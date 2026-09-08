import { SyncPhase, syncDiagnostics } from "../diagnostics";

afterEach(() => {
  syncDiagnostics.disable();
  jest.restoreAllMocks();
});

it("is opt-in, retains only the newest bounded numeric samples, and clears on disable", () => {
  let now = 0;
  const clock = jest.spyOn(performance, "now").mockImplementation(() => now);
  syncDiagnostics.begin(SyncPhase.PullNetwork, 1)(99);
  expect(clock).not.toHaveBeenCalled();
  expect(syncDiagnostics.snapshot()).toEqual([]);
  syncDiagnostics.enable();
  for (let row = 0; row < 300; row++) {
    const finish = syncDiagnostics.begin(SyncPhase.PullMap, 2);
    now += 5;
    finish(row);
  }
  const samples = syncDiagnostics.snapshot();
  expect(samples).toHaveLength(256);
  expect(samples[0]).toEqual({
    phase: SyncPhase.PullMap,
    page: 2,
    durationMs: 5,
    rows: 44,
    succeeded: 1,
  });
  expect(samples[255].rows).toBe(299);
  expect(
    samples.every((sample) => Object.values(sample).every((value) => typeof value === "number")),
  ).toBe(true);
  samples[0].rows = -1;
  expect(syncDiagnostics.snapshot()[0].rows).toBe(44);
  const stale = syncDiagnostics.begin(SyncPhase.PushNetwork, 3);
  syncDiagnostics.disable();
  syncDiagnostics.enable();
  stale(1);
  expect(syncDiagnostics.snapshot()).toEqual([]);
  syncDiagnostics.disable();
  expect(syncDiagnostics.snapshot()).toEqual([]);
});

it("exposes a local capture handle only in explicitly enabled profiling bundles", () => {
  const prior = process.env.EXPO_PUBLIC_POS_PERF;
  try {
    delete process.env.EXPO_PUBLIC_POS_PERF;
    jest.isolateModules(() => {
      require("../diagnostics");
    });
    expect(Object.getOwnPropertyDescriptor(globalThis, "__POS_SYNC_PERF__")).toBeUndefined();
    process.env.EXPO_PUBLIC_POS_PERF = "1";
    jest.isolateModules(() => {
      require("../diagnostics");
    });
    const handle = Object.getOwnPropertyDescriptor(globalThis, "__POS_SYNC_PERF__")?.value;
    expect(handle.snapshot()).toEqual([]);
    expect(typeof handle.enable).toBe("function");
    expect(typeof handle.disable).toBe("function");
    handle.disable();
  } finally {
    Reflect.deleteProperty(globalThis, "__POS_SYNC_PERF__");
    if (prior === undefined) delete process.env.EXPO_PUBLIC_POS_PERF;
    else process.env.EXPO_PUBLIC_POS_PERF = prior;
  }
});
