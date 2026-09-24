export interface FileUploadedEvent {
  batchId: string;
  fileKey: string;
  userEmail: string;
}

export interface FileProcessedEvent {
  batchId: string;
  userEmail: string;
  totalRows: number;
  successCount: number;
  failCount: number;
  errorFileKey?: string;
}

export interface RawProductRow {
  rowNumber: number;
  sku: string;
  name: string;
  description: string;
  price: string;
  category: string;
  color: string;
  stock: string;
}

export interface FailedRow {
  rowNumber: number;
  raw: RawProductRow;
  reason: string;
}
