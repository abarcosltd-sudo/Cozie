import { ZodError } from "zod";
import { AppError } from "../utils/AppError.js";
import { isProd } from "../config/env.js";

export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      success: false,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      details: err.flatten(),
    });
  }

  req.log?.error({ err }, "Unhandled error");

  return res.status(500).json({
    success: false,
    message: "Server error",
    ...(isProd ? {} : { details: { message: err.message, stack: err.stack } }),
  });
}
