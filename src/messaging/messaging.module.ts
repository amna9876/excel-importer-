import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RABBITMQ_SERVICE } from './messaging.constants';

// Registers the RabbitMQ *producer* client. Any module that imports this can
// inject RABBITMQ_SERVICE (a ClientProxy) to emit events onto the bus.
// The *consumer* side (the @EventPattern handlers) is wired separately in
// main.ts via app.connectMicroservice() — that's what actually listens.
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: RABBITMQ_SERVICE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [config.getOrThrow<string>('RABBITMQ_URL')],
            queue: config.get<string>('RABBITMQ_QUEUE', 'product_events_queue'),
            queueOptions: { durable: true },
          },
        }),
      },
    ]),
  ],
  exports: [ClientsModule],
})
export class MessagingModule {}
