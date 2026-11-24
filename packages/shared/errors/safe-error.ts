/**
 * Safe error descriptions for logs (RT-007).
 *
 * Provider SDK errors (Voyage, Pinecone, Cloudinary, LLM) can carry key
 * identifiers ("api_key=…", "Invalid api_key 1234…"), bearer tokens, cookies
 * and request URLs with query strings in their message or attached objects.
 * Logging the whole error object, or even the raw message, copies those into
 * log files. This helper keeps what is useful for diagnosis -- the error name,
 * an HTTP status and an error code -- plus a redacted, bounded message.
 */

const REDACTIONS: Array<[RegExp, string]> = [
  // Wave 6 A-1: credentials inside connection URIs ("mongodb://user:pass@host",
  // "mongodb+srv://…", "redis://:pass@host", "rediss://…", "amqp://…",
  // "https://user:pass@host"). Runs first, before the key and query rules.
  // Greedy up to the last "@" before the path, so an unescaped "@" inside a
  // password cannot leave its tail behind.
  // Quantifiers are bounded (Stage E round 2, W6-R5-08) so a crafted message
  // cannot make a rule backtrack quadratically.
  [/\b([a-z][a-z0-9+.-]{0,31}:\/\/)[^\s\/?#]{0,512}@/gi, "$1<redacted>@"],
  // Bare JWTs (no "Bearer" in front): three base64url parts starting "eyJ".
  [/\beyJ[A-Za-z0-9_-]{5,1024}\.[A-Za-z0-9_-]{5,1024}\.[A-Za-z0-9_-]{0,1024}/g, "<redacted-jwt>"],
  // "api_key=…", "api-key: …", "apikey …", "Invalid api_key 1234567890", and
  // JSON / quoted forms such as {"apiKey":"…"} or 'token': '…' (Wave 6 W6-R5-05).
  [/(api[_-]?key|apikey|access[_-]?key|secret|password|token)["']?\s*[=:]?\s*["']?[^\s,;"'}]+/gi, "$1=<redacted>"],
  // Authorization headers
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 <redacted>"],
  // Cookies
  [/(set-cookie|cookie)\s*[:=]\s*[^\n]*/gi, "$1: <redacted>"],
  // Provider key shapes: sk-…, pa-…, gsk_…, pcsk_…
  [/\b(sk|pa|gsk|pcsk)[-_][A-Za-z0-9_-]{8,}/g, "<redacted-key>"],
  // URL query strings
  [/(https?:\/\/[^\s?#"']{1,2048})\?[^\s#"']*/gi, "$1?<redacted>"],
];

/**
 * At most this many characters are examined and returned (W6-R5-08): every
 * caller keeps at most a few hundred characters anyway, and bounding the
 * input keeps each rule linear in practice even on crafted text.
 */
export const MAX_REDACTION_INPUT = 4096;

/** Remove secret-looking substrings from free text (bounded to MAX_REDACTION_INPUT characters). */
export const redactSecrets = (text: string): string => {
  const input = String(text);
  // When cut, also drop the last (possibly partial) token so half a
  // credential cannot survive at the cut.
  let bounded = input;
  if (input.length > MAX_REDACTION_INPUT) {
    const cut = input.slice(0, MAX_REDACTION_INPUT);
    const lastSpace = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("\n"), cut.lastIndexOf("\r"), cut.lastIndexOf("\t"));
    bounded = lastSpace >= 0 ? cut.slice(0, lastSpace) : "";
  }
  return REDACTIONS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), bounded);
};

/** "Name status=401 code=X: redacted message" (message bounded to 300 chars). */
export const describeErrorForLog = (error: unknown): string => {
  if (!(error instanceof Error) && (typeof error !== "object" || error === null)) {
    return redactSecrets(String(error)).slice(0, 300);
  }
  const e = error as { name?: unknown; message?: unknown; status?: unknown; statusCode?: unknown; http_code?: unknown; code?: unknown };
  // A subclass that never sets `name` (AppError) is reported by its class name.
  const className = error instanceof Error ? error.constructor?.name : undefined;
  const ownName = typeof e.name === "string" && e.name ? e.name : "Error";
  // Wave 6 (W6-R5-05): every field is redacted and bounded, not only the message.
  const field = (value: string) => redactSecrets(value).slice(0, 100);
  const name = field(ownName === "Error" && typeof className === "string" && className ? className : ownName);
  const statusValue = e.status ?? e.statusCode ?? e.http_code;
  const status = typeof statusValue === "number" || typeof statusValue === "string" ? ` status=${field(String(statusValue))}` : "";
  const code = typeof e.code === "string" || typeof e.code === "number" ? ` code=${field(String(e.code))}` : "";
  // One line: a multi-line message must not forge extra log lines (W6-R5-02).
  const message = typeof e.message === "string" ? redactSecrets(e.message).replace(/[\r\n]+/g, " ").slice(0, 300) : "";
  return `${name}${status}${code}: ${message}`;
};
