/**
 * Zillow RapidAPI Service
 * 
 * Handles integration with Zillow Working API via RapidAPI
 * Used for fetching new STR (Short Term Rental) listings
 */

const axios = require('axios');

class ZillowRapidApiService {
    constructor() {
        this.baseUrl = 'https://zillow-working-api.p.rapidapi.com';
        this.apiKey = process.env.ZILLOW_API_KEY;
        this.apiHost = 'zillow-working-api.p.rapidapi.com';
    }

    /**
     * Search for properties by map bounds
     * @param {Object} options - Search parameters
     * @returns {Promise<Object>} - Search results
     */
    async searchByMapBounds(options = {}) {
        const {
            // Geographic bounds
            eastLongitude = -94.00978485129427,
            northLatitude = 52.397757120483114,
            southLatitude = 22.261693293915314,
            westLongitude = -124.90333953879427,
            
            // Pagination
            page = 1,
            
            // Filters
            sortOrder = 'Homes_for_you',
            listingStatus = 'For_Sale',
            listPriceRange = 'min:200000, max:1500000',
            bed_min = '2',
            bed_max = 'No_Max',
            bathrooms = 'OnePlus',
            homeType = 'Houses, Townhomes',
            maxHOA = 'Any',
            listingTypeOptions = 'Agent listed',
            propertyStatus = 'listingStatus = For_Sale',
            parkingSpots = 'Any',
            mustHaveBasement = 'No',
            daysOnZillow = '1_day',
            soldInLast = 'Any',
            keywords = 'Short Term Rental'
        } = options;

        try {
            console.log(`Fetching Zillow listings - Page ${page}`);
            console.log('API URL:', `${this.baseUrl}/search/bymapbounds`);
            
            const response = await axios.get(`${this.baseUrl}/search/bymapbounds`, {
                headers: {
                    'x-rapidapi-key': this.apiKey,
                    'x-rapidapi-host': this.apiHost
                },
                params: {
                    eastLongitude,
                    northLatitude,
                    southLatitude,
                    westLongitude,
                    page,
                    sortOrder,
                    listingStatus,
                    listPriceRange,
                    bed_min,
                    bed_max,
                    bathrooms,
                    homeType,
                    maxHOA,
                    listingTypeOptions,
                    propertyStatus,
                    parkingSpots,
                    mustHaveBasement,
                    daysOnZillow,
                    soldInLast,
                    keywords
                }
            });

            console.log('API Response status:', response.status);
            console.log('API Response data:', JSON.stringify(response.data, null, 2).slice(0, 500) + '...');
            
            return {
                success: true,
                data: response.data,
                page: page,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error('Zillow API error:', error.response?.data || error.message);
            
            return {
                success: false,
                error: error.response?.data || error.message,
                statusCode: error.response?.status,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Search for STR listing addresses across multiple regions and keywords
     * @param {Array} regions - Array of region objects with bounds
     * @param {Object} options - Additional search options
     * @returns {Promise<Array>} - Array of unique property addresses
     */
    async searchSTRListings(regions = [], options = {}) {
        const addressSet = new Set(); // Use Set to automatically handle duplicates
        
        // Keywords to search for
        const keywords = ['Short Term Rental', 'Airbnb', 'Vacation Rentals'];
        
        // Default to entire US if no regions specified
        if (regions.length === 0) {
            regions = [{
                name: 'United States',
                bounds: {
                    eastLongitude: -94.00978485129427,
                    northLatitude: 52.397757120483114,
                    southLatitude: 22.261693293915314,
                    westLongitude: -124.90333953879427
                }
            }];
        }

        let totalApiCalls = 0;
        const searchSummary = [];

        // Loop through each region
        for (const region of regions) {
            console.log(`\nSearching ${region.name}...`);
            
            // Loop through each keyword
            for (const keyword of keywords) {
                console.log(`  Searching for "${keyword}"...`);
                
                const searchOptions = {
                    ...region.bounds,
                    ...options,
                    daysOnZillow: '1_day',
                    keywords: keyword
                };

                const result = await this.searchByMapBounds(searchOptions);
                totalApiCalls++;
                
                if (result.success && result.data?.searchResults) {
                    let newAddresses = 0;
                    
                    // Extract addresses from listings
                    result.data.searchResults.forEach(item => {
                        const listing = item.property || item;
                        const address = this.extractAddress(listing);
                        if (address && !addressSet.has(address)) {
                            addressSet.add(address);
                            newAddresses++;
                        }
                    });
                    
                    const summary = {
                        region: region.name,
                        keyword: keyword,
                        found: result.data.searchResults.length,
                        newUnique: newAddresses,
                        totalMatching: result.data.resultsCount?.totalMatchingCount || 0
                    };
                    
                    searchSummary.push(summary);
                    console.log(`    Found ${summary.found} listings (${summary.newUnique} new unique, ${summary.totalMatching} total available)`);
                }
                
                // Rate limiting - wait between API calls
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        const uniqueAddresses = Array.from(addressSet);
        
        console.log('\n=== Search Summary ===');
        console.log(`Total API calls made: ${totalApiCalls}`);
        console.log(`Total unique addresses found: ${uniqueAddresses.length}`);
        console.log('\nBreakdown by search:');
        searchSummary.forEach(s => {
            console.log(`  ${s.region} - "${s.keyword}": ${s.found} found, ${s.newUnique} new unique`);
        });
        
        return uniqueAddresses;
    }

    /**
     * Extract a clean, formatted address from Zillow listing data
     * @param {Object} listing - Raw Zillow listing data
     * @returns {string|null} - Formatted address or null if invalid
     */
    extractAddress(listing) {
        // Handle nested address object structure
        if (listing.address && typeof listing.address === 'object') {
            const addr = listing.address;
            const parts = [
                addr.streetAddress,
                addr.city,
                addr.state,
                addr.zipcode
            ].filter(Boolean);
            
            if (parts.length >= 3) {
                return parts.join(', ');
            }
        }
        
        // Try multiple address fields that Zillow might use
        let address = listing.address || listing.streetAddress || listing.fullAddress;
        
        // If no direct address, try to construct from components
        if (!address && listing.addressStreet) {
            const parts = [
                listing.addressStreet,
                listing.addressCity,
                listing.addressState,
                listing.addressZipcode
            ].filter(Boolean);
            
            if (parts.length >= 3) { // Need at least street, city, state
                address = parts.join(', ');
            }
        }
        
        // If still no address, try other field combinations
        if (!address) {
            const city = listing.addressCity || listing.city;
            const state = listing.addressState || listing.state;
            const zip = listing.addressZipcode || listing.zipcode;
            const street = listing.streetAddress || listing.street;
            
            if (street && city && state) {
                address = `${street}, ${city}, ${state}${zip ? ' ' + zip : ''}`;
            }
        }
        
        // Clean and validate the address
        if (address && typeof address === 'string') {
            // Remove extra whitespace and ensure proper formatting
            address = address.trim().replace(/\s+/g, ' ');
            
            // Skip if address is too short or looks invalid
            if (address.length < 10 || address === 'Address not available') {
                return null;
            }
            
            return address;
        }
        
        return null;
    }

    /**
     * Run a test of the service
     * @param {string} testType - Type of test: 'quick' (1 region, 1 keyword) or 'full' (all regions, all keywords)
     * @returns {Promise<void>}
     */
    async runTest(testType = 'quick') {
        console.log(`\n=== Running Zillow Service Test (${testType}) ===\n`);
        
        // Check API key
        if (!this.apiKey) {
            console.error('ERROR: ZILLOW_API_KEY not found in environment');
            console.log('Please ensure ZILLOW_API_KEY is set in your .env file');
            return;
        }
        
        console.log('✓ API Key configured\n');
        
        try {
            let regions, keywords;
            
            if (testType === 'quick') {
                // Quick test - just Western US with one keyword
                regions = [{
                    name: 'Western US (Test)',
                    bounds: {
                        westLongitude: -124.90333953879427,
                        eastLongitude: -94.00978485129427,
                        southLatitude: 22.261693293915314,
                        northLatitude: 52.397757120483114
                    }
                }];
                
                // Temporarily override keywords for quick test
                const originalKeywords = ['Short Term Rental', 'Airbnb', 'Vacation Rentals'];
                console.log('Quick test: Using only "Short Term Rental" keyword\n');
                
                // Save and restore keywords
                const addressSet = new Set();
                const searchOptions = {
                    ...regions[0].bounds,
                    page: 1,
                    bed_min: '2',
                    listPriceRange: 'min:200000, max:1500000',
                    daysOnZillow: '1_day',
                    keywords: 'Short Term Rental'
                };
                
                const result = await this.searchByMapBounds(searchOptions);
                
                if (result.success && result.data?.searchResults) {
                    result.data.searchResults.forEach(item => {
                        const listing = item.property || item;
                        const address = this.extractAddress(listing);
                        if (address) {
                            addressSet.add(address);
                        }
                    });
                    
                    const addresses = Array.from(addressSet);
                    console.log(`\n✅ Test Results:`);
                    console.log(`Found ${addresses.length} unique addresses`);
                    console.log(`Total available: ${result.data.resultsCount?.totalMatchingCount || 0}`);
                    
                    if (addresses.length > 0) {
                        console.log('\nFirst 3 addresses:');
                        addresses.slice(0, 3).forEach((addr, i) => {
                            console.log(`${i + 1}. ${addr}`);
                        });
                    }
                }
                
            } else {
                // Full test - all regions and keywords
                regions = [
                    {
                        name: 'Western United States',
                        bounds: {
                            westLongitude: -124.90333953879427,
                            eastLongitude: -94.00978485129427,
                            southLatitude: 22.261693293915314,
                            northLatitude: 52.397757120483114
                        }
                    },
                    {
                        name: 'Eastern United States',
                        bounds: {
                            westLongitude: -96.20768958590635,
                            eastLongitude: -65.31413489840635,
                            southLatitude: 22.14641867152922,
                            northLatitude: 52.32172009968274
                        }
                    }
                ];
                
                const addresses = await this.searchSTRListings(regions, {
                    page: 1,
                    bed_min: '2',
                    listPriceRange: 'min:200000, max:1500000'
                });
                
                console.log(`\n✅ Full Test Complete`);
                console.log(`Total unique addresses: ${addresses.length}`);
                
                if (addresses.length > 0) {
                    console.log('\nFirst 5 addresses:');
                    addresses.slice(0, 5).forEach((addr, i) => {
                        console.log(`${i + 1}. ${addr}`);
                    });
                }
            }
            
            console.log('\n✓ Test completed successfully');
            
        } catch (error) {
            console.error('\n❌ Test failed:', error.message);
            if (error.response) {
                console.error('API Response:', {
                    status: error.response.status,
                    statusText: error.response.statusText,
                    data: error.response.data
                });
            }
        }
    }
}

module.exports = new ZillowRapidApiService();