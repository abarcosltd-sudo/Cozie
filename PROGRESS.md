# Cozie Backend — Progress Checklist

A granular tracking document mapping the `Cozie/` backend implementation against the Cozie SRS. Tick items off as they're completed.

**Legend**
- `[x]` Implemented and wired up in code.
- `[~]` Partially done — needs work (see note).
- `[ ]` Not started.

**Snapshot:** roughly **60%** of backend scope from the SRS (108 of 228 granular items checked). Architectural pass complete: layered services/repositories/validators, single auth/CORS, zod validation, pino logging, helmet + rate-limit, AppError + asyncHandler. Audit fixes shipped (round 1): idempotent favorites, deterministic conversation IDs, post-like no longer mutates song.likeCount, batch-chunked read receipts, safer CORS origin parser, validator merges params. Bug-fix phase shipped (round 2): transactional toggle likes, denormalized reverse like-index (no more catalog scans), batched feed fan-out via getAll, case-insensitive search, bcrypt-hashed OTPs, idempotent backfill script. Social-graph slice shipped (round 3): atomic follow/unfollow with denormalized counters, cursor-paginated follower/following lists, follow-status one-RPC check, `/api/posts/feed` is now follower-filtered with `/explore` for discovery. Notifications slice shipped (round 4): in-app notification subcollection w/ dedup IDs + denormalized unread counter, wired into follow/like/comment writes as best-effort post-tx side-effects, full `/api/notifications` CRUD. Reels slice shipped (round 5): Mux-backed video pipeline with direct-upload URLs and HMAC-verified webhooks, top-level `reels` collection with `pending_upload → processing → ready/errored` state machine, post-upload 60s duration enforcement, full engagement (likes/comments/views/shares) with the same atomic-tx + reverse-index + best-effort-notification posture as posts.

> Each bar is 10 cells wide. When you tick or untick an item below, also update the count and bar in the matching row here so this dashboard stays in sync.

## Progress at a glance

| § | Section                          | Progress                  | Done   |
|---|----------------------------------|---------------------------|--------|
| — | **Overall**                      | `▰▰▰▰▰▰▱▱▱▱`              | 108/228 |
| 1 | Project infrastructure & ops     | `▰▰▰▰▰▰▰▰▰▱`              | 17/20  |
| 2 | Authentication & accounts        | `▰▰▰▰▰▰▱▱▱▱`              | 10/16  |
| 3 | User profile                     | `▰▰▰▰▰▰▱▱▱▱`              | 7/12   |
| 4 | Music catalogue                  | `▰▰▰▰▰▰▱▱▱▱`              | 9/15   |
| 5 | Posts, feed & engagement         | `▰▰▰▰▰▰▱▱▱▱`              | 11/18  |
| 6 | Favorites                        | `▰▰▰▰▰▰▰▰▰▰`              | 8/8    |
| 7 | Direct messaging                 | `▰▰▰▰▰▱▱▱▱▱`              | 8/16   |
| 8 | Follow / social graph            | `▰▰▰▰▰▰▰▰▱▱`              | 9/12   |
| 9 | Artist Communities ("Bubbles")   | `▱▱▱▱▱▱▱▱▱▱`              | 0/8    |
| 10| Battle Rooms                     | `▱▱▱▱▱▱▱▱▱▱`              | 0/11   |
| 11| Music-taste Matchmaking          | `▱▱▱▱▱▱▱▱▱▱`              | 0/8    |
| 12| Reels                            | `▰▰▰▰▰▰▰▰▰▰`              | 7/7    |
| 13| Listening data ingestion         | `▱▱▱▱▱▱▱▱▱▱`              | 0/7    |
| 14| Notifications                    | `▰▰▰▰▱▱▱▱▱▱`              | 2/5    |
| 15| Premium tier & payments          | `▱▱▱▱▱▱▱▱▱▱`              | 0/9    |
| 16| Moderation & safety              | `▱▱▱▱▱▱▱▱▱▱`              | 0/7    |
| 17| Privacy, consent & governance    | `▱▱▱▱▱▱▱▱▱▱`              | 0/6    |
| 18| Third-party integrations         | `▱▱▱▱▱▱▱▱▱▱`              | 0/6    |
| 19| Artist tooling                   | `▱▱▱▱▱▱▱▱▱▱`              | 0/6    |
| 20| Admin tooling                    | `▱▱▱▱▱▱▱▱▱▱`              | 0/6    |
| 21| Analytics & product signals      | `▱▱▱▱▱▱▱▱▱▱`              | 0/4    |
| 22| Non-functional requirements      | `▰▰▰▱▱▱▱▱▱▱`              | 3/10   |
| 23| Tech debt & cleanup              | `▰▰▰▰▰▰▰▰▰▰`              | 24/26  |

