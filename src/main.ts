import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const logger = new Logger('bootstrap');

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Hybrid app: HTTP for the upload/status/product endpoints, plus a
  // RabbitMQ microservice connection so the @EventPattern handlers
  // (FileUploadedController, NotificationController) can receive events.
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [config.getOrThrow<string>('RABBITMQ_URL')],
      queue: config.get<string>('RABBITMQ_QUEUE', 'product_events_queue'),
      queueOptions: { durable: true },
      noAck: false, // handlers ack manually after finishing their work
    },
  });

  await app.startAllMicroservices();

  const port = config.get<number>('PORT', 4000);
  await app.listen(port);

  logger.log(`HTTP listening on port ${port}`);
  logger.log('RabbitMQ microservice connected');
}

bootstrap();
