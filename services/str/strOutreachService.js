const { ApifyClient } = require('apify-client');
const puppeteer = require('puppeteer');
const { v4: uuidv4 } = require('uuid');
const { getPool } = require('../../utils/db');
const emailService = require('../emailService');
const axios = require('axios');

class STROutreachService {
    constructor() {
        this.apifyClient = new ApifyClient({
            token: process.env.APIFY_TOKEN
        });
        this.baseUrl = process.env.API_BASE_URL || 'https://email.re-workflow.com';
    }

    /**
     * Fetch new STR listings from Zillow via Apify
     */
    async fetchNewSTRListings(limit = 10) {
        console.log('Fetching new STR listings from Apify...');
        
        // TODO: Replace with actual Apify actor details
        const input = {
            searchType: 'sale',
            propertyType: 'vacation_rental',
            daysOnMarket: 1, // New listings only
            maxItems: limit
        };

        try {
            // Run the Apify actor
            const run = await this.apifyClient.actor('YOUR_ACTOR_ID').call(input);
            
            // Get results
            const { items } = await this.apifyClient.dataset(run.defaultDatasetId).listItems();
            
            return items.map(item => ({
                zillow_url: item.url,
                property_address: item.address,
                city: item.city,
                state: item.state,
                zip_code: item.zipCode,
                mls_number: item.mlsNumber,
                listing_price: item.price,
                listing_date: new Date(item.listingDate),
                days_on_market: item.daysOnMarket,
                agent_name: item.agentName,
                agent_email: item.agentEmail,
                agent_phone: item.agentPhone,
                brokerage: item.brokerage
            }));
        } catch (error) {
            console.error('Error fetching STR listings:', error);
            throw error;
        }
    }

    /**
     * Run StaySTRA analysis using Puppeteer
     */
    async runStaystraAnalysis(address) {
        console.log(`Running StaySTRA analysis for: ${address}`);
        
        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        try {
            const page = await browser.newPage();
            
            // Navigate to StaySTRA analyzer
            await page.goto('https://www.staystra.com/analyzer', {
                waitUntil: 'networkidle2',
                timeout: 30000
            });

            // Type the address
            await page.waitForSelector('input[type="text"]', { timeout: 10000 });
            await page.type('input[type="text"]', address);

            // Submit the form
            await page.keyboard.press('Enter');

            // Wait for results
            await page.waitForSelector('.analysis-results', { timeout: 60000 });

            // Extract the share URL
            const shareUrl = await page.evaluate(() => {
                const shareButton = document.querySelector('.share-button');
                if (shareButton) {
                    shareButton.click();
                    // Wait for share modal/URL to appear
                    const shareInput = document.querySelector('.share-url-input');
                    return shareInput ? shareInput.value : null;
                }
                return null;
            });

            // Extract analysis data
            const analysisData = await page.evaluate(() => {
                const data = {};
                
                // Annual revenue
                const revenueEl = document.querySelector('.annual-revenue');
                if (revenueEl) {
                    data.annualRevenue = parseFloat(revenueEl.textContent.replace(/[$,]/g, ''));
                }

                // Monthly revenue
                const monthlyEl = document.querySelector('.monthly-revenue');
                if (monthlyEl) {
                    data.monthlyRevenue = parseFloat(monthlyEl.textContent.replace(/[$,]/g, ''));
                }

                // Occupancy rate
                const occupancyEl = document.querySelector('.occupancy-rate');
                if (occupancyEl) {
                    data.occupancyRate = parseFloat(occupancyEl.textContent.replace('%', ''));
                }

                // Daily rate
                const dailyRateEl = document.querySelector('.daily-rate');
                if (dailyRateEl) {
                    data.dailyRate = parseFloat(dailyRateEl.textContent.replace(/[$,]/g, ''));
                }

                // Grade
                const gradeEl = document.querySelector('.property-grade');
                if (gradeEl) {
                    data.grade = gradeEl.textContent.trim();
                }

                return data;
            });

            return {
                shareUrl,
                analysisData
            };
        } finally {
            await browser.close();
        }
    }

