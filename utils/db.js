const { Pool } = require('pg');

let pool;

function getPool() {
    if (!pool) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            max: 20, // Maximum number of clients in the pool
            idleTimeoutMillis: 30000, // How long a client is allowed to remain idle
            connectionTimeoutMillis: 2000, // How long to wait for a connection
        });

        // Handle pool errors
        pool.on('error', (err, client) => {
            console.error('Unexpected error on idle database client', err);
        });

        // Log when connected
        pool.on('connect', () => {
            console.log('Database pool: client connected');
        });
    }

    return pool;
}

// Helper function for transactions
async function withTransaction(callback) {
    const pool = getPool();
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// Test database connection
async function testConnection() {
    try {
        const pool = getPool();
        const result = await pool.query('SELECT NOW()');
        console.log('Database connection successful:', result.rows[0].now);
        return true;
    } catch (error) {
        console.error('Database connection failed:', error.message);
        return false;
    }
}

module.exports = {
    getPool,
    withTransaction,
    testConnection
};