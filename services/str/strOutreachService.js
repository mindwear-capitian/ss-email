const puppeteer = require('puppeteer');
const { v4: uuidv4 } = require('uuid');
const { getPool } = require('../../utils/db');
const emailService = require('../emailService');
const axios = require('axios');

class STROutreachService {
    constructor() {
        this.baseUrl = process.env.API_BASE_URL || 'https://email.re-workflow.com';
        this.enformionApiKey = process.env.ENFORMION_API_KEY || '5fe02c8b0fa2461fb1b03398f58829cb';
        this.testMode = process.env.STR_OUTREACH_TEST_MODE === 'true';
        this.testEmail = process.env.STR_OUTREACH_TEST_EMAIL || 'engage.nrg@gmail.com';
    }

    /**
     * Fetch high-scoring properties from staystra_analysis_v1
     */
    async fetchHighScoringProperties(limit = 10, scoreThreshold = 90) {
        console.log(`Fetching properties with StaySTRA score > ${scoreThreshold}...`);
        
        const pool = getPool();
        const query = `
            SELECT DISTINCT ON (a.property_address_full)
                a.property_address_full,
                a.staystra_score,
                a.staystra_score_note,
                a.zillow_price as property_value,
                a.fp_median_annual_revenue as projected_revenue_typical,
                a.fp_top_25_annual_revenue as projected_revenue_top_25,
                a.fp_true_coc_return as cash_on_cash_return,
                a.fp_gross_yield_median as gross_yield,
                a.fp_dscr as debt_service_coverage_ratio,
                a.fp_grm_median as gross_rent_multiplier,
                a.analysis_version,
                a.analysis_timestamp as created_at,
                z.zillow_data
            FROM staystra_analysis_v1 a
            LEFT JOIN zillow_property_cache z ON z.address = a.property_address_full
            WHERE a.staystra_score > $1
            AND z.zillow_data IS NOT NULL
            AND z.zillow_data->'listingAgent' IS NOT NULL
            -- Only include properties analyzed in the last 24 hours
            AND a.analysis_timestamp >= NOW() - INTERVAL '24 hours'
            -- US Address validation
            AND a.property_address_full ~ ', [A-Z]{2} [0-9]{5}'  -- Must have state code and ZIP
            AND a.property_address_full NOT LIKE '0 %'  -- Filter out addresses starting with 0
            AND a.property_address_full NOT LIKE '00 %'  -- Filter out addresses starting with 00
            AND (z.zillow_data->>'state')::text IN (
                'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
                'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
                'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
                'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
                'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
            )
            -- Data Quality Filters - "Too Good to Be True" checks
            AND a.fp_true_coc_return <= 0.50  -- Cash on cash return <= 50%
            AND a.fp_true_coc_return > 0.05   -- Cash on cash return > 5% (not negative or too low)
            AND a.fp_gross_yield_median <= 0.30  -- Gross yield <= 30%
            AND a.fp_gross_yield_median > 0.05   -- Gross yield > 5%
            AND a.fp_dscr <= 5.0              -- DSCR <= 5.0 (not unrealistically high)
            AND a.fp_dscr > 0.8               -- DSCR > 0.8 (property should at least nearly cover debt)
            AND a.zillow_price > 50000        -- Property value > $50k (filter out data errors)
            AND a.zillow_price < 5000000      -- Property value < $5M (focus on normal STR range)
            AND a.fp_median_annual_revenue > 10000  -- Annual revenue > $10k (realistic minimum)
            AND a.fp_median_annual_revenue < a.zillow_price * 0.5  -- Revenue < 50% of property value (sanity check)
            AND a.fp_grm_median > 5           -- GRM > 5 (not unrealistically low)
            AND a.fp_grm_median < 30          -- GRM < 30 (not unrealistically high)
            AND NOT EXISTS (
                SELECT 1 FROM str_outreach_campaigns c 
                WHERE c.property_address = a.property_address_full 
                AND c.email_sent = true
            )
            ORDER BY a.property_address_full, a.analysis_timestamp DESC
            LIMIT $2
        `;
        
        try {
            const result = await pool.query(query, [scoreThreshold, limit]);
            console.log(`Found ${result.rows.length} eligible properties`);
            return result.rows;
        } catch (error) {
            console.error('Error fetching high-scoring properties:', error);
            throw error;
        }
    }

