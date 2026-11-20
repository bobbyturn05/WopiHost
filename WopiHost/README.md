# WOPI Host

A NestJS WOPI host that serves documents stored in MinIO through Microsoft Office Online / Microsoft 365 for the web.

## Architecture

- The main application authenticates users and authorizes access to a document.
- The main application is the only service allowed to call the WOPI host's `/internal` endpoints for launch creation, session revocation, and file-identity lifecycle operations.
- The WOPI host never calls the main application.
- The WOPI host reads and writes document content directly in MinIO using the AWS SDK for JavaScript v3.
- The browser receives an Office launch form, not MinIO credentials or MinIO presigned URLs.
- The WOPI host stores hashed launch/access tokens, persistent file identities, and document-scoped WOPI locks in MongoDB. CheckFileInfo returns the supplied `userId` unchanged as `UserId`; it does not receive or expose a separate display name. `OwnerId` is read from the MinIO object's custom `ownerid` metadata when present; if absent, it uses a stable opaque identity derived from the persistent WOPI file ID. `UserFriendlyName` is omitted.

The internal endpoint must be protected by the service token **and** restricted at the network/ingress layer so it is not publicly reachable. In the sample OpenShift deployment, the public Routes expose only `/wopi` and `/launch`; the main backend calls `/internal/presign` through the cluster-internal Service. Do not expose `/internal` or `/health` on the public Route.

The main backend calls `POST /internal/presign` with `{ bucket, key, userId, mode }` and receives a one-use launch URL. The WOPI host resolves the object to a persistent internal `fileId`; the backend does not supply or need to know that ID. When authorization is withdrawn, it calls `POST /internal/sessions/revoke` with `{ bucket, key, userId }`. Omit `userId` to revoke every launch/access token for that object. Both requests require the `X-Internal-Service-Token` header.

## Configuration

Copy `.env.example` to `.env` and configure:

- `PUBLIC_WOPI_ORIGIN`: externally reachable HTTPS origin of this WOPI host. It must be the same origin Office uses when calling the WOPI endpoints.
- `LAUNCH_TOKEN_TTL_SECONDS`: one-use launch-token lifetime in seconds (default 120; allowed range 30–600).
- `WOPI_ACCESS_TOKEN_TTL_SECONDS`: WOPI session token lifetime in seconds (default 28,800 / 8 hours; configurable up to 24 hours). Use the session-revocation endpoint when backend authorization is withdrawn.
- `MAX_FILE_SIZE_BYTES` and `WOPI_MAX_CONCURRENT_UPLOADS`: per-document body limit and concurrent upload limit per pod.
- `WOPI_OPERATION_LEASE_TTL_SECONDS`: MongoDB operation lease duration (default 120 seconds; the service renews it while an operation is active).
- MongoDB's `wopi_file_identities` collection is the durable mapping between an opaque WOPI file ID and its current MinIO bucket/key. Back up this collection with the document metadata; losing it changes file identities.
- `OFFICE_DISCOVERY_URL`: the discovery XML endpoint for the Office Online / Microsoft 365 deployment in use. For an on-premises Office Online Server deployment, use that deployment's discovery URL rather than the Microsoft 365 default.
- `OFFICE_DISCOVERY_ZONE`: the exact discovery network zone to use; defaults to `external-https`. Do not combine actions from different zones.
- `OFFICE_ALLOWED_ORIGINS`: comma-separated exact HTTPS origins permitted for Office action URLs in the selected zone. Populate this from the discovery XML for your Office deployment; the example values are illustrative and may need to be changed.
- `MINIO_ENDPOINT`: preferably a full S3 endpoint URL such as `http://minio:9000`.
- `MINIO_VERSIONED_BUCKETS`: required comma-separated allow-list of every bucket that the main backend may pass to the WOPI host. The internal endpoint rejects buckets outside this list. Every configured bucket must have versioning enabled: readiness checks verify it, and session creation checks the selected bucket before issuing a launch token. If document ownership differs from the active user, set the object's S3 user metadata key `ownerid` when uploading it; the WOPI host preserves custom metadata on saves.
- `INTERNAL_SERVICE_TOKEN`: a long random secret shared only with the main backend.

