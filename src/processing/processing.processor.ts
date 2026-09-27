import { Inject, Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ClientProxy } from '@nestjs/microservices';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../upload/s3.service';
import { ExcelService } from './excel.service';
import { EVENT_PATTERNS, PROCESSING_QUEUE, RABBITMQ_SERVICE } from '../messaging/messaging.constants';
import { FailedRow, FileUploadedEvent } from './processing.types';
import { ProductRowDto } from './dto/product-row.dto';

const CHUNK_SIZE = 500;

@Processor(PROCESSING_QUEUE)
export class ProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(ProcessingProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly excel: ExcelService,
    @Inject(RABBITMQ_SERVICE) private readonly rabbit: ClientProxy,
  ) {
    super();
  }

  async process(job: Job<FileUploadedEvent>): Promise<void> {
    const { batchId, fileKey, userEmail } = job.data;

    await this.prisma.uploadBatch.update({
      where: { id: batchId },
      data: { status: 'PROCESSING' },
    });

    const fileBuffer = await this.s3.downloadBuffer(fileKey);
    const rawRows = await this.excel.parseRows(fileBuffer);

    // Pre-fetch which of the file's SKUs already exist among *active*
    // products, in one query, instead of hitting the DB per row. A
    // soft-deleted product's SKU is free to reuse.
    const skusInFile = rawRows.map((r) => r.sku).filter(Boolean);
    const existing = await this.prisma.product.findMany({
      where: { sku: { in: skusInFile }, deletedAt: null },
      select: { sku: true },
    });
    const existingSkus = new Set(existing.map((p) => p.sku));
    const seenInThisFile = new Set<string>();

    const failedRows: FailedRow[] = [];
    const toInsert: ProductRowDto[] = [];

    for (const raw of rawRows) {
      const result = await this.excel.validateRow(raw);

      if (!result.valid) {
        failedRows.push({ rowNumber: raw.rowNumber, raw, reason: result.reason });
        continue;
      }

      const { sku } = result.data;
      if (existingSkus.has(sku) || seenInThisFile.has(sku)) {
        failedRows.push({ rowNumber: raw.rowNumber, raw, reason: 'duplicate sku' });
        continue;
      }

      seenInThisFile.add(sku);
      toInsert.push(result.data);
    }

    // Chunked batch insert instead of one INSERT per row — every DELETE and
    // INSERT has a real cost (index maintenance, WAL writes); batching
    // amortizes that instead of paying a round trip per row.
    let successCount = 0;
    for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
      const chunk = toInsert.slice(i, i + CHUNK_SIZE);
      const result = await this.prisma.product.createMany({
        data: chunk,
        skipDuplicates: true, // safety net for a same-SKU race with another import
      });
      successCount += result.count;
    }

    const totalRows = rawRows.length;
    // Anything skipDuplicates silently dropped (a rare race, since we
    // already de-duped in-memory above) counts as failed even though it
    // won't have its own row in the exported error file.
    const failCount = totalRows - successCount;

    let errorFileKey: string | undefined;
    if (failCount > 0) {
      const errorBuffer = await this.excel.generateErrorWorkbook(failedRows);
      errorFileKey = `failed-rows/${batchId}.xlsx`;
      await this.s3.uploadBuffer(
        errorFileKey,
        errorBuffer,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
    }

    let successFileKey: string | undefined;
    if (successCount > 0) {
      const successBuffer = await this.excel.generateSuccessWorkbook(toInsert);
      successFileKey = `imported-rows/${batchId}.xlsx`;
      await this.s3.uploadBuffer(
        successFileKey,
        successBuffer,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
    }

    await this.prisma.uploadBatch.update({
      where: { id: batchId },
      data: {
        status: 'COMPLETED',
        totalRows,
        successCount,
        failCount,
        errorFileKey,
      },
    });

    this.rabbit.emit(EVENT_PATTERNS.FILE_PROCESSED, {
      batchId,
      userEmail,
      totalRows,
      successCount,
      failCount,
      errorFileKey,
      successFileKey,
    });
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<FileUploadedEvent>, err: Error): Promise<void> {
    this.logger.error(`Job ${job.id} failed: ${err.message}`);
    const batchId = job.data?.batchId;
    if (!batchId) return;

    await this.prisma.uploadBatch
      .update({
        where: { id: batchId },
        data: { status: 'FAILED', errorMessage: err.message },
      })
      .catch(() => undefined);
  }
}
