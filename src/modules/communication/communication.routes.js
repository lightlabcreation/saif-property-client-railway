const express = require('express');

const router = express.Router();
const communicationController = require('./communication.controller');
const twilioWebhookController = require('./twilio.webhook.controller');
const smsController = require('./sms.controller');
const { authenticate } = require('../../middlewares/auth.middleware'); // Corrected path

// Authenticated routes
router.use(authenticate);

// Standard Communication
router.post('/send', communicationController.sendMessage);
router.get('/history/:userId', communicationController.getHistory);
router.get('/conversations', communicationController.getConversations);
router.post('/mark-read', communicationController.markAsRead);

// SMS Enhancement Module
router.get('/templates', smsController.getTemplates);
router.post('/templates', smsController.createTemplate);
router.put('/templates/:id', smsController.updateTemplate);
router.delete('/templates/:id', smsController.deleteTemplate);
router.post('/campaign', smsController.createCampaign);
router.get('/campaigns', smsController.getCampaigns);
router.get('/unread-stats', smsController.getUnreadStats);

module.exports = router;
