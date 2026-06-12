import { Router } from "express";
import { register, login, refresh, logout } from "../controllers/auth.controller";

import { me } from "../controllers/auth.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

/** Register a new user. */
router.post("/register", register);
/** Authenticate an existing user. */
router.post("/login", login);
/** Issue a new access token. */
router.post("/refresh", refresh);
/** Get currently authenticated user. */
router.get("/me", authenticate, me);
/** Logout the current user. */
router.post("/logout", logout);

export default router;