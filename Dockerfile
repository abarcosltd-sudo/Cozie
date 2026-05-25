# syntax=docker/dockerfile:1.7

# ---------- deps stage: install only production deps ----------
FROM node:20-alpine AS deps
WORKDIR /app

# Install build deps for any native modules (e.g. bcrypt) – removed after npm ci
RUN apk add --no-cache --virtual .build-deps python3 make g++

COPY package.json package-lock.json* ./
# Prefer reproducible `npm ci`; fall back to `npm install` if the committed
# package-lock.json is out of sync with package.json. Regenerate the lockfile
# locally (`npm install`) and commit it to make builds fully reproducible.
RUN (npm ci --omit=dev --no-audit --no-fund \
     || npm install --omit=dev --no-audit --no-fund) \
    && apk del .build-deps

# ---------- runtime stage ----------
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=5000

# Create a non-root user
RUN addgroup -S nodejs && adduser -S nodejs -G nodejs

COPY --from=deps /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs . .

USER nodejs

EXPOSE 5000

# Basic healthcheck against the dedicated /api/health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1

CMD ["node", "server.js"]
