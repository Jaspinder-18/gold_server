import express from 'express';
import { getConfig, updateConfig, calculatePivots, getPivotHistory } from '../controllers/configController.js';

const router = express.Router();

router.get('/', getConfig);
router.put('/', updateConfig);
router.post('/calculate', calculatePivots);
router.get('/history', getPivotHistory);

export default router;