    /**
     * Extract agent info from Zillow data
     */
    extractAgentInfo(zillowData) {
        const listingAgent = zillowData?.listingAgent || {};
        const address = zillowData?.address || {};
        
        return {
            name: listingAgent.name || null,
            phone: listingAgent.phone || null,
            city: address.city || zillowData?.city || null,
            state: address.state || zillowData?.state || null,
            zipcode: address.zipcode || null
        };
    }

    /**
     * Call Enformion API to get agent email
     */
    async getAgentEmail(agentInfo) {
        if (!agentInfo.name || !agentInfo.phone) {
            console.log('Missing agent name or phone, skipping lookup');
            return null;
        }

        console.log(`Looking up email for ${agentInfo.name} (${agentInfo.phone})...`);
        
        // First, check if we already have this agent's email in our database
        try {
            const pool = getPool();
            const existingAgent = await pool.query(
                `SELECT DISTINCT agent_email 
                 FROM str_outreach_campaigns 
                 WHERE agent_phone = $1 
                 AND agent_email IS NOT NULL 
                 AND agent_email != 'mock-agent@example.com'
                 LIMIT 1`,
                [agentInfo.phone]
            );
            
            if (existingAgent.rows.length > 0) {
                const email = existingAgent.rows[0].agent_email;
                console.log(`Found existing email in database: ${email}`);
                return email;
            }
        } catch (error) {
            console.log('Error checking database for existing contact:', error.message);
        }
        
        // Second, check if we have this contact in Brevo by phone
        try {
            const brevoContacts = await this.searchBrevoContactsByPhone(agentInfo.phone);
            if (brevoContacts.length > 0) {
                const contact = brevoContacts[0];
                const email = contact.email;
                console.log(`Found existing email in Brevo: ${email}`);
                
                // Check if we've sent to this contact recently
                const lastContactDate = contact.attributes?.LAST_STR_OUTREACH_DATE;
                if (lastContactDate) {
                    const lastContact = new Date(lastContactDate);
                    const daysSinceLastContact = Math.floor((new Date() - lastContact) / (1000 * 60 * 60 * 24));
                    
                    if (daysSinceLastContact < 30) {
                        console.log(`Skipping ${email} - last contacted ${daysSinceLastContact} days ago (minimum 30 days required)`);
                        return 'RECENTLY_CONTACTED';
                    }
                }
                
                return email;
            }
        } catch (error) {
            console.log('Error checking Brevo for existing contact:', error.message);
        }
        
        console.log('Contact not found in database or Brevo, checking Enformion...');
        
        // Parse name into first/last
        const nameParts = agentInfo.name.split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';
        
        try {
            // Search with name and state only
            const requestBody = {
                FirstName: firstName,
                LastName: lastName,
                Address: {
                    AddressLine1: "",
                    AddressLine2: agentInfo.state || ""
                }
            };
            
            // Only send if we have name and state
            if (!firstName || !lastName || !agentInfo.state) {
                console.log('Missing required fields for Enformion search:', { firstName, lastName, state: agentInfo.state });
                return null;
            }
            
            console.log('Enformion request (Name + State):', JSON.stringify(requestBody, null, 2));
            
            const response = await axios.post('https://devapi.enformion.com/Contact/Enrich', requestBody, {
                headers: {
                    'galaxy-ap-name': '5fe02c8b0fa2461fb1b03398f58829cb',
                    'galaxy-ap-password': 'd812179ac7d648d784574cdcc5861877',
                    'galaxy-client-session-id': '69',
                    'galaxy-client-type': 'RestAPI',
                    'galaxy-search-type': 'DevAPIContactEnrich',
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            });

            // Log the full response to debug
            console.log('Enformion response status:', response.status);
            console.log('Enformion response data:', JSON.stringify(response.data, null, 2));

            // Parse Enformion response - check for emails in response
            // Check if we have actual results
            if (response.data?.message === 'No strong matches') {
                console.log('Enformion: No strong matches found for this contact');
                return null;
            }
            
            // Handle multiple results if they exist
            const results = response.data?.results || (response.data?.person ? [response.data] : []);
            
            if (results.length === 0) {
                console.log('No results in Enformion response');
                return null;
            }
            
            console.log(`Found ${results.length} potential match(es) for ${agentInfo.name}`);
            
            // Score each result to find the best match
            let bestMatch = null;
            let bestScore = -1;
            
            for (let i = 0; i < results.length; i++) {
                const result = results[i];
                const person = result.person || result;
                
                if (!person.emails || person.emails.length === 0) {
                    console.log(`Result ${i + 1}: No emails, skipping`);
                    continue;
                }
                
                let score = 0;
                let matchDetails = [];
                
                // Base score for having emails
                score += 10;
                
                // Check if any of the addresses match the listing city
                if (person.addresses && agentInfo.city) {
                    const cityMatch = person.addresses.some(addr => 
                        addr.city && addr.city.toLowerCase() === agentInfo.city.toLowerCase()
                    );
                    if (cityMatch) {
                        score += 50;
                        matchDetails.push(`City: ${agentInfo.city}`);
                    }
                }
                
                // Check if any of the phones match
                if (person.phones && agentInfo.phone) {
                    const normalizedAgentPhone = agentInfo.phone.replace(/\D/g, '');
                    const phoneMatch = person.phones.some(phone => {
                        const normalizedPhone = phone.number.replace(/\D/g, '');
                        return normalizedPhone === normalizedAgentPhone;
                    });
                    if (phoneMatch) {
                        score += 50;
                        matchDetails.push(`Phone: ${agentInfo.phone}`);
                    }
                }
                
                // Bonus for validated emails
                const hasValidatedEmail = person.emails.some(e => e.isValidated === true);
                if (hasValidatedEmail) {
                    score += 20;
                    matchDetails.push('Validated email');
                }
                
                // Use identity score from Enformion if available
                if (result.identityScore) {
                    score += result.identityScore / 10; // Add up to 10 points based on identity score
                }
                
                console.log(`Result ${i + 1}: Score ${score} - Matches: ${matchDetails.join(', ') || 'Name only'}`);
                
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = person;
                }
            }
            
            if (!bestMatch) {
                console.log('No results with emails found');
                return null;
            }
            
            // Extract email from best match
            const emails = bestMatch.emails || [];
            let emailAddress = null;
            
            if (emails.length > 0) {
                // Prefer validated emails
                const validatedEmail = emails.find(e => e.isValidated === true);
                const emailObj = validatedEmail || emails[0];
                emailAddress = emailObj?.email || emailObj;
            }
            
            if (emailAddress) {
                console.log(`Selected best match email: ${emailAddress} (score: ${bestScore})`);
                
                // Check if this email has been contacted recently via Brevo
                try {
                    const brevoService = require('../brevoEmailService');
                    const existingContact = await brevoService.getContact(emailAddress);
                    
                    if (existingContact) {
                        const lastContactDate = existingContact.attributes?.LAST_STR_OUTREACH_DATE;
                        if (lastContactDate) {
                            const lastContact = new Date(lastContactDate);
                            const daysSinceLastContact = Math.floor((new Date() - lastContact) / (1000 * 60 * 60 * 24));
                            
                            if (daysSinceLastContact < 30) {
                                console.log(`Skipping ${emailAddress} - last contacted ${daysSinceLastContact} days ago (minimum 30 days required)`);
                                return 'RECENTLY_CONTACTED';
                            }
                        }
                    }
                } catch (error) {
                    console.log('Error checking Brevo for recent contact:', error.message);
                    // Continue anyway - better to risk a duplicate than miss an opportunity
                }
                
                return emailAddress;
            } else {
                console.log('No email found in best match');
                return null;
            }
        } catch (error) {
            console.error('Enformion API error:');
            console.error('Status:', error.response?.status);
            console.error('Headers:', error.response?.headers);
            console.error('Error data:', JSON.stringify(error.response?.data, null, 2));
            console.error('Error message:', error.message);
            return null;
        }
    }

