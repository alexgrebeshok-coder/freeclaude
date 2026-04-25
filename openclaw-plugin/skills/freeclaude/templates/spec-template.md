---
title: "Add user avatar upload feature"
owner: "@alice"
status: draft
created: 2026-04-25
updated: 2026-04-25
---

# Spec: Add user avatar upload feature

## Goal

Allow authenticated users to upload a profile avatar (JPEG/PNG, max 2 MB).
The image is stored in object storage and the URL is persisted to the user
record. Old avatars are deleted on replacement.

## Non-goals

- No image cropping or resizing UI in this iteration.
- No admin moderation of uploaded images.
- No support for animated GIFs.

## Constraints

- **Performance:** Upload endpoint must respond within 3 s on a 2 MB file.
- **Dependencies:** Do not add new npm packages; use existing `multer` setup.
- **Compatibility:** Must work with Node ≥18 and the current S3 client version.
- **Auth:** Endpoint requires a valid JWT; unauthenticated requests → 401.

## Files to modify

- `src/routes/users.ts` — add `POST /users/:id/avatar` route
- `src/services/storage.ts` — add `uploadAvatar(buffer, userId)` helper
- `src/models/user.ts` — add `avatarUrl` field to User schema
- `src/middleware/upload.ts` — configure multer limits (2 MB, JPEG/PNG only)
- `tests/routes/users.test.ts` — add integration tests for the new route

## Acceptance criteria

```gherkin
Given I am an authenticated user
When I POST a valid JPEG to /users/me/avatar
Then the response is 200 with { "avatarUrl": "<url>" }
And the URL is reachable and returns the uploaded image

Given I POST a file larger than 2 MB
Then the response is 413 Payload Too Large

Given I POST a non-image file (e.g. .txt)
Then the response is 415 Unsupported Media Type

Given I POST without a valid JWT
Then the response is 401 Unauthorized
```

## Edge cases

- Concurrent uploads for the same user: last write wins; no partial state.
- S3 upload failure: return 502 and do not update the DB record.
- User record not found: return 404 before attempting the upload.
- File with image MIME but corrupt bytes: multer rejects at parse time → 400.

## Test plan

- Unit: `storage.ts` — mock S3 client, verify correct bucket/key/ACL.
- Integration: `users.test.ts` — use supertest; mock S3 with `aws-sdk-mock`.
- Manual smoke: upload via curl against local dev server; verify image loads.

## Rollback plan

- Feature flag `AVATAR_UPLOAD_ENABLED=false` disables the route (returns 501).
- DB migration is additive (`avatarUrl` nullable) — safe to roll back without
  a down-migration.
- S3 objects are namespaced under `avatars/<userId>/` for easy bulk delete.
