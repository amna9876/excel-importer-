import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import path from 'path';
import { ImportJob } from '../models/ImportJob';
import { uploadBuffer } from '../services/s3.service';
import { enqueueImportJob } from '../queues/import.queue';

const ALLOWED_EXTENSIONS = ['.xlsx', '.xls'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function uploadImportFile(req: Request, res: Response): Promise<void> {
  const file = req.file;
  const userEmail = req.body.userEmail as string | undefined;

  if (!file) {
    res.status(400).json({ error: 'No file uploaded. Attach an Excel file under the "file" field.' });
    return;
  }

  if (!userEmail || !EMAIL_REGEX.test(userEmail)) {
    res.status(400).json({ error: 'A valid "userEmail" field is required.' });
    return;
  }

  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    res.status(400).json({ error: `Unsupported file type "${ext}". Upload an .xlsx or .xls file.` });
    return;
  }

  // Create the job first so we have an _id to key the S3 path and the
  // BullMQ job on — nothing here processes the file itself.
  const importJob = await ImportJob.create({
    userEmail,
    s3FileKey: '',
    status: 'queued',
  });

  const jobId = importJob._id.toString();
  const s3Key = `imports/${jobId}/${randomUUID()}${ext}`;

  await uploadBuffer(s3Key, file.buffer, file.mimetype);

  importJob.s3FileKey = s3Key;
  await importJob.save();

  await enqueueImportJob({ jobId, s3Key, userEmail });

  res.status(202).json({ jobId, status: importJob.status });
}

export async function getImportStatus(req: Request, res: Response): Promise<void> {
  const { jobId } = req.params;

  let importJob;
  try {
    importJob = await ImportJob.findById(jobId);
  } catch {
    res.status(400).json({ error: 'Invalid jobId' });
    return;
  }

  if (!importJob) {
    res.status(404).json({ error: 'Import job not found' });
    return;
  }

  res.json({
    jobId: importJob._id.toString(),
    status: importJob.status,
    totalRows: importJob.totalRows,
    successCount: importJob.successCount,
    failCount: importJob.failCount,
    createdAt: importJob.createdAt,
    updatedAt: importJob.updatedAt,
  });
}
