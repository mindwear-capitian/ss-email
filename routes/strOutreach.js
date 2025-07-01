const express = require('express');
const router = express.Router();
const strOutreachJob = require('../jobs/strOutreachJob');
const { getPool } = require('../utils/db');

// Manually trigger the STR outreach job
router.post('/run', async (req, res) => {
    try {
        const { limit = 10 } = req.body;
        
        if (strOutreachJob.isRunning) {
            return res.status(409).json({
                success: false,
                message: 'Job is already running'
            });
        }

        // Run the job asynchronously
        strOutreachJob.run(limit)
            .then(results => {
                console.log('STR Outreach job completed:', results);
            })
            .catch(err => {
                console.error('STR Outreach job error:', err);
            });

        res.json({
            success: true,
            message: 'STR Outreach job started',
            limit
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Get job status
router.get('/status', (req, res) => {
    res.json({
        success: true,
        status: strOutreachJob.getStatus()
    });
});

// Get campaign statistics
router.get('/stats', async (req, res) => {
    try {
        const pool = getPool();
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_campaigns,
                COUNT(CASE WHEN email_sent = true THEN 1 END) as emails_sent,
                COUNT(CASE WHEN email_opened = true THEN 1 END) as emails_opened,
                COUNT(CASE WHEN link_clicked = true THEN 1 END) as links_clicked,
                ROUND(AVG(estimated_annual_revenue)) as avg_annual_revenue,
                MAX(created_at) as last_campaign_created
            FROM str_outreach_campaigns
        `);

        const recentCampaigns = await pool.query(`
            SELECT 
                property_address,
                agent_name,
                agent_email,
                email_sent,
                email_opened,
                link_clicked,
                estimated_annual_revenue,
                created_at
            FROM str_outreach_campaigns
            ORDER BY created_at DESC
            LIMIT 10
        `);

        res.json({
            success: true,
            stats: stats.rows[0],
            recentCampaigns: recentCampaigns.rows
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Get campaign details by tracking ID
router.get('/campaign/:trackingId', async (req, res) => {
    try {
        const { trackingId } = req.params;
        const pool = getPool();
        
        const campaign = await pool.query(
            'SELECT * FROM str_outreach_campaigns WHERE tracking_id = $1',
            [trackingId]
        );

        if (campaign.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Campaign not found'
            });
        }

        const events = await pool.query(
            'SELECT * FROM str_email_events WHERE campaign_id = $1 ORDER BY created_at DESC',
            [campaign.rows[0].id]
        );

        res.json({
            success: true,
            campaign: campaign.rows[0],
            events: events.rows
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;