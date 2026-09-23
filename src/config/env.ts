import dotenv from 'dotenv';

dotenv.config();

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optional(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

export const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  port: Number(optional('PORT', '4000')),

  mongoUri: required('MONGO_URI'),

  redis: {
    // A full connection string (e.g. Upstash's "rediss://..." URL) takes
    // priority when set; host/port/password are only used as a fallback.
    url: optional('REDIS_URL') || undefined,
    host: optional('REDIS_HOST', 'localhost'),
    port: Number(optional('REDIS_PORT', '6379')),
    password: optional('REDIS_PASSWORD') || undefined,
  },

  s3: {
    region: required('AWS_REGION'),
    bucket: required('S3_BUCKET_NAME'),
    accessKeyId: optional('AWS_ACCESS_KEY_ID') || undefined,
    secretAccessKey: optional('AWS_SECRET_ACCESS_KEY') || undefined,
    // Only set for LocalStack / S3-compatible endpoints; leave undefined for real AWS.
    endpoint: optional('S3_ENDPOINT') || undefined,
    forcePathStyle: optional('S3_FORCE_PATH_STYLE', 'false') === 'true',
  },

  smtp: {
    host: optional('SMTP_HOST'),
    port: Number(optional('SMTP_PORT', '587')),
    user: optional('SMTP_USER'),
    pass: optional('SMTP_PASS'),
    from: optional('EMAIL_FROM', 'Product Imports <no-reply@example.com>'),
  },
};
