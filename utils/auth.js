import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { env } from "../config/env.js";

// Low cost is fine for short-lived 6-digit OTPs (~20ms verify on commodity
// hardware) — high enough to defeat offline brute-force of the 1M code space,
// low enough not to add user-visible latency on /verify-otp.
const OTP_BCRYPT_ROUNDS = 8;

export function signAuthToken(payload) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}

export function verifyAuthToken(token) {
  return jwt.verify(token, env.JWT_SECRET);
}

export function generateOTP() {
  return crypto.randomInt(100000, 1000000).toString();
}

export function hashOTP(otp) {
  return bcrypt.hash(otp, OTP_BCRYPT_ROUNDS);
}

export function verifyOTPHash(otp, hash) {
  if (!hash) return Promise.resolve(false);
  return bcrypt.compare(otp, hash);
}
