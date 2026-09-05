const express = require('express');
const router = express.Router();
const aiController = require('./ai.controller');

// Optionally require an auth middleware here if you have one
// const { requireAuth } = require('../../middlewares/auth');

/**
 * @route   POST /api/ai/query
 * @desc    Submit a natural language question to the PMS AI Assistant
 * @access  Private
 */
// router.post('/query', requireAuth, aiController.queryAI);
router.post('/query', aiController.queryAI);

module.exports = router;
