import express from 'express';
import { triggerTestAlert, testTelegram, captureLiveScreenshot, triggerCleanup } from '../controllers/testController.js';

const router = express.Router();

router.post('/trigger-alert', triggerTestAlert);
router.post('/capture-screenshot', captureLiveScreenshot);
router.post('/telegram', testTelegram);
router.post('/cleanup', triggerCleanup);

export default router;
