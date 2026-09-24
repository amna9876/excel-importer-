import { Controller } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EVENT_PATTERNS, PROCESSING_QUEUE } from '../messaging/messaging.constants';
import { FileUploadedEvent } from './processing.types';

// This is the "RabbitMQ event layer" from the plan: it does no processing
// itself, it just reacts to the FILE_UPLOADED event by enqueueing a BullMQ
// job. Keeping this separate from the worker (file-uploaded.controller.ts
// vs processing.processor.ts) is the whole point of using both — RabbitMQ
// routes the event, BullMQ does the actual (retryable, concurrent) work.
@Controller()
export class FileUploadedController {
  constructor(@InjectQueue(PROCESSING_QUEUE) private readonly queue: Queue) {}

  @EventPattern(EVENT_PATTERNS.FILE_UPLOADED)
  async handleFileUploaded(
    @Payload() payload: FileUploadedEvent,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    await this.queue.add('process-import', payload, {
      jobId: payload.batchId,
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    });

    channel.ack(originalMsg);
  }
}
