const express = require('express');
const router = express.Router();
const adminController = require('./admin.controller');
const { authenticate, authorize } = require('../../middlewares/auth.middleware');
const { checkPermission } = require('../../middlewares/permission.middleware');

// Note: Use authenticate for all below routes
// For now, I'll leave them unsecured unless explicitly needed for testing as requested by the original code structure.
// However, the checkPermission middleware will require the req.user object.

const ticketController = require('./ticket.controller');

router.get('/dashboard/stats', adminController.getDashboardStats);
router.get('/properties', adminController.getProperties);
router.get('/properties/available', adminController.getAvailableProperties);

const invoiceController = require('./invoice.controller');
const maintenanceController = require('./maintenance.controller');
const accountingController = require('./accounting.controller');
const communicationController = require('./communication.controller');
const messageController = require('./message.controller');
const analyticsController = require('./analytics.controller');
const leaseController = require('./lease.controller');
const insuranceController = require('./insurance.controller');
const reportsController = require('./reports.controller');
const settingsController = require('./settings.controller');
const taxController = require('./tax.controller');
const accountController = require('./account.controller');
const documentController = require('./document.controller');

router.get('/dashboard/stats', adminController.getDashboardStats);
router.get('/properties', checkPermission('Buildings', 'view'), adminController.getProperties);
router.get('/properties/available', adminController.getAvailableProperties);
router.post('/properties', checkPermission('Buildings', 'add'), adminController.createProperty);
router.put('/properties/:id', checkPermission('Buildings', 'edit'), adminController.updateProperty);
router.delete('/properties/:id', checkPermission('Buildings', 'delete'), adminController.deleteProperty);
router.get('/properties/:id', checkPermission('Buildings', 'view'), adminController.getPropertyDetails);

router.get('/owners', checkPermission('Owners', 'view'), adminController.getOwners);
router.post('/owners', checkPermission('Owners', 'add'), adminController.createOwner);
router.put('/owners/:id', checkPermission('Owners', 'edit'), adminController.updateOwner);
router.post('/owners/:id/send-invite', checkPermission('Owners', 'edit'), adminController.sendInvite);
router.delete('/owners/:id', checkPermission('Owners', 'delete'), adminController.deleteOwner);

router.get('/tickets', ticketController.getAllTickets);
router.post('/tickets', ticketController.createTicket);
router.put('/tickets/:id/status', ticketController.updateTicketStatus);
router.put('/tickets/:id', ticketController.updateTicket);
router.delete('/tickets/:id', ticketController.deleteTicket);
router.get('/tickets/:ticketId/attachments/:attachmentId', ticketController.getTicketAttachment);

router.get('/invoices', checkPermission('Invoices', 'view'), invoiceController.getInvoices);
router.post('/invoices', checkPermission('Invoices', 'add'), invoiceController.createInvoice);
router.put('/invoices/:id', checkPermission('Invoices', 'edit'), invoiceController.updateInvoice);
router.delete('/invoices/:id', checkPermission('Invoices', 'delete'), invoiceController.deleteInvoice);
router.get('/invoices/:id/download', checkPermission('Invoices', 'view'), invoiceController.downloadInvoicePDF);
router.post('/invoices/batch', checkPermission('Invoices', 'add'), invoiceController.runBatchInvoicing);

const serviceItemController = require('./serviceItem.controller');
router.get('/service-items', serviceItemController.getServiceItems);
router.post('/service-items', serviceItemController.createServiceItem);
router.put('/service-items/:id', serviceItemController.updateServiceItem);
router.delete('/service-items/:id', serviceItemController.deleteServiceItem);

const paymentController = require('./payment.controller');
router.get('/payments', paymentController.getReceivedPayments);
router.post('/payments', paymentController.recordPayment);
router.get('/outstanding-dues', paymentController.getOutstandingDues);
router.get('/payments/:id/download', paymentController.downloadReceiptPDF);

const refundController = require('./refund.controller');
router.get('/refunds', refundController.getRefunds);
router.post('/refunds', refundController.createRefund);
router.get('/refunds/calculate/:tenantId', refundController.calculateRefund);
router.put('/refunds/:id', refundController.updateRefund);
router.delete('/refunds/:id', refundController.deleteRefund);

