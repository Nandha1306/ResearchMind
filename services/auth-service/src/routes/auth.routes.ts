import { Router } from "express";
import { register, login, refresh, logout } from "../controllers/auth.controller";

import { me } from "../controllers/auth.controller";
import { authenticate } from "../middlewares/auth.middleware";
import { validate } from "../../../../packages/validation/validation";
import { registerSchema, loginSchema } from "../../../../packages/validation/schemas/auth.schema";

const router = Router();

/** Register a new user. */
router.post(
  "/register",
  validate(registerSchema),
  register
);
/** Authenticate an existing user. */
router.post(
  "/login",
  validate(loginSchema),
  login
);
/** Issue a new access token. */
router.post("/refresh", refresh);
/** Get currently authenticated user. */
router.get("/me", authenticate, me);
/** Logout the current user. */
router.post("/logout", logout);

export default router;