const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3003;

// Security middleware
app.use(helmet());
app.use(cors());
app.use(compression());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'ss-email',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        service: 'Staystra Email Service',
        version: '1.0.0',
        status: 'operational',
        endpoints: {
            health: '/health',
            api: {
                test: {
                    verify: '/api/test/verify',
                    send: '/api/test/send',
                    config: '/api/test/config'
                },
                contacts: '/api/contacts',
                campaigns: '/api/campaigns',
                discovery: '/api/discovery',
                webhooks: '/api/webhooks'
            }
        }
    });
});

// Routes
const testRoutes = require('./routes/test');
const trackingRoutes = require('./routes/tracking');
const strOutreachRoutes = require('./routes/strOutreach');

// Initialize jobs
const strOutreachJob = require('./jobs/strOutreachJob');
strOutreachJob.init();

// Test database connection
const { testConnection } = require('./utils/db');
testConnection();

// Test routes
app.use('/api/test', testRoutes);

// Tracking routes (no rate limiting for tracking pixels)
app.use('/api/tracking', trackingRoutes);

// STR Outreach routes
app.use('/api/str-outreach', strOutreachRoutes);

// Routes (to be implemented)
// const contactRoutes = require('./routes/contacts');
// const campaignRoutes = require('./routes/campaigns');
// const discoveryRoutes = require('./routes/discovery');
// const webhookRoutes = require('./routes/webhooks');

// app.use('/api/contacts', contactRoutes);
// app.use('/api/campaigns', campaignRoutes);
// app.use('/api/discovery', discoveryRoutes);
// app.use('/api/webhooks', webhookRoutes);

// Placeholder routes
app.use('/api/contacts', (req, res) => {
    res.json({ message: 'Contacts endpoint - to be implemented' });
});

app.use('/api/campaigns', (req, res) => {
    res.json({ message: 'Campaigns endpoint - to be implemented' });
});

app.use('/api/discovery', (req, res) => {
    res.json({ message: 'Discovery endpoint - to be implemented' });
});

app.use('/api/webhooks', (req, res) => {
    res.json({ message: 'Webhooks endpoint - to be implemented' });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint not found'
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`SS-Email service running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV}`);
    console.log(`Health check available at: http://localhost:${PORT}/health`);
});