const { getPool } = require('./db');

class ApiUsageTracker {
    constructor() {
        this.pool = getPool();
    }

    async trackUsage({
        service,
        endpoint,
        method = 'GET',
        responseTime,
        statusCode,
        errorMessage = null,
        metadata = {},
        estimatedCost = 0
    }) {
        try {
            const query = `
                INSERT INTO api_usage_logs (
                    service, endpoint, method, response_time_ms,
                    status_code, error_message, metadata, estimated_cost,
                    container_source
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING id
            `;

            const values = [
                service,
                endpoint,
                method,
                responseTime,
                statusCode,
                errorMessage,
                JSON.stringify(metadata),
                estimatedCost,
                'ss-email'
            ];

            const result = await this.pool.query(query, values);
            return result.rows[0].id;
        } catch (error) {
            console.error('Failed to track API usage:', error);
            // Don't throw - we don't want tracking failures to break the app
        }
    }

    async trackOpenAI(endpoint, tokens, responseTime, statusCode, error = null) {
        // GPT-4o-mini pricing
        const inputCost = (tokens.prompt_tokens / 1000) * 0.00015;
        const outputCost = (tokens.completion_tokens / 1000) * 0.0006;
        const totalCost = inputCost + outputCost;

        return this.trackUsage({
            service: 'openai',
            endpoint,
            method: 'POST',
            responseTime,
            statusCode,
            errorMessage: error,
            metadata: {
                model: 'gpt-4o-mini',
                prompt_tokens: tokens.prompt_tokens,
                completion_tokens: tokens.completion_tokens,
                total_tokens: tokens.total_tokens
            },
            estimatedCost: totalCost
        });
    }

    async trackCrawl4AI(endpoint, url, responseTime, statusCode, error = null) {
        return this.trackUsage({
            service: 'crawl4ai',
            endpoint,
            method: 'POST',
            responseTime,
            statusCode,
            errorMessage: error,
            metadata: { url },
            estimatedCost: 0 // Internal service, no cost
        });
    }

    async trackWebSearch(service, query, resultsCount, responseTime, statusCode, error = null) {
        // Brave Search: 2000 free queries/month
        // Google Search: Variable pricing
        const estimatedCost = service === 'google' ? 0.005 : 0; // Google ~$5 per 1000 queries

        return this.trackUsage({
            service,
            endpoint: '/search',
            method: 'GET',
            responseTime,
            statusCode,
            errorMessage: error,
            metadata: { 
                query,
                results_count: resultsCount
            },
            estimatedCost
        });
    }

    async trackEmail(action, campaign_id, contact_id, responseTime, statusCode, error = null) {
        // Track internal email operations (no external cost for now)
        return this.trackUsage({
            service: 'email',
            endpoint: `/email/${action}`,
            method: 'POST',
            responseTime,
            statusCode,
            errorMessage: error,
            metadata: { 
                campaign_id,
                contact_id,
                action
            },
            estimatedCost: 0
        });
    }

    // Get usage statistics
    async getUsageStats(service, hours = 24) {
        try {
            const query = `
                SELECT 
                    COUNT(*) as total_calls,
                    COUNT(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 END) as successful_calls,
                    COUNT(CASE WHEN status_code >= 400 THEN 1 END) as failed_calls,
                    AVG(response_time_ms)::numeric(10,2) as avg_response_time,
                    SUM(estimated_cost)::numeric(10,4) as total_cost
                FROM api_usage_logs
                WHERE service = $1
                AND created_at > NOW() - INTERVAL '${hours} hours'
                AND container_source = 'ss-email'
            `;

            const result = await this.pool.query(query, [service]);
            return result.rows[0];
        } catch (error) {
            console.error('Failed to get usage stats:', error);
            return null;
        }
    }
}

module.exports = new ApiUsageTracker();