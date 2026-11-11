/**
 * Access-token refresh coordination (P1-A12).
 *
 * Framework-free on purpose (no store, axios or React imports): the axios
 * interceptor, the SSE client and sign-out all share ONE coordinator, and the
 * logic can be unit-tested with fakes.
 *
 * Guarantees:
 *  - Single flight: concurrent 401s (axios and SSE alike) share one refresh
 *    request. Refresh tokens rotate on every use (auth-service, P1-A11), so a
 *    second concurrent refresh with the same token would be rejected.
 *  - No redundant refresh: a request that failed with an access token that has
 *    since been replaced simply retries with the current one.
 *  - Cross-tab safety: refreshes are serialised across tabs (Web Locks when
 *    available), and a tab that finds a newer token saved by another tab
 *    adopts it instead of spending its own stale refresh token.
 *  - Truthful failure: only an authentication rejection (401/403) from the
 *    refresh endpoint ends the session. A network error or 5xx keeps it, so a
 *    blip does not sign the user out.
 *  - Sign-out safety: a refresh that completes after the session changed
 *    (sign-out / another sign-in) never writes its tokens back.
 */

export interface SessionSnapshot {
  accessToken: string | null;
  refreshToken: string | null;
  sessionId: number;
  userId: string | null;
}

export interface PersistedTokens {
  accessToken: string | null;
  refreshToken: string | null;
  userId: string | null;
}

export interface RefreshResult {
  accessToken: string;
  refreshToken?: string;
}

export interface TokenRefreshDeps {
  getSession(): SessionSnapshot;
  /** The tokens as last saved by ANY tab (localStorage), or null. */
  readPersistedTokens(): PersistedTokens | null;
  setTokens(accessToken: string, refreshToken: string): void;
  /** POST /auth/refresh. Must reject with an error carrying `status` for HTTP failures. */
  requestRefresh(refreshToken: string): Promise<RefreshResult>;
  /** Tear the client session down (clearClientSession). */
  endSession(): void;
  /** Best effort: revoke tokens issued to a session that has since ended. */
  revokeRefreshToken?(refreshToken: string, accessToken: string): void;
  /** Run `fn` exclusively across tabs; defaults to running it directly. */
  withExclusiveLock?<T>(fn: () => Promise<T>): Promise<T>;
  /**
   * After a rejected refresh, how long to keep checking storage for tokens
   * another tab is about to save (it may have spent the same refresh token a
   * moment earlier). Matters where Web Locks are unavailable. Default 1500 ms.
   */
  raceWaitMs?: number;
  /** Injectable for tests. */
  sleep?(ms: number): Promise<void>;
}

