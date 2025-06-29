# SS-Email Service Guidelines for Claude

## Overview
The ss-email service is designed for automated email outreach to realtors who have Short Term Rental (STR) properties for sale. This container handles contact discovery, email campaign management, and inquiry processing while maintaining compliance with email regulations.

## Architecture Decisions

### Why This Architecture?

1. **Separate Container**: Following the microservices pattern established in Staystra, email functionality is isolated in its own container to:
   - Maintain clear separation of concerns
   - Enable independent scaling of email operations
   - Isolate email-specific dependencies (SMTP, email validation, etc.)
   - Prevent email service issues from affecting core API functionality

2. **Node.js/Express**: Chosen for consistency with other services (ss-api, ss-cron) and because:
   - Excellent async handling for email operations
   - Rich ecosystem of email-related packages
   - Shared utilities and patterns with existing services
   - Team familiarity with the stack

3. **Database Design**: 
   - **Normalized schema**: Separate tables for contacts, campaigns, sends, and interactions
   - **Tracking at every level**: From campaign performance to individual email interactions
   - **Compliance-first**: Built-in opt-out tracking and bounce management
   - **Audit trail**: Complete history of all email activities

4. **No Email Sending Yet**: Per requirements, the infrastructure is built but actual email sending is not implemented. This allows for:
   - Testing the infrastructure without spam risks
   - Configuring email authentication (SPF, DKIM, DMARC) properly
   - Setting up email service provider relationships
   - Implementing proper warm-up procedures

## Service Components

### 1. Contact Management (`/api/contacts`)
- CRUD operations for realtor contacts
- Duplicate detection by email
- Area association for geographic targeting
- Opt-out status tracking

### 2. Campaign Management (`/api/campaigns`)
- Template-based email creation
- Target criteria using JSONB for flexible filtering
- Campaign lifecycle management (draft → active → completed)
- Performance metrics tracking

### 3. Contact Discovery (`/api/discovery`)
- Integration with Crawl4AI for web scraping
- Search engine integration for finding realtor emails
- Batch processing with job tracking
- Source attribution for compliance

### 4. Webhook Processing (`/api/webhooks`)
- Email event handling (opens, clicks, bounces)
- Reply processing for inquiries
- Unsubscribe handling
- Spam complaint management

## External Integrations

### Email Server (Bluehost SMTP)
- Configuration via environment variables
- Supports SSL/TLS encryption
- Authentication with username/password
- Will require proper DNS setup (SPF, DKIM, DMARC)

### Crawl4AI Integration
- Internal service communication: `http://ss-crawl4ai:8000`
- Used for discovering realtor contact information
- Intelligent extraction with LLM support
- Rate-limited to respect target websites

### OpenAI Integration
- For generating personalized email content
- Template variable replacement
- A/B testing variations
- Cost tracked via api_usage_logs

## Database Tables

### Core Tables
1. **realtor_contacts**: Master contact list with verification status
2. **email_campaigns**: Campaign definitions and aggregate metrics
3. **email_sends**: Individual email tracking with unique IDs
4. **email_interactions**: Granular event tracking
5. **property_inquiries**: Realtor responses and interests
6. **contact_discovery_jobs**: Web scraping job management

### Key Design Decisions
- **UUID tracking IDs**: For secure, unguessable email tracking
- **JSONB fields**: For flexible data storage (criteria, property data)
- **Soft deletes**: Via opted_out flag rather than hard deletion
- **Comprehensive indexes**: For query performance

## Security & Compliance

### Email Best Practices
- **Rate limiting**: Built into API endpoints
- **Bounce handling**: Tracks hard/soft bounces separately
- **Opt-out mechanism**: Required for CAN-SPAM compliance
- **Source tracking**: Know where each contact came from

### Data Protection
- No email credentials in code
- Environment variable configuration
- Encrypted SMTP connections
- Audit trail for all operations

## Development Workflow

### Building the Container
```bash
cd /srv/staystra
docker compose -f docker-compose.unified.yml build ss-email
```

### Starting the Service
```bash
docker compose -f docker-compose.unified.yml up -d ss-email
```

### Checking Logs
```bash
docker compose -f docker-compose.unified.yml logs -f ss-email
```

### Running Migrations
```bash
docker exec -i staystra-ss-postgres psql -U staystra -d staystra < /srv/staystra/migrations/014_create_email_tables.sql
```

### Testing
```bash
# Health check
curl http://localhost:3003/health

# API endpoints (placeholders for now)
curl http://localhost:3003/api/contacts
```

## Future Implementation Notes

### Before Sending Emails
1. **Configure DNS**: Set up SPF, DKIM, and DMARC records
2. **Warm-up IP**: Start with low volume, gradually increase
3. **List validation**: Verify emails before first send
4. **Templates**: Create lawyer-approved email templates
5. **Tracking pixels**: Implement open tracking responsibly

### Email Sending Implementation
When ready to implement actual sending:
1. Add nodemailer or similar SMTP library
2. Implement queue processing with Bull/Redis
3. Add retry logic with exponential backoff
4. Set up webhook endpoints for ESP callbacks
5. Implement double opt-in for new contacts

### Monitoring
- Add email metrics to main dashboard
- Monitor bounce rates (keep under 2%)
- Track spam complaints (keep under 0.1%)
- Alert on delivery issues
- Regular list hygiene

## Git Repository
- **Repository**: `https://github.com/mindwear-capitian/ss-email.git`
- **Branch**: `main`
- **Commit changes**: Only to `/srv/staystra/ss-email/` directory

## Common Commands
```bash
# Rebuild after code changes
docker compose -f docker-compose.unified.yml down ss-email
docker compose -f docker-compose.unified.yml up -d ss-email --build

# Enter container shell
docker compose -f docker-compose.unified.yml exec ss-email sh

# View real-time logs
docker compose -f docker-compose.unified.yml logs -f ss-email

# Run database migrations
docker exec -i staystra-ss-postgres psql -U staystra -d staystra < migrations/014_create_email_tables.sql
```

## Important Notes
- Email sending is NOT implemented (as requested)
- All endpoints return placeholder responses
- Database schema is ready for production use
- External service integrations are configured but not active
- Follow email best practices when implementing sending
- Always test with small batches first
- Monitor reputation metrics closely