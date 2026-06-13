import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import { create, getAll, join } from "../controllers/workspace.controller";

const router = Router();

/** Create a workspace. */
router.post("/", authenticate, create);
/** Get all workspaces for current user. */
router.get("/", authenticate, getAll);
/**** Join a workspace using invite code. */
router.post("/join", authenticate, join);

export default router;