---

## 1. Project infrastructure & ops

- [x] Express 5 app bootstrapped (`server.js`)
- [x] ES modules (`"type": "module"`)
- [x] CORS middleware (`server.js`, `corsOptions`)
- [x] JSON / urlencoded body parsing
- [x] Global error handler (`middleware/errorHandler.js`)
- [x] `dotenv` dependency installed
- [x] Dockerfile (multi-stage, non-root user, healthcheck)
- [x] `.dockerignore`
- [x] `.env.example` template
- [x] `README.md` with build/run instructions
- [x] `dotenv.config()` called via `config/env.js`
- [x] Health endpoint distinct from `/api/test` — `GET /api/health`
- [x] Request logging — pino-http with request IDs (`middleware/requestLogger.js`)
- [x] Rate limiting — express-rate-limit on auth + global API (`middleware/rateLimiters.js`)
- [x] Helmet / security headers
- [x] Centralised config module — `config/env.js` (zod-validated, no `process.env` scattered)
- [ ] CI pipeline (GitHub Actions: lint + test + build image)
- [ ] Automated tests (Jest / Vitest / supertest) — currently no test runner
- [x] Production logging strategy — structured JSON logs via pino
- [ ] Backup strategy for Firestore exports

---

## 2. Authentication & accounts (SRS 3.2.1, alg-step 1)

- [x] `POST /api/users/signup` — bcrypt-hashed password, Firestore user doc, OTP issued
- [x] `POST /api/users/login` — credential check, JWT issued
- [x] `POST /api/users/verify-otp` — email OTP verification flow
- [x] JWT generation helper (`utils/auth.js`, configurable expiry via `JWT_EXPIRES_IN`)
- [x] `protect` auth middleware (`middleware/authMiddleware.js`)
- [x] OTP email sending via SendGrid (`services/emailService.js`)
- [x] OTP expiry check (10-minute window)
- [x] Email-format and password-strength validation — zod schemas (`validators/userValidators.js`)
- [x] Rate-limit signup + login + OTP endpoints — `authLimiter`
- [x] OTP code stored hashed (bcrypt, cost 8) — never persisted in plaintext (`utils/auth.js::hashOTP`)
- [ ] Resend-OTP endpoint
- [ ] Password reset / forgot-password flow
- [ ] Refresh token / token rotation
- [ ] Logout endpoint with token blocklist
- [ ] Social login (Google / Apple / Spotify)
- [ ] Account deletion endpoint

---

## 3. User profile (SRS 3.2.1)

- [x] `GET /api/users/profile` — read by JWT
- [x] `GET /api/users/me` — current user, sensitive fields stripped
- [x] `PUT /api/users/profile` — update displayName, username, bio, photoURL
- [x] Username uniqueness check on update
- [x] `POST /api/users/generate-upload-url` — signed URL for profile photo (Firebase Storage)
- [x] `POST /api/users/preferences` — save genres array
- [x] Bio length validation + username format validation — zod schema
- [ ] Profile cover/wallpaper upload
- [ ] Profile-level privacy settings (public / followers-only / private)
- [ ] Block / mute / report user
- [ ] Listing of blocked users

---

## 4. Music catalogue (SRS 3.2.2)

- [x] `POST /api/music/generate-upload-url` — signed URL for audio upload
- [x] `POST /api/music/generate-album-art-url` — signed URL for album art
- [x] `POST /api/music/add-music` — persist metadata to `music` collection
- [x] `GET /api/music/search?q=` — prefix search on title + artist
- [x] `GET /api/music/trending` — newest 20 by `createdAt`
- [x] `GET /api/music/charts` — top 20 by `likeCount`
- [x] `GET /api/music/:songId` — fetch a single track
- [x] `add-music` now protected (`protect` + zod) and strips client-supplied `likeCount`/`favoriteCount`
- [ ] Edit / delete uploaded music endpoint
- [ ] Server-side validation of audio file (MIME, duration, size) before signed URL
- [x] Case-insensitive prefix search via denormalized `titleLower` / `artistLower` (still prefix-only; promote to Algolia / Meilisearch for fuzzy/fulltext later)
- [ ] Trending logic factoring in play counts, recency, engagement
- [ ] Charts scoped by genre / region / time window
- [ ] Play-count increment endpoint
- [ ] Streaming-progress / scrubbing analytics endpoint

