const express = require('express');
const router = express.Router();
const workflowController = require('./workflow.controller');
const inspectionController = require('./inspection.controller');
const { authorize } = require('../../middlewares/auth.middleware');

// Move-In / Move-Out Dashboard Routes
router.get('/move-out', workflowController.getMoveOutDashboard);
router.get('/move-in', workflowController.getMoveInDashboard);
router.post('/move-out/:id/approve', authorize('ADMIN', 'OWNER'), workflowController.approveMoveOut);
router.post('/move-in/:id/override', authorize('ADMIN', 'OWNER'), workflowController.overrideMoveIn);

// Inspection Routes
router.post('/templates', authorize('ADMIN'), inspectionController.createTemplate);
router.get('/templates', inspectionController.getTemplates);
router.post('/inspections', inspectionController.createInspection);
router.get('/inspections/:id', inspectionController.getInspectionDetails);
router.post('/inspections/:id/submit', inspectionController.submitInspection);
router.post('/inspections/:id/tickets', inspectionController.createTicket);

// Unit History
router.get('/units/:unitId/history', workflowController.getUnitHistory);

module.exports = router;
