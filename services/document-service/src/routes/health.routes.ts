import { Router } from "express";

const router = Router();

/** Health check endpoint. */
router.get("/", (_, res) => {
  res.status(200).json({
    success: true,
    service: "document-service",
  });
});

export default router;