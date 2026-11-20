import Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3100),
  PUBLIC_WOPI_ORIGIN: Joi.alternatives().conditional('NODE_ENV', {
    is: 'production',
    then: Joi.string().uri({ scheme: ['https'] }).required(),
    otherwise: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
  }).custom((value, helpers) => {
    const parsed = new URL(value);
    if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) return helpers.error('string.uri');
    return value.replace(/\/$/, '');
  }),
  MONGODB_URI: Joi.string().required(),
  INTERNAL_SERVICE_TOKEN: Joi.string().min(32).required(),
  MINIO_ENDPOINT: Joi.string().required().custom((value, helpers) => {
    try {
      const endpoint = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`);
      if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
        return helpers.error('any.invalid');
      }
      return value;
    } catch {
      return helpers.error('any.invalid');
    }
  }),
  MINIO_PORT: Joi.number().port().default(9000),
  MINIO_USE_SSL: Joi.boolean().default(false),
  MINIO_ACCESS_KEY: Joi.string().required(),
  MINIO_SECRET_KEY: Joi.string().required(),
  MINIO_REGION: Joi.string().default('us-east-1'),
  MINIO_VERSIONED_BUCKETS: Joi.string().trim().required().custom((value, helpers) => {
    const buckets = value.split(',').map((bucket: string) => bucket.trim()).filter(Boolean);
    if (!buckets.length || new Set(buckets).size !== buckets.length || buckets.some((bucket: string) =>
      bucket.length < 3 || bucket.length > 63 ||
      !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucket) ||
      bucket.includes('..') || bucket.split('.').some((part: string) => part === '') ||
      /^\d{1,3}(\.\d{1,3}){3}$/.test(bucket)
    )) return helpers.error('any.invalid');
    return value;
  }),
  LAUNCH_TOKEN_TTL_SECONDS: Joi.number().integer().min(30).max(600).default(120),
  WOPI_ACCESS_TOKEN_TTL_SECONDS: Joi.number().integer().min(300).max(86400).default(28800),
  MAX_FILE_SIZE_BYTES: Joi.number().integer().positive().default(52428800),
  WOPI_MAX_CONCURRENT_UPLOADS: Joi.number().integer().min(1).max(32).default(4),
  WOPI_LOCK_TTL_SECONDS: Joi.number().valid(1800).default(1800),
  WOPI_OPERATION_LEASE_TTL_SECONDS: Joi.number().integer().min(120).max(600).default(120),
  WOPI_SERVER_VERSION: Joi.string().pattern(/^[A-Za-z0-9._-]{1,64}$/).default('1.0.0'),
  WOPI_MACHINE_NAME: Joi.string().pattern(/^[A-Za-z0-9._-]{1,64}$/).default('wopi-host'),
  OFFICE_DISCOVERY_URL: Joi.alternatives().conditional('NODE_ENV', {
    is: 'production',
    then: Joi.string().uri({ scheme: ['https'] }).required(),
    otherwise: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
  }).custom((value, helpers) => {
    try {
      const parsed = new URL(value);
      if (parsed.username || parsed.password) return helpers.error('string.uri');
      return value;
    } catch {
      return helpers.error('string.uri');
    }
  }),
  OFFICE_DISCOVERY_ZONE: Joi.string().trim().default('external-https'),
  OFFICE_ALLOWED_ORIGINS: Joi.string().trim().required().custom((value, helpers) => {
    const origins = value.split(',').map((origin: string) => origin.trim()).filter(Boolean);
    if (origins.length === 0) return helpers.error('any.invalid');
    try {
      origins.forEach((origin: string) => {
        const parsed = new URL(origin);
        if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
          throw new Error('Invalid Office origin');
        }
      });
    } catch {
      return helpers.error('any.invalid');
    }
    return value;
  }),
});
