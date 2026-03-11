const express = require('express');
const router = express.Router();
const authController = require('./auth.controller');
const { authenticate } = require('../../middlewares/auth.middleware');

router.post('/login', authController.validateLogin, authController.login);
router.get('/invite/:token', authController.getInviteDetails);
router.post('/accept-invite', authController.acceptInvite);

// Profile
router.get('/profile', authenticate, authController.getProfile);
router.patch('/profile', authenticate, authController.updateProfile);

module.exports = router;
