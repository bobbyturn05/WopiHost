#!/bin/sh
set -eu

: "${MINIO_ENDPOINT:?MINIO_ENDPOINT is required}"
: "${MINIO_ACCESS_KEY:?MINIO_ACCESS_KEY is required}"
: "${MINIO_SECRET_KEY:?MINIO_SECRET_KEY is required}"
: "${MINIO_VERSIONED_BUCKETS:?Set a comma-separated list of buckets to version}"

MINIO_ALIAS="${MINIO_ALIAS:-wopi}"
case "$MINIO_ENDPOINT" in
  http://*|https://*) S3_ENDPOINT="$MINIO_ENDPOINT" ;;
  *)
    PROTOCOL=http
    [ "${MINIO_USE_SSL:-false}" = "true" ] && PROTOCOL=https
    case "$MINIO_ENDPOINT" in
      *:[0-9]*) PORT_SUFFIX= ;;
      *) PORT_SUFFIX=":${MINIO_PORT:-9000}" ;;
    esac
    S3_ENDPOINT="$PROTOCOL://$MINIO_ENDPOINT$PORT_SUFFIX"
    ;;
esac

mc alias set "$MINIO_ALIAS" "$S3_ENDPOINT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY"

OLD_IFS="$IFS"
IFS=,
for bucket in $MINIO_VERSIONED_BUCKETS; do
  [ -n "$bucket" ] || continue
  mc mb --ignore-existing "$MINIO_ALIAS/$bucket"
  mc version enable "$MINIO_ALIAS/$bucket"
done
IFS="$OLD_IFS"