/** The session is over (refresh token invalid, expired, revoked or reused). */
export class SessionExpiredError extends Error {
  constructor(message = "Your session has expired. Please sign in again.") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

/** The refresh could not be completed right now (network, 5xx); the session is kept. */
export class RefreshUnavailableError extends Error {
  constructor(
    message = "Could not reach the server to renew your session. Please try again."
  ) {
    super(message);
    this.name = "RefreshUnavailableError";
  }
}

const httpStatusOf = (error: unknown): number | undefined => {
  const err = error as { status?: unknown; response?: { status?: unknown } } | null;
  const status = err?.response?.status ?? err?.status;
  return typeof status === "number" ? status : undefined;
};

const isAuthRejection = (error: unknown) => {
  const status = httpStatusOf(error);
  return status === 401 || status === 403;
};

export const createTokenRefreshCoordinator = (deps: TokenRefreshDeps) => {
  let inFlight: Promise<string> | null = null;
  const withLock = deps.withExclusiveLock ?? (<T>(fn: () => Promise<T>) => fn());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const raceWaitMs = deps.raceWaitMs ?? 1500;
  const RACE_POLL_MS = 250;

  /**
   * Another tab may have rotated the tokens: if storage holds a different
   * refresh token for the same user, adopt it. Returns the access token.
   */
  const adoptTokensFromAnotherTab = (startSessionId: number): string | null => {
    const current = deps.getSession();
    if (current.sessionId !== startSessionId) return null;

    const persisted = deps.readPersistedTokens();
    if (
      persisted?.accessToken &&
      persisted.refreshToken &&
      persisted.refreshToken !== current.refreshToken &&
      persisted.userId !== null &&
      persisted.userId === current.userId
    ) {
      deps.setTokens(persisted.accessToken, persisted.refreshToken);
      return persisted.accessToken;
    }
    return null;
  };

  const endSessionIfStill = (startSessionId: number) => {
    if (deps.getSession().sessionId === startSessionId) {
      deps.endSession();
    }
  };

  const runRefresh = async (failedAccessToken: string | null | undefined): Promise<string> => {
    const start = deps.getSession();

    // The request failed with a token that has already been replaced (by a
    // refresh that finished meanwhile): retry with the current one.
    if (failedAccessToken && start.accessToken && start.accessToken !== failedAccessToken) {
      return start.accessToken;
    }

    return withLock(async () => {
      // While waiting for the lock another tab may have refreshed.
      const adopted = adoptTokensFromAnotherTab(start.sessionId);
      if (adopted) return adopted;

      const session = deps.getSession();
      if (session.sessionId !== start.sessionId) {
        throw new SessionExpiredError("Your session changed. Please try again.");
      }
      // Tokens already replaced in memory while waiting (e.g. adopted from
      // another tab's storage event): no need to rotate again.
      if (session.accessToken && session.accessToken !== start.accessToken) {
        return session.accessToken;
      }
      if (!session.refreshToken) {
        endSessionIfStill(start.sessionId);
        throw new SessionExpiredError();
      }

      let result: RefreshResult;
      try {
        result = await deps.requestRefresh(session.refreshToken);
      } catch (error) {
        if (!isAuthRejection(error)) {
          throw new RefreshUnavailableError();
        }
        // Rejected: possibly because another tab spent the same token a moment
        // earlier (without Web Locks the server answers this tab's copy with
        // 401 "already used"). That tab saves its rotated tokens to storage as
        // soon as its own response lands -- wait briefly for them before
        // concluding the session is over.
        for (let waited = 0; ; waited += RACE_POLL_MS) {
          // The cross-tab listener may already have copied them into this
          // tab's memory (storage event), or they are still only in storage.
          const current = deps.getSession();
          if (
            current.sessionId === start.sessionId &&
            current.accessToken &&
            current.refreshToken &&
            current.refreshToken !== session.refreshToken
          ) {
            return current.accessToken;
          }
          const adoptedAfterRace = adoptTokensFromAnotherTab(start.sessionId);
          if (adoptedAfterRace) return adoptedAfterRace;
          if (waited >= raceWaitMs) break;
          await sleep(RACE_POLL_MS);
        }

        endSessionIfStill(start.sessionId);
        throw new SessionExpiredError();
      }

      const newRefreshToken = result.refreshToken ?? session.refreshToken;

      // Signed out (or into another account) while the request was on the
      // wire: never resurrect the old session. Revoke what was just issued.
      if (deps.getSession().sessionId !== start.sessionId) {
        if (result.refreshToken) {
          deps.revokeRefreshToken?.(result.refreshToken, result.accessToken);
        }
        throw new SessionExpiredError("Your session changed. Please try again.");
      }

      deps.setTokens(result.accessToken, newRefreshToken);
      return result.accessToken;
    });
  };

  return {
    /**
     * Get a renewed access token. `failedAccessToken` is the token the failed
     * request carried (if any). Rejects with SessionExpiredError (session
     * ended) or RefreshUnavailableError (try again later, session kept).
     */
    refreshAccessToken(failedAccessToken?: string | null): Promise<string> {
      if (!inFlight) {
        inFlight = runRefresh(failedAccessToken).finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },

    /** Resolves once any refresh in progress has settled (success or not). */
    async waitForPendingRefresh(): Promise<void> {
      if (inFlight) {
        await inFlight.catch(() => undefined);
      }
    },
  };
};

export type TokenRefreshCoordinator = ReturnType<typeof createTokenRefreshCoordinator>;

/**
 * What a change to the persisted auth entry made by ANOTHER tab means for this
 * tab (window `storage` event).
 *  - "adopt":      same user, rotated tokens -> take them over
 *  - "signed-out": the other tab signed out -> end this session too
 *  - "reload":     a different account signed in -> reload to start clean
 *  - "ignore":     nothing relevant changed
 */
export const decideCrossTabAuthChange = (
  current: { isAuthenticated: boolean; userId: string | null; refreshToken: string | null },
  persisted: PersistedTokens & { isAuthenticated: boolean } | null
): "adopt" | "signed-out" | "reload" | "ignore" => {
  if (!persisted || !persisted.isAuthenticated || !persisted.refreshToken) {
    return current.isAuthenticated ? "signed-out" : "ignore";
  }
  if (!current.isAuthenticated) {
    return "reload";
  }
  if (persisted.userId !== current.userId) {
    return "reload";
  }
  return persisted.refreshToken !== current.refreshToken ? "adopt" : "ignore";
};

/** Parse the zustand-persist auth entry ("researchmind-auth"). */
export const parsePersistedAuth = (
  raw: string | null
): (PersistedTokens & { isAuthenticated: boolean }) | null => {
  if (!raw) return null;
  try {
    const state = JSON.parse(raw)?.state;
    if (!state || typeof state !== "object") return null;
    return {
      accessToken: typeof state.accessToken === "string" ? state.accessToken : null,
      refreshToken: typeof state.refreshToken === "string" ? state.refreshToken : null,
      userId: typeof state.user?.id === "string" ? state.user.id : null,
      isAuthenticated: state.isAuthenticated === true,
    };
  } catch {
    return null;
  }
};

export interface RevokeDeps {
  /** Resolves once a refresh in progress (if any) has settled. */
  waitForPendingRefresh(): Promise<void>;
  getTokens(): { accessToken: string | null; refreshToken: string | null };
  /** POST /auth/logout for this refresh token, without automatic refresh. */
  logout(refreshToken: string): Promise<unknown>;
  refreshAccessToken(failedAccessToken: string | null): Promise<string>;
}

/**
 * Revoke the CURRENT refresh token server-side (sign-out). Never throws;
 * resolves true when the server confirmed the revocation.
 *
 * The logout endpoint needs a valid access token. If it has expired, the
 * session is renewed first and the refresh token issued by that renewal is the
 * one revoked -- revoking the pre-renewal token would leave the new one valid
 * (ISS-040). A refresh already in flight is awaited for the same reason.
 */
export const revokeCurrentRefreshToken = async (deps: RevokeDeps): Promise<boolean> => {
  try {
    await deps.waitForPendingRefresh();

    const { refreshToken } = deps.getTokens();
    if (!refreshToken) return false;

    try {
      await deps.logout(refreshToken);
      return true;
    } catch (error) {
      if (httpStatusOf(error) !== 401) return false;
    }

    // Access token expired: renew, then revoke the token that is now current.
    await deps.refreshAccessToken(deps.getTokens().accessToken);
    const current = deps.getTokens().refreshToken;
    if (!current) return false;
    await deps.logout(current);
    return true;
  } catch {
    return false;
  }
};
