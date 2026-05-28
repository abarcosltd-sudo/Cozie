# Firestore composite indexes

This directory contains [`firestore.indexes.json`](./firestore.indexes.json) and a
minimal [`firebase.json`](./firebase.json) whose sole purpose is to make
`firebase deploy --only firestore:indexes` deploy the indexes used by this
backend.

The backend speaks to Firestore via the Admin SDK with a service-account JSON
in env vars (see [`config/firebase.js`](./config/firebase.js)) — the Firebase
CLI is **not** otherwise wired into this repo and `firebase.json` deliberately
does not declare rules, hosting, functions, or storage. Add those sections only
if the team adopts the CLI for them too.

## Why hand-maintained?

Firestore auto-creates **single-field** indexes. Composite indexes (any query
that filters on more than one field, or combines an inequality with an
`orderBy`) must be declared explicitly. When a query needs an index that does
not yet exist, Firestore returns an error containing a console URL that
pre-fills the right index — paste the suggested index into
`firestore.indexes.json` rather than clicking through, so the index ships with
the code that needs it.

## Deploying

Targets the **backend** Firebase project (the one whose service account is
loaded from `FIREBASE_PROJECT_ID` / `FIREBASE_PRIVATE_KEY` in env vars), NOT the
frontend storage project.

```bash
cd Cozie
firebase use <backend-project-id>
firebase deploy --only firestore:indexes
```

Index builds are asynchronous — the CLI returns immediately. Watch the build
progress in the Firebase console (`Firestore → Indexes`). A composite index on
a small collection finishes in seconds; on a large collection it can take many
minutes. Queries that need the index will 500 with `FAILED_PRECONDITION` until
the build is `Enabled`.

## Current indexes

| # | Collection | Fields | Used by |
|---|---|---|---|
| 1 | `reels` | `status` ASC, `createdAt` DESC | `reelRepository.listRecent` — Discover feed (`GET /api/reels/discover`) |
| 2 | `reels` | `userId` ASC, `status` ASC, `createdAt` DESC | `reelRepository.listByUserId` (non-author viewer) — `GET /api/reels/user/{userId}` AND `reelRepository.listRecentByUserIds` — Following feed (`GET /api/reels/feed`). Firestore satisfies both `where userId == X` and `where userId in [...]` with the same composite index. |

Author-viewing-own-reels uses `where('userId','==',X).orderBy('createdAt','desc')`,
which Firestore satisfies with the auto-created single-field index on
`createdAt` — no composite index required.

## Adding a new query

1. Run the query locally / in staging. If a composite index is required,
   Firestore returns a `FAILED_PRECONDITION` error containing a console URL.
2. Either:
   - Open the URL to read the index shape, then add it to
     `firestore.indexes.json` by hand, OR
   - Click the "Create index" button in the console to create it directly, then
     run `firebase firestore:indexes` to print the now-deployed indexes in JSON
     form and copy the new entry into this file.
3. Open a PR with the updated `firestore.indexes.json`. Code that adds a query
   without the corresponding index entry should fail review.
