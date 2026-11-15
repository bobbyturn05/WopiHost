import Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  PORT: Joi.number().port().default(3100),
  PUBLIC_WOPI_ORIGIN: Joi.string().uri().required(),

  MONGODB_URI: Joi.string().required(),

  INTERNAL_SERVICE_TOKEN: Joi.string().min(32).required(),

  MAIN_BACKEND_URL: Joi.string().uri().required(),
  MAIN_BACKEND_SERVICE_TOKEN: Joi.string().min(32).required(),
  MAIN_BACKEND_TIMEOUT_MS: Joi.number().integer().positive().default(10000),

  MINIO_ENDPOINT: Joi.string().required(),
  MINIO_PORT: Joi.number().port().default(9000),
  MINIO_USE_SSL: Joi.boolean().default(false),
  MINIO_ACCESS_KEY: Joi.string().required(),
  MINIO_SECRET_KEY: Joi.string().required(),
  MINIO_PUBLIC_ENDPOINT: Joi.string().uri().required(),
  MINIO_REGION: Joi.string().default('us-east-1'),

  LAUNCH_TOKEN_TTL_SECONDS: Joi.number().integer().positive().default(120),
  WOPI_ACCESS_TOKEN_TTL_SECONDS: Joi.number().integer().positive().default(3600),
  MAX_LAUNCH_TOKEN_TTL_SECONDS: Joi.number().integer().positive().default(300),

  MAX_FILE_SIZE_BYTES: Joi.number().integer().positive().default(104857600),
  WOPI_LOCK_TTL_SECONDS: Joi.number().integer().positive().default(1800),

  OFFICE_DISCOVERY_URL: Joi.string().uri().required(),
  OFFICE_PUBLIC_ORIGIN: Joi.string().uri().required()
});