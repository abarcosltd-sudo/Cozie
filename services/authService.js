import bcrypt from "bcryptjs";
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
import { logger } from "../utils/logger.js";
import { USER_TYPES } from "../utils/collections.js";

const OTP_TTL_MIN = 10;
const BCRYPT_ROUNDS = 12;

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
};