    /**
     * Save campaign to database
     */
    async saveCampaign(propertyData, agentInfo, agentEmail) {
        const trackingId = uuidv4().substring(0, 10);
        const pool = getPool();
        
        const query = `
            INSERT INTO str_outreach_campaigns (
                zillow_url, property_address, city, state, zip_code,
                listing_price, agent_name, agent_email, agent_phone,
                tracking_id, estimated_annual_revenue, estimated_monthly_revenue,
                analysis_data, analysis_run_at, staystra_share_url
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            RETURNING id
        `;

        // Generate StaySTRA analyzer URL for this property (using ?a1= format)
        const encodedAddress = encodeURIComponent(propertyData.property_address_full);
        const staystraUrl = `https://staystra.com/staystra-analyzer/?a1=${encodedAddress}`;
        
        // Generate a unique Zillow URL (using StaySTRA URL as base since we don't have actual Zillow URL)
        const zillowUrl = `https://zillow.com/property/${trackingId}`;

        const values = [
            zillowUrl, // Added zillow_url as first parameter
            propertyData.property_address_full,
            agentInfo.city,
            agentInfo.state,
            agentInfo.zipcode,
            propertyData.property_value,
            agentInfo.name,
            agentEmail,
            agentInfo.phone,
            trackingId,
            propertyData.projected_revenue_top_25, // Using top 25% for annual revenue
            propertyData.projected_revenue_top_25 ? propertyData.projected_revenue_top_25 / 12 : null,
            {
                staystra_score: propertyData.staystra_score,
                score_note: propertyData.staystra_score_note,
                projected_revenue_typical: propertyData.projected_revenue_typical,
                projected_revenue_top_25: propertyData.projected_revenue_top_25
            },
            propertyData.created_at,
            staystraUrl
        ];

        const result = await pool.query(query, values);
        return { id: result.rows[0].id, trackingId, staystraUrl };
    }

