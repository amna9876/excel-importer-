import { S3Client } from '@aws-sdk/client-s3';
import { env } from './env';

export const s3Client = new S3Client({
  region: env.s3.region,
  ...(env.s3.accessKeyId && env.s3.secretAccessKey
    ? {
        credentials: {
          accessKeyId: env.s3.accessKeyId,
          secretAccessKey: env.s3.secretAccessKey,
        },
      }
    : {}),
  // endpoint + forcePathStyle are only needed for LocalStack / MinIO-style testing.
  ...(env.s3.endpoint
    ? { endpoint: env.s3.endpoint, forcePathStyle: env.s3.forcePathStyle }
    : {}),
});
