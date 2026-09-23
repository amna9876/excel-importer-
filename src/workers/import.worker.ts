import { Worker, Job } from 'bullmq';
import { connectDB } from '../config/db';
import { createRedisConnection } from '../config/redis';
import { IMPORT_QUEUE_NAME } from '../queues/import.queue';
import { ImportJob } from '../models/ImportJob';
import { Product } from '../models/Product';
import { downloadBuffer, uploadBuffer } from '../services/s3.service';
import {
  parseProductsWorkbook,
  validateRow,
  generateFailedRowsWorkbook,
} from '../services/excel.service';
import { sendImportReportEmail } from '../services/email.service';
import { FailedRow, ImportJobPayload } from '../types';

async function processImportJob(job: Job<ImportJobPayload>): Promise<void> {
  const { jobId, s3Key, userEmail } = job.data;

  const importJob = await ImportJob.findById(jobId);
  if (!importJob) {
    throw new Error(`ImportJob ${jobId} not found`);
  }

  importJob.status = 'processing';
  await importJob.save();

  const fileBuffer = await downloadBuffer(s3Key);
  const rawRows = await parseProductsWorkbook(fileBuffer);

  // Pre-fetch which of the file's SKUs already exist, in one query, instead
  // of hitting the DB per row.
  const skusInFile = rawRows.map((r) => r.sku).filter(Boolean);
  const existingProducts = await Product.find({ sku: { $in: skusInFile } })
    .select('sku')
    .lean();
  const existingSkus = new Set(existingProducts.map((p) => p.sku));

  // Rows are processed sequentially (not bulk-inserted) so we can catch
  // duplicate SKUs *within the same file* as we go, and so one bad row
  // never aborts the rest of the batch.
  const seenInThisFile = new Set<string>();
  const failedRows: FailedRow[] = [];
  let successCount = 0;

  for (const raw of rawRows) {
    const result = validateRow(raw);

    if (!result.valid) {
      failedRows.push({ rowNumber: raw.rowNumber, raw, reason: result.reason });
      continue;
    }

    const { sku } = result.data;

    if (existingSkus.has(sku) || seenInThisFile.has(sku)) {
      failedRows.push({ rowNumber: raw.rowNumber, raw, reason: 'duplicate SKU' });
      continue;
    }

    try {
      await Product.create(result.data);
      seenInThisFile.add(sku);
      successCount += 1;
    } catch {
      // Safety net for a race condition, e.g. the same SKU was imported
      // concurrently by another job between our pre-fetch and this insert.
      failedRows.push({ rowNumber: raw.rowNumber, raw, reason: 'duplicate SKU' });
    }
  }

  const totalRows = rawRows.length;
  const failCount = failedRows.length;

  let failedFileS3Key: string | undefined;
  let failedRowsBuffer: Buffer | undefined;

  if (failCount > 0) {
    failedRowsBuffer = await generateFailedRowsWorkbook(failedRows);
    failedFileS3Key = `failed-rows/${jobId}.xlsx`;
    await uploadBuffer(
      failedFileS3Key,
      failedRowsBuffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  }

  importJob.totalRows = totalRows;
  importJob.successCount = successCount;
  importJob.failCount = failCount;
  importJob.failedFileS3Key = failedFileS3Key;
  importJob.status = 'completed';
  await importJob.save();

  await sendImportReportEmail({
    to: userEmail,
    totalRows,
    successCount,
    failCount,
    failedRowsBuffer,
  });
}

async function main(): Promise<void> {
  await connectDB();

  const worker = new Worker<ImportJobPayload>(
    IMPORT_QUEUE_NAME,
    async (job) => {
      try {
        await processImportJob(job);
      } catch (err) {
        await ImportJob.findByIdAndUpdate(job.data.jobId, {
          status: 'failed',
          errorMessage: err instanceof Error ? err.message : 'Unknown error',
        });
        throw err;
      }
    },
    {
      connection: createRedisConnection(),
      concurrency: 2,
    }
  );

  worker.on('completed', (job) => {
    console.log(`[worker] job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[worker] job ${job?.id} failed:`, err.message);
  });

  console.log('[worker] listening for import jobs...');
}

main().catch((err) => {
  console.error('Failed to start worker', err);
  process.exit(1);
});
