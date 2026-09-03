import express from 'express';
import {
  getAlertHistory,
  getAlertById,
  deleteAlert,
  getAlertStates,
  getCustomPriceAlert,
  setCustomPriceAlert,
  deleteCustomPriceAlert,
  triggerCustomTestAlert,
  resetAlertLevel,
  getScreenshotEngineStatus,
  triggerScreenshotCleanup
} from '../controllers/alertController.js';

const router = express.Router();

router.get('/', getAlertHistory);
router.get('/history', getAlertHistory);
router.get('/states', getAlertStates);

// Custom Price Alert Online CRUD
router.get('/custom', getCustomPriceAlert);
router.post('/custom', setCustomPriceAlert);
router.delete('/custom/:symbol', deleteCustomPriceAlert);
router.delete('/custom', deleteCustomPriceAlert);
router.post('/test', triggerCustomTestAlert);

// Screenshot Engine Diagnostics
router.get('/screenshots/status', getScreenshotEngineStatus);
router.post('/screenshots/cleanup', triggerScreenshotCleanup);

// Item Delete & Reset
router.get('/:id', getAlertById);
router.delete('/:id', deleteAlert);
router.post('/reset', resetAlertLevel);
router.post('/reset/:level', resetAlertLevel);

export default router;
