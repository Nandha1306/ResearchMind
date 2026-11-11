import assert from "node:assert";
import { test, describe } from "node:test";
import axios, { type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";
import {
  createTokenRefreshCoordinator,
  decideCrossTabAuthChange,
  parsePersistedAuth,
  revokeCurrentRefreshToken,
  RefreshUnavailableError,
  SessionExpiredError,
  type TokenRefreshDeps,
} from "../frontend/src/lib/token-refresh.ts";
import { attachAuthInterceptors } from "../frontend/src/api/auth-interceptors.ts";

/*
 * P1-A12 -- client-side refresh coordination. UNIT tests of the real frontend
 * modules (no browser): a fake session store and a fake refresh endpoint; the
 * interceptor tests use a real axios instance with a fake adapter.
 */

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

/** A fake client session plus a fake /auth/refresh that rotates tokens. */
const makeSession = (overrides: Partial<TokenRefreshDeps> = {}) => {
  const state = {
    accessToken: "access-0" as string | null,
    refreshToken: "refresh-0" as string | null,
    sessionId: 1,
    userId: "user-1" as string | null,
  };
  let persisted: { accessToken: string | null; refreshToken: string | null; userId: string | null } | null = null;
  const calls = { refresh: [] as string[], ended: 0, revoked: [] as string[] };
  let counter = 0;

  const deps: TokenRefreshDeps = {
    getSession: () => ({ ...state }),
    readPersistedTokens: () => persisted ?? { accessToken: state.accessToken, refreshToken: state.refreshToken, userId: state.userId },
    setTokens: (a, r) => {
      state.accessToken = a;
      state.refreshToken = r;
    },
    requestRefresh: async (refreshToken) => {
      calls.refresh.push(refreshToken);
      await new Promise((r) => setTimeout(r, 5));
      counter += 1;
      return { accessToken: `access-${counter}`, refreshToken: `refresh-${counter}` };
    },
    endSession: () => {
      calls.ended += 1;
      state.accessToken = null;
      state.refreshToken = null;
      state.sessionId += 1;
    },
    revokeRefreshToken: (r) => void calls.revoked.push(r),
    ...overrides,
  };
  return {
    state,
    calls,
    deps,
    setPersisted: (p: typeof persisted) => {
      persisted = p;
    },
  };
};

describe("token refresh coordinator (frontend/src/lib/token-refresh.ts)", () => {
  test("concurrent refreshes share ONE request (rotation-safe single flight)", async () => {
    const { deps, calls, state } = makeSession();
    const coordinator = createTokenRefreshCoordinator(deps);
    const tokens = await Promise.all(Array.from({ length: 5 }, () => coordinator.refreshAccessToken("access-0")));
    assert.deepStrictEqual(calls.refresh, ["refresh-0"]);
    assert.ok(tokens.every((t) => t === "access-1"));
    assert.strictEqual(state.refreshToken, "refresh-1");
  });

  test("a request that failed with an already-replaced token retries without a new refresh", async () => {
    const { deps, calls, state } = makeSession();
    const coordinator = createTokenRefreshCoordinator(deps);
    await coordinator.refreshAccessToken("access-0"); // -> access-1
    const token = await coordinator.refreshAccessToken("access-0"); // late 401 from the old token
    assert.strictEqual(token, "access-1");
    assert.strictEqual(calls.refresh.length, 1);
    assert.strictEqual(state.accessToken, "access-1");
  });

  test("a rejected refresh (401) ends the session once and reports SessionExpired", async () => {
    const { deps, calls } = makeSession({ requestRefresh: async () => Promise.reject(httpError(401)), raceWaitMs: 0 });
    const coordinator = createTokenRefreshCoordinator(deps);
    await assert.rejects(coordinator.refreshAccessToken("access-0"), SessionExpiredError);
    assert.strictEqual(calls.ended, 1);
  });

  test("a network error / 5xx keeps the session (no logout on a blip)", async () => {
    for (const failure of [new TypeError("fetch failed"), httpError(502)]) {
      const { deps, calls, state } = makeSession({ requestRefresh: async () => Promise.reject(failure) });
      const coordinator = createTokenRefreshCoordinator(deps);
      await assert.rejects(coordinator.refreshAccessToken("access-0"), RefreshUnavailableError);
      assert.strictEqual(calls.ended, 0);
      assert.strictEqual(state.refreshToken, "refresh-0");
    }
  });

  test("no refresh token: the session ends without a network call", async () => {
    const session = makeSession();
    session.state.refreshToken = null;
    const coordinator = createTokenRefreshCoordinator(session.deps);
    await assert.rejects(coordinator.refreshAccessToken("access-0"), SessionExpiredError);
    assert.strictEqual(session.calls.refresh.length, 0);
    assert.strictEqual(session.calls.ended, 1);
  });

  test("sign-out during a refresh: new tokens are not written back, and are revoked", async () => {
    const session = makeSession();
    const coordinator = createTokenRefreshCoordinator(session.deps);
    const pending = coordinator.refreshAccessToken("access-0");
    // The user signs out while the refresh is on the wire.
    session.state.sessionId += 1;
    session.state.accessToken = null;
    session.state.refreshToken = null;
    await assert.rejects(pending, SessionExpiredError);
    assert.strictEqual(session.state.refreshToken, null, "old session not resurrected");
    assert.deepStrictEqual(session.calls.revoked, ["refresh-1"]);
  });

  test("lost a race with another tab: adopts the tokens that tab saved instead of logging out", async () => {
    const session = makeSession({
      requestRefresh: async () => {
        // Another tab already rotated refresh-0 and saved its result.
        session.setPersisted({ accessToken: "tab2-access", refreshToken: "tab2-refresh", userId: "user-1" });
        return Promise.reject(httpError(401));
      },
    });
    const coordinator = createTokenRefreshCoordinator(session.deps);
    assert.strictEqual(await coordinator.refreshAccessToken("access-0"), "tab2-access");
    assert.strictEqual(session.calls.ended, 0);
    assert.strictEqual(session.state.refreshToken, "tab2-refresh");
  });

  test("no Web Locks: a tab that loses the race waits for the winner's tokens instead of logging out", async () => {
    const session = makeSession({
      requestRefresh: async () => {
        // The other tab spent refresh-0 first; its result is saved 300 ms later.
        setTimeout(
          () => session.setPersisted({ accessToken: "late-access", refreshToken: "late-refresh", userId: "user-1" }),
          300
        );
        return Promise.reject(httpError(401));
      },
      raceWaitMs: 1500,
    });
    const coordinator = createTokenRefreshCoordinator(session.deps);
    assert.strictEqual(await coordinator.refreshAccessToken("access-0"), "late-access");
    assert.strictEqual(session.calls.ended, 0);
  });

  test("race lost, and the cross-tab listener already copied the winner's tokens into memory", async () => {
    const session = makeSession({
      requestRefresh: async () => {
        setTimeout(() => {
          // What installCrossTabSessionSync does on the storage event: memory
          // and storage both hold the winner's tokens.
          session.setPersisted({ accessToken: "synced-access", refreshToken: "synced-refresh", userId: "user-1" });
          session.state.accessToken = "synced-access";
          session.state.refreshToken = "synced-refresh";
        }, 300);
        return Promise.reject(httpError(401));
      },
      raceWaitMs: 1500,
    });
    const coordinator = createTokenRefreshCoordinator(session.deps);
    assert.strictEqual(await coordinator.refreshAccessToken("access-0"), "synced-access");
    assert.strictEqual(session.calls.ended, 0, "not signed out");
  });

  test("a genuinely rejected refresh ends the session after the bounded wait", async () => {
    const slept: number[] = [];
    const session = makeSession({
      requestRefresh: async () => Promise.reject(httpError(401)),
      raceWaitMs: 500,
      sleep: async (ms) => void slept.push(ms),
    });
    const coordinator = createTokenRefreshCoordinator(session.deps);
    await assert.rejects(coordinator.refreshAccessToken("access-0"), SessionExpiredError);
    assert.strictEqual(session.calls.ended, 1);
    assert.ok(slept.reduce((a, b) => a + b, 0) <= 500, "bounded");
  });

  test("tokens replaced in memory while waiting for the lock: no second rotation", async () => {
    const session = makeSession({
      withExclusiveLock: async (fn) => {
        // While this tab waited, a storage event adopted another tab's tokens.
        session.state.accessToken = "adopted-access";
        session.state.refreshToken = "adopted-refresh";
        session.setPersisted({ accessToken: "adopted-access", refreshToken: "adopted-refresh", userId: "user-1" });
        return fn();
      },
    });
    const coordinator = createTokenRefreshCoordinator(session.deps);
    assert.strictEqual(await coordinator.refreshAccessToken("access-0"), "adopted-access");
    assert.strictEqual(session.calls.refresh.length, 0);
  });

  test("tokens saved by another tab for a DIFFERENT user are never adopted", async () => {
    const session = makeSession({
      requestRefresh: async () => {
        session.setPersisted({ accessToken: "x", refreshToken: "other-user-refresh", userId: "user-2" });
        return Promise.reject(httpError(401));
      },
    });
    const coordinator = createTokenRefreshCoordinator(session.deps);
    await assert.rejects(coordinator.refreshAccessToken("access-0"), SessionExpiredError);
    assert.strictEqual(session.calls.ended, 1);
  });

  test("with a cross-tab lock, a tab that waited adopts the other tab's result (no second refresh)", async () => {
    // Two tabs share storage and a lock; each has its own coordinator.
    let storage = { accessToken: "access-0", refreshToken: "refresh-0", userId: "user-1" };
    let lockChain: Promise<unknown> = Promise.resolve();
    const withExclusiveLock = <T,>(fn: () => Promise<T>) => {
      const run = lockChain.then(fn);
      lockChain = run.catch(() => undefined);
      return run;
    };
    let serverToken = "refresh-0";
    const refreshCalls: string[] = [];
    const makeTab = () => {
      const tab = { accessToken: "access-0", refreshToken: "refresh-0" };
      const coordinator = createTokenRefreshCoordinator({
        getSession: () => ({ ...tab, sessionId: 1, userId: "user-1" }),
        readPersistedTokens: () => ({ ...storage }),
        setTokens: (a, r) => {
          tab.accessToken = a;
          tab.refreshToken = r;
          storage = { accessToken: a, refreshToken: r, userId: "user-1" };
        },
        requestRefresh: async (token) => {
          refreshCalls.push(token);
          if (token !== serverToken) throw httpError(401); // rotated: reuse rejected
          serverToken = `${token}-next`;
          return { accessToken: `${serverToken}-access`, refreshToken: serverToken };
        },
        endSession: () => assert.fail("no tab may be signed out"),
        withExclusiveLock,
      });
      return { tab, coordinator };
    };
    const tab1 = makeTab();
    const tab2 = makeTab();
    const [t1, t2] = await Promise.all([
      tab1.coordinator.refreshAccessToken("access-0"),
      tab2.coordinator.refreshAccessToken("access-0"),
    ]);
    assert.deepStrictEqual(refreshCalls, ["refresh-0"], "only one tab spent the refresh token");
    assert.strictEqual(t1, t2);
    assert.strictEqual(tab2.tab.refreshToken, "refresh-0-next");
  });

  test("waitForPendingRefresh resolves after the in-flight refresh, even when it fails", async () => {
    const { deps } = makeSession({ requestRefresh: async () => Promise.reject(httpError(401)) });
    const coordinator = createTokenRefreshCoordinator(deps);
    const pending = coordinator.refreshAccessToken("access-0").catch(() => "failed");
    await coordinator.waitForPendingRefresh();
    assert.strictEqual(await pending, "failed");
  });
});

describe("axios auth interceptors (frontend/src/api/auth-interceptors.ts)", () => {
  /** A fake server: 401 unless the request carries the currently valid token. */
  const makeClient = (opts: { refresh?: () => Promise<string>; validToken?: () => string } = {}) => {
    let valid = "access-1";
    let accessToken = "access-0";
    const seen: Array<{ url?: string; auth?: string }> = [];
    let refreshCount = 0;
    const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
      const auth = String(config.headers?.Authorization ?? "");
      seen.push({ url: config.url, auth });
      const ok = auth === `Bearer ${(opts.validToken ?? (() => valid))()}`;
      const response = { data: { ok }, status: ok ? 200 : 401, statusText: "", headers: {}, config };
      if (!ok) {
        throw Object.assign(new Error("401"), { config, response, isAxiosError: true });
      }
      return response;
    };
    const instance = axios.create({ adapter });
    attachAuthInterceptors(instance, {
      getAccessToken: () => accessToken,
      coordinator: {
        refreshAccessToken: async () => {
          refreshCount += 1;
          const next = opts.refresh ? await opts.refresh() : "access-1";
          accessToken = next;
          return next;
        },
      },
    });
    return {
      instance,
      seen,
      refreshCount: () => refreshCount,
      setValid: (v: string) => {
        valid = v;
      },
    };
  };

  test("a 401 refreshes once and retries with the new token", async () => {
    const client = makeClient();
    const res = await client.instance.get("/tasks");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(client.refreshCount(), 1);
    assert.deepStrictEqual(client.seen.map((s) => s.auth), ["Bearer access-0", "Bearer access-1"]);
  });

  test("no refresh loop: a 401 after the refresh is final", async () => {
    const client = makeClient();
    client.setValid("never-valid");
    await assert.rejects(client.instance.get("/tasks"), (err: any) => err.response?.status === 401);
    assert.strictEqual(client.refreshCount(), 1);
    assert.strictEqual(client.seen.length, 2);
  });

  test("login / register / refresh 401s are never treated as an expired session", async () => {
    for (const url of ["/auth/login", "/auth/register", "/auth/refresh"]) {
      const client = makeClient();
      await assert.rejects(client.instance.post(url, {}), (err: any) => err.response?.status === 401);
      assert.strictEqual(client.refreshCount(), 0, url);
    }
  });

  test("skipAuthRefresh (logout) is not refreshed-and-retried", async () => {
    const client = makeClient();
    await assert.rejects(client.instance.post("/auth/logout", {}, { skipAuthRefresh: true }));
    assert.strictEqual(client.refreshCount(), 0);
  });

  test("an ended session rejects with the original 401; a transient failure with its own error", async () => {
    const expired = makeClient({ refresh: async () => Promise.reject(new SessionExpiredError()) });
    await assert.rejects(expired.instance.get("/x"), (err: any) => err.response?.status === 401);

    const blip = makeClient({ refresh: async () => Promise.reject(new RefreshUnavailableError()) });
    await assert.rejects(blip.instance.get("/x"), RefreshUnavailableError);
  });
});