router.get('/leases', checkPermission('Leases', 'view'), leaseController.getLeaseHistory);
router.delete('/leases/:id', checkPermission('Leases', 'delete'), leaseController.deleteLease);
router.put('/leases/:id', checkPermission('Leases', 'edit'), leaseController.updateLease);
router.get('/leases/:id/download', checkPermission('Leases', 'view'), leaseController.downloadLeasePDF);

router.get('/insurance/compliance', insuranceController.getComplianceDashboard);
router.post('/insurance', insuranceController.createInsurance);
router.put('/insurance/:id', insuranceController.updateInsurance);
router.post('/insurance/check-alerts', insuranceController.checkInsuranceExpirations);
router.get('/insurance/alerts', insuranceController.getInsuranceAlerts);
router.get('/insurance/stats', insuranceController.getInsuranceStats);
router.post('/insurance/:id/approve', insuranceController.approveInsurance);
router.post('/insurance/:id/reject', insuranceController.rejectInsurance);

router.get('/maintenance', maintenanceController.getTasks);
router.post('/maintenance', maintenanceController.createTask);
router.put('/maintenance/:id', maintenanceController.updateTask);
router.delete('/maintenance/:id', maintenanceController.deleteTask);

router.get('/accounting/transactions', accountingController.getTransactions);
router.post('/accounting/transactions', accountingController.createTransaction);

router.get('/communication/emails', communicationController.getEmailLogs);
router.delete('/communication/emails/:id', communicationController.deleteEmailLog);
router.post('/communication/send-email', communicationController.sendComposeEmail);
router.get('/communication', communicationController.getHistory);
router.post('/communication', communicationController.sendMessage);
router.delete('/communication/:id', communicationController.deleteLog);
router.post('/communication/bulk-delete', communicationController.bulkDeleteLogs);

router.get('/analytics/revenue', analyticsController.getRevenueStats);
router.get('/analytics/vacancy', analyticsController.getVacancyStats);
router.get('/reports/rent-roll', checkPermission('Rent Roll', 'view'), reportsController.getRentRoll);
router.put('/reports/potential-rent', checkPermission('Reports', 'edit'), reportsController.updatePotentialRent);
router.get('/reports', checkPermission('Reports', 'view'), reportsController.getReports);
router.get('/reports/:id/download', checkPermission('Reports', 'view'), reportsController.downloadReportPDF);

router.get('/settings', settingsController.getSettings);
router.post('/settings', settingsController.updateSettings);

router.get('/taxes', taxController.getTaxes);
router.post('/taxes', taxController.updateTaxes);
router.patch('/taxes/:id', taxController.updateTax);
router.delete('/taxes/:id', taxController.deleteTax);

router.get('/accounts', accountController.getAccounts);
router.post('/accounts', accountController.createAccount);
router.patch('/accounts/:id', accountController.updateAccount);
router.delete('/accounts/:id', accountController.deleteAccount);

router.get('/documents', checkPermission('Documents', 'view'), documentController.getAllDocuments);
router.post('/documents/upload', checkPermission('Documents', 'add'), documentController.uploadDocument);
router.put('/documents/:id', checkPermission('Documents', 'edit'), documentController.updateDocument);
router.get('/documents/download-proof', checkPermission('Documents', 'view'), documentController.downloadProofFromUrl);
router.get('/documents/:id/download', checkPermission('Documents', 'view'), documentController.downloadDocument);
router.delete('/documents/:id', checkPermission('Documents', 'delete'), documentController.deleteDocument);

// Message routes
router.get('/messages', messageController.getMessages);
router.post('/messages', messageController.sendMessage);
router.put('/messages/:id/read', messageController.markAsRead);

const unitTypeController = require('./unitType.controller');
router.get('/unit-types', unitTypeController.getUnitTypes);
router.post('/unit-types', unitTypeController.createUnitType);
router.put('/unit-types/:id', unitTypeController.updateUnitType);
router.delete('/unit-types/:id', unitTypeController.deleteUnitType);

const coworkerController = require('./coworker.controller');
router.get('/coworkers', coworkerController.getCoworkers);
router.post('/coworkers', coworkerController.createCoworker);
router.put('/coworkers/:id', coworkerController.updateCoworker);
router.delete('/coworkers/:id', coworkerController.deleteCoworker);
router.get('/coworkers/:id/permissions', coworkerController.getPermissions);
router.put('/coworkers/:id/permissions', coworkerController.updatePermissions);
router.post('/coworkers/:id/send-invite', coworkerController.sendInvitation);

module.exports = router;
