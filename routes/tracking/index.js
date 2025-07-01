const express = require('express');
const router = express.Router();
const strOutreachService = require('../../services/str/strOutreachService');
const { getPool } = require('../../utils/db');

// Track email open (1x1 pixel)
router.get('/open/:trackingId', async (req, res) => {
    try {
        const { trackingId } = req.params;
        const ipAddress = req.ip;
        const userAgent = req.get('user-agent');

        // Track the open asynchronously
        strOutreachService.trackEmailOpen(trackingId, ipAddress, userAgent)
            .catch(err => console.error('Error tracking email open:', err));

        // Return 1x1 transparent pixel
        const pixel = Buffer.from(
            'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
            'base64'
        );

        res.writeHead(200, {
            'Content-Type': 'image/gif',
            'Content-Length': pixel.length,
            'Cache-Control': 'no-store, no-cache, must-revalidate, private',
            'Pragma': 'no-cache',
            'Expires': '0'
        });

        res.end(pixel);
    } catch (error) {
        console.error('Error in open tracking:', error);
        res.status(200).end(); // Still return 200 to not break email clients
    }
});

// Track link click and redirect
router.get('/click/:trackingId', async (req, res) => {
    try {
        const { trackingId } = req.params;
        const { url } = req.query;
        const ipAddress = req.ip;
        const userAgent = req.get('user-agent');

        // Track the click
        const campaign = await strOutreachService.trackLinkClick(trackingId, ipAddress, userAgent);

        // Redirect to the target URL
        if (url) {
            res.redirect(decodeURIComponent(url));
        } else if (campaign && campaign.staystra_share_url) {
            // Fallback to the share URL if no URL parameter
            res.redirect(campaign.staystra_share_url);
        } else {
            // Final fallback
            res.redirect('https://www.staystra.com');
        }
    } catch (error) {
        console.error('Error in click tracking:', error);
        // Still redirect even if tracking fails
        res.redirect(req.query.url ? decodeURIComponent(req.query.url) : 'https://www.staystra.com');
    }
});

// Get tracking stats for a campaign
router.get('/stats/:trackingId', async (req, res) => {
    try {
        const { trackingId } = req.params;
        
        const pool = getPool();
        const result = await pool.query(
            `SELECT 
                property_address,
                agent_name,
                agent_email,
                email_sent,
                email_sent_at,
                email_opened,
                email_opened_at,
                email_open_count,
                link_clicked,
                link_clicked_at,
                link_click_count,
                last_activity_at
             FROM str_outreach_campaigns 
             WHERE tracking_id = $1`,
            [trackingId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        res.json({
            success: true,
            campaign: result.rows[0]
        });
    } catch (error) {
        console.error('Error getting stats:', error);
        res.status(500).json({ error: 'Failed to get campaign stats' });
    }
});

module.exports = router;