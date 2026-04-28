/**
 * PURPOSE: Serve Claude Code metadata used by the chat frontend.
 */
import express from 'express';

import { getClaudeModelCatalog } from '../claude-models.js';

const router = express.Router();

router.get('/models', async (_req, res) => {
  try {
    const catalog = await getClaudeModelCatalog();
    res.json({ success: true, ...catalog });
  } catch (error) {
    console.error('Error reading Claude model catalog:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