---

## 5. Posts, feed & engagement (SRS 3.2, alg-steps 3, 5, 9)

- [x] `POST /api/posts/share-music` — create a music share post
- [x] `GET /api/posts/feed` — **personalized**: posts from users the viewer follows (chunked `where in` fan-out)
- [x] `GET /api/posts/explore` — discovery feed: 50 most-recent posts from everyone (the prior `/feed` behaviour)
- [x] `POST /api/posts/:postId/like` — like toggle (post counter only; no longer leaks into `music.likeCount`)
- [x] `GET /api/posts/:postId/comments` — list 50 newest comments
- [x] `POST /api/posts/:postId/comments` — add a text comment
- [x] Likes count + comments count returned in feed
- [x] `likedByUser` flag for current viewer
- [x] Follower-filtered feed shipped (`/feed`); `/explore` retains chronological-all. Still no affinity ranking — left for future scoring work driven by listening signals (§13).
- [ ] Pagination (cursor / `startAfter`) on feed and comments
- [ ] Audio comments (SRS premium feature)
- [ ] Comment likes / nested replies
- [ ] Edit / delete own comment
- [ ] Edit / delete own post
- [ ] Share post to other platforms (`platforms` array is recorded but not acted on)
- [ ] Hashtag / mention indexing
- [ ] Save / bookmark post
- [ ] Repost / quote-post
- [x] N+1 query problem in `getMusicPosts` resolved — denormalized `likeCount`/`commentCount` on the post doc, single `db().getAll()` for authors + viewer likes (~2 RPCs total vs. ~200 before)

---

## 6. Favorites (likes on songs)

- [x] `GET /api/users/favorites` — list user's favourites
- [x] `GET /api/users/favorites/:songId` — is-favorited check
- [x] `POST /api/users/favorites/:songId` — add to favourites, increments `music.favoriteCount` (idempotent; double-add cannot inflate counter)
- [x] `DELETE /api/users/favorites/:songId` — remove (idempotent; transactional check-and-delete)
- [x] `POST /api/music/:songId/like` — direct song like
- [x] `GET /api/music/:songId/likes` — list likes for a song
- [x] `GET /api/music/liked` — songs liked by current user
- [ ] Recently played history endpoint

---

## 7. Direct messaging (SRS alg-step 8)

- [x] `GET /api/messages/conversations` — list conversations for user
- [x] `GET /api/messages/:conversationId` — list 100 messages, marks unread as read
- [x] `POST /api/messages/:userId` — send text or music-share message (deterministic conversation ID — no duplicate threads on race)
- [x] `DELETE /api/messages/:messageId` — delete own message
- [x] `GET /api/users/available` — directory of users to start a chat with
- [x] Unread counters per user per conversation
- [x] Music-card messages (share song into DM)
- [ ] Real-time delivery — Socket.IO scaffold exists in `server.js` but is commented out; messaging is REST-poll only
- [ ] Typing indicators
- [ ] Read receipts surfaced to sender
- [ ] Group conversations
- [ ] Voice / audio messages
- [ ] Image / file attachments in DMs
- [ ] DM privacy: who can message me (everyone / followers / nobody)
- [ ] Block / report inside a thread
- [ ] Pagination on message list (currently capped at 100, no cursor)

---

## 8. Follow / social graph (SRS 1.1, 3.2.1)

- [x] `POST /api/users/:userId/follow` — atomic, idempotent (201 new / 200 alreadyFollowing)
- [x] `DELETE /api/users/:userId/follow` — atomic, idempotent (200 alwaysAbsent or removed)
- [x] `GET /api/users/:userId/followers` — cursor-paginated, default 20, max 50
- [x] `GET /api/users/:userId/following` — cursor-paginated, same
- [x] `GET /api/users/:userId/follow-status` — single `db().getAll(3 refs)` (isFollowing + isFollowedBy + counts)
- [x] Follow counts denormalised on user document (`followerCount`, `followingCount`) — maintained inside the same Firestore transaction as the relation docs
- [x] `visibility: "public"` field on user doc — hook for future private-account mode (no migration when flipped)
- [x] Self-follow rejected at the service layer (400)
- [x] Backfill subcommand `npm run backfill users` for legacy user docs
- [ ] "Suggested users to follow" endpoint (recommendation engine — needs play data)
- [ ] Follow notifications (queued for §14 notifications slice)
- [ ] Private-account approval flow (request → accept/reject state machine; data model already supports `status: "pending"`)

---

## 9. Artist Communities / "Bubbles" (SRS 1.1, 2.1.2, alg-step 4)

