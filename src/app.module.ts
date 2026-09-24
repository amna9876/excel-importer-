import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
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
    // Serves public/index.html (the demo UI) at "/" without shadowing the
    // /uploads and /products API routes, which express.static falls through to.
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      exclude: ['/uploads*', '/products*'],
    }),
    PrismaModule,
    MessagingModule,
    UploadModule,
    ProcessingModule,
    NotificationModule,
    ProductModule,
  ],
})
export class AppModule {}
