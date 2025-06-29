const Joi = require('joi');

// Email validation regex (RFC 5322 simplified)
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Common validation schemas
const schemas = {
    // Contact schemas
    contact: Joi.object({
        email: Joi.string().pattern(emailRegex).required(),
        first_name: Joi.string().max(100).allow(null, ''),
        last_name: Joi.string().max(100).allow(null, ''),
        agency: Joi.string().max(255).allow(null, ''),
        phone: Joi.string().max(50).allow(null, ''),
        website: Joi.string().uri().max(255).allow(null, ''),
        area_id: Joi.number().integer().positive().allow(null),
        str_property_count: Joi.number().integer().min(0).default(0),
        source: Joi.string().valid('web_search', 'manual', 'api').default('manual'),
        source_url: Joi.string().uri().allow(null, '')
    }),

    // Campaign schemas
    campaign: Joi.object({
        name: Joi.string().max(255).required(),
        subject_template: Joi.string().required(),
        body_template: Joi.string().required(),
        campaign_type: Joi.string().valid('initial_outreach', 'follow_up', 'property_alert').required(),
        target_criteria: Joi.object().default({})
    }),

    // Email send schema
    emailSend: Joi.object({
        campaign_id: Joi.number().integer().positive().required(),
        contact_ids: Joi.array().items(Joi.number().integer().positive()).min(1).required()
    }),

    // Discovery job schema
    discoveryJob: Joi.object({
        area_id: Joi.number().integer().positive().required(),
        search_query: Joi.string().max(500).required(),
        max_results: Joi.number().integer().min(1).max(50).default(10)
    }),

    // Property inquiry schema
    propertyInquiry: Joi.object({
        contact_id: Joi.number().integer().positive().required(),
        email_send_id: Joi.number().integer().positive().allow(null),
        property_data: Joi.object().required(),
        inquiry_type: Joi.string().valid('analysis_request', 'market_data', 'investment_potential').required(),
        inquiry_text: Joi.string().allow(null, '')
    }),

    // Pagination schema
    pagination: Joi.object({
        page: Joi.number().integer().min(1).default(1),
        limit: Joi.number().integer().min(1).max(100).default(20),
        sort_by: Joi.string().default('created_at'),
        sort_order: Joi.string().valid('asc', 'desc').default('desc')
    }),

    // ID parameter
    id: Joi.object({
        id: Joi.number().integer().positive().required()
    })
};

// Validation functions
const validate = {
    // Validate email format
    email: (email) => {
        return emailRegex.test(email);
    },

    // Validate phone number (basic validation)
    phone: (phone) => {
        // Remove common formatting characters
        const cleaned = phone.replace(/[\s\-\(\)\.]/g, '');
        // Check if it's a valid length (7-15 digits)
        return /^\+?\d{7,15}$/.test(cleaned);
    },

    // Validate URL
    url: (url) => {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    },

    // Generic schema validation
    schema: (schema, data) => {
        const { error, value } = schema.validate(data, {
            abortEarly: false,
            stripUnknown: true
        });
        
        if (error) {
            const errors = error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message
            }));
            return { valid: false, errors, value: null };
        }
        
        return { valid: true, errors: null, value };
    }
};

// Express middleware for validation
const validateMiddleware = (schemaName) => {
    return (req, res, next) => {
        const schema = schemas[schemaName];
        if (!schema) {
            return res.status(500).json({
                success: false,
                message: 'Invalid validation schema'
            });
        }

        const dataToValidate = ['GET', 'DELETE'].includes(req.method) ? req.params : req.body;
        const { valid, errors, value } = validate.schema(schema, dataToValidate);

        if (!valid) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors
            });
        }

        // Replace request data with validated/cleaned data
        if (['GET', 'DELETE'].includes(req.method)) {
            req.params = value;
        } else {
            req.body = value;
        }

        next();
    };
};

module.exports = {
    schemas,
    validate,
    validateMiddleware
};