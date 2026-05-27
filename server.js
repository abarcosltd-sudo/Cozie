import express from "express";
import cors from "cors";
import helmet from "helmet";

import { env, isProd } from "./config/env.js";
import { initFirebase } from "./config/firebase.js";

import { requestLogger } from "./middleware/requestLogger.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { notFound } from "./middleware/notFound.js";
import { apiLimiter } from "./middleware/rateLimiters.js";

import userRoutes from "./routes/userRoutes.js";
import musicRoutes from "./routes/musicRoutes.js";
import postRoutes from "./routes/postRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";

import { logger } from "./utils/logger.js";

initFirebase();

const app = express();

app.set("trust proxy", 1);

const allowedOrigins = (env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function isOriginAllowed(origin) {
  if (allowedOrigins.includes(origin)) return true;
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return true;
  let hostname;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    return false;
  }
  return /\.vercel\.app$/.test(hostname);
}

const corsOptions = {
  origin(origin, callback) {
    // Non-browser requests (curl, server-to-server) have no Origin header.
    if (!origin) return callback(null, true);
    if (isOriginAllowed(origin)) return callback(null, true);
    return callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(requestLogger);
app.use(helmet());
// cors() handles OPTIONS preflight automatically when used as global middleware
app.use(cors(corsOptions));

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use("/api", apiLimiter);

app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/home", (_req, res) => {
  res.json({ message: "Welcome to the user server side", status: "success" });
});

if (!isProd) {
  app.get("/api/test", (_req, res) => {
    res.json({
      success: true,
      message: "CORS is working!",
      timestamp: new Date().toISOString(),
    });
  });
  app.post("/api/test", (req, res) => {
    res.json({ status: "OK", received: req.body });
  });
}

app.use("/api/users", userRoutes);
app.use("/api/music", musicRoutes);
app.use("/api/posts", postRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/notifications", notificationRoutes);

app.use(notFound);
app.use(errorHandler);

/**
 * Listen on a port only when running as a long-lived process (Docker, bare
 * Node, nodemon). On Vercel — and any platform that sets a similar marker —
 * the runtime invokes our default export per request and owns the lifecycle,
 * so binding a port here would either crash or hang the function.
 *
 * Vercel sets VERCEL=1. Add other detectors here if you target Lambda, Cloud
 * Run, etc. (AWS_LAMBDA_FUNCTION_NAME, K_SERVICE, …).
 */
const isServerlessRuntime = Boolean(process.env.VERCEL);

if (!isServerlessRuntime) {
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, "Server listening");
  });

  function shutdown(signal) {
    logger.info({ signal }, "Shutting down server");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// Process-level safety nets. Safe to register in both runtimes — Vercel may
// kill the function before these fire, but on Docker / bare Node they
// guarantee a clean exit on fatal errors.
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection");
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception, exiting");
  if (!isServerlessRuntime) process.exit(1);
});

// Vercel + @vercel/node require a default-exported request handler. The
// Express app is a handler (it implements (req, res) => …), so we expose
// it as the default export. Existing imports that destructure { app }
// continue to work via the named export.
export { app };
export default app;
