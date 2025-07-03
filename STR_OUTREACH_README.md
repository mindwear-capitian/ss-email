# STR Outreach System Documentation

## Overview
The STR (Short-Term Rental) Outreach System is an automated email marketing system designed to:
1. Find new STR listings on Zillow via Apify
2. Analyze each property using StaySTRA's analyzer tool
3. Send personalized emails to listing agents with revenue projections
4. Track email engagement (opens, clicks)
5. Drive traffic back to the StaySTRA website

## Current Status (As of 2025-07-01)
- ✅ Database schema created and migrated
- ✅ Core service logic implemented
- ✅ Email tracking system built
- ✅ API endpoints created
- ✅ Cron job scheduled (9 AM daily)
- ⏳ **PENDING**: Share link functionality on analyzer page
- ⏳ **PENDING**: Apify actor configuration
- ⏳ **PENDING**: CSS selector updates for analyzer page

## System Architecture

### Database Tables
1. **str_outreach_campaigns** - Main campaign tracking
   - Zillow listing data
   - Agent contact information
   - Analysis results
   - Email tracking metrics

2. **str_email_events** - Detailed event tracking
   - Email opens
   - Link clicks
   - IP addresses and user agents

### Key Files
```
ss-email/
├── services/str/
│   └── strOutreachService.js    # Core business logic
├── routes/
│   ├── strOutreach.js           # API endpoints
│   └── tracking/
│       └── index.js             # Tracking endpoints
├── jobs/
│   └── strOutreachJob.js        # Cron job wrapper
└── STR_OUTREACH_README.md       # This file
```

## API Endpoints

### Campaign Management
- `POST /api/str-outreach/run` - Manually trigger processing
  ```bash
  curl -X POST http://localhost:3004/api/str-outreach/run \
    -H "Content-Type: application/json" \
    -d '{"limit": 10}'
  ```

- `GET /api/str-outreach/status` - Check job status
- `GET /api/str-outreach/stats` - View campaign statistics
- `GET /api/str-outreach/campaign/:trackingId` - Get campaign details

### Tracking
- `GET /api/tracking/open/:trackingId` - Email open pixel
- `GET /api/tracking/click/:trackingId` - Click tracking & redirect

## Configuration Required

### 1. Apify Setup
Add to `.env`:
```
APIFY_TOKEN=your_apify_api_token_here
```

Update in `strOutreachService.js` line 32:
```javascript
const run = await this.apifyClient.actor('YOUR_ACTOR_ID').call(input);
```

### 2. Docker Compose
Add to `docker-compose.unified.yml` under ss-email environment:
```yaml
APIFY_TOKEN: ${APIFY_TOKEN}
```

### 3. Analyzer Page Selectors
Update selectors in `strOutreachService.js` (lines 79-131) to match actual page:
```javascript
// Current placeholders that need updating:
- 'input[type="text"]' - Address input field
- '.analysis-results' - Results container
- '.share-button' - Share button (DOES NOT EXIST YET)
- '.share-url-input' - Share URL input (DOES NOT EXIST YET)
- '.annual-revenue' - Annual revenue display
- '.monthly-revenue' - Monthly revenue display
- '.occupancy-rate' - Occupancy percentage
- '.daily-rate' - Daily rate
- '.property-grade' - Property grade
```

## Email Template
The system sends a personalized email with:
- Agent's name
- Property address
- Estimated annual revenue
- Call-to-action button
- Tracking pixel for opens
- Tracked link for clicks

## Workflow Process
1. **Fetch Listings** - Get new STR listings from Zillow via Apify
2. **Filter** - Only process listings with agent emails
3. **Analyze** - Run each address through StaySTRA analyzer
4. **Extract Data** - Get revenue projections and share link
5. **Save** - Store campaign data in database
6. **Send Email** - Send personalized email via Brevo
7. **Track** - Monitor opens and clicks

## Testing the System

### Check Database Tables
```sql
-- Connect to database
docker exec -it staystra-ss-postgres psql -U staystra -d staystra

-- View campaigns
SELECT * FROM str_outreach_campaigns;

-- View events
SELECT * FROM str_email_events;
```

### Manual Test Run
```bash
# Check system status
curl http://localhost:3004/api/str-outreach/status | jq

# View statistics
curl http://localhost:3004/api/str-outreach/stats | jq

# Run manually (after configuration)
curl -X POST http://localhost:3004/api/str-outreach/run \
  -H "Content-Type: application/json" \
  -d '{"limit": 1}' | jq
```

## Known Issues & TODOs

### Critical Blockers (As of 2025-07-03)
1. **No Agent Data from Zillow** - Zillow doesn't provide agent names/emails in their public data
   - Without agent names, email discovery is nearly impossible
   - Affects 100% of listings - system will skip all properties
   - See APIFY_INTEGRATION_STATUS.md for details

### High Priority (Original Issues)
1. **Share Link Missing** - The analyzer page doesn't have share functionality yet
2. **Apify Actor** - ✅ COMPLETED - Using maxcopell~zillow-scraper
3. **CSS Selectors** - Need to update selectors to match actual analyzer page

### Future Enhancements
1. Add unsubscribe functionality
2. Implement follow-up email sequences
3. Add A/B testing for subject lines
4. Create admin dashboard for campaign management
5. Add more sophisticated agent discovery (crawl brokerage sites)
6. Implement bounce handling
7. Add email preview functionality

## Security Considerations
- Agent emails are stored in plain text (consider encryption)
- Tracking IDs are shortened UUIDs (10 chars)
- No authentication on tracking endpoints (by design)
- Email content is not stored (regenerated from campaign data)

## Performance Notes
- 5-second delay between processing listings
- Puppeteer runs with headless Chrome
- Database connection pool limited to 20 connections
- Email sending through Brevo (300/day free limit)

## Error Handling
- Failed Apify calls logged but don't stop processing
- Failed analyses skip to next listing
- Failed emails logged with full error details
- All failures tracked in results object

## Monitoring
- Check logs: `docker compose -f docker-compose.unified.yml logs ss-email -f`
- Database queries for campaign performance
- Brevo dashboard for email delivery stats
- Application logs for processing errors

## Next Steps When Share Link is Ready
1. Update the analyzer page selectors
2. Test the full workflow with a single property
3. Configure Apify actor for Zillow STR listings
4. Run small test batch (5-10 properties)
5. Monitor email engagement
6. Scale up gradually

---

**Created**: 2025-07-01
**Status**: Awaiting share link functionality on analyzer page
**Contact**: Development team for STR outreach system