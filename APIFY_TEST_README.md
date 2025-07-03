# Apify Zillow Scraper Test Guide

## Setup

1. **Add your Apify token** to `/srv/staystra/.env`:
   ```
   APIFY_TOKEN=your_actual_token_here
   ```

2. **Rebuild the ss-email container** to pick up the new environment variable:
   ```bash
   docker compose -f docker-compose.unified.yml down ss-email
   docker compose -f docker-compose.unified.yml up -d ss-email --build
   ```

## Running the Test

### First Run (Fetch from Apify)

1. Enter the container:
   ```bash
   docker compose -f docker-compose.unified.yml exec ss-email bash
   ```

2. Make sure `RUN_ACTOR = true` in the test script (line 12)

3. Run the test:
   ```bash
   node test-apify-zillow.js
   ```

This will:
- Run the Apify actor
- Wait for completion
- Save results to `apify-test-results.json`
- Display the properties found

### Subsequent Runs (Use Cached Results)

1. Edit `test-apify-zillow.js` and set `RUN_ACTOR = false` (line 12)

2. Run the test again:
   ```bash
   node test-apify-zillow.js
   ```

This will use the cached results without calling Apify again.

## What to Check

1. **Actor Input Format**: The current input format in the test script is a placeholder. You may need to check the actual Zillow scraper documentation for the correct input format.

2. **Result Transformation**: The `transformResults` function maps Apify data to our expected format. You'll need to adjust the field mappings based on the actual response from the actor.

3. **Agent Emails**: The system only processes listings that have agent email addresses. Check how many of your results have emails.

## Troubleshooting

### No results returned
- Check the actor input format matches what the Zillow scraper expects
- Verify your search criteria (location, property type, etc.)

### Authentication errors
- Ensure APIFY_TOKEN is set correctly in .env
- Verify the token has access to the maxcopell~zillow-scraper actor

### Transformation errors
- The field mappings in `transformResults` may need adjustment
- Check `apify-test-results.json` to see the raw data structure

## Next Steps

Once you have successful results:

1. Update the input format in `strOutreachService.js` to match what works
2. Adjust the `transformResults` mapping based on actual data
3. Test the full outreach workflow with a single property