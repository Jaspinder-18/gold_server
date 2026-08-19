import express from 'express';
import {
  getAlertHistory,
  getAlertById,
  deleteAlert,
  getAlertStates,
  resetAlertLevel,
  getScreenshotEngineStatus,
  triggerScreenshotCleanup
} from '../controllers/alertController.js';

const router = express.Router();

router.get('/', getAlertHistory);
router.get('/states', getAlertStates);
router.get('/screenshots/status', getScreenshotEngineStatus);
router.post('/screenshots/cleanup', triggerScreenshotCleanup);
router.get('/:id', getAlertById);
router.delete('/:id', deleteAlert);
router.post('/reset/:level', resetAlertLevel);

export default router;
