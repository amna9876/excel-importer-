import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ClientProxy } from '@nestjs/microservices';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from './s3.service';
import { EVENT_PATTERNS, RABBITMQ_SERVICE } from '../messaging/messaging.constants';

const ALLOWED_EXTENSIONS = ['.xlsx', '.xls'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Controller('uploads')
export class UploadController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    @Inject(RABBITMQ_SERVICE) private readonly rabbit: ClientProxy,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('userEmail') userEmail: string,
  ): Promise<{ batchId: string; status: string }> {
    if (!file) {
      throw new BadRequestException('No file uploaded. Attach an Excel file under the "file" field.');
    }
    if (!userEmail || !EMAIL_REGEX.test(userEmail)) {
      throw new BadRequestException('A valid "userEmail" field is required.');
    }

    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw new BadRequestException(`Unsupported file type "${ext}". Upload an .xlsx or .xls file.`);
    }

    // Created before the S3 upload so we have a batch id to key the S3 path on.
    const batch = await this.prisma.uploadBatch.create({
      data: { userEmail, fileKey: '', status: 'PENDING' },
    });

    const fileKey = `imports/${batch.id}/${randomUUID()}${ext}`;
    await this.s3.uploadBuffer(fileKey, file.buffer, file.mimetype);
    await this.prisma.uploadBatch.update({ where: { id: batch.id }, data: { fileKey } });

    // Nothing here parses the file — we just announce that it happened and
    // return immediately. The processing module reacts to this event.
    this.rabbit.emit(EVENT_PATTERNS.FILE_UPLOADED, {
      batchId: batch.id,
      fileKey,
      userEmail,
    });

    return { batchId: batch.id, status: batch.status };
  }

  @Get(':id')
  async getStatus(@Param('id') id: string) {
    const batch = await this.prisma.uploadBatch.findUnique({ where: { id } });
    if (!batch) {
      throw new NotFoundException('Upload batch not found');
    }
    return {
      batchId: batch.id,
      status: batch.status,
      totalRows: batch.totalRows,
      successCount: batch.successCount,
      failCount: batch.failCount,
      errorMessage: batch.errorMessage,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
    };
  }
}