    /**
     * Save campaign to database
     */
    async saveCampaign(listingData, analysisResult) {
        const trackingId = uuidv4().substring(0, 10);
        const pool = getPool();
        
        const query = `
            INSERT INTO str_outreach_campaigns (
                zillow_url, property_address, city, state, zip_code,
                mls_number, listing_price, listing_date, days_on_market,
                agent_name, agent_email, agent_phone, brokerage,
                staystra_share_url, tracking_id,
                estimated_annual_revenue, estimated_monthly_revenue,
                occupancy_rate, daily_rate, analysis_grade,
                analysis_data, analysis_run_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
            ON CONFLICT (zillow_url) DO UPDATE SET
                updated_at = NOW()
            RETURNING id
        `;

        const values = [
            listingData.zillow_url,
            listingData.property_address,
            listingData.city,
            listingData.state,
            listingData.zip_code,
            listingData.mls_number,
            listingData.listing_price,
            listingData.listing_date,
            listingData.days_on_market,
            listingData.agent_name,
            listingData.agent_email,
            listingData.agent_phone,
            listingData.brokerage,
            analysisResult.shareUrl,
            trackingId,
            analysisResult.analysisData.annualRevenue,
            analysisResult.analysisData.monthlyRevenue,
            analysisResult.analysisData.occupancyRate,
            analysisResult.analysisData.dailyRate,
            analysisResult.analysisData.grade,
            analysisResult.analysisData,
            new Date()
        ];

        const result = await pool.query(query, values);
        return { id: result.rows[0].id, trackingId };
    }

    /**
     * Generate tracked URL
     */
    generateTrackedUrl(shareUrl, trackingId) {
        // Add tracking parameter to the share URL
        const url = new URL(shareUrl);
        url.searchParams.set('utm_source', 'str_outreach');
        url.searchParams.set('utm_medium', 'email');
        url.searchParams.set('utm_campaign', 'new_listing');
        url.searchParams.set('tid', trackingId);
        
        // Create a redirect URL through our tracking endpoint
        const trackedUrl = `${this.baseUrl}/api/tracking/click/${trackingId}?url=${encodeURIComponent(url.toString())}`;
        
        return trackedUrl;
    }

