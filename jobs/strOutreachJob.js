/**
 * ⚠️ DEPRECATED - FOR REFERENCE ONLY ⚠️
 * 
 * This STR (Short-Term Rental) outreach job is NO LONGER IN USE.
 * 
 * REASONS FOR DEPRECATION:
 * 1. Zillow data no longer includes agent email addresses
 * 2. StaySTRA analyzer share URL functionality was never implemented
 * 3. The outreach strategy has been discontinued
 * 
 * This file is kept for reference purposes only to understand the previous
 * email outreach implementation. DO NOT enable or use this job.
 * 
 * Original purpose: Automated email campaigns to real estate agents with
 * new STR listings, including property analysis and revenue projections.
 * 
 * Last active: July 2025
 */

const cron = require('node-cron');
const strOutreachService = require('../services/str/strOutreachService');

class STROutreachJob {
    constructor() {
        this.isRunning = false;
    }

    /**
     * Initialize the cron job
     * @deprecated This method should NOT be called. Job is disabled.
     */
    init() {
        // DISABLED - DO NOT ENABLE
        // Original schedule was: '0 9 * * *' (9:00 AM daily)
        
        console.warn('⚠️ STR Outreach job init() was called but job is DISABLED. This job is deprecated.');
        return;
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