import nodemailer from 'nodemailer';
import { env } from '../config/env';

const transporter = nodemailer.createTransport({
  host: env.smtp.host,
  port: env.smtp.port,
  secure: env.smtp.port === 465,
  auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
});

interface ImportReportEmailParams {
  to: string;
  totalRows: number;
  successCount: number;
  failCount: number;
  failedRowsBuffer?: Buffer;
}

const REQUIRED_COLUMNS_NOTE = [
  'Required columns for future uploads (first row = headers):',
  '  sku, name, price, inventory, description, category, colors (optional)',
  '',
  '- sku, name, description, category: text, required',
  '- price, inventory: numbers greater than 0, required',
  '- sku must be unique across all products',
  '- colors: optional, comma-separated (e.g. "Red, Blue")',
].join('\n');

export async function sendImportReportEmail(params: ImportReportEmailParams): Promise<void> {
  const { to, totalRows, successCount, failCount, failedRowsBuffer } = params;

  const bodyLines = [
    `${successCount} of ${totalRows} products imported successfully. ${failCount} failed.`,
    '',
    failCount > 0
      ? 'See the attached spreadsheet for the rows that failed and why.'
      : 'All rows were imported without errors.',
    '',
    REQUIRED_COLUMNS_NOTE,
  ];

  await transporter.sendMail({
    from: env.smtp.from,
    to,
    subject: 'Import summary',
    text: bodyLines.join('\n'),
    attachments:
      failCount > 0 && failedRowsBuffer
        ? [
            {
              filename: 'failed-rows.xlsx',
              content: failedRowsBuffer,
              contentType:
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            },
          ]
        : [],
  });
}
