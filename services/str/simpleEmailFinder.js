const axios = require('axios');

class SimpleEmailFinder {
    constructor() {
        this.crawl4aiUrl = process.env.CRAWL4AI_URL || 'http://ss-crawl4ai:8080';
    }

    /**
     * Find agent email using basic web scraping
     */
    async findAgentEmail(brokerName, agentName = null) {
        console.log(`Searching for email - Broker: ${brokerName}, Agent: ${agentName || 'Unknown'}`);
        
        try {
            // Try to scrape broker website directly
            const brokerWebsites = this.guessBrokerWebsites(brokerName);
            
            for (const website of brokerWebsites) {
                const email = await this.scrapeWebsiteForEmail(website, agentName);
                if (email) {
                    console.log(`Found email on ${website}: ${email}`);
                    return email;
                }
            }
            
            console.log('No email found');
            return null;
            
        } catch (error) {
            console.error('Error finding email:', error.message);
            return null;
        }
    }
    
    /**
     * Guess common broker website patterns
     */
    guessBrokerWebsites(brokerName) {
        const cleanName = brokerName.toLowerCase()
            .replace(/[^\w\s]/g, '')
            .replace(/\s+/g, '');
        
        const domains = [];
        
        // Common patterns for real estate websites
        const patterns = [
            `https://www.${cleanName}.com`,
            `https://${cleanName}.com`,
            `https://www.${cleanName}realty.com`,
            `https://www.${cleanName}re.com`
        ];
        
        // Special cases for known brokers
        if (brokerName.includes('KELLER WILLIAMS')) {
            domains.push('https://www.kw.com');
            const location = brokerName.replace('KELLER WILLIAMS', '').trim().toLowerCase().replace(/\s+/g, '');
            if (location) {
                domains.push(`https://www.kw.com/offices/${location}`);
            }
        } else if (brokerName.includes('RE/MAX')) {
            domains.push('https://www.remax.com');
        } else if (brokerName.includes('COLDWELL BANKER')) {
            domains.push('https://www.coldwellbanker.com');
        } else if (brokerName.includes('CENTURY 21')) {
            domains.push('https://www.century21.com');
        }
        
        return [...domains, ...patterns];
    }
    
    /**
     * Scrape a website for email addresses
     */
    async scrapeWebsiteForEmail(url, agentName = null) {
        try {
            console.log(`Scraping ${url}...`);
            
            // Use Crawl4AI basic crawl to get the page content
            const response = await axios.post(`${this.crawl4aiUrl}/crawl`, {
                url: url,
                bypass_cache: true
            }, {
                timeout: 10000 // 10 second timeout
            });
            
            if (!response.data.success) {
                return null;
            }
            
            // Extract emails from markdown content
            const content = response.data.markdown || '';
            const emails = this.extractEmailsFromText(content);
            
            if (emails.length > 0) {
                // If we have an agent name, try to find their specific email
                if (agentName) {
                    const agentEmail = this.findAgentSpecificEmail(emails, agentName, content);
                    if (agentEmail) return agentEmail;
                }
                
                // Return the first professional-looking email
                const professionalEmail = emails.find(email => 
                    !email.includes('gmail.com') && 
                    !email.includes('yahoo.com') && 
                    !email.includes('hotmail.com')
                );
                
                return professionalEmail || emails[0];
            }
            
            return null;
            
        } catch (error) {
            console.error(`Error scraping ${url}:`, error.message);
            return null;
        }
    }
    
    /**
     * Extract all email addresses from text
     */
    extractEmailsFromText(text) {
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const matches = text.match(emailRegex) || [];
        
        // Filter out common non-email patterns
        return matches.filter(email => 
            !email.includes('example.com') &&
            !email.startsWith('support@') &&
            !email.startsWith('info@') &&
            !email.startsWith('noreply@')
        );
    }
    
    /**
     * Try to find an email specific to the agent
     */
    findAgentSpecificEmail(emails, agentName, content) {
        const nameParts = agentName.toLowerCase().split(' ');
        
        // Look for emails that contain parts of the agent's name
        for (const email of emails) {
            const emailLower = email.toLowerCase();
            if (nameParts.some(part => emailLower.includes(part))) {
                return email;
            }
        }
        
        // Look for email near the agent's name in content
        const agentSection = this.findAgentSection(content, agentName);
        if (agentSection) {
            const sectionEmails = this.extractEmailsFromText(agentSection);
            if (sectionEmails.length > 0) {
                return sectionEmails[0];
            }
        }
        
        return null;
    }
    
    /**
     * Find section of content near agent name
     */
    findAgentSection(content, agentName) {
        const nameIndex = content.toLowerCase().indexOf(agentName.toLowerCase());
        if (nameIndex === -1) return null;
        
        // Extract 500 characters before and after the name
        const start = Math.max(0, nameIndex - 500);
        const end = Math.min(content.length, nameIndex + agentName.length + 500);
        
        return content.substring(start, end);
    }
}

module.exports = new SimpleEmailFinder();