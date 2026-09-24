import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { ProcessingProcessor } from './processing.processor';
import { ExcelService } from './excel.service';
import { FileUploadedController } from './file-uploaded.controller';
import { UploadModule } from '../upload/upload.module';
import { MessagingModule } from '../messaging/messaging.module';
import { PROCESSING_QUEUE } from '../messaging/messaging.constants';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // Handles rediss:// (TLS) URLs like the ones Upstash issues.
        connection: new IORedis(config.getOrThrow<string>('REDIS_URL'), {
          maxRetriesPerRequest: null,
        }),
      }),
    }),
    BullModule.registerQueue({ name: PROCESSING_QUEUE }),
    UploadModule, // for S3Service
    MessagingModule, // for the RabbitMQ ClientProxy (emit FILE_PROCESSED)
  ],
  controllers: [FileUploadedController],
  providers: [ProcessingProcessor, ExcelService],
})
export class ProcessingModule {}
