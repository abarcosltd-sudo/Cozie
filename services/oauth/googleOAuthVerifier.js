import { OAuth2Client } from "google-auth-library";
import { AppError } from "../../utils/AppError.js";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";

/**
 * Provider-agnostic OAuth verifier shape.
 *
 * Every verifier in `services/oauth/` returns this exact object so the
 * rest of the system (authService, controllers, routes) never sees
 * Google-specific fields. Swapping to Firebase Auth later means dropping
 * in a sibling module that produces the same shape — no caller changes.
 *
 *   {
 *     provider:      "google",
 *     providerUid:   string,   // Google `sub` — stable across renames
 *     email:         string,   // lowercased
 *     emailVerified: boolean,  // we reject false in verifyIdToken
 *     name:          string | null,
 *     picture:       string | null,
 *   }
 */

function parseAllowedAudiences() {
  if (!env.GOOGLE_CLIENT_ID) return [];
  // Allow a comma-separated list to support multiple platforms (web /
  // iOS / Android) sharing the same backend.
  return env.GOOGLE_CLIENT_ID.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

let clientInstance = null;

function getClient() {
  if (!clientInstance) {
    // OAuth2Client without args works for verifyIdToken — we pass the
    // audience(s) directly to the call. Caching across requests keeps
    // Google's JWKS LRU cache warm.
    clientInstance = new OAuth2Client();
  }
  return clientInstance;
}

export const googleOAuthVerifier = {
  /**
   * Verify a Google ID token minted by the frontend (GIS).
   *
   * Throws AppError.unauthorized on any failure: bad signature, wrong
   * audience, expired, missing email, or unverified email. We deliberately
   * reject `email_verified !== true` because we treat the Google email as
   * a proof-of-ownership and skip our own OTP step for Google accounts.
   */
  async verifyIdToken(idToken) {
    if (!idToken || typeof idToken !== "string") {
      throw AppError.unauthorized("Missing Google ID token");
    }

    const audiences = parseAllowedAudiences();
    if (audiences.length === 0) {
      logger.error(
        "GOOGLE_CLIENT_ID is not configured; refusing to verify Google ID token"
      );
      throw AppError.internal("Google sign-in is not configured on this server");
    }

    let ticket;
    try {
      ticket = await getClient().verifyIdToken({
        idToken,
        audience: audiences.length === 1 ? audiences[0] : audiences,
      });
    } catch (err) {
      logger.warn({ err: err.message }, "Google ID token verification failed");
      throw AppError.unauthorized("Invalid Google token");
    }

    const payload = ticket.getPayload();
    if (!payload) {
      throw AppError.unauthorized("Invalid Google token");
    }

    const { sub, email, email_verified, name, picture } = payload;

    if (!sub) {
      throw AppError.unauthorized("Invalid Google token");
    }
    if (!email) {
      throw AppError.unauthorized("Google account has no email");
    }
    if (email_verified !== true) {
      throw AppError.unauthorized("Google email is not verified");
    }

    return {
      provider: "google",
      providerUid: sub,
      email: String(email).toLowerCase(),
      emailVerified: true,
      name: name || null,
      picture: picture || null,
    };
  },
};
