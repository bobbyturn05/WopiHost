export const configuration = () => ({
  app: {
    environment: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 3100),
    publicWopiOrigin: process.env.PUBLIC_WOPI_ORIGIN,
  },
  database: {
    uri: process.env.MONGODB_URI,
  },
  security: {
    internalServiceToken: process.env.INTERNAL_SERVICE_TOKEN,
  },
  minio: {
    endpoint: process.env.MINIO_ENDPOINT,
    port: Number(process.env.MINIO_PORT ?? 9000),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY,
    secretKey: process.env.MINIO_SECRET_KEY,
    region: process.env.MINIO_REGION ?? 'us-east-1',
    allowedBuckets: (process.env.MINIO_VERSIONED_BUCKETS ?? '')
      .split(',')
      .map((bucket) => bucket.trim())
      .filter(Boolean),
  },
  tokens: {
    launchTtlSeconds: Number(process.env.LAUNCH_TOKEN_TTL_SECONDS ?? 120),
    accessTtlSeconds: Number(process.env.WOPI_ACCESS_TOKEN_TTL_SECONDS ?? 3600),
  },
  wopi: {
    maxFileSizeBytes: Number(process.env.MAX_FILE_SIZE_BYTES ?? 104857600),
    lockTtlSeconds: Number(process.env.WOPI_LOCK_TTL_SECONDS ?? 1800),
    operationLeaseTtlSeconds: Number(process.env.WOPI_OPERATION_LEASE_TTL_SECONDS ?? 120),
    fileIdSecret: process.env.WOPI_FILE_ID_SECRET,
    serverVersion: process.env.WOPI_SERVER_VERSION ?? '1.0.0',
    machineName: process.env.WOPI_MACHINE_NAME ?? 'wopi-host',
  },
  office: {
    discoveryUrl: process.env.OFFICE_DISCOVERY_URL,
  },
});
