const express = require('express');
const router = express.Router();
const emailService = require('../services/emailService');
const { validate } = require('../utils/validator');

// Test SMTP connection
router.get('/verify', async (req, res) => {
    try {
        const result = await emailService.verifyConnection();
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Send test email
router.post('/send', async (req, res) => {
    try {
        const { to } = req.body;

        // Validate email
        if (!to) {
            return res.status(400).json({
                success: false,
                message: 'Recipient email is required'
            });
        }

        if (!validate.email(to)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid email format'
            });
        }

        // Send test email
        const result = await emailService.sendTestEmail(to);
        
        res.json({
            success: true,
            message: 'Test email sent successfully',
            data: result
        });
    } catch (error) {
        console.error('Test email error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Get email configuration status
router.get('/config', (req, res) => {
    const config = {
        isConfigured: emailService.isConfigured,
        smtp: {
            host: process.env.SMTP_HOST || 'mail.re-workflow.com',
            port: process.env.SMTP_PORT || '465',
            secure: process.env.SMTP_SECURE !== 'false',
            userConfigured: !!process.env.SMTP_USER,
            passConfigured: !!process.env.SMTP_PASS,
            fromAddress: process.env.SMTP_FROM || process.env.SMTP_USER || 'Not configured'
        }
    };

    res.json({
        success: true,
        config
    });
});

module.exports = router;