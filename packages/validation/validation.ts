import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";

export const validate =
  (schema: ZodSchema) =>
  (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      return res.status(400).json({
        success: false,
        message: messages.join(", "),
        errors: messages,
      });
    }

    req.body = result.data;

    next();
  };