The application emits structured JSON audit events for launch issuance, save success/reconciliation, session revocation, and file-location updates. Collect and retain these logs with access controls; the events intentionally omit bearer tokens and raw object keys. The main backend and WOPI ingress/proxy should redact both `/launch/<token>` path segments and query strings containing `access_token` from access logs, traces, and error reports. Launch tokens and WOPI access tokens are bearer credentials and must not be copied into logs or traces. Also redact the `x-internal-service-token` request header from all backend, proxy, and error logs. Apply ingress-level request-rate limits to launch attempts and internal service endpoints; tune WOPI protocol request limits generously enough for Office autosave, proof-key checks, and coauthoring traffic rather than using a generic low per-user API limit.

Do not commit `.env`, MinIO credentials, MongoDB credentials, or the internal service token.

## Provision MinIO bucket versioning

Versioning is a bucket-level setting. It must be enabled once per bucket, outside the WOPI application. The application identity should not need permission to change bucket configuration.

Install the MinIO Client (`mc`) in a deployment/init job and run this with a separate bucket-provisioning identity (not the WOPI runtime credentials):

```bash
MINIO_ENDPOINT=http://minio:9000 \
MINIO_ACCESS_KEY=... \
MINIO_SECRET_KEY=... \
MINIO_VERSIONED_BUCKETS=documents,archive \
./scripts/enable-minio-versioning.sh
```

Include every bucket that the main backend can send in `POST /internal/presign`. Buckets omitted from this list are not allowed for WOPI access; the script enables versioning only for the listed buckets.

Before production, verify conditional `PutObject` support against the exact MinIO release you run:

```bash
node scripts/verify-minio-conditional-write.mjs
```

Run this check with a temporary provisioning identity that can create and delete object versions. It writes a temporary object, updates it with the current ETag, confirms a stale ETag is rejected, and removes the test versions. Do not grant the WOPI runtime identity `DeleteObject` or bucket-administration permissions just for this test.

## Provision MongoDB indexes

Production configuration disables Mongoose automatic index creation. For a new installation, run the index script as a deployment migration before starting the WOPI host. For an upgrade from the previous HMAC-based release, run the one-time file-identity migration in the Stable WOPI file IDs section first, then create/verify indexes:

```bash
node --env-file=.env scripts/create-mongo-indexes.mjs
```

The file-identity collection requires unique indexes on `fileId` and `{ bucket, key }`, plus a lookup index for historical locations used by moves and revocation. The lock and operation-lease collections use unique `fileId` indexes, and the token collection has a `fileId`-based session-revocation index. The token, lock, and operation-lease collections require their TTL indexes for eventual cleanup. Expiration is also checked in application queries; correctness does not depend on the TTL monitor running immediately.

## Run

```bash
npm ci
npm run build
npm run start:prod
```

## Internal launch endpoint

The main backend calls:

```http
POST /internal/presign
X-Internal-Service-Token: <shared-secret>
Content-Type: application/json

{
  "bucket": "documents",
  "key": "presentations/123.pptx",
  "userId": "user-123",
  "mode": "edit"
}
```

The response contains a short-lived `launchUrl`. The backend must authorize the user and document before calling this endpoint. Launch redemption checks the document and Office action before consuming the single-use launch token; concurrent redemptions race atomically, and only one can succeed.


## Revoke WOPI sessions

The main backend can revoke outstanding launch and access tokens for a document:

```http
POST /internal/sessions/revoke
X-Internal-Service-Token: <shared-secret>
Content-Type: application/json

{
  "bucket": "documents",
  "key": "presentations/123.pptx",
  "userId": "user-123"
}
```

`userId` is optional. Include it to revoke only that user's sessions; omit it to revoke every WOPI session for the document. The response contains `revokedCount`. This endpoint uses the same service-token guard as `/internal/presign` and must have the same network/ingress restrictions. The backend remains responsible for deciding when a user's access should be revoked. Revocation blocks subsequent requests using those tokens; an already-authorized in-flight operation may finish. Document-scoped WOPI locks are not user-owned and remain until the client unlocks them or their timeout expires.

## Delete a MinIO object

