import { Request, Response, NextFunction } from "express";

/**
 * Reject request paths that different parsers in the gateway could read
 * differently (SEC-003).
 *
 * Express routes on the raw path, while http-proxy and http-proxy-middleware
 * rebuild the upstream path with `url.parse` and collapse repeated slashes,
 * map `\` to `/` and so on. A path such as `/api/auth//login` or
 * `/api/ai\query` therefore skipped the exact-route rate limiters (and, for
 * `\`, even `authenticate`) while the upstream still served it as the real
 * route. Normalising would mean re-implementing every parser exactly; instead
 * this guard runs FIRST and answers 400 for any path that is not already in
 * canonical form, so every later middleware, every limiter and the proxy see
 * the same path.
 *
 * Rejected (on the path, before `?`; the query string is not inspected):
 *   - anything that is not an origin-form path starting with `/`
 *     (absolute-form `http://host/...`, `*`);
 *   - repeated slashes (`//`) anywhere;
 *   - a backslash;
 *   - `.` or `..` segments (`/./`, `/../`, trailing `/.` or `/..`);
 *   - percent-encoded `/`, `\`, control characters (including `%00`) and
 *     percent-encoded unreserved characters (`A-Z a-z 0-9 - . _ ~`, e.g.
 *     `%2e`, `%6C`), which RFC 3986 says must never be encoded, plus
 *     malformed escapes (`%zz`, a lone `%`);
 *   - raw control characters (including NUL).
 *
 * Accepted on purpose: one trailing slash (`/api/auth/login/`). Express routes
 * non-strictly, so the exact-route limiters match it, and the services (also
 * Express, non-strict) route it to the same handler, so the limiter and the
 * upstream agree; it counts against the same limit. Letter case is left to
 * Express (case-insensitive routing, so the limiters match `/API/AUTH/LOGIN`);
 * the proxy filters are case-sensitive, so such a path is never forwarded.
 *
 * Legitimate clients never produce any of the rejected forms: ids are
 * ObjectIds, invite codes are alphanumeric and files travel in the body.
 */

const UNRESERVED = /^[A-Za-z0-9\-._~]$/;

/** Why the path is not canonical, or null if it is acceptable. */
export const nonCanonicalPathReason = (rawUrl: string): string | null => {
  const queryStart = rawUrl.indexOf("?");
  const path = queryStart === -1 ? rawUrl : rawUrl.slice(0, queryStart);

  if (!path.startsWith("/")) return "not an origin-form path";
  if (path.includes("//")) return "repeated slash";
  if (path.includes("\\")) return "backslash";
  // Raw control characters (Node's parser rejects most; be explicit).
  if (/[\u0000-\u001f\u007f]/.test(path)) return "control character";

  for (let i = path.indexOf("%"); i !== -1; i = path.indexOf("%", i + 1)) {
    const hex = path.slice(i + 1, i + 3);
    if (!/^[0-9A-Fa-f]{2}$/.test(hex)) return "malformed percent-encoding";
    const code = parseInt(hex, 16);
    const char = String.fromCharCode(code);
    if (char === "/" || char === "\\") return "encoded slash or backslash";
    if (code < 0x20 || code === 0x7f) return "encoded control character";
    if (UNRESERVED.test(char)) return "encoded unreserved character";
  }

  const segments = path.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return "dot segment";
  }

  return null;
};

export const rejectNonCanonicalPaths = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const reason = nonCanonicalPathReason(req.originalUrl ?? req.url);
  if (reason) {
    res.status(400).json({
      success: false,
      message: "Invalid request path",
    });
    return;
  }
  next();
};

/**
 * Segment-bounded proxy filter: matches `prefix` itself and paths below it,
 * but not `prefix` followed by other characters (`/api/authx`), which the
 * plain string filter of http-proxy-middleware (an `indexOf === 0` test)
 * would forward although Express's `app.use(prefix, ...)` did not run the
 * prefix's middleware (authenticate, limiters) for it.
 */
export const underPrefix = (prefix: string) => (pathname: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);
