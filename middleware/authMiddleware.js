import { AppError } from "../utils/AppError.js";
import { verifyAuthToken } from "../utils/auth.js";
import { userRepository } from "../repositories/userRepository.js";
import { USER_TYPES } from "../utils/collections.js";

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

/**
 * Loads the user (if not already loaded by an earlier `loadUser`) and
 * gates on `userType === "artist"`. Used by artist-only endpoints
 * (own-bubble dashboard, release post, etc.). The 403 + `NOT_ARTIST`
 * code is the contract the frontend handlers branch on.
 *
 * Must be registered AFTER `protect` so `req.auth.id` is populated.
 */
export async function requireArtist(req, _res, next) {
  if (!req.auth?.id) return next(AppError.unauthorized());
  try {
    if (!req.user) {
      const user = await userRepository.findById(req.auth.id);
      if (!user) return next(AppError.unauthorized("User not found"));
      req.user = user;
    }
    if (req.user.userType !== USER_TYPES.ARTIST) {
      return next(
        new AppError(403, "This action is only available to artists", {
          code: "NOT_ARTIST",
        })
      );
    }
    next();
  } catch (err) {
    next(err);
  }
}