- [ ] `communities` collection / data model
- [ ] Top-artist computation from play counts
- [ ] Auto-join user to community for their top artists
- [ ] `GET /api/communities` — list current user's bubbles
- [ ] `GET /api/communities/:communityId/posts` — community feed
- [ ] `POST /api/communities/:communityId/posts` — community-scoped post
- [ ] Community-level moderation roles
- [ ] Artist-owned channels within bubble

---

## 10. Battle Rooms (SRS 1.1, alg-step 6)

- [ ] `battleRooms` data model (topic, creator, mode, participants)
- [ ] `POST /api/battle-rooms` — create room
- [ ] `GET /api/battle-rooms` — list/discover rooms
- [ ] `POST /api/battle-rooms/:id/join`
- [ ] Free tier: observe-only enforcement
- [ ] Premium tier: interaction enforcement
- [ ] Real-time room events (Socket.IO / pub/sub)
- [ ] Vote / reaction endpoints
- [ ] Room transcript / archive
- [ ] Artist Challenge Rooms (artist-to-artist)
- [ ] Ticket sales for Artist Challenge Rooms
- [ ] Moderation hooks (kick, mute, report)

---

## 11. Music-taste Matchmaking (Premium, alg-step 7)

- [ ] Taste-vector representation (genre weights / artist weights / listening signals)
- [ ] Vector storage on user doc
- [ ] Similarity scoring (cosine / Jaccard)
- [ ] Candidate retrieval (premium-only pool)
- [ ] Geography / online-status filters
- [ ] Match notification + mutual interest flow
- [ ] `GET /api/matches/suggestions`
- [ ] `POST /api/matches/:userId/accept` and `/decline`

---

## 12. Reels (SRS 1.1, alg-step 8)

- [x] `reels` collection / data model — top-level `reels`, subcollections for `likes` / `comments` / `views`, reverse-index `users/{uid}/likedReels`, status enum `pending_upload | processing | ready | errored`, denormalized engagement counters
- [x] Signed-URL upload for short video — Mux direct uploads (`mux.video.uploads.create` with `passthrough=reelId`); audio component bundled in the video
- [x] `POST /api/reels` — creates doc + returns `{ reelId, uploadId, uploadUrl }` in one call so the client uploads directly to Mux
- [x] `GET /api/reels/discover` — public reel feed, cursor-paginated, filters `status==ready`
- [x] `GET /api/reels/user/:userId` — user's reels, cursor-paginated; author sees their own processing/errored docs
- [x] Reel likes / comments / shares — atomic toggle-like (tx over reel doc + likeRef + reverse index), cursor-paginated comments with `commentCount` increment, share counter with `arrayUnion` of platforms
- [x] View-count tracking — `POST /:reelId/view`, idempotent per (reel, viewer); only first view bumps `viewCount`, subsequent calls refresh per-user `lastViewedAt`/`count`

### Beyond the SRS line items (shipped in the same slice)

- [x] `POST /api/reels/webhooks/mux` — HMAC-verified via `MUX_WEBHOOK_SECRET`, dispatches on `video.upload.asset_created` / `video.asset.ready` / `video.asset.errored` / `video.upload.cancelled` / `video.upload.errored`. Raw bytes captured by a `verify` callback on `express.json()` so the signature stays valid. Always returns 200 on lookup misses to prevent Mux retry storms.
- [x] `GET /api/reels/feed` — following-filtered feed via chunked `where userId in` fan-out (mirrors `/api/posts/feed`)
- [x] `GET /api/reels/:reelId` — single reel for deep links; author-only visibility while non-ready
- [x] `POST /api/reels/:reelId/share` — `FieldValue.increment(shareCount, 1)` + `arrayUnion(platforms)`
- [x] Post-upload duration enforcement — `video.asset.ready` handler deletes any asset >60s via `mux.video.assets.delete` and flips reel to `errored` with reason

### Deferred (tracked here so the slice stays honest)

- [ ] Signed playback URLs — switch `playback_policy` to `signed` + JWT minting per request
- [ ] MP4 downloads — Mux `mp4_support: "standard"` on asset settings
- [ ] Mux Data analytics SDK on the frontend
- [ ] Orphan-GC job for reels stuck in `pending_upload` > 24h (needs Cloud Scheduler)
- [ ] Edit / delete own reel (delete must also call `muxService.deleteAsset`)
- [ ] Visibility levels beyond `public` (followers-only, private)
- [ ] Cursor pagination on `/reels/feed` (fixed top-N window in v1 — same compromise as `/posts/feed`)

