const express = require('express');
const router = express.Router();
const workflowController = require('./workflow.controller');
const inspectionController = require('./inspection.controller');
const { authorize } = require('../../middlewares/auth.middleware');

// Move-In / Move-Out Dashboard Routes
router.get('/move-out', workflowController.getMoveOutDashboard);
router.get('/move-in', workflowController.getMoveInDashboard);
router.post('/move-out/:id/approve', authorize('ADMIN', 'OWNER'), workflowController.approveMoveOut);
router.put('/move-out/:id/confirm', authorize('ADMIN', 'OWNER'), workflowController.confirmMoveOut);
router.put('/move-out/:id/complete', authorize('ADMIN', 'OWNER'), workflowController.completeMoveOut);
router.post('/move-in/:id/override', authorize('ADMIN', 'OWNER'), workflowController.overrideMoveIn);
router.post('/move-in/:id/approve', authorize('ADMIN', 'OWNER'), workflowController.approveMoveIn);
router.get('/unit-prep', authorize('ADMIN', 'OWNER'), workflowController.getUnitPrepDashboard);
router.put('/unit-prep/:unitId/stage', authorize('ADMIN', 'OWNER'), workflowController.updateUnitPrepStage);
router.post('/move-out/trigger/:leaseId', workflowController.triggerMoveOut);
router.put('/move-out/cancel/:leaseId', authorize('ADMIN', 'OWNER'), workflowController.cancelMoveOut);

// Inspection Routes
router.post('/templates', authorize('ADMIN'), inspectionController.createTemplate);
router.get('/templates', inspectionController.getTemplates);
router.post('/inspections', inspectionController.createInspection);
router.get('/inspections', inspectionController.getAllInspections);
router.get('/inspections/:id', inspectionController.getInspectionDetails);
router.get('/inspections/:id/download', inspectionController.downloadInspectionPDF);
router.post('/inspections/:id/submit', inspectionController.submitInspection);
router.post('/inspections/:id/tickets', inspectionController.createTicket);
router.put('/inspections/:id', inspectionController.updateInspection);

// Unit History
router.get('/units/:unitId/history', workflowController.getUnitHistory);

module.exports = router;
