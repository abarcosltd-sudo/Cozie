import { AppError } from "../utils/AppError.js";
import { verifyAuthToken } from "../utils/auth.js";
import { userRepository } from "../repositories/userRepository.js";

function extractBearer(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

export function protect(req, _res, next) {
  const token = extractBearer(req);
  if (!token) return next(AppError.unauthorized("No token provided"));

  try {
    const decoded = verifyAuthToken(token);
    req.auth = { id: decoded.id, raw: decoded };
    next();
  } catch {
    next(AppError.unauthorized("Invalid or expired token"));
  }
}

export async function loadUser(req, _res, next) {
  if (!req.auth?.id) return next(AppError.unauthorized());
  try {
    const user = await userRepository.findById(req.auth.id);
    if (!user) return next(AppError.unauthorized("User not found"));
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}