Before deleting or replacing a logical document, pause new launch requests for it and call `POST /internal/file-identities/delete`:

```http
POST /internal/file-identities/delete
X-Internal-Service-Token: <shared-secret>
Content-Type: application/json

{
  "bucket": "documents",
  "key": "presentations/123.pptx"
}
```

The endpoint serializes against lock/save operations, refuses deletion while an active WOPI editing lock exists, revokes all remaining launch/access tokens, and removes the persistent identity. A retry is safe if the identity was already removed. After it succeeds, keep the object available for at least five minutes so already-started reads can finish, then delete it from MinIO. Resume new launches only after the old object has been deleted. A replacement object at the same bucket/key will receive a new WOPI file ID. If the endpoint returns 409, do not delete the object; retry after the editor releases its lock.

## Move or rename a MinIO object

The main backend owns the physical MinIO move. Pause issuing new launch sessions for the source object while moving it. Use this order so an active WOPI session never points at a missing source object:

1. Copy the object to its destination, preserving metadata and tags as required by your storage workflow.
2. Call the internal identity-move endpoint:

```http
POST /internal/file-identities/move
X-Internal-Service-Token: <shared-secret>
Content-Type: application/json

{
  "sourceBucket": "documents",
  "sourceKey": "presentations/123.pptx",
  "destinationBucket": "archive",
  "destinationKey": "presentations/123.pptx"
}
```

3. Keep the source object available for at least five minutes after the endpoint succeeds, then delete it. If the endpoint returns 409 because an editing lock is active, leave the source untouched, remove the uncommitted destination copy, and retry the move after the document is unlocked. This grace period lets already-started GetFile requests that resolved the old location finish safely.

The endpoint validates both buckets against `MINIO_VERSIONED_BUCKETS`, verifies the destination copy matches the source ETag, size, metadata, headers, and tags, serializes against WOPI lock/save operations, refuses to move an actively locked document, and updates the persistent identity. If the source changed during the copy, it returns 409; copy the latest source again and retry. The backend must also avoid issuing new launch URLs during the move. Retries after a successful mapping update are safe. Never change the MinIO key without updating this mapping.

## MinIO permissions for saving

The WOPI service needs bucket-level `s3:ListBucket` (HeadBucket) and `s3:GetBucketVersioning` permissions. For objects it needs `s3:GetObject`, `s3:GetObjectVersion`, `s3:PutObject`, `s3:GetObjectTagging`, `s3:GetObjectVersionTagging`, and `s3:PutObjectTagging`. Version-specific read/tag permissions are required because the host reads exact object versions and preserves their tags during saves. It also preserves user metadata, content type, cache-control, content-disposition, content-encoding, content-language, expiry, and website redirect metadata when replacing an object. Grant only the required permissions on the configured buckets and object prefixes.

## WOPI support

Implemented operations include CheckFileInfo, GetFile, PutFile, Lock, GetLock, RefreshLock, Unlock, and UnlockAndRelock (using `X-WOPI-Override: LOCK` with `X-WOPI-OldLock`). PutRelativeFile is intentionally unsupported; CheckFileInfo sets `UserCanNotWriteRelative: true`, and the endpoint returns 501 for that operation.

The WOPI host validates access tokens and Microsoft Office proof signatures. PutFile requires a matching active WOPI lock, except for the WOPI-defined initial save to an existing zero-byte object, which may be written while unlocked. The host supports `X-WOPI-LockExpirationTimeout` for Lock, RefreshLock, and UnlockAndRelock (60–3600 seconds); when omitted, the WOPI-standard 30-minute expiration is used (`WOPI_LOCK_TTL_SECONDS` is fixed at 1800). PutFile checks the lock but does not extend its expiry. Before production use, run Microsoft's WOPI Validator, especially the ProofKeys, CheckFileInfoSchema, BaseWopiViewing, EditFlows, Locks, FileVersion, and PutRelativeFileUnsupported test groups. The public WOPI URL must be HTTPS in production, and the reverse proxy must preserve the original request path and query string.

## Stable WOPI file IDs and cross-replica serialization

