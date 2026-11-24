import dotenv from "dotenv";
import { assertRequiredSecrets } from "../../../packages/shared/config/secrets";
import { assertGatewayConfig } from "./config/gateway-config";

/*
 * Startup checks that must run BEFORE app.ts is loaded (W6-SEC-01).
 *
 * server.ts imports this module first. Import order is kept by tsc and
 * ts-node (statements in order) and by tsx/esbuild (imports hoisted in
 * order), so the checks always run before the app module is evaluated. A
 * bare statement in server.ts would run AFTER app.ts under tsx, which is why
 * these checks live in their own module.
 *
 * Each check fails closed with the variable NAME and the rule only -- never
 * the value -- and exits 1 without a stack trace.
 */
dotenv.config({ quiet: true });

assertRequiredSecrets("api-gateway", ["JWT_ACCESS_SECRET"]);

// TRUST_PROXY and CORS_ORIGIN: one "[api-gateway] refusing to start" line.
assertGatewayConfig();
