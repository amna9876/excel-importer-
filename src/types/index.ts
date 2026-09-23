export interface ImportJobPayload {
  jobId: string;
  s3Key: string;
  userEmail: string;
}

export interface ParsedRawRow {
  rowNumber: number;
  sku: string;
  name: string;
  price: string;
  inventory: string;
  description: string;
  category: string;
  colors: string;
}

export interface ValidProductRow {
  sku: string;
  name: string;
  price: number;
  inventory: number;
  description: string;
  category: string;
  colors: string[];
}

export interface FailedRow {
  rowNumber: number;
  raw: ParsedRawRow;
  reason: string;
}
