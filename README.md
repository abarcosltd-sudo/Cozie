# Cozie – Backend

Node.js + Express REST API for the Cozie application. Runs on port `5000` by default.

## Tech stack

- Node.js 20 (ES modules)
- Express 5
- Firebase Admin SDK — Firestore (database) + Storage (uploads)
- Zod for request validation (params / query / body)
- Pino structured logging with PII redaction
- JWT auth + bcrypt (also hashes OTPs at rest)
- express-rate-limit (api + auth tiers)
- Helmet, CORS allowlist (localhost + `*.vercel.app`)
- Nodemailer / SendGrid for verification emails

## Architecture (layered)

```
routes/        thin HTTP routing (URL → controller)
controllers/   request handlers; pull data off req, hand to a service, format response
services/     domain logic; orchestrate repositories, never touch req/res
repositories/ Firestore I/O; the only layer that talks to the DB
validators/   Zod schemas; mounted as middleware via validate()
middleware/   auth, errorHandler, rateLimiters, requestLogger
utils/        AppError, asyncHandler, response helpers, logger, auth helpers
config/       env (Zod-validated), firebase init
```

All controllers wrap their handlers in `asyncHandler` so thrown errors bubble to `errorHandler`, which formats every response as `{ success, ...payload }` (or `{ success: false, message, ... }` on error).

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine + CLI)
- A populated `.env` file in this folder. Required vars are validated at boot by `config/env.js`; see the schema there for the canonical list. Highlights:
  - `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_STORAGE_BUCKET`
  - `JWT_SECRET` (≥ 32 chars in prod)
  - SMTP credentials (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`) — or comment out email if running offline
  - Optional: `PORT` (default 5000), `ALLOWED_ORIGINS` (comma-separated), `NODE_ENV`

> **Note on lockfiles:** the `Dockerfile` tries `npm ci` first and falls back to `npm install` if `package-lock.json` drifts out of sync with `package.json`. For fully reproducible builds, run `npm install` here once and commit the regenerated `package-lock.json`.

## Build & run with Docker

```bash
cd Cozie
docker build -t cozie-backend .
docker run --rm -p 5000:5000 --env-file .env cozie-backend
```

- Image is built from `node:20-alpine`, runs as a non-root user, and exposes port `5000`.
- `--env-file .env` injects your local `.env` at runtime; it is **not** baked into the image (`.env` is excluded by `.dockerignore`).
- API will be available at <http://localhost:5000>. Sanity-check with `GET /api/health`.

## Local development (without Docker)

```bash
npm install
node server.js          # or: npx nodemon server.js
node scripts/backfill.js [music|posts|liked-songs]   # one-time backfills (idempotent)
```

The server reads `PORT` from the environment and defaults to `5000`.

## Endpoints

### Health
- `GET  /api/health` – uptime / liveness
- `GET  /api/home`   – welcome
- `GET  /api/test`   – dev-only CORS check

### Auth & users (`/api/users`)
- `POST /signup`, `POST /login`, `POST /verify-otp`
- `GET  /me`, `GET  /profile`, `PUT /profile`
- `POST /preferences`, `POST /generate-upload-url`
- `GET  /available` – directory of other users (used by "new chat")
- `GET  /favorites`, `GET|POST|DELETE /favorites/:songId`
- `POST|DELETE /:userId/follow`
- `GET  /:userId/follow-status`, `/:userId/followers`, `/:userId/following`
- `GET  /:userId/profile`, `/:userId/posts`, `/:userId/liked-songs`

### Music (`/api/music`)
- `POST /generate-upload-url`, `POST /generate-album-art-url`, `POST /add-music`
- `GET  /search?q=…`, `/trending`, `/charts`, `/liked`
- `GET  /:songId`, `POST /:songId/like`, `GET /:songId/likes`

### Posts (`/api/posts`)
- `POST /share-music`
- `GET  /feed` (following-filtered) · `GET /explore` (chronological-all)
- `POST /:postId/like`, `GET|POST /:postId/comments`

### Messages (`/api/messages`)
- `GET  /conversations`, `GET /:conversationId`
- `POST /:userId` (sends to a user; backend resolves/creates the conversation)
- `DELETE /:messageId` (soft-delete for me)

### Notifications (`/api/notifications`)
- `GET  /`, `GET /unread-count`
- `POST /mark-read` (single or `{ markAll: true }`)
- `DELETE /:id`

## Operational notes

- **Rate limiting:** `apiLimiter` on `/api/*` and a stricter `authLimiter` on signup/login/verify-otp.
- **Logging:** Pino JSON logs; PII (passwords, OTP hashes, JWT secret) redacted via `utils/logger.js`.
- **Race-safe writes:** like/follow toggles and counters run inside Firestore transactions, so concurrent clicks never desynchronize counters.
- **OTPs at rest:** stored as bcrypt hashes (cost 8) with `expiresAt`; verification uses timing-safe compare.

## Troubleshooting

- **`npm ci` fails with `EUSAGE … Missing: … from lock file`** &nbsp;– your `package-lock.json` is out of sync with `package.json`. Run `npm install` here and commit the new lockfile. The Dockerfile's fallback to `npm install` lets the build succeed in the meantime.
- **Boot fails with a Zod env error** &nbsp;– `config/env.js` couldn't validate `.env`. The message lists which variable is missing or wrongly shaped (the `FIREBASE_PRIVATE_KEY` newline issue is the most common — copy the value with `\n` literals intact).
- **CORS errors in the browser** &nbsp;– the requesting origin isn't in `ALLOWED_ORIGINS`. localhost on any port and `*.vercel.app` are always allowed; add explicit origins via the env var.
- **Backend can't read env vars** &nbsp;– confirm `.env` exists in this folder and that you passed `--env-file .env` to `docker run`.
