import { parseTrustProxy, type TrustProxySetting } from "./trust-proxy";
import { parseCorsOrigins, type CorsOriginSetting } from "../../../../packages/shared/http/cors-origins";

/**
 * Gateway configuration that must be valid before the gateway starts
 * (W6-SEC-01): TRUST_PROXY (RT-008) and CORS_ORIGIN (SEC-015).
 *
 * Every error message names the variable and the rule, never the value.
 */
export interface GatewayConfig {
  trustProxy: TrustProxySetting;
  cors: CorsOriginSetting;
}

export type GatewayConfigResult =
  | { ok: true; config: GatewayConfig }
  | { ok: false; variable: "TRUST_PROXY" | "CORS_ORIGIN"; message: string };

export const readGatewayConfig = (env: NodeJS.ProcessEnv = process.env): GatewayConfigResult => {
  const trustProxy = parseTrustProxy(env.TRUST_PROXY);
  if (trustProxy.error) return { ok: false, variable: "TRUST_PROXY", message: trustProxy.error };
  const cors = parseCorsOrigins(env.CORS_ORIGIN);
  if (cors.error) return { ok: false, variable: "CORS_ORIGIN", message: cors.error };
  return { ok: true, config: { trustProxy: trustProxy.value, cors } };
};

/** The single line printed when the gateway refuses to start. */
export const refusalLine = (message: string): string => `[api-gateway] refusing to start: ${message}`;

/**
 * Called by server.ts before the app is loaded: on an invalid value, print
 * exactly one line (variable and rule, no value, no stack) and exit 1.
 */
export const assertGatewayConfig = (env: NodeJS.ProcessEnv = process.env): void => {
  const result = readGatewayConfig(env);
  if (!result.ok) {
    console.error(refusalLine(result.message));
    process.exit(1);
  }
};
