const express = require('express');
const router = express.Router();
const tenantController = require('./tenant.controller');

const { checkPermission } = require('../../middlewares/permission.middleware');

router.get('/', checkPermission('Tenants', 'view'), tenantController.getAllTenants);
router.get('/:id', checkPermission('Tenants', 'view'), tenantController.getTenantById);
router.get('/:id/tickets', checkPermission('Tenants', 'view'), tenantController.getTenantTickets);
router.post('/', checkPermission('Tenants', 'add'), tenantController.createTenant);
router.put('/:id', checkPermission('Tenants', 'edit'), tenantController.updateTenant);
router.post('/:id/send-invite', checkPermission('Tenants', 'edit'), tenantController.sendInvite);
router.delete('/:id', checkPermission('Tenants', 'delete'), tenantController.deleteTenant);

module.exports = router;
