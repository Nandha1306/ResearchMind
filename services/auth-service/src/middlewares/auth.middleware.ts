/*
 * auth-service uses the shared middleware: same messages ("Authentication
 * required" / "Invalid or expired access token"), and verification through the
 * single hardened verifyAccessToken (SEC-019, ISS-047). Importing it validates
 * JWT_ACCESS_SECRET at load, as before.
 */
export { authenticate, type AuthRequest } from "../../../../packages/shared/auth/authenticate";
