import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { MessagingModule } from './messaging/messaging.module';
import { UploadModule } from './upload/upload.module';
import { ProcessingModule } from './processing/processing.module';
import { NotificationModule } from './notification/notification.module';
import { ProductModule } from './product/product.module';
import { validateEnv } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    MessagingModule,
    UploadModule,
    ProcessingModule,
    NotificationModule,
    ProductModule,
  ],
})
export class AppModule {}
