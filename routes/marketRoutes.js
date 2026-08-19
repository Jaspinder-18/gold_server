import express from 'express';
import { getLiveTicker, getKlines, getSystemHealth } from '../controllers/marketController.js';

const router = express.Router();

router.get('/ticker', getLiveTicker);
router.get('/klines', getKlines);
router.get('/health', getSystemHealth);

export default router;
