const express = require('express');
const router = express.Router();
const emailController = require('./email.controller');
const { authenticate } = require('../../middlewares/auth.middleware');
const { checkPermission } = require('../../middlewares/permission.middleware');

// Apply auth to all email routes
router.use(authenticate);

// Templates
router.get('/templates', emailController.getTemplates);
router.post('/templates', emailController.createTemplate);
router.put('/templates/:id', emailController.updateTemplate);
router.delete('/templates/:id', emailController.deleteTemplate);

// Sending
router.post('/send-bulk', emailController.sendBulkEmails);

// History
router.get('/history', emailController.getHistory);
router.get('/history/:id', emailController.getLogDetails);
router.post('/history/:id/resend', emailController.resendEmail);

// Signature
router.get('/signature', emailController.getSignature);
router.post('/signature', emailController.updateSignature);

module.exports = router;
