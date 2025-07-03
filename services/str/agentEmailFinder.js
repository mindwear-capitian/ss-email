const axios = require('axios');

class AgentEmailFinder {
    constructor() {
        this.crawl4aiUrl = process.env.CRAWL4AI_URL || 'http://ss-crawl4ai:8000';
        this.openaiKey = process.env.OPENAI_API_KEY;
    }

    /**
     * Search for agent email using broker name and agent name
     */
    async findAgentEmail(brokerName, agentName = null) {
        console.log(`Searching for email - Broker: ${brokerName}, Agent: ${agentName || 'Unknown'}`);
        
        try {
            // Build search query
            const searchQuery = this.buildSearchQuery(brokerName, agentName);
            
            // Try multiple search strategies
            const strategies = [
                () => this.searchBrokerWebsite(brokerName, agentName),
                () => this.searchGoogleForAgent(searchQuery),
                () => this.searchBrokerageDirectory(brokerName, agentName)
            ];
            
            for (const strategy of strategies) {
                const email = await strategy();
                if (email && this.isValidEmail(email)) {
                    console.log(`Found email: ${email}`);
                    return email;
                }
            }
            
            console.log('No email found');
            return null;
            
        } catch (error) {
            console.error('Error finding agent email:', error.message);
            return null;
        }
    }
    
    /**
     * Build search query for finding agent info
     */
    buildSearchQuery(brokerName, agentName) {
        const parts = [];
        
        if (agentName) {
            parts.push(`"${agentName}"`);
        }
        
        parts.push(brokerName);
        parts.push('realtor agent email contact');
        
        return parts.join(' ');
    }
    
    /**
     * Search broker's website directly
     */
    async searchBrokerWebsite(brokerName, agentName) {
        // First, try to find the broker's website
        const brokerDomain = await this.findBrokerDomain(brokerName);
        if (!brokerDomain) return null;
        
        console.log(`Searching broker website: ${brokerDomain}`);
        
        // Construct likely agent page URLs
        const urlPatterns = [
            `${brokerDomain}/agents`,
            `${brokerDomain}/our-team`,
            `${brokerDomain}/team`,
            `${brokerDomain}/agents/${this.slugify(agentName)}`,
            `${brokerDomain}/agent/${this.slugify(agentName)}`
        ];
        
        for (const url of urlPatterns) {
            try {
                const email = await this.extractEmailFromUrl(url, agentName);
                if (email) return email;
            } catch (error) {
                // Continue to next URL
            }
        }
        
        return null;
    }
    
    /**
     * Find broker's domain using search
     */
    async findBrokerDomain(brokerName) {
        try {
            // Use Google search to find broker website
            const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(brokerName + ' real estate website')}`;
            
            const response = await axios.post(`${this.crawl4aiUrl}/extract/llm`, {
                url: searchUrl,
                provider: 'openai',
                api_key: this.openaiKey,
                instruction: `Find the official website URL for the real estate brokerage "${brokerName}". 
                             Return ONLY the domain (e.g., https://example.com) without any explanation.
                             If no website found, return "null".`,
                bypass_cache: true
            });
            
            // Handle both possible response formats
            const content = response.data?.content || response.data?.extracted_content;
            const domain = content?.trim();
            if (domain && domain !== 'null' && domain.startsWith('http')) {
                return domain;
            }
        } catch (error) {
            console.error('Error finding broker domain:', error.message);
        }
        
        return null;
    }
    
    /**
     * Search Google for agent information
     */
    async searchGoogleForAgent(searchQuery) {
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;
        
        try {
            const response = await axios.post(`${this.crawl4aiUrl}/extract/llm`, {
                url: searchUrl,
                provider: 'openai',
                api_key: this.openaiKey,
                instruction: `Extract any email addresses found in the search results that likely belong to a real estate agent.
                             Focus on professional email addresses (not gmail, yahoo, etc unless clearly associated with the agent).
                             Return ONLY the email address if found, or "null" if not found.
                             Do not include any explanation or additional text.`,
                bypass_cache: true
            });
            
            // Handle both possible response formats
            const content = response.data?.content || response.data?.extracted_content;
            const email = content?.trim();
            if (email && email !== 'null' && this.isValidEmail(email)) {
                return email;
            }
        } catch (error) {
            console.error('Error searching Google:', error.message);
        }
        
        return null;
    }
    
    /**
     * Search brokerage directory sites
     */
    async searchBrokerageDirectory(brokerName, agentName) {
        // Common real estate directory sites
        const directories = [
            'realtor.com',
            'zillow.com/professionals',
            'trulia.com/real_estate_agents'
        ];
        
        for (const directory of directories) {
            const searchUrl = `https://www.${directory}/search?q=${encodeURIComponent(brokerName + ' ' + (agentName || ''))}`;
            
            try {
                const email = await this.extractEmailFromUrl(searchUrl, agentName);
                if (email) return email;
            } catch (error) {
                // Continue to next directory
            }
        }
        
        return null;
    }
    
    /**
     * Extract email from a specific URL
     */
    async extractEmailFromUrl(url, agentName = null) {
        try {
            console.log(`Extracting from: ${url}`);
            
            const instruction = agentName 
                ? `Find the email address for real estate agent "${agentName}". Return ONLY the email address, or "null" if not found.`
                : `Find any real estate agent email addresses on this page. Return ONLY the first valid email address, or "null" if not found.`;
            
            const response = await axios.post(`${this.crawl4aiUrl}/extract/llm`, {
                url: url,
                provider: 'openai',
                api_key: this.openaiKey,
                instruction: instruction,
                bypass_cache: true
            });
            
            // Handle both possible response formats
            const content = response.data?.content || response.data?.extracted_content;
            const email = content?.trim();
            if (email && email !== 'null' && this.isValidEmail(email)) {
                return email;
            }
        } catch (error) {
            console.error(`Error extracting from ${url}:`, error.message);
        }
        
        return null;
    }
    
    /**
     * Validate email format
     */
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }
    
    /**
     * Convert name to URL slug
     */
    slugify(text) {
        if (!text) return '';
        return text.toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .replace(/[\s_-]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }
}

module.exports = new AgentEmailFinder();