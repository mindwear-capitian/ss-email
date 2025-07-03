const axios = require('axios');

class DuckDuckGoEmailFinder {
    constructor() {
        this.crawl4aiUrl = process.env.CRAWL4AI_URL || 'http://ss-crawl4ai:8080';
    }

    /**
     * Find agent email using DuckDuckGo searches (no CAPTCHA)
     */
    async findAgentEmail(listing) {
        const { agent_name, brokerage, property_address, city, state } = listing;
        
        console.log(`\nSearching for agent contact info:`);
        console.log(`Agent: ${agent_name || 'Unknown'}`);
        console.log(`Brokerage: ${brokerage || 'Unknown'}`);
        console.log(`Property: ${property_address}`);
        
        try {
            // Build search queries
            const searchQueries = this.buildSearchQueries(agent_name, brokerage, property_address, city, state);
            
            for (const query of searchQueries) {
                console.log(`\nSearching: "${query}"`);
                
                // Use DuckDuckGo HTML version (no JavaScript required)
                const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
                
                const results = await this.searchAndExtractEmails(searchUrl, query);
                
                if (results.emails.length > 0) {
                    console.log(`Found ${results.emails.length} emails`);
                    const bestEmail = this.selectBestEmail(results.emails, agent_name, brokerage);
                    if (bestEmail) {
                        console.log(`Selected: ${bestEmail}`);
                        return bestEmail;
                    }
                }
                
                // Check any promising URLs found
                if (results.urls.length > 0) {
                    console.log(`Checking ${results.urls.length} relevant URLs...`);
                    for (const url of results.urls.slice(0, 3)) {
                        const pageEmails = await this.crawlPageForEmails(url);
                        if (pageEmails.length > 0) {
                            const bestEmail = this.selectBestEmail(pageEmails, agent_name, brokerage);
                            if (bestEmail) {
                                console.log(`Found on ${url}: ${bestEmail}`);
                                return bestEmail;
                            }
                        }
                    }
                }
                
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
            
            console.log('No email found');
            return null;
            
        } catch (error) {
            console.error('Error in email search:', error.message);
            return null;
        }
    }
    
    /**
     * Build search queries
     */
    buildSearchQueries(agentName, brokerage, propertyAddress, city, state) {
        const queries = [];
        
        // Property-specific searches
        queries.push(`"${propertyAddress}" agent email`);
        
        if (brokerage) {
            // Brokerage + location
            queries.push(`${brokerage} ${city} ${state} agent email contact`);
            
            // Brokerage + property
            queries.push(`${brokerage} "${propertyAddress}"`);
        }
        
        if (agentName) {
            // Agent name searches
            queries.push(`"${agentName}" realtor ${city} ${state} email`);
            queries.push(`"${agentName}" ${brokerage} contact`);
        }
        
        return queries;
    }
    
    /**
     * Search and extract emails from results
     */
    async searchAndExtractEmails(searchUrl, query) {
        try {
            const response = await axios.post(`${this.crawl4aiUrl}/crawl`, {
                url: searchUrl,
                bypass_cache: true
            }, {
                timeout: 15000
            });
            
            if (!response.data.success) {
                return { emails: [], urls: [] };
            }
            
            const content = response.data.markdown || '';
            
            // Extract emails
            const emails = this.extractEmailsFromText(content);
            
            // Extract real estate related URLs from search results
            const urls = this.extractRelevantUrls(content);
            
            return { emails: [...new Set(emails)], urls };
            
        } catch (error) {
            console.error(`Search error: ${error.message}`);
            return { emails: [], urls: [] };
        }
    }
    
    /**
     * Crawl a specific page for emails
     */
    async crawlPageForEmails(url) {
        try {
            console.log(`  Checking: ${url}`);
            
            const response = await axios.post(`${this.crawl4aiUrl}/crawl`, {
                url: url,
                bypass_cache: true
            }, {
                timeout: 10000
            });
            
            if (!response.data.success) {
                return [];
            }
            
            const content = response.data.markdown || '';
            return this.extractEmailsFromText(content);
            
        } catch (error) {
            console.error(`  Failed to crawl ${url}: ${error.message}`);
            return [];
        }
    }
    
    /**
     * Extract email addresses from text
     */
    extractEmailsFromText(text) {
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const matches = text.match(emailRegex) || [];
        
        return matches.filter(email => {
            const lower = email.toLowerCase();
            return !lower.includes('example.com') &&
                   !lower.includes('@duckduckgo.') &&
                   !lower.includes('wikipedia') &&
                   !lower.startsWith('support@') &&
                   !lower.startsWith('info@') &&
                   !lower.startsWith('noreply@') &&
                   lower.length < 50; // Avoid false positives
        });
    }
    
    /**
     * Extract relevant URLs from search results
     */
    extractRelevantUrls(content) {
        // Look for result URLs in DuckDuckGo's format
        const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
        const matches = content.match(urlRegex) || [];
        
        return matches.filter(url => {
            const lower = url.toLowerCase();
            // Skip major listing sites and social media
            return !lower.includes('duckduckgo.com') &&
                   !lower.includes('zillow.com') &&
                   !lower.includes('realtor.com') &&
                   !lower.includes('trulia.com') &&
                   !lower.includes('redfin.com') &&
                   !lower.includes('facebook.com') &&
                   !lower.includes('twitter.com') &&
                   !lower.includes('linkedin.com') &&
                   !lower.includes('youtube.com') &&
                   !lower.includes('pinterest.com') &&
                   !lower.includes('instagram.com') &&
                   // Look for real estate related domains
                   (lower.includes('kw.com') ||
                    lower.includes('kellerwilliams') ||
                    lower.includes('remax') ||
                    lower.includes('coldwellbanker') ||
                    lower.includes('century21') ||
                    lower.includes('realty') ||
                    lower.includes('homes') ||
                    lower.includes('properties') ||
                    lower.includes(brokerage?.toLowerCase().replace(/\s+/g, '')) ||
                    lower.includes('.realtor'));
        }).slice(0, 5);
    }
    
    /**
     * Select the best email from candidates
     */
    selectBestEmail(emails, agentName, brokerage) {
        if (emails.length === 0) return null;
        if (emails.length === 1) return emails[0];
        
        const scoredEmails = emails.map(email => {
            let score = 0;
            const lower = email.toLowerCase();
            
            // Prefer professional domains
            if (!lower.includes('gmail.com') && 
                !lower.includes('yahoo.com') && 
                !lower.includes('hotmail.com')) {
                score += 3;
            }
            
            // Check for agent name parts
            if (agentName) {
                const nameParts = agentName.toLowerCase().split(' ');
                nameParts.forEach(part => {
                    if (part.length > 2 && lower.includes(part)) {
                        score += 2;
                    }
                });
            }
            
            // Check for brokerage match
            if (brokerage) {
                const brokerageWords = brokerage.toLowerCase()
                    .replace(/[^\w\s]/g, '')
                    .split(' ')
                    .filter(word => word.length > 3);
                
                brokerageWords.forEach(word => {
                    if (lower.includes(word)) {
                        score += 1;
                    }
                });
            }
            
            return { email, score };
        });
        
        scoredEmails.sort((a, b) => b.score - a.score);
        return scoredEmails[0].email;
    }
}

module.exports = new DuckDuckGoEmailFinder();