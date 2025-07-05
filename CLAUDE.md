# SS-Email Service Guidelines for Claude

## Overview
The SS-Email service is a dedicated microservice for email automation, outreach campaigns, and engagement tracking. It runs as part of the Staystra unified stack.

## Service Architecture
- **Container**: `staystra-ss-email`
- **Port**: 3004 (internal only, localhost for development)
- **External URL**: None (internal-only service)
- **Internal Access**: http://ss-email:3004
- **Framework**: Node.js with Express
- **Email Provider**: Brevo (formerly Sendinblue)

## Key Features

### 1. Email Sending
- SMTP configuration via Brevo
- Support for HTML and plain text emails
- Attachment support
- Email validation

### 2. STR Outreach System (NEW - July 2025)
Automated system for reaching out to real estate agents with new STR listings:
- Fetches listings from Zillow via Apify
- Analyzes properties using StaySTRA analyzer
- Sends personalized emails with revenue projections
- Tracks email opens and link clicks
- **Status**: Pending share link functionality on analyzer page

### 3. Contact Management (Planned)
- Store and manage email contacts
- Segmentation and tagging
- Import/export functionality

### 4. Campaign Management (Planned)
- Create and manage email campaigns
- Template system
- A/B testing
- Scheduling

## Database Schema

### STR Outreach Tables
```sql
-- Main campaign tracking
str_outreach_campaigns
- Zillow listing data
- Agent information
- Analysis results
- Email tracking metrics

-- Event tracking
str_email_events
- Email opens
- Link clicks
- Bounce/unsubscribe events
```

## API Endpoints

### Test Endpoints
- `GET /api/test/verify` - Verify SMTP connection
- `POST /api/test/send` - Send test email
- `GET /api/test/config` - View email configuration

### STR Outreach Endpoints
- `POST /api/str-outreach/run` - Manually trigger outreach
- `GET /api/str-outreach/status` - Job status
- `GET /api/str-outreach/stats` - Campaign statistics
- `GET /api/str-outreach/campaign/:trackingId` - Campaign details

### Tracking Endpoints (No rate limiting)
- `GET /api/tracking/open/:trackingId` - Email open tracking
- `GET /api/tracking/click/:trackingId` - Click tracking with redirect

## Environment Variables
```bash
# Email Configuration
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=90f786001@smtp-brevo.com
SMTP_PASSWORD=<brevo_smtp_key>
SMTP_FROM_ADDRESS=datacollection@staystra.com

# External Services
APIFY_TOKEN=<pending>
CRAWL4AI_URL=http://ss-crawl4ai:8000
OPENAI_API_KEY=<from_main_env>

# Database (inherited from docker-compose)
DB_HOST=ss-postgres
DB_PORT=5432
DB_NAME=staystra
DB_USER=staystra
DB_PASSWORD=<from_env>
```

## Development Workflow

### Making Changes
1. Edit code in `/srv/staystra/ss-email/`
2. Rebuild container: `docker compose -f docker-compose.unified.yml up -d ss-email --build`
3. Check logs: `docker compose -f docker-compose.unified.yml logs ss-email -f`

### Testing
```bash
# Test SMTP connection
curl http://localhost:3004/api/test/verify | jq

# Send test email
curl -X POST http://localhost:3004/api/test/send \
  -H "Content-Type: application/json" \
  -d '{"to": "test@example.com"}' | jq

# Check STR outreach stats
curl http://localhost:3004/api/str-outreach/stats | jq
```

## Cron Jobs
- **STR Outreach**: Daily at 9:00 AM (America/New_York)
  - Fetches new STR listings
  - Runs analysis
  - Sends emails
  - Configurable limit (default 10 per run)

## Dependencies
### Core
- express, helmet, cors, compression
- pg (PostgreSQL client)
- nodemailer (Email sending)
- express-rate-limit

### STR Outreach
- puppeteer (Web automation)
- apify-client (Zillow data)
- node-cron (Scheduling)
- uuid (Tracking IDs)

## Security Notes
- Rate limiting: 100 requests per 15 minutes on /api routes
- No rate limiting on tracking endpoints (by design)
- Helmet.js for security headers
- Input validation with Joi
- Non-root user in container

## Troubleshooting

### Email Not Sending
1. Check SMTP credentials
2. Verify Brevo account status
3. Check daily sending limits (300 free)
4. Review logs for authentication errors

### Database Connection Issues
- Password special characters are handled
- Uses individual connection parameters (not connection string)
- Connection pool with 20 max clients

### Puppeteer Issues
- Chromium is installed in Alpine container
- Runs with --no-sandbox flag
- Headless mode enabled

## Future Enhancements
1. Complete contact management system
2. Campaign templates and scheduling
3. Webhook processing for email events
4. Email discovery using Crawl4AI
5. Integration with CRM systems
6. Advanced analytics dashboard

## Git Repository
- **URL**: https://github.com/mindwear-capitian/ss-email.git
- **Branch**: main
- **Last Updated**: 2025-07-01

## Important Notes
- Email sending works perfectly with Brevo
- STR outreach system is built but waiting for analyzer share links
- Database migrations must be run manually
- Container must be rebuilt when adding npm packages
- All tracking is done via unique tracking IDs