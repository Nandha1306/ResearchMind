/*
 * Wave 6 (WP-9; W6-TEST-19, W6-CI-05, W6-CI-06; scope amendments A-4, A-5,
 * R9, R10): ONE implementation of the "disposable infrastructure only" rule
 * for every connection string a test process uses. Applied locally AND in CI.
 *
 * A MongoDB or Redis target is accepted only when
 *   - the scheme is mongodb:// (never mongodb+srv://) or redis:// / rediss://;
 *   - EVERY host is loopback: 127.0.0.1, localhost or ::1 ([::1]);
 *   - no port is the default one: 27017 / 6379, and an omitted port counts
 *     as the default (refused);
 *   - (TEST_MONGO_URI) a URI with credentials also names authSource: two
 *     suites rewrite the database path, and the path would otherwise become
 *     the authentication database (code 18 AuthenticationFailed).
 *
 * Errors name the variable and the rule only. They never contain the URI,
 * its host or its password (A-4, R9).
 */

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

export class InfraTargetError extends Error {
  constructor(variable: string, rule: string) {
    super(`${variable}: ${rule}`);
    this.name = "InfraTargetError";
  }
}

interface ParsedTarget {
  scheme: string;
  hasCredentials: boolean;
  hosts: Array<{ host: string; port: string }>;
  path: string;
  query: URLSearchParams;
}

/** Strict, dependency-free parse of scheme://[userinfo@]host[:port][,host[:port]...][/path][?query]. */
const parseTarget = (variable: string, value: string): ParsedTarget => {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?$/i.exec(value.trim());
  if (!match) throw new InfraTargetError(variable, "is not a valid connection URI");
  const [, scheme, authority, path, query] = match;
  const at = authority.lastIndexOf("@");
  const userinfo = at === -1 ? "" : authority.slice(0, at);
  const hostList = at === -1 ? authority : authority.slice(at + 1);
  if (hostList === "") throw new InfraTargetError(variable, "has no host");
  const hosts = hostList.split(",").map((entry) => {
    const ipv6 = /^\[([^\]]+)\](?::(\d*))?$/.exec(entry);
    if (ipv6) return { host: ipv6[1].toLowerCase(), port: ipv6[2] ?? "" };
    const parts = entry.split(":");
    if (parts.length > 2) throw new InfraTargetError(variable, "has an IPv6 host without [brackets]");
    return { host: parts[0].toLowerCase(), port: parts[1] ?? "" };
  });
  return {
    scheme: scheme.toLowerCase(),
    hasCredentials: userinfo !== "",
    hosts,
    path,
    query: new URLSearchParams(query ? query.slice(1) : ""),
  };
};

const checkHosts = (variable: string, target: ParsedTarget, defaultPort: string) => {
  for (const { host, port } of target.hosts) {
    if (!LOOPBACK.has(host)) {
      throw new InfraTargetError(variable, "must point at a loopback host (127.0.0.1, localhost or ::1); remote and 0.0.0.0 hosts are refused");
    }
    if (port === "") {
      throw new InfraTargetError(
        variable,
        `must use a non-default port: ${defaultPort} (or an omitted port) is where a developer's real server listens`
      );
    }
    // Strict, numeric (Wave 6 Stage E, W6-R5-03): drivers read "06379" as 6379.
    if (!/^\d+$/.test(port)) throw new InfraTargetError(variable, "has an invalid port");
    if (port.length > 1 && port.startsWith("0")) {
      throw new InfraTargetError(variable, "must write the port in canonical form (no leading zeros)");
    }
    const portNumber = Number(port);
    if (portNumber < 1 || portNumber > 65535) throw new InfraTargetError(variable, "has an invalid port (1-65535)");
    if (portNumber === Number(defaultPort)) {
      throw new InfraTargetError(
        variable,
        `must use a non-default port: ${defaultPort} (or an omitted port) is where a developer's real server listens`
      );
    }
  }
};

/** A MongoDB URI a test may connect to (TEST_MONGO_URI, MONGO_URI). */
export const assertDisposableMongoUri = (variable: string, value: string, options: { requireAuthSource?: boolean } = {}) => {
  const target = parseTarget(variable, value);
  if (target.scheme === "mongodb+srv") throw new InfraTargetError(variable, "mongodb+srv:// is refused (DNS seed lists cannot be checked)");
  if (target.scheme !== "mongodb") throw new InfraTargetError(variable, "must start with mongodb://");
  checkHosts(variable, target, "27017");
  if ((options.requireAuthSource ?? true) && target.hasCredentials && !target.query.get("authSource")) {
    throw new InfraTargetError(
      variable,
      "has credentials but no authSource: add ?authSource=admin (the tests rewrite the database path, which would otherwise become the authentication database)"
    );
  }
};

/** A Redis URL a test may connect to (TEST_REDIS_URL, REDIS_URL). */
export const assertDisposableRedisUrl = (variable: string, value: string) => {
  const target = parseTarget(variable, value);
  if (target.scheme !== "redis" && target.scheme !== "rediss") throw new InfraTargetError(variable, "must start with redis:// or rediss://");
  if (target.hosts.length !== 1) throw new InfraTargetError(variable, "must name exactly one host");
  checkHosts(variable, target, "6379");
  const db = target.path.replace(/^\//, "");
  if (db !== "" && !/^\d+$/.test(db)) throw new InfraTargetError(variable, "has a database index that is not a number");
};

/** Dead ports: nothing listens there, so a forgotten URL fails fast. */
export const DEAD_REDIS_URL = "redis://127.0.0.1:6399";
export const DEAD_MONGO_URI = "mongodb://127.0.0.1:6598/rmtest_unused";

/**
 * A-5 / R10: before any service module is imported, REDIS_URL and MONGO_URI
 * of the test process are either unset (then set to dead ports, so a
 * service's own fallback to 6379 / 27017 is never used) or a disposable
 * loopback target. Called at import by tests/helpers/test-env.ts.
 */
export const applySafeConnectionDefaults = (env: NodeJS.ProcessEnv = process.env) => {
  if (!env.REDIS_URL) env.REDIS_URL = DEAD_REDIS_URL;
  if (!env.MONGO_URI) env.MONGO_URI = DEAD_MONGO_URI;
  assertDisposableRedisUrl("REDIS_URL", env.REDIS_URL);
  assertDisposableMongoUri("MONGO_URI", env.MONGO_URI, { requireAuthSource: false });
};