describe("sign-out revocation (revokeCurrentRefreshToken)", () => {
  test("revokes the current refresh token", async () => {
    const revoked: string[] = [];
    const ok = await revokeCurrentRefreshToken({
      waitForPendingRefresh: async () => {},
      getTokens: () => ({ accessToken: "a", refreshToken: "r-current" }),
      logout: async (r) => void revoked.push(r),
      refreshAccessToken: async () => assert.fail("no refresh needed"),
    });
    assert.strictEqual(ok, true);
    assert.deepStrictEqual(revoked, ["r-current"]);
  });

  test("expired access token: renews, then revokes the NEW refresh token (ISS-040)", async () => {
    const tokens = { accessToken: "expired", refreshToken: "r-old" };
    const revoked: string[] = [];
    const ok = await revokeCurrentRefreshToken({
      waitForPendingRefresh: async () => {},
      getTokens: () => ({ ...tokens }),
      logout: async (r) => {
        if (tokens.accessToken === "expired") throw httpError(401);
        revoked.push(r);
      },
      refreshAccessToken: async () => {
        tokens.accessToken = "fresh";
        tokens.refreshToken = "r-new";
        return "fresh";
      },
    });
    assert.strictEqual(ok, true);
    assert.deepStrictEqual(revoked, ["r-new"], "the rotated token is the one revoked");
  });

  test("waits for an in-flight refresh so the newest token is revoked", async () => {
    const tokens = { accessToken: "a", refreshToken: "r-before" };
    const revoked: string[] = [];
    await revokeCurrentRefreshToken({
      waitForPendingRefresh: async () => {
        await new Promise((r) => setTimeout(r, 5));
        tokens.refreshToken = "r-after"; // the refresh completed meanwhile
      },
      getTokens: () => ({ ...tokens }),
      logout: async (r) => void revoked.push(r),
      refreshAccessToken: async () => "a",
    });
    assert.deepStrictEqual(revoked, ["r-after"]);
  });

  test("never throws; reports false when the server could not revoke", async () => {
    const ok = await revokeCurrentRefreshToken({
      waitForPendingRefresh: async () => {},
      getTokens: () => ({ accessToken: "a", refreshToken: "r" }),
      logout: async () => Promise.reject(httpError(503)),
      refreshAccessToken: async () => "a",
    });
    assert.strictEqual(ok, false);
  });
});

