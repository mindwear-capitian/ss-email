const SibApiV3Sdk = require('sib-api-v3-sdk');
const { validate } = require('../utils/validator');

class BrevoEmailService {
    constructor() {
        this.isConfigured = false;
        this.apiKey = process.env.BREVO_API_KEY || process.env.SENDINBLUE_API_KEY;
        this.defaultSender = {
            email: process.env.SMTP_FROM_ADDRESS || 'datacollection@staystra.com',
            name: process.env.SMTP_FROM_NAME || 'StaySTRA Team'
        };
        
        if (!this.apiKey) {
            console.warn('Brevo API key not configured. Email sending disabled.');
            return;
        }

        // Configure API client
        const defaultClient = SibApiV3Sdk.ApiClient.instance;
        const apiKeyAuth = defaultClient.authentications['api-key'];
        apiKeyAuth.apiKey = this.apiKey;
        
        // Initialize API instances
        this.transactionalEmailsApi = new SibApiV3Sdk.TransactionalEmailsApi();
        this.contactsApi = new SibApiV3Sdk.ContactsApi();
        
        this.isConfigured = true;
        console.log('Brevo Email API service initialized successfully');
    }

    async verifyConnection() {
        if (!this.isConfigured) {
            return {
                success: false,
                message: 'Brevo API not configured. Check API key.'
            };
        }

        try {
            // Test API connection by getting account info
            const accountApi = new SibApiV3Sdk.AccountApi();
            const account = await accountApi.getAccount();
            
            return {
                success: true,
                message: 'Brevo API connection verified successfully',
                accountInfo: {
                    email: account.email,
                    companyName: account.companyName,
                    plan: account.plan
                }
            };
        } catch (error) {
            return {
                success: false,
                message: `Brevo API connection failed: ${error.message}`
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
            throw new Error('Brevo API not configured. Check API key.');
        }

        try {
            // Prepare email data for Brevo API
            const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
            
            // Set recipient
            sendSmtpEmail.to = [{
                email: options.to,
                name: options.recipientName || options.to.split('@')[0]
            }];
            
            // Set sender
            sendSmtpEmail.sender = options.from ? {
                email: options.from,
                name: options.senderName || 'StaySTRA Team'
            } : this.defaultSender;
            
            // Set content
            sendSmtpEmail.subject = options.subject;
            sendSmtpEmail.htmlContent = options.html;
            sendSmtpEmail.textContent = options.text;
            
            // Add reply-to if provided
            if (options.replyTo) {
                sendSmtpEmail.replyTo = {
                    email: options.replyTo,
                    name: options.replyToName || 'StaySTRA Team'
                };
            }
            
            // Add custom headers if provided
            if (options.headers) {
                sendSmtpEmail.headers = options.headers;
            }
            
            // Add tags for tracking and categorization
            if (options.tags) {
                sendSmtpEmail.tags = options.tags;
            }
            
            // Add custom parameters for personalization
            if (options.params) {
                sendSmtpEmail.params = options.params;
            }
            
            // Add attachments if provided
            if (options.attachments && options.attachments.length > 0) {
                sendSmtpEmail.attachment = options.attachments.map(att => ({
                    name: att.filename,
                    content: att.content.toString('base64')
                }));
            }
            
            // Send the email
            const result = await this.transactionalEmailsApi.sendTransacEmail(sendSmtpEmail);
            
            return {
                success: true,
                messageId: result.messageId,
                // Brevo provides the message ID that can be used to track the email
                brevoMessageId: result.messageId,
                accepted: [options.to],
                rejected: []
            };
        } catch (error) {
            console.error('Brevo email send error:', error);
            throw new Error(`Failed to send email via Brevo: ${error.message}`);
        }
    }

    async sendTestEmail(recipientEmail) {
        const testEmailContent = {
            to: recipientEmail,
            subject: 'Test Email from Staystra Email Service (Brevo API)',
            text: `This is a test email from the Staystra Email Service using Brevo API.

If you're receiving this, the Brevo API configuration is working correctly.

This email will be tracked automatically by Brevo:
- Open tracking: Enabled
- Click tracking: Enabled
- Delivery status: Monitored

You can view the statistics in your Brevo dashboard.

Timestamp: ${new Date().toISOString()}

Best regards,
Staystra Email Service`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #333;">Test Email from Staystra Email Service (Brevo API)</h2>
                    <p>This is a test email from the Staystra Email Service using <strong>Brevo API</strong>.</p>
                    <p>If you're receiving this, the Brevo API configuration is working correctly.</p>
                    
                    <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                        <h3 style="margin-top: 0;">Tracking Features Enabled:</h3>
                        <ul>
                            <li>✅ Open tracking: Automatic</li>
                            <li>✅ Click tracking: Automatic</li>
                            <li>✅ Delivery status: Monitored</li>
                            <li>✅ Bounce handling: Automatic</li>
                        </ul>
                        <p>You can view the statistics in your Brevo dashboard.</p>
                    </div>
                    
                    <p>Test link: <a href="https://staystra.com">Visit StaySTRA</a></p>
                    
                    <p style="color: #666; font-size: 14px; margin-top: 30px;">
                        Timestamp: ${new Date().toISOString()}<br><br>
                        Best regards,<br>
                        Staystra Email Service
                    </p>
                </div>
            `,
            tags: ['test-email', 'system-test']
        };

        return this.sendEmail(testEmailContent);
    }

    // Get email statistics from Brevo
    async getEmailStats(messageId, days = 7) {
        if (!this.isConfigured) {
            throw new Error('Brevo API not configured.');
        }

        try {
            const statisticsApi = new SibApiV3Sdk.TransactionalEmailsApi();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
            
            const stats = await statisticsApi.getEmailEventReport({
                startDate: startDate.toISOString().split('T')[0],
                endDate: new Date().toISOString().split('T')[0],
                messageId: messageId
            });
            
            return stats;
        } catch (error) {
            console.error('Error fetching email stats:', error);
            throw error;
        }
    }

    // Get aggregated statistics
    async getAggregatedStats(tags = [], days = 7) {
        if (!this.isConfigured) {
            throw new Error('Brevo API not configured.');
        }

        try {
            const statisticsApi = new SibApiV3Sdk.TransactionalEmailsApi();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
            
            const stats = await statisticsApi.getAggregatedSmtpReport({
                startDate: startDate.toISOString().split('T')[0],
                endDate: new Date().toISOString().split('T')[0],
                tags: tags.join(',')
            });
            
            return stats;
        } catch (error) {
            console.error('Error fetching aggregated stats:', error);
            throw error;
        }
    }

    // Create or update a contact in Brevo
    async createOrUpdateContact(contactData) {
        if (!this.isConfigured) {
            throw new Error('Brevo API not configured.');
        }

        try {
            const createContact = new SibApiV3Sdk.CreateContact();
            
            // Required fields
            createContact.email = contactData.email;
            
            // Contact attributes
            createContact.attributes = {
                FIRSTNAME: contactData.firstName || '',
                LASTNAME: contactData.lastName || '',
                PHONE: contactData.phone || '',
                AGENT_NAME: contactData.fullName || '',
                BROKERAGE: contactData.brokerage || '',
                CITY: contactData.city || '',
                STATE: contactData.state || '',
                PROPERTY_ADDRESS: contactData.propertyAddress || '',
                PROPERTY_VALUE: contactData.propertyValue || 0,
                ESTIMATED_REVENUE: contactData.estimatedRevenue || 0,
                STAYSTRA_SCORE: contactData.staystraScore || 0,
                LAST_CONTACT_DATE: new Date().toISOString()
            };
            
            // Add specific date fields if provided
            if (contactData.lastStrOutreachDate) {
                createContact.attributes.LAST_STR_OUTREACH_DATE = contactData.lastStrOutreachDate;
            }
            
            // Add to lists
            if (contactData.listIds && contactData.listIds.length > 0) {
                createContact.listIds = contactData.listIds;
            }
            
            // Update if exists, create if not
            createContact.updateEnabled = true;
            
            await this.contactsApi.createContact(createContact);
            
            console.log(`Contact saved to Brevo: ${contactData.email}`);
            return { success: true, email: contactData.email };
            
        } catch (error) {
            console.error('Error creating/updating contact in Brevo:', error);
            throw error;
        }
    }

    // Get contact by email
    async getContact(email) {
        if (!this.isConfigured) {
            throw new Error('Brevo API not configured.');
        }

        try {
            const contact = await this.contactsApi.getContactInfo(email);
            return contact;
        } catch (error) {
            if (error.status === 404) {
                return null; // Contact not found
            }
            throw error;
        }
    }

    // Get contact by phone number
    async getContactByPhone(phone) {
        if (!this.isConfigured) {
            throw new Error('Brevo API not configured.');
        }

        try {
            // Clean phone number
            const cleanPhone = phone.replace(/\D/g, '');
            
            // Try with country code variations
            const phoneVariations = [
                cleanPhone,
                `+1${cleanPhone}`, // US country code
                `1${cleanPhone}`,
                `+${cleanPhone}`
            ];
            
            for (const phoneVar of phoneVariations) {
                try {
                    // Brevo uses 'phone_id' as identifier type for phone lookups
                    const contact = await this.contactsApi.getContactInfo(phoneVar, 'phone_id');
                    if (contact) {
                        console.log(`Found contact in Brevo by phone: ${phoneVar}`);
                        return contact;
                    }
                } catch (err) {
                    // Continue trying other variations
                }
            }
            
            return null; // Not found
        } catch (error) {
            console.error('Error searching contact by phone:', error);
            return null;
        }
    }

    // Create a contact list
    async createList(listName) {
        if (!this.isConfigured) {
            throw new Error('Brevo API not configured.');
        }

        try {
            const createList = new SibApiV3Sdk.CreateList();
            createList.name = listName;
            createList.folderId = 1; // Default folder
            
            const result = await this.contactsApi.createList(createList);
            return result;
        } catch (error) {
            console.error('Error creating list:', error);
            throw error;
        }
    }

    // Get all lists
    async getLists() {
        if (!this.isConfigured) {
            throw new Error('Brevo API not configured.');
        }

        try {
            const lists = await this.contactsApi.getLists();
            return lists.lists;
        } catch (error) {
            console.error('Error fetching lists:', error);
            throw error;
        }
    }
}

// Export singleton instance
module.exports = new BrevoEmailService();