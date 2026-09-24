import { Module } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { MailerService } from './mailer.service';
import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [UploadModule], // for S3Service (re-downloading the error file)
  controllers: [NotificationController],
  providers: [MailerService],
})
export class NotificationModule {}
