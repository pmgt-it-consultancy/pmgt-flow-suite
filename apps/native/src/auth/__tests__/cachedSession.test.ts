import {
  clearCachedSession,
  isSessionValid,
  readCachedSession,
  writeCachedSession,
} from "../cachedSession";

const mockStore = new Map<string, string>();

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn((k: string) => Promise.resolve(mockStore.get(k) ?? null)),
  setItemAsync: jest.fn((k: string, v: string) => {
    mockStore.set(k, v);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((k: string) => {
    mockStore.delete(k);
    return Promise.resolve();
  }),
}));

beforeEach(() => mockStore.clear());

const session = {
  userId: "u1",
  email: "a@b.com",
  name: "Test",
  roleId: "r1",
  permissions: ["x"],
  storeId: "s1",
  storeSnapshot: {},
  expiresAt: Date.now() + 1000,
};

describe("cachedSession", () => {
  it("round-trips a valid session", async () => {
    await writeCachedSession(session);
    expect(await readCachedSession()).toEqual(session);
  });

  it("isSessionValid rejects expired", () => {
    expect(isSessionValid({ ...session, expiresAt: Date.now() - 1 })).toBe(false);
    expect(isSessionValid({ ...session, expiresAt: Date.now() + 1000 })).toBe(true);
    expect(isSessionValid(null)).toBe(false);
  });

  it("clear removes the session", async () => {
    await writeCachedSession(session);
    await clearCachedSession();
    expect(await readCachedSession()).toBeNull();
  });
});
