# WOPI Host

A NestJS WOPI host that serves documents stored in MinIO through Microsoft Office Online / Microsoft 365 for the web.

## Architecture

- The main application authenticates users and authorizes access to a document.
- The main application is the only service allowed to call `POST /internal/presign`.
- The WOPI host never calls the main application.
- The WOPI host reads and writes document content directly in MinIO using the AWS SDK for JavaScript v3.
- The browser receives an Office launch form, not MinIO credentials or MinIO presigned URLs.
- The WOPI host stores hashed launch/access tokens and document-scoped WOPI locks in MongoDB. CheckFileInfo derives a stable alphanumeric WOPI identity by hashing the supplied `userId`; `OwnerId` is read from the MinIO object's custom `ownerid` metadata when present; if absent, it falls back to a stable identity derived from the bucket and object key. Both values are hashed into stable alphanumeric WOPI identities. `UserFriendlyName` is omitted.

The internal endpoint must be protected by the service token **and** restricted at the network/ingress layer so it is not publicly reachable.

## Configuration

Copy `.env.example` to `.env` and configure:

- `PUBLIC_WOPI_ORIGIN`: externally reachable HTTPS origin of this WOPI host. It must be the same origin Office uses when calling the WOPI endpoints.
- `OFFICE_DISCOVERY_URL`: the discovery XML endpoint for the Office Online / Microsoft 365 deployment in use. For an on-premises Office Online Server deployment, use that deployment's discovery URL rather than the Microsoft 365 default.
- `MINIO_ENDPOINT`: preferably a full S3 endpoint URL such as `http://minio:9000`.
- `MINIO_VERSIONED_BUCKETS`: required comma-separated allow-list of every bucket that the main backend may pass to the WOPI host. The internal endpoint rejects buckets outside this list. Enable versioning before the first WOPI write to each bucket. If document ownership differs from the active user, set the object's S3 user metadata key `ownerid` when uploading it; the WOPI host preserves custom metadata on saves.
- `INTERNAL_SERVICE_TOKEN`: a long random secret shared only with the main backend.

Do not commit `.env`, MinIO credentials, MongoDB credentials, or the internal service token.

## Provision MinIO bucket versioning

Versioning is a bucket-level setting. It must be enabled once per bucket, outside the WOPI application. The application identity should not need permission to change bucket configuration.

Install the MinIO Client (`mc`) in a deployment/init job and run:

```bash
MINIO_ENDPOINT=http://minio:9000 \
MINIO_ACCESS_KEY=... \
MINIO_SECRET_KEY=... \
MINIO_VERSIONED_BUCKETS=documents,archive \
./scripts/enable-minio-versioning.sh
```

Include every bucket that the main backend can send in `POST /internal/presign`. Buckets omitted from this list will not retain previous object versions.

## Provision MongoDB indexes

Production configuration disables Mongoose automatic index creation. Run the index script as a deployment migration before starting the WOPI host:

```bash
node --env-file=.env scripts/create-mongo-indexes.mjs
```

The lock collection requires the unique `{ bucket, key }` index for atomic lock acquisition. Both collections require TTL indexes for eventual cleanup. Expiration is also checked in application queries; correctness does not depend on the TTL monitor running immediately.

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

The response contains a short-lived `launchUrl`. The backend must authorize the user and document before calling this endpoint.

## WOPI support

Implemented operations include CheckFileInfo, GetFile, PutFile, Lock, GetLock, RefreshLock, Unlock, and UnlockAndRelock (using `X-WOPI-Override: LOCK` with `X-WOPI-OldLock`). PutRelativeFile is intentionally unsupported; CheckFileInfo sets `UserCanNotWriteRelative: true`, and the endpoint returns 501 for that operation.

The WOPI host validates access tokens and Microsoft Office proof signatures. PutFile requires a matching active WOPI lock, except for the WOPI-defined initial save to an existing zero-byte object, which may be written while unlocked. Before production use, run Microsoft's WOPI Validator, especially the ProofKeys, CheckFileInfoSchema, BaseWopiViewing, EditFlows, Locks, FileVersion, and PutRelativeFileUnsupported test groups. The public WOPI URL must be HTTPS in production, and the reverse proxy must preserve the original request path and query string.

## Stable WOPI file IDs and cross-replica serialization

`WOPI_FILE_ID_SECRET` is a stable secret shared by every WOPI host replica. The host derives the WOPI `file_id` as an HMAC of `bucket + NUL + key`, so one MinIO object has the same opaque WOPI ID across separate launches and replicas without exposing its bucket or key. Keep this secret stable across deployments and replicas. Changing it makes future launches use different file IDs for the same objects; existing tokens keep the file IDs already stored with their token records, but separate sessions will no longer share the same WOPI file identity. Back it up as deployment secret material.

Lock mutations and `PutFile` are serialized per `{ bucket, key }` through MongoDB operation leases. The lease has a heartbeat and is released when the operation finishes; the TTL index is only cleanup, not the correctness mechanism. This serializes WOPI lock transitions and WOPI saves across host replicas. Other services must not write the same object key during an active WOPI editing session unless they participate in an equivalent coordination scheme. Run the MongoDB index migration before deploying this version. `PutFile` also bounds its MinIO upload request to 90 seconds; keep the operation lease TTL at least 120 seconds (the configured minimum) so it exceeds the bounded storage request duration.

The WOPI `PutFile` zero-byte exception is supported: an unlocked object can accept its initial save only when the current object exists and is exactly zero bytes. Unlocked non-empty objects and lock mismatches return `409 Conflict` with `X-WOPI-Lock` set to the current lock (or an empty value when unlocked).

Use Node.js 20 or newer for the built-in `AbortSignal.timeout()` used to bound MinIO writes.
