import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { S3Service } from './s3.service';
import { MessagingModule } from '../messaging/messaging.module';

@Module({
  imports: [MessagingModule],
  controllers: [UploadController],
  providers: [S3Service],
  exports: [S3Service],
})
export class UploadModule {}