describe("cross-tab session sync decisions", () => {
  const me = { isAuthenticated: true, userId: "user-1", refreshToken: "r1" };
  const saved = (o: Partial<{ accessToken: string | null; refreshToken: string | null; userId: string | null; isAuthenticated: boolean }>) => ({
    accessToken: "a2", refreshToken: "r2", userId: "user-1", isAuthenticated: true, ...o,
  });

  test("another tab rotated the tokens -> adopt", () => {
    assert.strictEqual(decideCrossTabAuthChange(me, saved({})), "adopt");
  });
  test("nothing changed -> ignore", () => {
    assert.strictEqual(decideCrossTabAuthChange(me, saved({ refreshToken: "r1" })), "ignore");
  });
  test("another tab signed out -> signed-out", () => {
    assert.strictEqual(decideCrossTabAuthChange(me, null), "signed-out");
    assert.strictEqual(decideCrossTabAuthChange(me, saved({ isAuthenticated: false, refreshToken: null })), "signed-out");
  });
  test("another account signed in -> reload (never mix two users' state)", () => {
    assert.strictEqual(decideCrossTabAuthChange(me, saved({ userId: "user-2" })), "reload");
  });
  test("this tab signed out, another signed in -> reload", () => {
    assert.strictEqual(decideCrossTabAuthChange({ isAuthenticated: false, userId: null, refreshToken: null }, saved({})), "reload");
  });
  test("parsePersistedAuth reads the zustand entry and tolerates garbage", () => {
    const raw = JSON.stringify({ state: { user: { id: "u" }, accessToken: "a", refreshToken: "r", isAuthenticated: true }, version: 0 });
    assert.deepStrictEqual(parsePersistedAuth(raw), { accessToken: "a", refreshToken: "r", userId: "u", isAuthenticated: true });
    assert.strictEqual(parsePersistedAuth("{not json"), null);
    assert.strictEqual(parsePersistedAuth(null), null);
  });
});
