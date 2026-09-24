import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';
import { S3Service } from '../upload/s3.service';
import { FileProcessedEvent } from '../processing/processing.types';

const REQUIRED_COLUMNS_NOTE = [
  'Required columns for future uploads (first row = headers):',
  '  sku, name, description, price, category, color, stock',
  '  ("color" also accepts "colors"; "stock" also accepts "inventory")',
  '',
  '- sku, name, description, category, color: text, required',
  '- sku must be unique across all products',
  '- price: number, required, greater than 0',
  '- stock: whole number, required, 0 or greater',
].join('\n');

@Injectable()
export class MailerService {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(
    private readonly config: ConfigService,
    private readonly s3: S3Service,
  ) {
    this.from = this.config.get<string>('EMAIL_FROM', 'Product Imports <no-reply@example.com>');
    const port = this.config.get<number>('SMTP_PORT', 587);

    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST'),
      port,
      secure: port === 465,
      auth: this.config.get<string>('SMTP_USER')
        ? {
            user: this.config.get<string>('SMTP_USER'),
            pass: this.config.get<string>('SMTP_PASS'),
          }
        : undefined,
    });
  }

  async sendImportReport(event: FileProcessedEvent): Promise<void> {
    const { userEmail, totalRows, successCount, failCount, errorFileKey } = event;

    // The RabbitMQ event only carries the S3 key, not the file itself
    // (message buses are for small payloads) — so re-download here.
    const attachmentBuffer = errorFileKey ? await this.s3.downloadBuffer(errorFileKey) : undefined;

    const bodyLines = [
      `${successCount} of ${totalRows} products imported successfully. ${failCount} failed.`,
      '',
      failCount > 0
        ? 'See the attached spreadsheet for the rows that failed and why.'
        : 'All rows were imported without errors.',
      '',
      REQUIRED_COLUMNS_NOTE,
    ];

    await this.transporter.sendMail({
      from: this.from,
      to: userEmail,
      subject: 'Import summary',
      text: bodyLines.join('\n'),
      attachments: attachmentBuffer
        ? [
            {
              filename: 'failed-rows.xlsx',
              content: attachmentBuffer,
              contentType:
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            },
          ]
        : [],
    });
  }
}
