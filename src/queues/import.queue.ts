import { Queue } from 'bullmq';
import { createRedisConnection } from '../config/redis';
import { ImportJobPayload } from '../types';

export const IMPORT_QUEUE_NAME = 'product-import';

export const importQueue = new Queue<ImportJobPayload>(IMPORT_QUEUE_NAME, {
  connection: createRedisConnection(),
});

export async function enqueueImportJob(payload: ImportJobPayload): Promise<void> {
  await importQueue.add('process-import', payload, {
    // Reusing our own Mongo _id as the BullMQ job id means a duplicate
    // enqueue for the same ImportJob is a no-op instead of a second job.
    jobId: payload.jobId,
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
  });
}
