const axios = require('axios');

class WebSearchEmailFinder {
    constructor() {
        this.crawl4aiUrl = process.env.CRAWL4AI_URL || 'http://ss-crawl4ai:8080';
    }

    /**
     * Find agent email using targeted web searches
     */
    async findAgentEmail(listing) {
        const { agent_name, brokerage, property_address, city, state } = listing;
        
        console.log(`\nSearching for agent contact info:`);
        console.log(`Agent: ${agent_name || 'Unknown'}`);
        console.log(`Brokerage: ${brokerage || 'Unknown'}`);
        console.log(`Property: ${property_address}`);
        
        try {
            // Build different search queries
            const searchQueries = this.buildSearchQueries(agent_name, brokerage, property_address, city, state);
            
            // Try each search query
            for (const query of searchQueries) {
                console.log(`\nTrying search: "${query}"`);
                const results = await this.searchAndExtractEmails(query);
                
                if (results.emails.length > 0) {
                    console.log(`Found ${results.emails.length} emails`);
                    
                    // Return the most likely agent email
                    const bestEmail = this.selectBestEmail(results.emails, agent_name, brokerage);
                    if (bestEmail) {
                        console.log(`Selected: ${bestEmail}`);
                        return bestEmail;
                    }
                }
                
                // Add delay between searches to be respectful
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            console.log('No email found');
            return null;
            
        } catch (error) {
            console.error('Error in email search:', error.message);
            return null;
        }
    }
    
    /**
     * Build targeted search queries
     */
    buildSearchQueries(agentName, brokerage, propertyAddress, city, state) {
        const queries = [];
        
        // If we have agent name
        if (agentName) {
            // Simple realtor search
            queries.push(`realtor ${agentName} ${city} ${state}`);
            
            // Agent + property address
            queries.push(`realtor ${agentName} "${propertyAddress}"`);
            
            // Agent + brokerage
            if (brokerage) {
                queries.push(`${agentName} ${brokerage} email contact`);
            }
        }
        
        // If we only have brokerage and property
        if (brokerage && propertyAddress) {
            queries.push(`${brokerage} agent "${propertyAddress}"`);
            queries.push(`${brokerage} listing "${propertyAddress}" contact`);
        }
        
        // Property-specific searches
        queries.push(`"${propertyAddress}" listing agent contact`);
        queries.push(`"${propertyAddress}" for sale agent email`);
        
        return queries;
    }
    
    /**
     * Search Google and extract emails from results
     */
    async searchAndExtractEmails(query) {
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        
        try {
            // Basic crawl to get search results
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
            
            // Extract emails from content
            const emails = this.extractEmailsFromText(content);
            
            // Extract URLs that might be agent/broker pages
            const urls = this.extractRelevantUrls(content);
            
            // If we found URLs but no emails, crawl the URLs
            if (emails.length === 0 && urls.length > 0) {
                for (const url of urls.slice(0, 3)) { // Check first 3 URLs only
                    const pageEmails = await this.crawlPageForEmails(url);
                    emails.push(...pageEmails);
                }
            }
            
            return { emails: [...new Set(emails)], urls }; // Remove duplicates
            
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
        
        // Filter out common non-agent emails
        return matches.filter(email => {
            const lower = email.toLowerCase();
            return !lower.includes('example.com') &&
                   !lower.includes('@google.') &&
                   !lower.includes('@bing.') &&
                   !lower.includes('wikipedia') &&
                   !lower.startsWith('support@') &&
                   !lower.startsWith('info@') &&
                   !lower.startsWith('admin@') &&
                   !lower.startsWith('webmaster@') &&
                   !lower.startsWith('noreply@') &&
                   !lower.includes('privacy@') &&
                   !lower.includes('legal@');
        });
    }
    
    /**
     * Extract URLs that might be agent/broker pages
     */
    extractRelevantUrls(content) {
        const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
        const matches = content.match(urlRegex) || [];
        
        // Filter for relevant real estate URLs
        return matches.filter(url => {
            const lower = url.toLowerCase();
            return !lower.includes('google.com') &&
                   !lower.includes('bing.com') &&
                   !lower.includes('zillow.com') &&
                   !lower.includes('realtor.com') &&
                   !lower.includes('trulia.com') &&
                   !lower.includes('redfin.com') &&
                   !lower.includes('youtube.com') &&
                   !lower.includes('facebook.com') &&
                   !lower.includes('twitter.com') &&
                   !lower.includes('linkedin.com') &&
                   !lower.includes('wikipedia') &&
                   (lower.includes('real') || 
                    lower.includes('estate') || 
                    lower.includes('homes') ||
                    lower.includes('agent') ||
                    lower.includes('broker') ||
                    lower.includes('realty'));
        }).slice(0, 5); // Limit to 5 URLs
    }
    
    /**
     * Select the best email from candidates
     */
    selectBestEmail(emails, agentName, brokerage) {
        if (emails.length === 0) return null;
        if (emails.length === 1) return emails[0];
        
        // Score each email
        const scoredEmails = emails.map(email => {
            let score = 0;
            const lower = email.toLowerCase();
            
            // Prefer professional domains
            if (!lower.includes('gmail.com') && 
                !lower.includes('yahoo.com') && 
                !lower.includes('hotmail.com') &&
                !lower.includes('outlook.com')) {
                score += 3;
            }
            
            // Check if email contains agent name parts
            if (agentName) {
                const nameParts = agentName.toLowerCase().split(' ');
                nameParts.forEach(part => {
                    if (part.length > 2 && lower.includes(part)) {
                        score += 2;
                    }
                });
            }
            
            // Check if email domain matches brokerage
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
        
        // Sort by score and return the best
        scoredEmails.sort((a, b) => b.score - a.score);
        return scoredEmails[0].email;
    }
}

module.exports = new WebSearchEmailFinder();