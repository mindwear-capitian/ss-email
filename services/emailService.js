const nodemailer = require('nodemailer');
const { validate } = require('../utils/validator');

class EmailService {
    constructor() {
        this.transporter = null;
        this.isConfigured = false;
        this.config = {
            host: process.env.SMTP_HOST || 'mail.re-workflow.com',
            port: parseInt(process.env.SMTP_PORT || '465'),
            secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            },
            tls: {
                rejectUnauthorized: process.env.NODE_ENV === 'production' // Only enforce in production
            }
        };

        this.initializeTransporter();
    }

    initializeTransporter() {
        try {
            // Check if we have required credentials
            if (!this.config.auth.user || !this.config.auth.pass) {
                console.warn('SMTP credentials not configured. Email sending disabled.');
                this.isConfigured = false;
                return;
            }

            // Create reusable transporter
            this.transporter = nodemailer.createTransport(this.config);
            this.isConfigured = true;
            console.log('Email service initialized successfully');
        } catch (error) {
            console.error('Failed to initialize email service:', error);
            this.isConfigured = false;
        }
    }

    async verifyConnection() {
        if (!this.isConfigured) {
            return {
                success: false,
                message: 'Email service not configured. Check SMTP credentials.'
            };
        }

        try {
            await this.transporter.verify();
            return {
                success: true,
                message: 'SMTP connection verified successfully'
            };
        } catch (error) {
            return {
                success: false,
                message: `SMTP connection failed: ${error.message}`
            };
        }
    }

    async sendEmail(options) {
        // Validate email addresses
        if (!validate.email(options.to)) {
            throw new Error(`Invalid recipient email: ${options.to}`);
        }

        if (options.from && !validate.email(options.from)) {
            throw new Error(`Invalid sender email: ${options.from}`);
        }

        if (!this.isConfigured) {
            throw new Error('Email service not configured. Check SMTP credentials.');
        }

        // Set default from address if not provided
        const from = options.from || process.env.SMTP_FROM || process.env.SMTP_USER;

        try {
            const mailOptions = {
                from: from,
                to: options.to,
                subject: options.subject,
                text: options.text,
                html: options.html,
                headers: options.headers || {},
                attachments: options.attachments || []
            };

            // Send mail
            const info = await this.transporter.sendMail(mailOptions);

            return {
                success: true,
                messageId: info.messageId,
                response: info.response,
                accepted: info.accepted,
                rejected: info.rejected
            };
        } catch (error) {
            console.error('Email send error:', error);
            throw new Error(`Failed to send email: ${error.message}`);
        }
    }

    async sendTestEmail(recipientEmail) {
        const testEmailContent = {
            to: recipientEmail,
            subject: 'Test Email from Staystra Email Service',
            text: `This is a test email from the Staystra Email Service.

If you're receiving this, the email configuration is working correctly.

Configuration Details:
- SMTP Host: ${this.config.host}
- SMTP Port: ${this.config.port}
- Secure: ${this.config.secure}
- Timestamp: ${new Date().toISOString()}

Best regards,
Staystra Email Service`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #333;">Test Email from Staystra Email Service</h2>
                    <p>This is a test email from the Staystra Email Service.</p>
                    <p>If you're receiving this, the email configuration is working correctly.</p>
                    
                    <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                        <h3 style="margin-top: 0;">Configuration Details:</h3>
                        <ul style="list-style-type: none; padding-left: 0;">
                            <li><strong>SMTP Host:</strong> ${this.config.host}</li>
                            <li><strong>SMTP Port:</strong> ${this.config.port}</li>
                            <li><strong>Secure:</strong> ${this.config.secure}</li>
                            <li><strong>Timestamp:</strong> ${new Date().toISOString()}</li>
                        </ul>
                    </div>
                    
                    <p style="color: #666; font-size: 14px; margin-top: 30px;">
                        Best regards,<br>
                        Staystra Email Service
                    </p>
                </div>
            `
        };

        return this.sendEmail(testEmailContent);
    }

    // Future methods for campaign emails
    async sendCampaignEmail(campaign, contact, variables = {}) {
        // To be implemented when campaign functionality is added
        throw new Error('Campaign email sending not yet implemented');
    }

    // Method to format email with tracking pixels and links
    formatEmailContent(template, variables = {}, trackingId = null) {
        let content = template;
        
        // Replace variables in template
        Object.keys(variables).forEach(key => {
            const regex = new RegExp(`{{${key}}}`, 'g');
            content = content.replace(regex, variables[key] || '');
        });

        // Add tracking pixel if trackingId provided
        if (trackingId && content.includes('</body>')) {
            const trackingPixel = `<img src="${process.env.API_BASE_URL}/api/webhooks/track/open/${trackingId}" width="1" height="1" style="display:none;" />`;
            content = content.replace('</body>', `${trackingPixel}</body>`);
        }

        return content;
    }
}

// Export singleton instance
module.exports = new EmailService();