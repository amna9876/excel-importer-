export const RABBITMQ_SERVICE = 'RABBITMQ_SERVICE';

export const EVENT_PATTERNS = {
  FILE_UPLOADED: 'product.file.uploaded',
  FILE_PROCESSED: 'product.file.processed',
} as const;

export const PROCESSING_QUEUE = 'product-processing';