---

## 13. Listening data ingestion (alg-step 2)

- [ ] Spotify Web API integration (OAuth + recently-played pull)
- [ ] Last.fm scrobble import
- [ ] Apple Music API integration
- [ ] In-app play-event ingestion endpoint (when user plays via Cozie itself)
- [ ] Per-user per-artist affinity score job
- [ ] Per-user per-genre affinity score job
- [ ] Listening privacy / consent toggle respected during ingestion

---

## 14. Notifications

- [ ] Firebase Cloud Messaging (FCM) admin integration
- [ ] Notification subscription endpoint (`POST /api/notifications/token`)
- [x] In-app notifications collection / endpoints
      *(`users/{uid}/notifications` subcollection w/ deterministic-IDs for toggle events + auto-IDs for comments. `GET /api/notifications` cursor-paginated, `GET /unread-count` for badge, `POST /mark-read` (ids or markAll), `DELETE /:id`. `unreadNotificationCount` denormalized on user doc + surfaced in `getCurrentUser` and backfill script.)*
- [ ] Notification preferences per category (likes, comments, follows, DMs, battle, match)
- [x] Notification triggers wired into existing controllers
      *(emits on `follow`, `post_like`, `post_comment`, `song_like`. Toggle-off withdraws the matching notification + decrements unread if still unread. Emit runs **outside** the source transaction — a notif blip never rolls back the like/follow. Self-emit skipped.)*

---

## 15. Premium tier & payments (SRS 3.2, alg-step 10)

- [ ] `subscriptions` data model + entitlement flags
- [ ] Payment gateway integration (Paystack / Flutterwave / Stripe)
- [ ] Webhook handlers (subscription created / renewed / failed / cancelled)
- [ ] Recurring billing job
- [ ] Entitlement middleware to gate premium routes
- [ ] Receipt / invoice endpoint
- [ ] Ticket purchase for Artist Challenge Rooms
- [ ] Refund / cancel flow
- [ ] Premium feature flags (ad-free, DMs to non-followers, fonts, wallpapers, hosting rights, battle interaction, matchmaking, audio comments, AI music)

---

## 16. Moderation & safety (SRS 3.3.2, alg-step 11)

- [ ] Report endpoints (post / comment / message / user / community)
- [ ] `reports` collection + queue
- [ ] Automated content checks (profanity, spam, copyright)
- [ ] Moderator actions: hide, warn, suspend, ban
- [ ] Appeal workflow
- [ ] Audit log of moderation actions
- [ ] Copyright takedown (DMCA) workflow

---

## 17. Privacy, consent & data governance (SRS 3.3.7, alg-step 12)

- [ ] Consent flags on user doc (listening data, marketing, third-party sharing)
- [ ] `GET /api/me/data-export` — GDPR / NDPR export
- [ ] `DELETE /api/me` — account + data deletion
- [ ] Retention rules (auto-delete OTP after verification, soft-delete posts, etc.)
- [ ] Audit trail of data-subject requests
- [ ] Terms of service / privacy policy versioning

---

## 18. Third-party integrations (SRS 2.3, alg-step 13)

- [ ] Streaming APIs (Spotify / Last.fm / Apple Music) — see §13
- [ ] Social share APIs (X, Instagram, TikTok, Facebook)
- [ ] Google Maps API for location tagging
- [ ] Ad network integration (free tier)
- [ ] AI music tools (Udio / Korin / Beatoven) — upload + share
- [ ] Analytics provider (PostHog / GA4 / Mixpanel)

---

## 19. Artist tooling (SRS 3.2.2)

- [ ] Artist account type / role flag on user doc
- [ ] Artist registration / verification flow
- [ ] Artist discography management
- [ ] Streaming-count analytics for artist's own tracks
- [ ] Fan-engagement dashboard endpoints
- [ ] Earnings dashboard + withdrawal request endpoints

---

## 20. Admin tooling (SRS 3.2.3)

- [ ] Admin role flag + middleware
- [ ] User management endpoints (list, suspend, change role)
- [ ] Content overview endpoints
- [ ] Platform metrics endpoint (DAU / MAU / revenue / engagement)
- [ ] Royalty management / reporting
- [ ] Subscription plan / pricing management endpoints

---

## 21. Analytics & product signals (alg-step 15)

- [ ] Event ingestion pipeline (play / view / like / comment / share / DM-sent / etc.)
- [ ] Daily aggregate jobs (DAU, MAU, retention)
- [ ] Ranking signal store feeding the timeline ranker
- [ ] Operational dashboard (separate service / hosted)

