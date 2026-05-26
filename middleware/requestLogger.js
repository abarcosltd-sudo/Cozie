import pinoHttp from "pino-http";
import { randomUUID } from "node:crypto";
import { logger } from "../utils/logger.js";

export const requestLogger = pinoHttp({
  logger,
  genReqId: (req) => {
    const raw = req.headers["x-request-id"];
    const candidate = Array.isArray(raw) ? raw[0] : raw;
    return candidate && typeof candidate === "string" ? candidate : randomUUID();
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
    }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});
