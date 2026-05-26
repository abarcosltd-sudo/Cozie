import pino from "pino";
import { env, isDev } from "../config/env.js";

const baseOptions = {
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
      "*.password",
      "*.otp",
      "*.otp.code",
      "*.otp.hash",
      "*.privateKey",
      "*.private_key",
    ],
    censor: "[redacted]",
  },
};

export const logger = pino(
  isDev
    ? {
        ...baseOptions,
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss.l",
            ignore: "pid,hostname",
          },
        },
      }
    : baseOptions
);
