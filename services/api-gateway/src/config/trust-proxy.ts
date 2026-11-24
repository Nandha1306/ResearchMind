import net from "net";
import express from "express";

/**
 * TRUST_PROXY (RT-008): how many reverse proxies sit in front of the gateway,
 * or which proxy addresses to trust, so `req.ip` (used by the per-IP rate
 * limiters) is the real client and not the proxy.
 *
 *   unset, "", "false", "0"   -> off (default): req.ip is the socket peer
 *   "1".."10"                 -> trust that many hops of X-Forwarded-For
 *   "loopback, 10.0.0.0/8"    -> trust these addresses/CIDRs/keywords
 *                                (loopback, linklocal, uniquelocal)
 *   "true"                    -> REFUSED: it trusts any client-supplied
 *                                X-Forwarded-For, so anyone could pick their
 *                                own rate-limit key.
 *   too-wide CIDRs            -> REFUSED for the same reason (Wave 4 review
 *                                L1): "0.0.0.0/0" or "::/0" is `true` in
 *                                disguise. Minimum prefix: /8 for IPv4 and
 *                                /32 for IPv6. An IPv6 range that contains
 *                                the IPv4-mapped block ::ffff:0:0/96 is
 *                                refused (proxy-addr matches IPv4 clients
 *                                against it); a range inside that block
 *                                counts as IPv4 (prefix - 96 must be >= 8).
 *                                The private ranges stay available through
 *                                the keywords above.
 *
 * Do not enable it before proxy-addr >= 2.0.8 is installed (SEC-022 batch).
 */
export type TrustProxySetting = false | number | string[];

const KEYWORDS = new Set(["loopback", "linklocal", "uniquelocal"]);

/** Narrowest allowed prefixes for a trusted proxy range (see above). */
export const MIN_IPV4_PREFIX = 8;
export const MIN_IPV6_PREFIX = 32;

const TOO_WIDE = "too-wide";

/**
 * Wave 6 (W6-SEC-01): net.isIP accepts forms that proxy-addr (ipaddr.js)
 * cannot compile, e.g. the IPv4-compatible "::0.0.0.0/96" or "::127.0.0.1".
 * Express would then crash at app.set("trust proxy", ...) with a stack trace.
 * Cross-check every otherwise valid entry with the same compile path the
 * gateway uses; this can only ADD rejections.
 */
const compilesInExpress = (entry: string): boolean => {
  try {
    express().set("trust proxy", [entry]);
    return true;
  } catch {
    return false;
  }
};

/** "ok", "invalid" or "too-wide" for one TRUST_PROXY entry. */
const classifyEntry = (entry: string): "ok" | "invalid" | typeof TOO_WIDE => {
  const verdict = classifyAddress(entry);
  if (verdict === "ok" && !KEYWORDS.has(entry) && !compilesInExpress(entry)) return "invalid";
  return verdict;
};

const classifyAddress = (entry: string): "ok" | "invalid" | typeof TOO_WIDE => {
  if (KEYWORDS.has(entry)) return "ok";
  const [address, bits, ...rest] = entry.split("/");
  if (rest.length > 0) return "invalid";
  const family = net.isIP(address);
  if (family === 0) return "invalid";
  if (bits === undefined) return "ok"; // a single address
  if (!/^\d{1,3}$/.test(bits)) return "invalid";
  const prefix = Number(bits);
  if (prefix > (family === 4 ? 32 : 128)) return "invalid";
  if (family === 4) return prefix >= MIN_IPV4_PREFIX ? "ok" : TOO_WIDE;

  if (prefix < MIN_IPV6_PREFIX) return TOO_WIDE;
  const range = new net.BlockList();
  range.addSubnet(address, prefix, "ipv6");
  // The range covers the whole IPv4-mapped block: every IPv4 client.
  if (prefix <= 96 && range.check("::ffff:0:0", "ipv6")) return TOO_WIDE;
  // The range lies inside the IPv4-mapped block: judge it as IPv4.
  const mapped = new net.BlockList();
  mapped.addSubnet("::ffff:0:0", 96, "ipv6");
  if (prefix > 96 && mapped.check(address, "ipv6") && prefix - 96 < MIN_IPV4_PREFIX) return TOO_WIDE;
  return "ok";
};

export const parseTrustProxy = (
  raw: string | undefined
): { value: TrustProxySetting; error?: string } => {
  const text = (raw ?? "").trim();
  if (text === "" || text.toLowerCase() === "false" || text === "0") return { value: false };
  if (text.toLowerCase() === "true") {
    return { value: false, error: "TRUST_PROXY must not trust every proxy: it would trust any client-supplied X-Forwarded-For; set a hop count (1-10) or proxy addresses" };
  }
  if (/^\d+$/.test(text)) {
    const hops = Number(text);
    if (hops >= 1 && hops <= 10) return { value: hops };
    return { value: false, error: "TRUST_PROXY hop count must be 1 to 10" };
  }
  const entries = text.split(",").map((e) => e.trim()).filter(Boolean);
  const verdicts = entries.map(classifyEntry);
  if (entries.length === 0 || verdicts.includes("invalid")) {
    return { value: false, error: "TRUST_PROXY must be a hop count (1-10) or a list of IP addresses, CIDRs or loopback/linklocal/uniquelocal" };
  }
  if (verdicts.includes(TOO_WIDE)) {
    return {
      value: false,
      error:
        `TRUST_PROXY contains a CIDR that is too wide (it would trust any client-supplied X-Forwarded-For); ` +
        `use at least /${MIN_IPV4_PREFIX} for IPv4 and /${MIN_IPV6_PREFIX} for IPv6, or the loopback/linklocal/uniquelocal keywords`,
    };
  }
  return { value: entries };
};