    /**
     * Generate tracked URL
     */
    generateTrackedUrl(shareUrl, trackingId) {
        // Add tracking parameters directly to the share URL
        const url = new URL(shareUrl);
        url.searchParams.set('utm_source', 'str_outreach');
        url.searchParams.set('utm_medium', 'email');
        url.searchParams.set('utm_campaign', 'top_10_percent');
        url.searchParams.set('utm_content', trackingId);
        url.searchParams.set('tid', trackingId);
        
        // Return the direct URL with tracking parameters (no redirect for now)
        return url.toString();
    }

    /**
     * Send outreach email
     */
    async sendOutreachEmail(campaign) {
        const trackedUrl = this.generateTrackedUrl(campaign.staystra_share_url, campaign.tracking_id);
        
        // Override email address in test mode
        const recipientEmail = this.testMode ? this.testEmail : campaign.agent_email;
        
        // Extract first name from agent name
        const agentFirstName = campaign.agent_name ? campaign.agent_name.split(' ')[0] : 'there';
        
        // Format revenue as currency
        const formattedRevenue = campaign.estimated_annual_revenue 
            ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(campaign.estimated_annual_revenue)
            : '$XX,XXX';
        
        const emailContent = {
            to: recipientEmail,
            subject: `Investment Opportunity: ${campaign.property_address}`,
            tags: ['str-outreach', 'high-score-property', `score-${campaign.analysis_data.staystra_score}`],
            params: {
                property_address: campaign.property_address,
                agent_name: agentFirstName,
                revenue: formattedRevenue,
                tracking_id: campaign.tracking_id
            },
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                        .header { color: #2c3e50; margin-bottom: 20px; }
                        .highlight-box { 
                            background-color: #e8f4f8;
                            border-left: 4px solid #3498db;
                            padding: 15px;
                            margin: 20px 0;
                        }
                        .revenue { font-size: 24px; color: #27ae60; font-weight: bold; }
                        .cta-button { 
                            display: inline-block; 
                            padding: 15px 30px; 
                            background-color: #3498db; 
                            color: white; 
                            text-decoration: none; 
                            border-radius: 5px; 
                            margin: 20px 0;
                            font-size: 16px;
                        }
                        .benefits {
                            background-color: #f8f9fa;
                            padding: 20px;
                            border-radius: 8px;
                            margin: 20px 0;
                        }
                        .benefits h3 { color: #2c3e50; margin-top: 0; }
                        .benefits ul { margin: 10px 0; }
                        .footer { font-size: 12px; color: #666; margin-top: 30px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h2 class="header">Hi ${agentFirstName},</h2>
                        
                        <p>We analyzed hundreds of properties today, and your listing at <strong>${campaign.property_address}</strong> 
                        could make for a great short-term rental.</p>
                        
                        <p>We think it can earn around <span class="revenue" style="display: inline;">${formattedRevenue}</span> in gross rent annually.</p>
                        
                        <p>If you think a buyer would be interested in that, please check out the link below to our analysis, 
                        where you can print out a PDF to share with your buyers.</p>
                        
                        <div class="benefits">
                            <h3>What You Can Do With This Analysis:</h3>
                            <ul>
                                <li><strong>Print & Share</strong> - Use it in your marketing materials</li>
                                <li><strong>Show Buyers</strong> - Demonstrate the investment potential</li>
                                <li><strong>Stand Out</strong> - Differentiate your listing with data-driven insights</li>
                                <li><strong>Close Faster</strong> - Help investors make confident decisions</li>
                            </ul>
                        </div>
                        
                        <center>
                            <a href="${trackedUrl}" class="cta-button">View Full Analysis & Print Report</a>
                        </center>
                        
                        <p>The full report includes detailed revenue projections, occupancy rates, seasonal trends, 
                        and comparison to similar properties in the area.</p>
                        
                        <p>Best regards,<br>
                        The StaySTRA Team</p>
                        
                        <div class="footer">
                            <p>This analysis is based on comprehensive market data and comparable properties. 
                            StaySTRA is the trusted source for short-term rental investment analysis.</p>
                            ${this.testMode ? '<p style="color: red;"><strong>TEST MODE - Original recipient: ' + campaign.agent_email + '</strong></p>' : ''}
                            <img src="${this.baseUrl}/api/tracking/open/${campaign.tracking_id}" width="1" height="1" style="display:none;" />
                        </div>
                    </div>
                </body>
                </html>
            `,
            text: `Hi ${agentFirstName},

We analyzed hundreds of properties today, and your listing at ${campaign.property_address} could make for a great short-term rental.

We think it can earn around ${formattedRevenue} in gross rent annually.

If you think a buyer would be interested in that, please check out the link below to our analysis, where you can print out a PDF to share with your buyers.

What You Can Do With This Analysis:
- Print & Share - Use it in your marketing materials
- Show Buyers - Demonstrate the investment potential
- Stand Out - Differentiate your listing with data-driven insights
- Close Faster - Help investors make confident decisions

View the full analysis and print your report: ${trackedUrl}

The full report includes detailed revenue projections, occupancy rates, seasonal trends, and comparison to similar properties in the area.

Best regards,
The StaySTRA Team

${this.testMode ? 'TEST MODE - Original recipient: ' + campaign.agent_email : ''}`
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

            console.log(`Email sent to ${recipientEmail} (${this.testMode ? 'TEST MODE' : 'LIVE'})`);
            return result;
        } catch (error) {
            console.error(`Failed to send email to ${recipientEmail}:`, error);
            throw error;
        }
    }

    /**
     * Validate property metrics for sanity
     */
    validatePropertyMetrics(property) {
        const validationErrors = [];
        
        // Check cash on cash return
        if (property.cash_on_cash_return) {
            const cocReturn = parseFloat(property.cash_on_cash_return);
            if (cocReturn > 0.50) {
                validationErrors.push(`Cash on cash return too high: ${(cocReturn * 100).toFixed(1)}%`);
            }
            if (cocReturn <= 0.05) {
                validationErrors.push(`Cash on cash return too low: ${(cocReturn * 100).toFixed(1)}%`);
            }
        }
        
        // Check gross yield
        if (property.gross_yield) {
            const grossYield = parseFloat(property.gross_yield);
            if (grossYield > 0.30) {
                validationErrors.push(`Gross yield too high: ${(grossYield * 100).toFixed(1)}%`);
            }
            if (grossYield <= 0.05) {
                validationErrors.push(`Gross yield too low: ${(grossYield * 100).toFixed(1)}%`);
            }
        }
        
        // Check revenue to price ratio
        if (property.projected_revenue_typical && property.property_value) {
            const revenueToPriceRatio = property.projected_revenue_typical / property.property_value;
            if (revenueToPriceRatio > 0.50) {
                validationErrors.push(`Revenue to price ratio too high: ${(revenueToPriceRatio * 100).toFixed(1)}%`);
            }
        }
        
        // Check DSCR
        if (property.debt_service_coverage_ratio) {
            const dscr = parseFloat(property.debt_service_coverage_ratio);
            if (dscr > 5.0) {
                validationErrors.push(`DSCR too high: ${dscr.toFixed(2)}`);
            }
            if (dscr < 0.8) {
                validationErrors.push(`DSCR too low: ${dscr.toFixed(2)}`);
            }
        }
        
        // Check GRM
        if (property.gross_rent_multiplier) {
            const grm = parseFloat(property.gross_rent_multiplier);
            if (grm < 5) {
                validationErrors.push(`GRM too low: ${grm.toFixed(1)}`);
            }
            if (grm > 30) {
                validationErrors.push(`GRM too high: ${grm.toFixed(1)}`);
            }
        }
        
        return validationErrors;
    }

    /**
     * Process new high-scoring properties - main workflow
     */
    async processNewListings(limit = 10) {
        console.log('Starting STR outreach processing for high-scoring properties...');
        console.log(`Test Mode: ${this.testMode ? 'ON (emails will go to ' + this.testEmail + ')' : 'OFF'}`);
        
        // 1. Fetch high-scoring properties
        const properties = await this.fetchHighScoringProperties(limit);
        console.log(`Found ${properties.length} eligible properties to process`);

        const results = {
            processed: 0,
            sent: 0,
            failed: []
        };

        // 2. Process each property
        for (const property of properties) {
            try {
                console.log(`\nProcessing: ${property.property_address_full} (Score: ${property.staystra_score})`);
                
                // Validate property metrics
                const validationErrors = this.validatePropertyMetrics(property);
                if (validationErrors.length > 0) {
                    console.log('Property failed validation checks:');
                    validationErrors.forEach(error => console.log(`  - ${error}`));
                    results.failed.push({
                        address: property.property_address_full,
                        error: `Failed validation: ${validationErrors.join('; ')}`
                    });
                    continue;
                }
                
                // Log key metrics for transparency
                console.log('Property metrics:');
                console.log(`  - Property Value: $${property.property_value?.toLocaleString()}`);
                console.log(`  - Projected Revenue (typical): $${property.projected_revenue_typical?.toLocaleString()}`);
                console.log(`  - Cash on Cash Return: ${property.cash_on_cash_return ? (parseFloat(property.cash_on_cash_return) * 100).toFixed(1) + '%' : 'N/A'}`);
                console.log(`  - Gross Yield: ${property.gross_yield ? (parseFloat(property.gross_yield) * 100).toFixed(1) + '%' : 'N/A'}`);
                console.log(`  - DSCR: ${property.debt_service_coverage_ratio ? parseFloat(property.debt_service_coverage_ratio).toFixed(2) : 'N/A'}`);
                
                // 3. Extract agent info from Zillow data
                const agentInfo = this.extractAgentInfo(property.zillow_data);
                
                if (!agentInfo.name || !agentInfo.phone) {
                    console.log('No agent name or phone found in Zillow data, skipping...');
                    results.failed.push({
                        address: property.property_address_full,
                        error: 'Missing agent contact info'
                    });
                    continue;
                }

                console.log(`Agent: ${agentInfo.name} (${agentInfo.phone})`);

                // 4. Get agent email from Enformion
                const agentEmail = await this.getAgentEmail(agentInfo);
                
                if (agentEmail === 'RECENTLY_CONTACTED') {
                    console.log('Agent was contacted within the last 30 days, skipping...');
                    results.failed.push({
                        address: property.property_address_full,
                        error: 'Recently contacted (< 30 days)'
                    });
                    continue;
                }
                
                if (!agentEmail) {
                    console.log('Could not find agent email, skipping...');
                    results.failed.push({
                        address: property.property_address_full,
                        error: 'Email not found'
                    });
                    continue;
                }

                // 5. Save to database
                const { id, trackingId, staystraUrl } = await this.saveCampaign(property, agentInfo, agentEmail);
                
                // 6. Get the campaign data
                const pool = getPool();
                const campaign = await pool.query(
                    'SELECT * FROM str_outreach_campaigns WHERE id = $1',
                    [id]
                );

                // 7. Send email
                await this.sendOutreachEmail(campaign.rows[0]);
                
                // 8. Save contact to Brevo (non-blocking)
                this.saveContactToBrevo(campaign.rows[0], property).catch(err => {
                    console.error('Failed to save contact to Brevo:', err.message);
                });
                
                results.processed++;
                results.sent++;
                
                // Add delay between processing to avoid overwhelming systems
                await new Promise(resolve => setTimeout(resolve, 3000));
                
            } catch (error) {
                console.error(`Error processing property ${property.property_address_full}:`, error);
                results.failed.push({
                    address: property.property_address_full,
                    error: error.message
                });
            }
        }

        console.log('\nSTR outreach processing complete:', results);
        return results;
    }

    /**
     * Search Brevo contacts by phone number
     */
    async searchBrevoContactsByPhone(phone) {
        try {
            const brevoService = require('../brevoEmailService');
            
            // Try to find contact by phone in Brevo
            const contact = await brevoService.getContactByPhone(phone);
            
            if (contact && contact.email) {
                console.log(`Found contact in Brevo: ${contact.email}`);
                return [{
                    email: contact.email,
                    attributes: contact.attributes
                }];
            }
            
            return [];
            
        } catch (error) {
            console.error('Error searching Brevo contacts:', error);
            return [];
        }
    }

    /**
     * Save contact to Brevo CRM
     */
    async saveContactToBrevo(campaign, property) {
        try {
            const brevoService = require('../brevoEmailService');
            
            // Parse agent name
            const nameParts = campaign.agent_name ? campaign.agent_name.split(' ') : [''];
            const firstName = nameParts[0] || '';
            const lastName = nameParts.slice(1).join(' ') || '';
            
            // Create contact data
            const contactData = {
                email: campaign.agent_email,
                firstName: firstName,
                lastName: lastName,
                fullName: campaign.agent_name,
                phone: campaign.agent_phone,
                brokerage: property.zillow_data?.attributionInfo?.brokerName || '',
                city: campaign.city,
                state: campaign.state,
                propertyAddress: campaign.property_address,
                propertyValue: campaign.listing_price,
                estimatedRevenue: campaign.estimated_annual_revenue,
                staystraScore: property.staystra_score,
                lastStrOutreachDate: new Date().toISOString()
            };
            
            // Save to Brevo
            await brevoService.createOrUpdateContact(contactData);
            
            console.log(`Contact saved to Brevo CRM: ${campaign.agent_email}`);
        } catch (error) {
            console.error('Error saving contact to Brevo:', error);
            // Don't throw - this is non-critical
        }
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