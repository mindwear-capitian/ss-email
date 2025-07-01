const cron = require('node-cron');
const strOutreachService = require('../services/str/strOutreachService');

class STROutreachJob {
    constructor() {
        this.isRunning = false;
    }

    /**
     * Initialize the cron job
     */
    init() {
        // Run every day at 9:00 AM
        cron.schedule('0 9 * * *', async () => {
            await this.run();
        }, {
            scheduled: true,
            timezone: "America/New_York"
        });

        console.log('STR Outreach job scheduled for 9:00 AM daily');
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