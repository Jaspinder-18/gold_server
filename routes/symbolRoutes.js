import express from 'express';
import { symbolController } from '../controllers/symbolController.js';

const router = express.Router();

router.get('/', symbolController.getAllSymbols);
router.get('/search', symbolController.searchSymbols);
router.get('/active', symbolController.getActiveSymbol);
router.post('/active', symbolController.setActiveSymbol);
router.get('/validate/:symbol?', symbolController.validateSymbolPivot);

export default router;
