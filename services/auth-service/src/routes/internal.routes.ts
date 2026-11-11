import { Router, Request, Response } from "express";
import { requireInternalServiceToken } from "../../../../packages/shared/auth/internal-auth.middleware";
import { asyncHandler } from "../../../../packages/shared/errors/asyncHandler";
import { getUsersBulk } from "../services/auth.service";

const router = Router();

router.use(requireInternalServiceToken);

/** POST /internal/users/bulk - Hydrate user profiles by array of ObjectIds */
router.post(
  "/users/bulk",
  asyncHandler(async (req: Request, res: Response) => {
    const { userIds } = req.body;
    if (!Array.isArray(userIds)) {
      return res.status(400).json({
        success: false,
        message: "userIds must be an array of strings",
      });
    }

    const users = await getUsersBulk(userIds);
    res.status(200).json({
      success: true,
      data: users,
    });
  })
);

export default router;