---

## 22. Non-functional requirements

- [ ] **Performance**: ≤2 s song-start, ≤3 s playlist update echo (no measurement yet)
- [ ] **Performance**: load-test plan for 10 000 concurrent streams
- [ ] **Scalability**: stateless containers (achieved) + Firestore (achieved) — add CDN for media
- [ ] **Security**: HTTPS / TLS (depends on deploy target)
- [x] **Security**: passwords hashed with bcrypt
- [x] **Security**: helmet + rate limiting + input validation (zod)
- [ ] **Reliability**: 99.5% uptime SLO + monitoring
- [ ] **Reliability**: media + DB backup / restore drill
- [x] **Maintainability**: layered architecture (routes → controllers → services → repositories)
- [ ] **Compliance**: GDPR / NDPR — see §17

---

## 23. Tech debt & cleanup (discovered during audit)

- [x] `controllers/genreController.js` — deleted (was CommonJS dead code)
- [x] `controllers/chartItemController.js` — deleted
- [x] `controllers/trendingCardController.js` — deleted
- [x] `models/*.js` — entire `models/` directory deleted (all CommonJS, not used)
- [x] Unused npm deps removed: `multer`, `mongoose`, `mongodb`, `nodemailer`, `firebase` (client SDK)
- [x] `static/*.html` excluded from Docker image via `.dockerignore`
- [x] Per-controller CORS middleware deleted — single app-level CORS in `server.js`
- [x] Per-controller `Cors` imports deleted
- [x] CORS allowlist centralised — origin function in `server.js` using `ALLOWED_ORIGINS` env var
- [x] Inline `authenticate()` deleted from all controllers — `protect` is the single source of truth
- [x] `/api/test-email` route deleted (was referencing undefined `nodemailer`)
- [x] `config/firebase.js` rewritten — explicit `initFirebase()`, no top-level crash, env validated by zod
- [x] `.env.example` updated with new vars (`LOG_LEVEL`, `ALLOWED_ORIGINS`, rate-limit overrides)
- [x] Request validation layer added — zod schemas per route via `validate(...)` middleware
- [x] Post-refactor audit fixes (see below)
- [ ] OpenAPI / Swagger spec
- [ ] ESLint config for the backend

### Post-refactor audit fixes (round 1)

Items discovered while reviewing the refactor itself, all shipped:

- [x] `searchMusic` now returns the standard `{ success: true, songs: [...] }` envelope (was bypassing `ok()`)
- [x] `favoriteService.add` is idempotent — uses `createIfMissing()` in a transaction; counter only bumps on actual insert
- [x] `favoriteService.remove` is idempotent — uses `deleteIfPresent()` in a transaction; counter only decrements on actual delete
- [x] `togglePostLike` no longer also writes to `song.likeCount` — post likes and song likes are now properly separate
- [x] `messageService.getOrCreateConversation` uses a deterministic doc ID (`[a,b].sort().join("__")`) inside a transaction so concurrent first-messages can't create duplicate conversations
- [x] `listMessages` chunks the read-receipt batch update at 450 writes (Firestore caps at 500)
- [x] `validate.js` merges parsed params into `req.params` (no longer drops parent-router params); `validatedQuery` is writable/configurable
- [x] `server.js` CORS origin parser wraps `new URL()` in try/catch (no more crashes on malformed `Origin` headers)
- [x] `server.js` `/api/test` GET/POST debug routes guarded behind `!isProd`
- [x] `server.js` removed redundant `app.options(/.*/, cors(...))` — global `app.use(cors())` already handles preflight
- [x] `requestLogger.genReqId` normalises `x-request-id` header (handles string-or-array properly)
- [x] `favoriteRepository` split into `createIfMissing` / `deleteIfPresent` / `get` / `list` — `addedAt` no longer overwritten on every touch

### Bug-fix phase (round 2) — all shipped

