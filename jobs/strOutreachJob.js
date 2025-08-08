/**
 * STR (Short-Term Rental) Outreach Job
 * 
 * Automated email campaigns to real estate agents for high-scoring STR properties
 * 
 * FEATURES:
 * 1. Queries properties with StaySTRA score > 90
 * 2. Gets agent contact info from Zillow cache
 * 3. Enriches contacts via local DB, Brevo, or Enformion API
 * 4. Sends personalized emails with revenue projections
 * 5. Tracks all interactions via Brevo
 * 
 * SCHEDULE: Daily at 9:00 AM ET
 * VOLUME: 25 emails per day
 * 
 * Last updated: July 2025
 */

const cron = require('node-cron');
const strOutreachService = require('../services/str/strOutreachService');

class STROutreachJob {
    constructor() {
        this.isRunning = false;
        this.dailyLimit = 100; // Send 100 emails per day
    }

    /**
     * Initialize the cron job
     */
    init() {
        // Schedule for 9:00 AM ET daily
        cron.schedule('0 9 * * *', async () => {
            console.log('STR Outreach cron job triggered at', new Date().toISOString());
            await this.run(this.dailyLimit);
        }, {
            scheduled: true,
            timezone: "America/New_York"
        });
        
        console.log('STR Outreach job initialized - will run daily at 9:00 AM ET with limit of', this.dailyLimit);
    }

    /**
     * Run the job manually
     */
    async run(limit = 10) {
        if (this.isRunning) {
            console.log('STR Outreach job is already running');
            return;
        }

        this.isRunning = true;
        console.log(`Starting STR Outreach job at ${new Date().toISOString()}`);

        try {
            const results = await strOutreachService.processNewListings(limit);
            console.log('STR Outreach job completed:', results);
            return results;
        } catch (error) {
            console.error('STR Outreach job failed:', error);
            throw error;
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Get job status
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            schedule: '9:00 AM daily',
            timezone: 'America/New_York'
        };
    }
}

module.exports = new STROutreachJob();