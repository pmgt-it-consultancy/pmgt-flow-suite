import { synchronize } from "@nozbe/watermelondb/sync";
import NetInfo from "@react-native-community/netinfo";
import { SyncPhase, syncDiagnostics } from "../diagnostics";

const originalUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
process.env.EXPO_PUBLIC_CONVEX_URL = "https://test.convex.cloud";
const { syncManager }: typeof import("../SyncManager") = require("../SyncManager");
const { setAuthTokenFn }: typeof import("../syncEndpoints") = require("../syncEndpoints");
if (originalUrl === undefined) delete process.env.EXPO_PUBLIC_CONVEX_URL;
else process.env.EXPO_PUBLIC_CONVEX_URL = originalUrl;

const mockLocalRead = jest.fn(async (): Promise<string | null> => "1");

jest.mock("@react-native-community/netinfo", () => ({
  addEventListener: jest.fn(() => jest.fn()),
}));
jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(async () => "device") }));
jest.mock("../../db", () => ({
  getDatabase: () => ({ adapter: { getLocal: mockLocalRead, setLocal: async () => {} } }),
}));
jest.mock("@nozbe/watermelondb/sync", () => ({ synchronize: jest.fn() }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function settle() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

describe("sync manager lifecycle", () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    global.fetch = fetchMock;
    setAuthTokenFn(async () => "token");
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.endsWith("registerDevice")
          ? { deviceCode: "01" }
          : { changes: {}, timestamp: 100, complete: true },
    }));
    jest.mocked(synchronize).mockImplementation(async ({ pullChanges, pushChanges }) => {
      await pullChanges({ lastPulledAt: 10, schemaVersion: 1, migration: null });
      await pushChanges!({ changes: {}, lastPulledAt: 100 });
    });
  });
  afterEach(() => {
    syncManager.stop();
    syncDiagnostics.disable();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("coalesces writes during a run and syncNow waits for their follow-up", async () => {
    const first = deferred();
    const second = deferred();
    const apply = jest.mocked(synchronize).getMockImplementation()!;
    jest
      .mocked(synchronize)
      .mockImplementationOnce(async (options) => {
        await first.promise;
        await apply(options);
      })
      .mockImplementationOnce(async (options) => {
        await second.promise;
        await apply(options);
      });
    await syncManager.start("store");
    await settle();
    syncManager.triggerPush();
    syncManager.triggerPush();
    await jest.advanceTimersByTimeAsync(500);
    let finished = false;
    const completion = syncManager.syncNow().then(() => {
      finished = true;
    });
    await settle();
    expect(finished).toBe(false);
    first.resolve();
    await settle();
    await jest.advanceTimersByTimeAsync(0);
    expect(synchronize).toHaveBeenCalledTimes(2);
    expect(finished).toBe(false);
    second.resolve();
    await completion;
    expect(finished).toBe(true);
  });

  it("does not start a push or queued follow-up after stopping during pull", async () => {
    const pulled = deferred();
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("pull")) await pulled.promise;
      return {
        ok: true,
        json: async () =>
          url.endsWith("registerDevice")
            ? { deviceCode: "01" }
            : { changes: {}, timestamp: 100, complete: true },
      };
    });
    jest.mocked(synchronize).mockImplementation(async ({ pullChanges, pushChanges }) => {
      await pullChanges({ lastPulledAt: 10, schemaVersion: 1, migration: null });
      await pushChanges!({
        changes: { orders: { created: [], updated: [{ id: "local" }], deleted: [] } },
        lastPulledAt: 100,
      });
    });
    await syncManager.start("store");
    await settle();
    syncManager.triggerPush();
    const completion = syncManager.syncNow();
    syncManager.stop();
    pulled.resolve();
    await completion;
    await jest.advanceTimersByTimeAsync(60_000);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("push"))).toHaveLength(0);
    expect(synchronize).toHaveBeenCalledTimes(1);
  });

  it("separates endpoint elapsed time from mapping and local apply/read time", async () => {
    let now = 0;
    jest.spyOn(performance, "now").mockImplementation(() => now);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("pull")) now += 20;
      if (url.endsWith("push")) now += 30;
      return {
        ok: true,
        json: async () =>
          url.endsWith("registerDevice")
            ? { deviceCode: "01" }
            : { changes: {}, timestamp: 100, complete: true },
      };
    });
    jest.mocked(synchronize).mockImplementation(async ({ pullChanges, pushChanges }) => {
      await pullChanges({ lastPulledAt: 10, schemaVersion: 1, migration: null });
      now += 7;
      await pushChanges!({
        changes: {
          orders: {
            created: [],
            updated: [{ id: "private-order", customer_name: "private-customer" }],
            deleted: [],
          },
        },
        lastPulledAt: 100,
      });
      now += 3;
    });
    syncDiagnostics.enable();
    await syncManager.start("store");
    await settle();
    expect(syncManager.getState().status).toBe("idle");
    const samples = syncDiagnostics.snapshot();
    expect(samples.map(({ phase, durationMs }) => [phase, durationMs])).toEqual([
      [SyncPhase.PullNetwork, 20],
      [SyncPhase.PullMap, 0],
      [SyncPhase.ApplyPreparation, 0],
      [SyncPhase.ApplyAndReadLocal, 7],
      [SyncPhase.PushMap, 0],
      [SyncPhase.PushNetwork, 30],
      [SyncPhase.SynchronizeTotal, 60],
    ]);
    expect(JSON.stringify(samples)).not.toContain("private");
  });

  it("preserves pagination cursors and original since while yielding between pages", async () => {
    let pulls = 0;
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.endsWith("registerDevice")
          ? { deviceCode: "01" }
          : {
              changes: {},
              timestamp: 100,
              complete: ++pulls === 2,
              cursors: { orders: "next-page" },
            },
    }));
    let localCursor = 10;
    jest.mocked(synchronize).mockImplementation(async ({ pullChanges, pushChanges }) => {
      const result = await pullChanges({
        lastPulledAt: localCursor,
        schemaVersion: 1,
        migration: null,
      });
      if (!("timestamp" in result)) throw new Error("Expected incremental pull result");
      localCursor = result.timestamp;
      await pushChanges?.({ changes: {}, lastPulledAt: localCursor });
    });
    await syncManager.start("store");
    await settle();
    expect(pulls).toBe(1);
    expect(syncManager.getState().progress?.pageIndex).toBe(2);
    await jest.advanceTimersByTimeAsync(0);
    expect(pulls).toBe(2);
    const requests = fetchMock.mock.calls.filter(([url]) => url.endsWith("pull"));
    expect(JSON.parse(requests[1][1].body)).toEqual({
      lastPulledAt: 10,
      cursors: { orders: "next-page" },
      serverNow: 100,
    });
    expect(syncManager.getState().status).toBe("idle");
  });

  it("retains queued work offline and drains it when connectivity returns", async () => {
    await syncManager.start("store");
    await settle();
    const notify = jest.mocked(NetInfo.addEventListener).mock.calls[0][0];
    notify({ isConnected: false } as Parameters<typeof notify>[0]);
    syncManager.triggerPush();
    await jest.advanceTimersByTimeAsync(500);
    await syncManager.syncNow();
    expect(synchronize).toHaveBeenCalledTimes(1);
    expect(syncManager.getState().status).toBe("offline");
    notify({ isConnected: true, isInternetReachable: true } as Parameters<typeof notify>[0]);
    await settle();
    expect(synchronize).toHaveBeenCalledTimes(2);
    expect(syncManager.getState().status).toBe("idle");
  });

  it("backs off a failed active pass despite queued writes and cancels retry on stop", async () => {
    const blocked = deferred();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.mocked(synchronize).mockImplementationOnce(async () => {
      await blocked.promise;
      throw new Error("network unavailable");
    });
    await syncManager.start("store");
    await settle();
    syncManager.triggerPush();
    const completion = syncManager.syncNow();
    blocked.resolve();
    await completion;
    await jest.advanceTimersByTimeAsync(1999);
    expect(synchronize).toHaveBeenCalledTimes(1);
    expect(syncManager.getState().status).toBe("error");
    await jest.advanceTimersByTimeAsync(1);
    expect(synchronize).toHaveBeenCalledTimes(2);
    expect(syncManager.getState().status).toBe("idle");
    jest.mocked(synchronize).mockRejectedValueOnce(new Error("network unavailable"));
    await syncManager.syncNow();
    syncManager.stop();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(synchronize).toHaveBeenCalledTimes(3);
  });

  it("does not register or install timers if stopped during startup storage read", async () => {
    const storage = deferred();
    mockLocalRead.mockImplementationOnce(async () => {
      await storage.promise;
      return "1";
    });
    const starting = syncManager.start("store");
    await settle();
    syncManager.stop();
    storage.resolve();
    await starting;
    await jest.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(NetInfo.addEventListener).not.toHaveBeenCalled();
    expect(synchronize).not.toHaveBeenCalled();
  });

  it("delivers a write made on a later pull page instead of marking an unsent write synced", async () => {
    let pulls = 0;
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.endsWith("registerDevice")
          ? { deviceCode: "01" }
          : { changes: {}, timestamp: 100, complete: !url.endsWith("pull") || ++pulls !== 1 },
    }));
    let outbox: { id: string }[] = [{ id: "initial-write" }];
    jest.mocked(synchronize).mockImplementation(async ({ pullChanges, pushChanges }) => {
      await pullChanges({ lastPulledAt: 10, schemaVersion: 1, migration: null });
      if (pulls === 2) {
        outbox = [{ id: "late-write" }];
        syncManager.triggerPush();
      }
      // Watermelon marks fetched local changes synced after a successful
      // push callback, even when that callback returned without sending.
      if (pushChanges && outbox.length) {
        await pushChanges({
          changes: { orders: { created: outbox, updated: [], deleted: [] } },
          lastPulledAt: 100,
        });
        outbox = [];
      }
    });
    await syncManager.start("store");
    await settle();
    await jest.advanceTimersByTimeAsync(5);
    const pushes = fetchMock.mock.calls.filter(([url]) => url.endsWith("push"));
    expect(pushes).toHaveLength(2);
    expect(JSON.parse(pushes[1][1].body).changes.orders.created).toEqual([{ id: "late-write" }]);
  });

  it("waits for the new session when restarted before the old run settles", async () => {
    const oldRun = deferred();
    const newRun = deferred();
    const apply = jest.mocked(synchronize).getMockImplementation()!;
    jest
      .mocked(synchronize)
      .mockImplementationOnce(async (options) => {
        await oldRun.promise;
        await apply(options);
      })
      .mockImplementationOnce(async (options) => {
        await newRun.promise;
        await apply(options);
      });
    await syncManager.start("old-store");
    await settle();
    syncManager.stop();
    await syncManager.start("new-store");
    let finished = false;
    const completion = syncManager.syncNow().then(() => {
      finished = true;
    });
    oldRun.resolve();
    await settle();
    expect(synchronize).toHaveBeenCalledTimes(2);
    expect(finished).toBe(false);
    newRun.resolve();
    await completion;
    expect(syncManager.getState().status).toBe("idle");
  });

  it.each([
    10,
    null,
  ])("restarts an interrupted partial pull from watermark %s", async (initialCursor) => {
    let pulls = 0;
    let durableCursor = initialCursor;
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.endsWith("registerDevice")
          ? { deviceCode: "01" }
          : { changes: {}, timestamp: 100, complete: ++pulls > 1, cursors: { orders: "next" } },
    }));
    jest.mocked(synchronize).mockImplementation(async ({ pullChanges }) => {
      const result = await pullChanges({
        lastPulledAt: durableCursor,
        schemaVersion: 1,
        migration: null,
      });
      if (!("timestamp" in result)) throw new Error("Expected incremental result");
      durableCursor = result.timestamp;
    });
    await syncManager.start("store");
    await settle();
    expect(pulls).toBe(1);
    syncManager.stop();
    await jest.advanceTimersByTimeAsync(0);
    await syncManager.start("store");
    await settle();
    const requests = fetchMock.mock.calls.filter(([url]) => url.endsWith("pull"));
    expect(JSON.parse(requests[1][1].body)).toEqual({ lastPulledAt: initialCursor });
    expect(durableCursor).toBe(100);
  });

  it("drains a request arriving as the active promise finishes", async () => {
    let syncing = false;
    let requested = false;
    let completion: Promise<void> | undefined;
    const unsubscribe = syncManager.subscribe((state) => {
      if (state.status === "syncing") syncing = true;
      if (syncing && state.status === "idle" && !requested) {
        requested = true;
        void Promise.resolve().then(() =>
          Promise.resolve().then(() => {
            completion = syncManager.syncNow();
          }),
        );
      }
    });
    await syncManager.start("store");
    await settle();
    await completion;
    unsubscribe();
    expect(synchronize).toHaveBeenCalledTimes(2);
  });
});