- [x] **Race-safe `toggleSongLike`** — single Firestore transaction that atomically updates `music/{songId}/likes/{userId}`, `users/{userId}/likedSongs/{songId}` (new reverse index), and `music/{songId}.likeCount`. Counter clamped at 0 to recover from any pre-existing drift.
- [x] **Race-safe `togglePostLike`** — single transaction over the post doc + viewer like doc; denormalized `post.likeCount` updated atomically.
- [x] **N+1 in `listFeed` eliminated** — 50 posts now cost 2 RPCs: `listRecent` + a single `db().getAll(...uniqueAuthorRefs, ...viewerLikeRefs)`. Counters read from the post doc.
- [x] **N+1 in `listUserLikedSongs` eliminated** — reads the denormalized `users/{userId}/likedSongs` subcollection ordered by `likedAt desc`. No catalog scan.
- [x] **OTP hashed at rest** — bcrypt (cost 8, ~20ms verify). `user.otp = { hash, expiresAt }` and verify uses `bcrypt.compare` (timing-safe).
- [x] **Case-insensitive search** — `musicService.addMusic` writes `titleLower` and `artistLower`; the prefix range query targets those fields.
- [x] **Logger redact paths extended** with `*.otp.hash`.
- [x] **Backfill script** for existing data — `npm run backfill` (or `node scripts/backfill.js [music|posts|liked-songs]`). Idempotent; rerunnable.

### Remaining hardening (post-bug-fix, not blocking)

- [ ] Cursor-based pagination on feed, comments, message history (currently fixed limits)
- [ ] Search backed by a proper engine (Algolia/Meilisearch) for fuzzy/fulltext (current impl is prefix-only)
- [ ] Resend-OTP endpoint (signup hash is now non-recoverable, so re-sending must mint a fresh code)
- [ ] Account / soft-delete + OTP auto-cleanup TTL

### Backend ↔ frontend audit additions — 2026-05-25

Three endpoints added so the frontend's profile surfaces work for any user, not just `me`. All three are protected, cursor-paginated where appropriate, and reuse existing services.

- [x] `GET /api/users/:userId/profile` — public profile by id (`userController.getPublicProfile` → `userService.getProfile`). Returns the same shape as `/profile` (self).
- [x] `GET /api/users/:userId/posts?cursor&limit` — paginated posts authored by `:userId` (`musicPostService.listByUser` → `musicPostRepository.listByUserId`). `limit` defaults to 30, max 100. Hydrates author + viewer-like flags in one `db().getAll` like the feed does.
- [x] `GET /api/users/:userId/liked-songs` — liked songs for any user (reuses existing `musicService.listUserLikedSongs`).

These previously 404'd from the frontend. Visibility gating (private accounts) is deferred to a future feature pass — keeping parity with the existing followers/following endpoints, which also read public data.

### Reels slice (round 5) — shipped

End-to-end Reels feature delivered against [`../REELS_FEATURE_SPEC.md`](../REELS_FEATURE_SPEC.md) and the round-5 plan. Eleven endpoints, one webhook, Mux-backed video pipeline. Highlights:

- **New module**: `services/muxService.js` — thin wrapper around `@mux/mux-node` (lazy client, `createDirectUpload` / `unwrapWebhook` / `deleteAsset`). Nothing else in the codebase imports the SDK so a future provider swap is a one-file change.
- **State machine**: `pending_upload → processing → ready | errored` on the reel doc, driven by webhooks (`video.upload.asset_created`, `video.asset.ready`, etc.). The doc exists from the very first request so orphaned uploads (client closes app before PUT) are easy to GC.
- **Passthrough lookup**: every Mux upload carries the reel id as `passthrough`, so the webhook handler resolves to the right doc in O(1) — no index query, no race with delivery order. Fallbacks via `findByMuxUploadId` / `findByMuxAssetId` cover edge cases.
- **HMAC verification**: `express.json({ verify })` in `server.js` captures the raw request bytes onto `req.rawBody` so signature verification works without re-stringifying the JSON. Standard pattern, also usable for any future webhook provider.
- **Duration enforcement**: Mux doesn't enforce upload-time duration. The `video.asset.ready` handler reads `data.duration`, and if it exceeds 60s, calls `muxService.deleteAsset` and flips the reel to `errored` — so we don't pay storage on over-limit clips.
- **Reuses the proven feed-hydration pattern**: one `db().getAll(...authorRefs, ...viewerLikeRefs)` per feed page — same O(1)-RPCs-per-page approach as `musicPostService.hydrateFeedPosts`.
- **Engagement parity with posts**: atomic toggle-like over reel doc + likeRef + `users/{uid}/likedReels/{reelId}` reverse index, `commentCount` increment, `notificationService.emitReelLike` / `withdrawReelLike` / `emitReelComment` fired outside the source transaction.
- **Idempotent view counter**: first view per (reel, viewer) bumps `viewCount`; subsequent calls only refresh per-user `lastViewedAt`/`count` so loop replays and refresh spam can't inflate the public counter — same pattern as favorites.
- **Required env vars** (all `.optional()` so non-reels environments boot): `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_WEBHOOK_SECRET`.
- **Required Firestore composite indexes** (declared in [`firestore.indexes.json`](./firestore.indexes.json), deployed via `firebase deploy --only firestore:indexes`): `reels (status asc, createdAt desc)` for discover, `reels (userId asc, status asc, createdAt desc)` for user lists AND feed fan-out (Firestore satisfies both `where userId == X` and `where userId in [...]` with the same composite index). Author-viewing-own-reels uses single-field auto-indexes. Full deploy / new-query workflow documented in [`FIRESTORE_INDEXES.md`](./FIRESTORE_INDEXES.md).

