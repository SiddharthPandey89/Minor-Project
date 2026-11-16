import { Router } from 'express';
import { generateReportController, chatController } from '../controllers/ai.controller.js';

const router = Router();

router.post('/report', generateReportController);
router.post('/chat', chatController);

export default router;
