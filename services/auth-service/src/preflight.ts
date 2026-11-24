import dotenv from "dotenv";
import { assertDistinctSecrets, assertRequiredSecrets } from "../../../packages/shared/config/secrets";
import { assertTokenLifetimes } from "./config/token-lifetimes";

/*
 * Startup checks that must run BEFORE app.ts (and utils/jwt.ts) is loaded.
 *
 * server.ts imports this module first. Import order is kept by tsc and
 * ts-node (statements in order) and by tsx/esbuild (imports hoisted in
 * order); a bare statement in server.ts would run after app.ts under tsx.
 * Each check fails closed with the variable NAME only -- never the value.
 * - INTERNAL_SERVICE_TOKEN is required (SEC-018): workspace-service hydrates
 *   member names through /internal/users/bulk with it.
 * - The access and refresh secrets must differ (SEC-019 b).
 * - ACCESS_TOKEN_EXPIRES / REFRESH_TOKEN_EXPIRES must be valid and bounded
 *   (W6-SEC-05): access <= 15m, refresh <= 30d and longer than access.
 */
dotenv.config({ quiet: true });

assertRequiredSecrets("auth-service", ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "INTERNAL_SERVICE_TOKEN"]);
assertDistinctSecrets("auth-service", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET");
assertTokenLifetimes("auth-service");