#### Round-5 post-implementation audit (line-by-line vs spec)

Audited each section of `REELS_FEATURE_SPEC.md` against the merged code. Four gaps surfaced and were fixed in the same slice:

- [x] **`errorReason` codes** — webhook handler and the service-layer Mux-unavailable path now write a machine-readable `errorReason` (`upload_cancelled`, `upload_errored`, `processing_failed`, `exceeds_max_duration`, `no_playback_id`, `mux_unavailable`) alongside the human-readable `errorMessage`. The public reel response surfaces both so the frontend can branch on outcome without parsing English.
- [x] **`uploadExpiresAt` in create response** — `muxService.createDirectUpload` now returns an ISO timestamp (`now + 3600s`) and `reelService.create` threads it through to the `POST /api/reels` response, matching spec section 9.1.
- [x] **Per-endpoint per-user rate limits** — five new limiters in `middleware/rateLimiters.js` (`reelCreateLimiter` 10/hr, `reelLikeLimiter` 60/min, `reelCommentLimiter` 20/min, `reelViewLimiter` 600/min, `reelShareLimiter` 30/min) keyed on `req.auth.id` with IP fallback. Wired into the matching routes AFTER `protect`. The global `apiLimiter` still applies on top for traffic shaping.
- [x] **Mux secrets redaction** — `utils/logger.js` redact paths extended with `req.headers['mux-signature']`, `*.MUX_TOKEN_SECRET`, `*.MUX_WEBHOOK_SECRET`, `*.muxTokenSecret`, `*.muxWebhookSecret`, `*.tokenSecret`, `*.webhookSecret`. Purely defensive — no call site currently logs these — but cheap insurance.

#### Post-review blocker fixes (round-5 PR review)

Two blockers surfaced during PR review and were fixed in the same slice:

- [x] **`recordShare` stale-read response** — service was using `FieldValue.increment(1)` for the persisted counter (correct) but computing the response value from a pre-read snapshot (`(reel.shareCount || 0) + 1`), so concurrent shares returned non-monotonic numbers to clients while the stored counter was correct. Rewrote `reelService.recordShare` as a single Firestore transaction over the reel doc — reads `shareCount`, writes `shareCount + 1` plus the platforms `arrayUnion`, returns the post-increment value. Matches `toggleReelLike` / `registerView` conventions.
- [x] **Firestore composite indexes now deployable from code** — added [`firestore.indexes.json`](./firestore.indexes.json) and a minimal [`firebase.json`](./firebase.json) wiring it for `firebase deploy --only firestore:indexes`. Two composite indexes: `reels (status asc, createdAt desc)` and `reels (userId asc, status asc, createdAt desc)`. Deploy / new-query workflow documented in [`FIRESTORE_INDEXES.md`](./FIRESTORE_INDEXES.md). Without this, the first prod request to discover / user-list / feed would 500 with `FAILED_PRECONDITION` until an operator manually clicked through the Firebase console.

#### Two intentional deviations (documented, not fixed)

- **Error envelope shape.** Spec section 9.12 specifies `{ success: false, error: { code, message } }`. Cozie's existing convention (in `middleware/errorHandler.js`) is `{ success: false, message, details }`. Adopting the spec shape for just reels would diverge from every other endpoint, so the existing shape was kept. As a result, the named `error.code` values from spec sections 9.1-9.11 (`invalid_caption`, `song_not_found`, `mux_unavailable`, `reel_not_found`, `reel_not_visible`) are detected correctly but not surfaced as machine-readable codes in the response. Adopting the nested-error shape is a cross-cutting refactor — slated for a future slice if product wants the spec shape.
- **Following-feed cursor pagination.** Spec section 9.4 shows cursor + limit on `/api/reels/feed`. Implementation returns a fixed top-N window — the chunked `where in` fan-out across 200 follows doesn't pair cleanly with a single cursor (same compromise `/api/posts/feed` has lived with since round 3). The validator still accepts `cursor` to keep the client request shape uniform; the service ignores it. Discover (`/api/reels/discover`) remains fully cursor-paginated.
