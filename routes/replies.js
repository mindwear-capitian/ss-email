const express = require('express');
const router = express.Router();
const { getPool } = require('../utils/db');

// Get all replies
router.get('/', async (req, res) => {
    try {
        const pool = getPool();
        const { days = 7 } = req.query;
        
        const replies = await pool.query(`
            SELECT 
                c.property_address,
                c.agent_name,
                c.agent_email,
                c.agent_phone,
                e.created_at as reply_date,
                e.metadata->>'from' as reply_from,
                e.metadata->>'subject' as reply_subject,
                e.metadata->>'text' as reply_text
            FROM str_email_events e
            JOIN str_outreach_campaigns c ON c.id = e.campaign_id
            WHERE e.event_type = 'reply'
            AND e.created_at >= NOW() - INTERVAL '${parseInt(days)} days'
            ORDER BY e.created_at DESC
        `);
        
        res.json({
            success: true,
            count: replies.rows.length,
            replies: replies.rows
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Get reply stats
router.get('/stats', async (req, res) => {
    try {
        const pool = getPool();
        
        const stats = await pool.query(`
            SELECT 
                COUNT(DISTINCT c.id) as total_campaigns_with_replies,
                COUNT(e.id) as total_replies,
                MIN(e.created_at) as first_reply,
                MAX(e.created_at) as latest_reply
            FROM str_email_events e
            JOIN str_outreach_campaigns c ON c.id = e.campaign_id
            WHERE e.event_type = 'reply'
        `);
        
        const recentReplies = await pool.query(`
            SELECT 
                c.agent_name,
                c.property_address,
                e.created_at,
                e.metadata->>'subject' as subject
            FROM str_email_events e
            JOIN str_outreach_campaigns c ON c.id = e.campaign_id
            WHERE e.event_type = 'reply'
            ORDER BY e.created_at DESC
            LIMIT 5
        `);
        
        res.json({
            success: true,
            stats: stats.rows[0],
            recentReplies: recentReplies.rows
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;