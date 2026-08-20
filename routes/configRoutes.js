import express from 'express';
import { getConfig, updateConfig, calculatePivots, autoCalculatePivots, getPivotHistory } from '../controllers/configController.js';

const router = express.Router();

router.get('/', getConfig);
router.put('/', updateConfig);
router.post('/calculate', calculatePivots);
router.post('/auto-calculate', autoCalculatePivots);
router.get('/history', getPivotHistory);

export default router;
