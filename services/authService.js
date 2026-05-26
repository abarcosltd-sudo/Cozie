import bcrypt from "bcryptjs";
import { AppError } from "../utils/AppError.js";
import {
  signAuthToken,
  generateOTP,
  hashOTP,
  verifyOTPHash,
} from "../utils/auth.js";
import { userRepository } from "../repositories/userRepository.js";
import { emailService } from "./emailService.js";
import { logger } from "../utils/logger.js";

const OTP_TTL_MIN = 10;
const BCRYPT_ROUNDS = 12;

export const authService = {
  async signup({ fullname, username, email, password }) {
    if (await userRepository.findByEmail(email)) {
      throw AppError.badRequest("User already exists");
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const otp = generateOTP();
    const otpHash = await hashOTP(otp);
    const otpExpiresAt = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000);

    const { id } = await userRepository.create({
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
    });

    try {
      await emailService.sendOtpEmail(email, otp, fullname);
      return { userId: id, message: "Verification code sent to your email" };
    } catch (err) {
      logger.warn({ err: err.message, email }, "OTP email failed during signup");
      return {
        userId: id,
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
