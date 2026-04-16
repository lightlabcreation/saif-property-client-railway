const express = require('express');
const router = express.Router();
const shuttleController = require('./shuttle.controller');
const { checkPermission } = require('../../middlewares/permission.middleware');

// We use 'Shuttle' as the permission module name 

// 1. Daily Schedule (Trips)
router.get('/trips', checkPermission('Shuttle', 'view'), shuttleController.getTrips);
router.post('/trips', checkPermission('Shuttle', 'add'), shuttleController.createTrip);
router.put('/trips/:id', checkPermission('Shuttle', 'edit'), shuttleController.updateTrip);
router.delete('/trips/:id', checkPermission('Shuttle', 'delete'), shuttleController.deleteTrip);
router.post('/trips/duplicate', checkPermission('Shuttle', 'add'), shuttleController.duplicateDay);

// 2. Ride Requests (Inbox)
router.get('/requests', checkPermission('Shuttle', 'view'), shuttleController.getRequests);
router.post('/requests', checkPermission('Shuttle', 'add'), shuttleController.createRequest);
router.put('/requests/:id/status', checkPermission('Shuttle', 'edit'), shuttleController.updateRequestStatus);
router.post('/requests/:id/:action', checkPermission('Shuttle', 'edit'), shuttleController.updateRequestStatus); 

// 3. App Access / Drivers (Users)
router.get('/users', checkPermission('Shuttle', 'view'), shuttleController.getUsers);

module.exports = router;