The WOPI `file_id` is a random, persistent 256-bit identifier stored in `wopi_file_identities`; it is independent of the current MinIO object key. All replicas resolve the same ID through MongoDB. The identity collection is essential state and must be included in MongoDB backups and restores. Lock mutations and `PutFile` are coordinated by this immutable `fileId` through MongoDB operation leases, so moving the object does not orphan its WOPI lock.

When the main backend moves or renames an object, it must copy the object to the destination first, then call `POST /internal/file-identities/move` with the source and destination bucket/key, and only delete the old object after that call succeeds. The endpoint is idempotent for retries. It verifies the destination object exists and both buckets are in the WOPI allow-list. This updates the identity's current location; existing WOPI access tokens continue to work because they refer to the immutable file ID. Do not move objects behind the WOPI host without updating this mapping.

For an upgrade from the previous HMAC-derived file IDs, stop the old WOPI deployment and run the one-time migration while the old `WOPI_FILE_ID_SECRET` is available:

```bash
WOPI_FILE_ID_SECRET='<the previous runtime value>' npm run db:migrate-file-identities
npm run db:indexes
```

The migration preserves the previous HMAC file IDs for existing tokens and migrates existing lock/lease records to those IDs. Run it once with a MongoDB backup in place. The service must be stopped during migration so no old-version instance can create bucket/key-based locks or tokens. After migration, remove `WOPI_FILE_ID_SECRET` from runtime configuration. For new objects, the host creates and persists random file IDs automatically.

Lock mutations and `PutFile` are coordinated by immutable file ID through MongoDB operation leases. The lease has a heartbeat and is released when an operation finishes; lease loss aborts an in-flight MinIO write. This is distributed coordination, not a transaction-level fencing token. `PutFile` rechecks that bucket versioning is enabled and uses MinIO's conditional `If-Match` write against the ETag read before saving, preventing a stale content save from overwriting a newer content version. Metadata/tag-only changes may not change the ETag, so other services must not write or retag the same object key during an active WOPI editing session unless they participate in equivalent coordination. The MinIO upload request is bounded to 120 seconds. Keep MongoDB reachable throughout writes and run the MongoDB index migration before deploying. Verify conditional-write support against your exact MinIO release using the script above.

The WOPI `PutFile` zero-byte exception is supported: an unlocked object can accept its initial save only when the current object exists and is exactly zero bytes. Unlocked non-empty objects and lock mismatches return `409 Conflict` with `X-WOPI-Lock` set to the current lock (or an empty value when unlocked).

Use Node.js 20.6 or newer for the `AbortSignal.timeout()` and `AbortSignal.any()` APIs used to bound and cancel MinIO writes.


## Production operations

### Health endpoints

- `GET /health/live` is a liveness check. It does not depend on MongoDB, MinIO, or Office discovery.
- `GET /health/ready` checks a live MongoDB ping, the required unique/TTL/session indexes, successful Office discovery initialization, and HeadBucket plus versioning status for every configured MinIO bucket. It returns HTTP 503 if a dependency is unavailable. The MinIO identity therefore needs `s3:ListBucket` and `s3:GetBucketVersioning` on every configured bucket.

### Upload resource limits

`MAX_FILE_SIZE_BYTES` limits a single WOPI `PutFile` body. `WOPI_MAX_CONCURRENT_UPLOADS` limits concurrent PutFile requests per pod; excess requests receive HTTP 503 with `Retry-After`. These are per-replica limits, not a cluster-wide quota. Tune them against the pod memory limit and expected document sizes.

### Container and OpenShift

A multi-stage production `Dockerfile` and example OpenShift manifests are under `deploy/openshift`. Replace all example hostnames, image names, bucket names, and Office origins before applying them. Create `wopi-host-secrets` through your secret manager; do not commit real credentials. The sample deployment assumes two replicas, TLS termination at the OpenShift router, MongoDB availability, and a MinIO bucket with versioning enabled.

The sample manifests are a starting point, not a substitute for adapting resource requests, network policies, TLS termination, secret delivery, and storage permissions to your cluster. The deployment uses a 210-second termination grace period and a three-minute WOPI Route timeout to allow an in-flight bounded MinIO save to finish during pod shutdown, plus preferred pod anti-affinity to spread replicas across nodes when possible.
