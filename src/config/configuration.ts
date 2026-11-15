export const configuration = () => ({
    app: {
        environment: process.env.NODE_ENV,
        port: Number(process.env.PORT),
        publicWopiOrigin: process.env.PUBLIC_WOPI_ORIGIN
    },

    database: {
        uri: process.env.MONGODB_URI
    },

    security: {
        internalServiceToken: process.env.INTERNAL_SERVICE_TOKEN
    },

    backend: {
        url: process.env.MAIN_BACKEND_URL,
        serviceToken: process.env.MAIN_BACKEND_SERVICE_TOKEN,
        timeoutMs: Number(process.env.MAIN_BACKEND_TIMEOUT_MS)
    },

    minio: {
        endpoint: process.env.MINIO_ENDPOINT,
        port: Number(process.env.MINIO_PORT),
        useSSL: process.env.MINIO_USE_SSL === 'true',
        accessKey: process.env.MINIO_ACCESS_KEY,
        secretKey: process.env.MINIO_SECRET_KEY,
        publicEndpoint: process.env.MINIO_PUBLIC_ENDPOINT,
        region: process.env.MINIO_REGION
    },

    tokens: {
        launchTtlSeconds: Number(process.env.LAUNCH_TOKEN_TTL_SECONDS),
        accessTtlSeconds: Number(process.env.WOPI_ACCESS_TOKEN_TTL_SECONDS),
        maxLaunchTtlSeconds: Number(process.env.MAX_LAUNCH_TOKEN_TTL_SECONDS)
    },

    wopi: {
        maxFileSizeBytes: Number(process.env.MAX_FILE_SIZE_BYTES),
        lockTtlSeconds: Number(process.env.WOPI_LOCK_TTL_SECONDS)
    },

    office: {
        discoveryUrl: process.env.OFFICE_DISCOVERY_URL,
        publicOrigin: process.env.OFFICE_PUBLIC_ORIGIN
    }
});