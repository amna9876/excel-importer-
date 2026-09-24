import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Readable } from 'stream';

@Injectable()
export class S3Service {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    const accessKeyId = this.config.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('AWS_SECRET_ACCESS_KEY');
    const endpoint = this.config.get<string>('S3_ENDPOINT');

    this.bucket = this.config.getOrThrow<string>('S3_BUCKET_NAME');

    this.client = new S3Client({
      region: this.config.getOrThrow<string>('AWS_REGION'),
      ...(accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey } }
        : {}),
      // Only set for S3-compatible providers (e.g. Backblaze B2); leave
      // unset for real AWS.
      ...(endpoint
        ? {
            endpoint,
            forcePathStyle: this.config.get<string>('S3_FORCE_PATH_STYLE', 'false') === 'true',
          }
        : {}),
    });
  }

  async uploadBuffer(key: string, buffer: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );
  }

  async downloadBuffer(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );

    const stream = response.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}
