import bcrypt from "bcryptjs";
import { FieldValue } from "firebase-admin/firestore";
import { AppError } from "../utils/AppError.js";
import {
  signAuthToken,
  generateOTP,
  hashOTP,
  verifyOTPHash,
} from "../utils/auth.js";
import { db } from "../config/firebase.js";
import { userRepository } from "../repositories/userRepository.js";
import { bubbleRepository } from "../repositories/bubbleRepository.js";
import { bubbleService } from "./bubbleService.js";
import { emailService } from "./emailService.js";
import { googleOAuthVerifier } from "./oauth/googleOAuthVerifier.js";
import { logger } from "../utils/logger.js";
import { USER_TYPES } from "../utils/collections.js";

const OTP_TTL_MIN = 10;
const BCRYPT_ROUNDS = 12;

/**
 * Shape the auth endpoints return alongside the JWT. Mirrors the existing
 * `login` projection so the frontend's `AuthLoginResponse` type works for
 * Google flows too — no new types or context branches needed.
 */
function publicAuthUser(user) {
  return {
    id: user.id,
    fullname: user.fullname,
    username: user.username,
    email: user.email,
  };
}

export const authService = {
  async signup({
    fullname,
    username,
    email,
    password,
    userType = USER_TYPES.USER,
    artistProfile = null,
  }) {
    if (await userRepository.findByEmail(email)) {
      throw AppError.badRequest("User already exists");
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const otp = generateOTP();
    const otpHash = await hashOTP(otp);
    const otpExpiresAt = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000);
    const isArtist = userType === USER_TYPES.ARTIST;

    const now = new Date();
    // Pre-allocate the user doc id so we can write the user + bubble
    // (which has doc id == userId) in a single batch.
    const newUserRef = userRepository.refNew();
    const userId = newUserRef.id;

    const userData = {
      id: userId,
      fullname,
      username,
      email,
      password: hashedPassword,
      isVerified: false,
      // Never store the plaintext OTP — only the bcrypt hash. This means
      // we can't re-send the same code; a "resend" flow must mint a new one.
      otp: { hash: otpHash, expiresAt: otpExpiresAt },
      // Social graph defaults. `visibility` is a hook for the future
      // private-account mode; flipping a user to "private" later doesn't
      // require a migration.
      followerCount: 0,
      followingCount: 0,
      visibility: "public",
      // Denormalized notification badge counter — incremented by
      // notificationService.emit and decremented by markRead/dismiss.
      unreadNotificationCount: 0,
      // Role choice is set here and is immutable thereafter — no upgrade
      // endpoint in MVP. See PROGRESS / plan for the rationale.
      userType: isArtist ? USER_TYPES.ARTIST : USER_TYPES.USER,
      createdAt: now,
    };

    if (isArtist) {
      // bubbleId == userId by invariant; the bubble doc is created in the
      // same batch below so we never end up with a half-registered artist.
      userData.artistProfile = {
        artistName: artistProfile.artistName,
        genres: artistProfile.genres,
        label: artistProfile.label || null,
        website: artistProfile.website || null,
        bio: artistProfile.bio || null,
        isVerified: false,
        verificationStatus: "none",
        bubbleId: userId,
      };
    }

    // Atomic user + bubble write. Firestore batches are all-or-nothing,
    // so the moment this returns either both docs exist or neither does.
    const batch = db().batch();
    batch.set(newUserRef, userData);
    if (isArtist) {
      const bubbleDoc = bubbleService.buildArtistBubbleDoc({
        userId,
        artistName: artistProfile.artistName,
        now,
      });
      batch.set(bubbleRepository.ref(userId), bubbleDoc);
    }
    await batch.commit();

    try {
      await emailService.sendOtpEmail(email, otp, fullname);
      return { userId, message: "Verification code sent to your email" };
    } catch (err) {
      logger.warn({ err: err.message, email }, "OTP email failed during signup");
      return {
        userId,
        emailFailed: true,
        warning:
          "Account created but verification email could not be sent. Please request a new code.",
      };
    }
  },

  async login({ email, password }) {
    const user = await userRepository.findByEmail(email);
    if (!user) throw AppError.unauthorized("Invalid email or password");

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) throw AppError.unauthorized("Invalid email or password");

    const token = signAuthToken({ id: user.id });
    return {
      token,
      user: {
        id: user.id,
        fullname: user.fullname,
        username: user.username,
        email: user.email,
      },
    };
  },

  /**
   * Mint and email a fresh OTP for an unverified account. Signup stores
   * only the bcrypt hash of the original code, so the original can never
   * be re-sent — this endpoint always generates a brand-new 6-digit
   * code, overwrites the stored hash + expiry, and fires the email.
   *
   * Defensive against enumeration: the response is the same shape
   * regardless of whether the email exists, EXCEPT we throw 400 if the
   * account is already verified (which the frontend handles by routing
   * the user to /login). Rate-limited at the route level via authLimiter.
   *
   * If SendGrid fails we surface a 503 (consistent with signup's email
   * fallback) but still update the stored OTP hash, so a subsequent
   * resend that succeeds matches the latest code.
   */
  async resendOtp({ email }) {
    const user = await userRepository.findByEmail(email);
    // Don't reveal whether the email is registered — return a generic
    // "if an account exists" response. The verified-account path stays
    // an explicit error because the user is already past signup and
    // benefits from the clear "log in instead" hint.
    if (!user) {
      return {
        message:
          "If an account with that email exists, a new code has been sent.",
      };
    }
    if (user.isVerified) {
      throw AppError.badRequest("Email already verified");
    }

    const otp = generateOTP();
    const otpHash = await hashOTP(otp);
    const otpExpiresAt = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000);

    await userRepository.update(user.id, {
      otp: { hash: otpHash, expiresAt: otpExpiresAt },
    });

    try {
      await emailService.sendOtpEmail(email, otp, user.fullname);
      return { message: "A new verification code has been sent." };
    } catch (err) {
      // Surface the actual SendGrid response so the network tab tells us
      // *why* delivery failed (missing API key, unverified sender, sandbox
      // mode, etc.) rather than a generic "try again". This is especially
      // important during deploy bring-up — the most common causes are
      // env vars (`SENDGRID_API_KEY` / `EMAIL_FROM`) missing on the host
      // or the From address not being a verified single-sender / domain.
      const sgBody = err.response?.body;
      const sgErrors = Array.isArray(sgBody?.errors) ? sgBody.errors : [];
      const reason =
        sgErrors[0]?.message ||
        err.message ||
        "Unknown email provider error";

      logger.warn(
        {
          err: err.message,
          status: err.code || err.response?.statusCode,
          sgBody,
          email,
        },
        "OTP email failed during resend"
      );

      throw new AppError(
        503,
        `Could not send the verification email: ${reason}`,
        {
          code: "EMAIL_SEND_FAILED",
          providerStatus: err.code || err.response?.statusCode || null,
          providerErrors: sgErrors,
        }
      );
    }
  },

  /**
   * BUG-006 fix: Forgot-password flow.
   * Sends a 6-digit OTP to the user's email that can be used to set a new password.
   * Always responds with the same message to avoid leaking whether the email exists.
   */
  async forgotPassword({ email }) {
    const user = await userRepository.findByEmail(email);
    // Silently succeed when the email is not found — never leak user existence
    if (!user) return { message: "If that email exists, a reset code has been sent." };

    const otp = generateOTP();
    const otpHash = await hashOTP(otp);
    const otpExpiresAt = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000);

    await userRepository.update(user.id, {
      passwordResetOtp: { hash: otpHash, expiresAt: otpExpiresAt },
    });

    try {
      await emailService.sendPasswordResetEmail(email, otp, user.fullname);
    } catch (err) {
      logger.error({ err: err.message, email }, "Failed to send password reset email");
      throw new AppError(503, "Could not send the reset email. Please try again.", {
        code: "EMAIL_SEND_FAILED",
      });
    }

    return { message: "If that email exists, a reset code has been sent." };
  },

  /**
   * BUG-006 fix: Reset password using the OTP sent to the user's email.
   */
  async resetPassword({ email, otp, newPassword }) {
    const user = await userRepository.findByEmail(email);
    if (!user) throw AppError.badRequest("Invalid or expired reset code.");

    const resetOtp = user.passwordResetOtp;
    if (!resetOtp?.hash || !resetOtp?.expiresAt) {
      throw AppError.badRequest("No password reset was requested for this account.");
    }

    const expiresAt = resetOtp.expiresAt?.toDate
      ? resetOtp.expiresAt.toDate()
      : new Date(resetOtp.expiresAt);

    if (Date.now() > expiresAt.getTime()) {
      throw AppError.badRequest("Reset code has expired. Please request a new one.");
    }

    const matches = await verifyOTPHash(otp, resetOtp.hash);
    if (!matches) throw AppError.badRequest("Invalid reset code.");

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await userRepository.update(user.id, {
      password: hashedPassword,
      passwordResetOtp: null,
    });

    const token = signAuthToken({ id: user.id });
    return { token, message: "Password reset successfully." };
  },

  async verifyOtp({ email, otp }) {
    const user = await userRepository.findByEmail(email);
    if (!user) throw AppError.notFound("User not found");
    if (user.isVerified) throw AppError.badRequest("Email already verified");

    const expiresAt = user.otp?.expiresAt?.toDate
      ? user.otp.expiresAt.toDate()
      : new Date(user.otp?.expiresAt);

    if (!user.otp?.hash || !expiresAt || Number.isNaN(expiresAt.getTime())) {
      throw AppError.badRequest("No OTP pending for this account");
    }
    if (Date.now() > expiresAt.getTime()) {
      throw AppError.badRequest("OTP expired");
    }

    const matches = await verifyOTPHash(otp, user.otp.hash);
    if (!matches) {
      throw AppError.badRequest("Invalid OTP");
    }

    await userRepository.setVerified(user.id);
    const token = signAuthToken({ id: user.id });
    return { token, message: "Email verified successfully" };
  },

  // --- Google OAuth ---------------------------------------------------------
  // These two methods live alongside `signup` / `login` and reuse the
  // existing JWT issuance + Firestore writes. They intentionally do NOT
  // touch the password/OTP code paths above — the OTP flow stays exactly
  // as it is today. New accounts created via Google get `isVerified: true`
  // directly because Google's `email_verified` claim is proof of ownership;
  // they therefore bypass `/verify-otp` and never have an `otp` field.

  /**
   * Sign up with Google. Verifies the ID token, then either:
   *   - creates a brand-new user (+ bubble doc atomically for artists), OR
   *   - returns the existing Google account (idempotent), OR
   *   - auto-links to an existing password account with the same email
   *     (safe because Google attested email ownership).
   *
   * Username is chosen on the frontend (Google has no username concept)
   * and must be unique. We surface a 409 with a stable error code so the
   * UI can prompt the user to pick a different one without losing form
   * state. For artists, `artistProfile` must already be present per the
   * Zod schema's `superRefine`.
   */
  async signupWithGoogle({ idToken, username, userType = USER_TYPES.USER, artistProfile = null }) {
    const profile = await googleOAuthVerifier.verifyIdToken(idToken);
    const { providerUid, email, name, picture } = profile;
    const isArtist = userType === USER_TYPES.ARTIST;

    // 1. Idempotent path — Google account already linked. Behaves like
    //    login. We deliberately do NOT enforce username uniqueness or
    //    artist-fields here; the account already exists.
    const existingGoogle = await userRepository.findByGoogleSub(providerUid);
    if (existingGoogle) {
      const token = signAuthToken({ id: existingGoogle.id });
      return {
        token,
        user: publicAuthUser(existingGoogle),
        newAccount: false,
        linked: false,
      };
    }

    // 2. Auto-link path — same email exists from the OTP flow. Add Google
    //    as an additional provider on that account and mark verified.
    const existingByEmail = await userRepository.findByEmail(email);
    if (existingByEmail) {
      await userRepository.update(
        existingByEmail.id,
        buildAutoLinkUpdates(existingByEmail, providerUid, picture)
      );
      const token = signAuthToken({ id: existingByEmail.id });
      return {
        token,
        user: publicAuthUser(existingByEmail),
        newAccount: false,
        linked: true,
      };
    }

    // 3. Brand-new account. Mirrors the OTP `signup` write but with no
    //    password, no OTP, and `isVerified: true`. Artist users get the
    //    sibling bubble doc in the same Firestore batch so we never end
    //    up with a half-registered artist.
    const usernameTaken = await userRepository.findByUsername(username);
    if (usernameTaken) {
      throw new AppError(409, "Username already taken", {
        code: "USERNAME_TAKEN",
      });
    }

    const now = new Date();
    const newUserRef = userRepository.refNew();
    const userId = newUserRef.id;

    const userData = {
      id: userId,
      fullname: name || username,
      username,
      email,
      password: null,
      isVerified: true,
      otp: null,
      authProviders: ["google"],
      googleSub: providerUid,
      photoURL: picture || null,
      followerCount: 0,
      followingCount: 0,
      visibility: "public",
      unreadNotificationCount: 0,
      userType: isArtist ? USER_TYPES.ARTIST : USER_TYPES.USER,
      createdAt: now,
    };

    if (isArtist) {
      userData.artistProfile = {
        artistName: artistProfile.artistName,
        genres: artistProfile.genres,
        label: artistProfile.label || null,
        website: artistProfile.website || null,
        bio: artistProfile.bio || null,
        isVerified: false,
        verificationStatus: "none",
        bubbleId: userId,
      };
    }

    const batch = db().batch();
    batch.set(newUserRef, userData);
    if (isArtist) {
      const bubbleDoc = bubbleService.buildArtistBubbleDoc({
        userId,
        artistName: artistProfile.artistName,
        now,
      });
      batch.set(bubbleRepository.ref(userId), bubbleDoc);
    }
    await batch.commit();

    const token = signAuthToken({ id: userId });
    return {
      token,
      user: publicAuthUser({ id: userId, ...userData }),
      newAccount: true,
      linked: false,
    };
  },

  /**
   * Sign in with Google. Verifies the ID token, then:
   *   - returns the existing Google account, OR
   *   - auto-links to an existing password account with the same email
   *     (Google verified the email, so this is safe), OR
   *   - throws ACCOUNT_NOT_FOUND so the UI can redirect to signup.
   *
   * We never create a new account here — that's an explicit user choice
   * gated by the signup form (which collects username + role + artist
   * fields).
   */
  async loginWithGoogle({ idToken }) {
    const profile = await googleOAuthVerifier.verifyIdToken(idToken);
    const { providerUid, email, picture } = profile;

    const existingGoogle = await userRepository.findByGoogleSub(providerUid);
    if (existingGoogle) {
      const token = signAuthToken({ id: existingGoogle.id });
      return { token, user: publicAuthUser(existingGoogle), linked: false };
    }

    const existingByEmail = await userRepository.findByEmail(email);
    if (existingByEmail) {
      await userRepository.update(
        existingByEmail.id,
        buildAutoLinkUpdates(existingByEmail, providerUid, picture)
      );
      const token = signAuthToken({ id: existingByEmail.id });
      return { token, user: publicAuthUser(existingByEmail), linked: true };
    }

    throw new AppError(404, "No Cozie account for this Google email", {
      code: "ACCOUNT_NOT_FOUND",
    });
  },
};

/**
 * Build the partial-update payload for auto-linking Google to an account
 * that already exists by email.
 *
 *   - `googleSub` is always written (it's how we'll find them next time).
 *   - `authProviders` uses arrayUnion so it's idempotent across repeat
 *     sign-ins. Legacy OTP accounts have no `authProviders` field, so we
 *     also union `"password"` back in when the existing doc has a stored
 *     password hash — otherwise the array would be a misleading
 *     `["google"]` for a user who can still sign in with their password.
 *   - `isVerified: true` because Google attested the email.
 *   - `otp: null` clears any in-flight unverified-email OTP so a stale
 *     verify request can't succeed afterwards.
 *   - `photoURL` is backfilled only when missing — never overwrite a
 *     user-chosen avatar with the Google avatar.
 */
function buildAutoLinkUpdates(existingUser, providerUid, picture) {
  const providersToAdd = ["google"];
  if (existingUser.password) providersToAdd.push("password");
  const updates = {
    googleSub: providerUid,
    authProviders: FieldValue.arrayUnion(...providersToAdd),
    isVerified: true,
    otp: null,
  };
  if (!existingUser.photoURL && picture) {
    updates.photoURL = picture;
  }
  return updates;
}
