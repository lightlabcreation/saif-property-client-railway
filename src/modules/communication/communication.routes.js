const express = require('express');

const router = express.Router();
const communicationController = require('./communication.controller');
const smsController = require('./sms.controller');
const { authenticate } = require('../../middlewares/auth.middleware');
const { checkPermission, checkAnyPermission } = require('../../middlewares/permission.middleware');

// Authenticated routes
router.use(authenticate);

// Standard Communication
router.post('/send', checkPermission('Inbox', 'add'), communicationController.sendMessage);
router.get('/history/:userId', checkPermission('Inbox', 'view'), communicationController.getHistory);
router.get('/conversations', checkPermission('Inbox', 'view'), communicationController.getConversations);
router.post('/mark-read', checkPermission('Inbox', 'edit'), communicationController.markAsRead);

// SMS Enhancement Module
router.get('/templates', checkAnyPermission(['Templates', 'Inbox', 'Campaign Manager'], 'view'), smsController.getTemplates);
router.post('/templates', checkPermission('Templates', 'add'), smsController.createTemplate);
router.put('/templates/:id', checkPermission('Templates', 'edit'), smsController.updateTemplate);
router.delete('/templates/:id', checkPermission('Templates', 'delete'), smsController.deleteTemplate);
router.post('/campaign', checkPermission('Campaign Manager', 'add'), smsController.createCampaign);
router.get('/campaigns', checkPermission('Campaign Manager', 'view'), smsController.getCampaigns);
router.get('/unread-stats', checkPermission('Inbox', 'view'), smsController.getUnreadStats);

module.exports = router;
