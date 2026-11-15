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
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) return helpers.error('string.uri');
    return value.replace(/\/$/, '');
  }),
  MONGODB_URI: Joi.string().required(),
  INTERNAL_SERVICE_TOKEN: Joi.string().min(32).required(),
  MINIO_ENDPOINT: Joi.string().required(),
  MINIO_PORT: Joi.number().port().default(9000),
  MINIO_USE_SSL: Joi.boolean().default(false),
  MINIO_ACCESS_KEY: Joi.string().required(),
  MINIO_SECRET_KEY: Joi.string().required(),
  MINIO_REGION: Joi.string().default('us-east-1'),
  MINIO_VERSIONED_BUCKETS: Joi.string().trim().required(),
  LAUNCH_TOKEN_TTL_SECONDS: Joi.number().integer().positive().default(120),
  WOPI_ACCESS_TOKEN_TTL_SECONDS: Joi.number().integer().positive().default(3600),
  MAX_FILE_SIZE_BYTES: Joi.number().integer().positive().default(104857600),
  WOPI_LOCK_TTL_SECONDS: Joi.number().integer().positive().max(1800).default(1800),
  WOPI_OPERATION_LEASE_TTL_SECONDS: Joi.number().integer().min(120).max(600).default(120),
  WOPI_FILE_ID_SECRET: Joi.string().min(32).required(),
  WOPI_SERVER_VERSION: Joi.string().default('1.0.0'),
  WOPI_MACHINE_NAME: Joi.string().default('wopi-host'),
  OFFICE_DISCOVERY_URL: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
});
