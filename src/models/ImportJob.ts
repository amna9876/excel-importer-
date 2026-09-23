import { Schema, model, Document } from 'mongoose';

export type ImportJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface IImportJob extends Document {
  userEmail: string;
  s3FileKey: string;
  status: ImportJobStatus;
  totalRows: number;
  successCount: number;
  failCount: number;
  failedFileS3Key?: string;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

const importJobSchema = new Schema<IImportJob>(
  {
    userEmail: { type: String, required: true, trim: true },
    s3FileKey: { type: String, required: true },
    status: {
      type: String,
      enum: ['queued', 'processing', 'completed', 'failed'],
      default: 'queued',
    },
    totalRows: { type: Number, default: 0 },
    successCount: { type: Number, default: 0 },
    failCount: { type: Number, default: 0 },
    failedFileS3Key: { type: String },
    errorMessage: { type: String },
  },
  { timestamps: true }
);

export const ImportJob = model<IImportJob>('ImportJob', importJobSchema);
