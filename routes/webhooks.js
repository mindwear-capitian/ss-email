const express = require('express');
const router = express.Router();
const { getPool } = require('../utils/db');

// Brevo webhook handler
router.post('/brevo', async (req, res) => {
    try {
        const events = Array.isArray(req.body) ? req.body : [req.body];
        const pool = getPool();
        
        for (const event of events) {
            // Extract tracking ID from tags or message ID
            let trackingId = null;
            
            // Try to find tracking ID in tags
            if (event.tags && Array.isArray(event.tags)) {
                const tidTag = event.tags.find(tag => tag.startsWith('tid-'));
                if (tidTag) {
                    trackingId = tidTag.replace('tid-', '');
                }
            }
            
            // Try to find tracking ID from message-id header
            if (!trackingId && event['message-id']) {
                // Look up campaign by Brevo message ID
                const campaign = await pool.query(
                    'SELECT tracking_id FROM str_outreach_campaigns WHERE email_message_id = $1',
                    [event['message-id']]
                );
                if (campaign.rows.length > 0) {
                    trackingId = campaign.rows[0].tracking_id;
                }
            }
            
            // Skip if no tracking ID found
            if (!trackingId) {
                console.log('Brevo webhook: No tracking ID found for event', event);
                continue;
            }
            
            // Get campaign
            const campaign = await pool.query(
                'SELECT id FROM str_outreach_campaigns WHERE tracking_id = $1',
                [trackingId]
            );
            
            if (campaign.rows.length === 0) {
                console.log(`Brevo webhook: Campaign not found for tracking ID ${trackingId}`);
                continue;
            }
            
            const campaignId = campaign.rows[0].id;
            
            // Process event based on type
            switch (event.event) {
                case 'delivered':
                    console.log(`Email delivered for campaign ${trackingId}`);
                    // Email delivery is already marked when sent
                    break;
                    
                case 'opened':
                case 'unique_opened':
                    console.log(`Email opened for campaign ${trackingId}`);
                    await pool.query(
                        `UPDATE str_outreach_campaigns 
                         SET email_opened = true,
                             email_opened_at = COALESCE(email_opened_at, NOW()),
                             email_open_count = email_open_count + 1,
                             last_activity_at = NOW()
                         WHERE id = $1`,
                        [campaignId]
                    );
                    
                    // Log event
                    await pool.query(
                        `INSERT INTO str_email_events (campaign_id, event_type, ip_address, user_agent)
                         VALUES ($1, $2, $3, $4)`,
                        [campaignId, 'open', event.ip || null, event['user-agent'] || null]
                    );
                    break;
                    
                case 'click':
                    console.log(`Link clicked for campaign ${trackingId}`);
                    await pool.query(
                        `UPDATE str_outreach_campaigns 
                         SET link_clicked = true,
                             link_clicked_at = COALESCE(link_clicked_at, NOW()),
                             link_click_count = link_click_count + 1,
                             last_activity_at = NOW()
                         WHERE id = $1`,
                        [campaignId]
                    );
                    
                    // Log event with clicked URL
                    await pool.query(
                        `INSERT INTO str_email_events (campaign_id, event_type, ip_address, user_agent, metadata)
                         VALUES ($1, $2, $3, $4, $5)`,
                        [campaignId, 'click', event.ip || null, event['user-agent'] || null, 
                         JSON.stringify({ url: event.url })]
                    );
                    break;
                    
                case 'soft_bounce':
                case 'hard_bounce':
                    console.log(`Email bounced (${event.event}) for campaign ${trackingId}`);
                    await pool.query(
                        `INSERT INTO str_email_events (campaign_id, event_type, metadata)
                         VALUES ($1, $2, $3)`,
                        [campaignId, event.event, JSON.stringify({ reason: event.reason })]
                    );
                    break;
                    
                case 'spam':
                case 'invalid_email':
                case 'blocked':
                    console.log(`Email issue (${event.event}) for campaign ${trackingId}`);
                    await pool.query(
                        `INSERT INTO str_email_events (campaign_id, event_type, metadata)
                         VALUES ($1, $2, $3)`,
                        [campaignId, event.event, JSON.stringify({ reason: event.reason })]
                    );
                    break;
                    
                case 'reply':
                    console.log(`Email reply received for campaign ${trackingId}`);
                    await pool.query(
                        `INSERT INTO str_email_events (campaign_id, event_type, metadata)
                         VALUES ($1, $2, $3)`,
                        [campaignId, 'reply', JSON.stringify({ 
                            from: event.from,
                            subject: event.subject,
                            text: event.text,
                            timestamp: event.date
                        })]
                    );
                    
                    // TODO: Send notification to sales team
                    // Could send Slack notification, email alert, etc.
                    break;
            }
        }
        
        // Brevo expects a 200 response
        res.status(200).send('OK');
    } catch (error) {
        console.error('Brevo webhook error:', error);
        // Still return 200 to prevent Brevo from retrying
        res.status(200).send('Error logged');
    }
});

// Legacy tracking endpoints (can be removed once fully migrated to Brevo)
router.get('/track/open/:trackingId', async (req, res) => {
    try {
        const { trackingId } = req.params;
        const strOutreachService = require('../services/str/strOutreachService');
        
        await strOutreachService.trackEmailOpen(
            trackingId,
            req.ip,
            req.get('user-agent')
        );
        
        // Return 1x1 transparent pixel
        const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
        res.writeHead(200, {
            'Content-Type': 'image/gif',
            'Content-Length': pixel.length,
            'Cache-Control': 'no-store, no-cache, must-revalidate, private'
        });
        res.end(pixel);
    } catch (error) {
        console.error('Track open error:', error);
        res.status(200).send();
    }
});

router.get('/track/click/:trackingId', async (req, res) => {
    try {
        const { trackingId } = req.params;
        const { url } = req.query;
        
        if (!url) {
            return res.status(400).send('Missing redirect URL');
        }
        
        const strOutreachService = require('../services/str/strOutreachService');
        
        await strOutreachService.trackLinkClick(
            trackingId,
            req.ip,
            req.get('user-agent')
        );
        
        // Redirect to the target URL
        res.redirect(decodeURIComponent(url));
    } catch (error) {
        console.error('Track click error:', error);
        // Still redirect even if tracking fails
        const { url } = req.query;
        if (url) {
            res.redirect(decodeURIComponent(url));
        } else {
            res.status(400).send('Invalid request');
        }
    }
});

module.exports = router;