import { Router } from 'express';
import multer from 'multer';
import { uploadImportFile, getImportStatus } from '../controllers/import.controller';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

const router = Router();

router.post('/import', upload.single('file'), uploadImportFile);
router.get('/import/:jobId', getImportStatus);

export default router;
