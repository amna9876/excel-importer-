import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { MailerService } from './mailer.service';
import { EVENT_PATTERNS } from '../messaging/messaging.constants';
import { FileProcessedEvent } from '../processing/processing.types';

@Controller()
export class NotificationController {
  private readonly logger = new Logger(NotificationController.name);

  constructor(private readonly mailer: MailerService) {}

  @EventPattern(EVENT_PATTERNS.FILE_PROCESSED)
  async handleFileProcessed(
    @Payload() payload: FileProcessedEvent,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    try {
      await this.mailer.sendImportReport(payload);
    } catch (err) {
      // Acked either way in this learning setup, so a broken SMTP config
      // can't wedge the queue with infinite redelivery. A production system
      // would more likely nack + route to a dead-letter queue here.
      this.logger.error(`Failed to send report for batch ${payload.batchId}: ${(err as Error).message}`);
    } finally {
      channel.ack(originalMsg);
    }
  }
}