    /**
     * Send outreach email
     */
    async sendOutreachEmail(campaign) {
        const trackedUrl = this.generateTrackedUrl(campaign.staystra_share_url, campaign.tracking_id);
        
        const emailContent = {
            to: campaign.agent_email,
            subject: `Congrats on ${campaign.property_address} - $${campaign.estimated_annual_revenue?.toLocaleString() || 'XX,XXX'} potential revenue`,
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                        .header { color: #2c3e50; margin-bottom: 20px; }
                        .revenue { font-size: 24px; color: #27ae60; font-weight: bold; }
                        .cta-button { 
                            display: inline-block; 
                            padding: 12px 24px; 
                            background-color: #3498db; 
                            color: white; 
                            text-decoration: none; 
                            border-radius: 5px; 
                            margin: 20px 0;
                        }
                        .footer { font-size: 12px; color: #666; margin-top: 30px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h2 class="header">Hi ${campaign.agent_name || 'there'},</h2>
                        
                        <p>Congratulations on your new STR listing at <strong>${campaign.property_address}</strong>!</p>
                        
                        <p>We ran the numbers and estimate it could generate:</p>
                        <div class="revenue">$${campaign.estimated_annual_revenue?.toLocaleString() || 'XX,XXX'} in rental income over the next 12 months</div>
                        
                        <a href="${trackedUrl}" class="cta-button">View Full Analysis</a>
                        
                        <p>Feel free to share this analysis with any potential buyers who might be interested in the investment potential.</p>
                        
                        <p>Best regards,<br>
                        The StaySTRA Team</p>
                        
                        <div class="footer">
                            <p>This analysis is based on comparable properties in the area. Actual results may vary.</p>
                            <img src="${this.baseUrl}/api/tracking/open/${campaign.tracking_id}" width="1" height="1" style="display:none;" />
                        </div>
                    </div>
                </body>
                </html>
            `,
            text: `Hi ${campaign.agent_name || 'there'},

Congratulations on your new STR listing at ${campaign.property_address}!

We ran the numbers and estimate it could generate $${campaign.estimated_annual_revenue?.toLocaleString() || 'XX,XXX'} in rental income over the next 12 months.

View the full analysis: ${trackedUrl}

Feel free to share this analysis with any potential buyers who might be interested in the investment potential.

Best regards,
The StaySTRA Team`
        };

        try {
            const result = await emailService.sendEmail(emailContent);
            
            // Update campaign record
            const pool = getPool();
            await pool.query(
                `UPDATE str_outreach_campaigns 
                 SET email_sent = true, 
                     email_sent_at = NOW(), 
                     email_message_id = $1 
                 WHERE id = $2`,
                [result.messageId, campaign.id]
            );

            return result;
        } catch (error) {
            console.error(`Failed to send email to ${campaign.agent_email}:`, error);
            throw error;
        }
    }

    /**
     * Process new STR listings - main workflow
     */
    async processNewListings(limit = 10) {
        console.log('Starting STR outreach processing...');
        
        // 1. Fetch new listings from Apify
        const listings = await this.fetchNewSTRListings(limit);
        console.log(`Found ${listings.length} new STR listings`);

        const results = {
            processed: 0,
            sent: 0,
            failed: []
        };

        // 2. Process each listing
        for (const listing of listings) {
            try {
                console.log(`Processing: ${listing.property_address}`);
                
                // Skip if no agent email
                if (!listing.agent_email) {
                    console.log('No agent email found, skipping...');
                    continue;
                }

                // 3. Run StaySTRA analysis
                const analysisResult = await this.runStaystraAnalysis(listing.property_address);
                
                if (!analysisResult.shareUrl) {
                    console.log('Could not get share URL, skipping...');
                    continue;
                }

                // 4. Save to database
                const { id, trackingId } = await this.saveCampaign(listing, analysisResult);
                
                // 5. Get the campaign data
                const pool = getPool();
                const campaign = await pool.query(
                    'SELECT * FROM str_outreach_campaigns WHERE id = $1',
                    [id]
                );

                // 6. Send email
                await this.sendOutreachEmail(campaign.rows[0]);
                
                results.processed++;
                results.sent++;
                
                // Add delay between processing to avoid overwhelming systems
                await new Promise(resolve => setTimeout(resolve, 5000));
                
            } catch (error) {
                console.error(`Error processing listing ${listing.property_address}:`, error);
                results.failed.push({
                    address: listing.property_address,
                    error: error.message
                });
            }
        }

        console.log('STR outreach processing complete:', results);
        return results;
    }

    /**
     * Track email open
     */
    async trackEmailOpen(trackingId, ipAddress, userAgent) {
        const pool = getPool();
        const campaign = await pool.query(
            'SELECT id FROM str_outreach_campaigns WHERE tracking_id = $1',
            [trackingId]
        );

        if (campaign.rows.length > 0) {
            const campaignId = campaign.rows[0].id;
            
            // Update campaign
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
                [campaignId, 'open', ipAddress, userAgent]
            );
        }
    }

    /**
     * Track link click
     */
    async trackLinkClick(trackingId, ipAddress, userAgent) {
        const pool = getPool();
        const campaign = await pool.query(
            'SELECT id, staystra_share_url FROM str_outreach_campaigns WHERE tracking_id = $1',
            [trackingId]
        );

        if (campaign.rows.length > 0) {
            const campaignId = campaign.rows[0].id;
            
            // Update campaign
            await pool.query(
                `UPDATE str_outreach_campaigns 
                 SET link_clicked = true,
                     link_clicked_at = COALESCE(link_clicked_at, NOW()),
                     link_click_count = link_click_count + 1,
                     last_activity_at = NOW()
                 WHERE id = $1`,
                [campaignId]
            );

            // Log event
            await pool.query(
                `INSERT INTO str_email_events (campaign_id, event_type, ip_address, user_agent)
                 VALUES ($1, $2, $3, $4)`,
                [campaignId, 'click', ipAddress, userAgent]
            );

            return campaign.rows[0];
        }
        
        return null;
    }
}

module.exports = new STROutreachService();