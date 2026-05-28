export class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.details = details;
    this.isOperational = true;
    if (typeof Error.captureStackTrace === "function") {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  static badRequest(message, details) {
    return new AppError(400, message, details);
  }

  static unauthorized(message = "Not authorised") {
    return new AppError(401, message);
  }

  static forbidden(message = "Forbidden") {
    return new AppError(403, message);
  }

  static notFound(message = "Not found") {
    return new AppError(404, message);
  }

  static conflict(message) {
    return new AppError(409, message);
  }

  static tooMany(message = "Too many requests") {
    return new AppError(429, message);
  }

  static internal(message = "Internal server error", details) {
    return new AppError(500, message, details);
  }
}
