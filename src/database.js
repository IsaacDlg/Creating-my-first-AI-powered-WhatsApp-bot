const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = process.env.DATA_DIR
    ? path.join(process.env.DATA_DIR, 'streaming_bot.db')
    : path.join(__dirname, '..', 'streaming_bot.db');
const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function initDatabase() {
    try {
        // Create Clients table
        await run(`
            CREATE TABLE IF NOT EXISTS clients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT UNIQUE NOT NULL,
                name TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT 1
            )
        `);

        // Create Services table
        await run(`
            CREATE TABLE IF NOT EXISTS services (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL
            )
        `);

        // Create Subscriptions table
        await run(`
            CREATE TABLE IF NOT EXISTS subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id INTEGER NOT NULL,
                service_name TEXT NOT NULL,
                expiry_date DATE NOT NULL,
                email TEXT,
                password TEXT,
                is_active BOOLEAN DEFAULT 1,
                FOREIGN KEY (client_id) REFERENCES clients (id)
            )
        `);

        // Create Account Costs table
        await run(`
            CREATE TABLE IF NOT EXISTS account_costs (
                email TEXT PRIMARY KEY,
                service_name TEXT NOT NULL,
                cost_price REAL DEFAULT 0,
                bought_date DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create Licenses table
        await run(`
            CREATE TABLE IF NOT EXISTS licenses (
                key TEXT PRIMARY KEY,
                duration_days INTEGER NOT NULL,
                is_used BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create System Config table
        await run(`
            CREATE TABLE IF NOT EXISTS system_config (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        `);

        // Migration: Add columns if they don't exist (for existing databases)
        try { await run('ALTER TABLE subscriptions ADD COLUMN email TEXT'); } catch (e) { }
        try { await run('ALTER TABLE subscriptions ADD COLUMN password TEXT'); } catch (e) { }
        try { await run('ALTER TABLE subscriptions ADD COLUMN profile_name TEXT'); } catch (e) { }
        try { await run('ALTER TABLE subscriptions ADD COLUMN profile_pin TEXT'); } catch (e) { }
        try { await run('ALTER TABLE subscriptions ADD COLUMN sale_price REAL DEFAULT 0'); } catch (e) { }
        try { await run('ALTER TABLE subscriptions ADD COLUMN is_full_account BOOLEAN DEFAULT 0'); } catch (e) { }
        try { await run('ALTER TABLE clients ADD COLUMN is_active BOOLEAN DEFAULT 1'); } catch (e) { }

        // Performance Indices
        await run('CREATE INDEX IF NOT EXISTS idx_subscriptions_client_id ON subscriptions(client_id)');
        await run('CREATE INDEX IF NOT EXISTS idx_subscriptions_email ON subscriptions(email)');
        await run('CREATE INDEX IF NOT EXISTS idx_subscriptions_service_name ON subscriptions(service_name)');
        await run('CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name)');

        console.log('Database initialized.');
    } catch (err) {
        console.error('Error initializing database:', err);
    }
}

// Helper functions
async function addClient(phone, name) {
    return run('INSERT OR IGNORE INTO clients (phone, name) VALUES (?, ?)', [phone, name]);
}

async function getClientByPhone(phone) {
    return get('SELECT * FROM clients WHERE phone = ? AND is_active = 1', [phone]);
}

async function addSubscription(clientId, serviceName, expiryDate, email, password, profileName, profilePin, salePrice = 0, isFullAccount = 0) {
    return run('INSERT INTO subscriptions (client_id, service_name, expiry_date, email, password, profile_name, profile_pin, sale_price, is_full_account) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [clientId, serviceName, expiryDate, email, password, profileName, profilePin, salePrice, isFullAccount]);
}

async function getExpiringSubscriptions(days = 3) {
    return all(`
        SELECT s.*, c.phone, c.name as client_name 
        FROM subscriptions s
        JOIN clients c ON s.client_id = c.id
        WHERE s.is_active = 1 
        AND date(s.expiry_date) <= date('now', '+' || ? || ' days')
        AND date(s.expiry_date) >= date('now')
    `, [days]);
}

async function getAllSubscriptions(clientId) {
    return all('SELECT * FROM subscriptions WHERE client_id = ? AND is_active = 1', [clientId]);
}

async function renewSubscription(subscriptionId, newExpiryDate) {
    return run('UPDATE subscriptions SET expiry_date = ? WHERE id = ?', [newExpiryDate, subscriptionId]);
}

async function deleteClient(phone) {
    const client = await getClientByPhone(phone);
    if (!client) return false;

    // Soft delete subscriptions
    await run('UPDATE subscriptions SET is_active = 0 WHERE client_id = ?', [client.id]);
    // Soft delete client
    await run('UPDATE clients SET is_active = 0 WHERE id = ?', [client.id]);
    return true;
}

async function deleteSubscriptionById(id) {
    return run('UPDATE subscriptions SET is_active = 0 WHERE id = ?', [id]);
}

async function getAllClientsWithSubs() {
    return all(`
        SELECT s.id, c.phone, c.name, s.service_name, s.expiry_date, s.profile_name, s.profile_pin, s.email, s.password 
        FROM clients c 
        LEFT JOIN subscriptions s ON c.id = s.client_id 
        WHERE s.is_active = 1 AND c.is_active = 1
        ORDER BY c.name
    `);
}

async function updateSubscription(phone, serviceName, newEmail, newPassword, newProfile, newPin) {
    const client = await getClientByPhone(phone);
    if (!client) return false;

    // Update specific subscription for this client
    await run(`
        UPDATE subscriptions 
        SET email = ?, password = ?, profile_name = ?, profile_pin = ? 
        WHERE client_id = ? AND service_name = ? AND is_active = 1
    `, [newEmail, newPassword, newProfile, newPin, client.id, serviceName]);

    return true;
}

async function updateBulkSubscriptions(oldEmail, newEmail, newPassword) {
    // 1. Find affected clients
    const affectedClients = await all(`
        SELECT c.phone, c.name, s.service_name 
        FROM subscriptions s
        JOIN clients c ON s.client_id = c.id
        WHERE s.email = ? AND s.is_active = 1
    `, [oldEmail]);

    // 2. Update ALL subscriptions that have the old email
    await run(`
        UPDATE subscriptions 
        SET email = ?, password = ? 
        WHERE email = ? AND is_active = 1
    `, [newEmail, newPassword, oldEmail]);

    return affectedClients;
}

async function getSubscriptionCount(serviceName, email) {
    const result = await get(`
        SELECT COUNT(*) as count 
        FROM subscriptions 
        WHERE service_name = ? AND email = ? AND is_active = 1
    `, [serviceName, email]);
    return result ? result.count : 0;
}

async function getSubscriptionsByEmail(email) {
    return all(`
        SELECT s.*, c.name as client_name, c.phone as client_phone
        FROM subscriptions s
        JOIN clients c ON s.client_id = c.id
        WHERE s.email = ? AND s.is_active = 1
    `, [email]);
}

async function deleteSubscriptionsByEmail(email) {
    return run('UPDATE subscriptions SET is_active = 0 WHERE email = ?', [email]);
}

async function updateSubscriptionById(id, fields) {
    // fields is an object { password: '...', profile_name: '...' }
    const keys = Object.keys(fields);
    if (keys.length === 0) return false;

    const setClause = keys.map(k => `${k} = ?`).join(', ');
    const values = Object.values(fields);
    values.push(id);

    await run(`UPDATE subscriptions SET ${setClause} WHERE id = ?`, values);
    return true;
}

async function updateClient(phone, newName, newPhone) {
    const client = await getClientByPhone(phone);
    if (!client) return false;

    if (newPhone && newPhone !== phone) {
        await run('UPDATE clients SET name = ?, phone = ? WHERE id = ?', [newName, newPhone, client.id]);
    } else {
        await run('UPDATE clients SET name = ? WHERE id = ?', [newName, client.id]);
    }
    return true;
}

async function getClientsWithCount(searchTerm = '') {
    let query = `
        SELECT c.*, COUNT(s.id) as sub_count 
        FROM clients c 
        LEFT JOIN subscriptions s ON c.id = s.client_id AND s.is_active = 1
        WHERE c.is_active = 1
    `;
    const params = [];

    if (searchTerm) {
        query += ' AND (c.name LIKE ? OR c.phone LIKE ?)';
        params.push(`%${searchTerm}%`, `%${searchTerm}%`);
    }

    query += ' GROUP BY c.id ORDER BY c.name';
    return all(query, params);
}

async function getClientCount() {
    const result = await get('SELECT COUNT(*) as count FROM clients WHERE is_active = 1');
    return result ? result.count : 0;
}

async function getTotalSubscriptionCount() {
    const res = await get('SELECT COUNT(*) as count FROM subscriptions WHERE is_active = 1');
    return res ? res.count : 0;
}

async function getExpiringCount(days = 7) {
    const res = await get(`
        SELECT COUNT(*) as count 
        FROM subscriptions 
        WHERE is_active = 1 
        AND date(expiry_date) <= date('now', '+' || ? || ' days')
        AND date(expiry_date) >= date('now')
    `, [days]);
    return res ? res.count : 0;
}

async function getTopPlatforms() {
    return all(`
        SELECT service_name, COUNT(*) as count 
        FROM subscriptions 
        WHERE is_active = 1 
        GROUP BY service_name 
        ORDER BY count DESC 
        LIMIT 3
    `);
}

async function getAllClientPhones() {
    return all('SELECT phone FROM clients WHERE is_active = 1');
}

async function addAccountCost(email, serviceName, cost) {
    return run(
        'INSERT OR REPLACE INTO account_costs (email, service_name, cost_price) VALUES (?, ?, ?)',
        [email, serviceName, cost]
    );
}

async function getAccountCost(email) {
    return get('SELECT cost_price FROM account_costs WHERE email = ?', [email]);
}

async function updateSubscriptionPrice(id, price, isFullAccount = 0) {
    return run(
        'UPDATE subscriptions SET sale_price = ?, is_full_account = ? WHERE id = ?',
        [price, isFullAccount, id]
    );
}

async function getFinancialStats() {
    // Calculate total revenue (ALL subscriptions, active or inactive)
    const revenue = await get('SELECT SUM(sale_price) as total FROM subscriptions');

    // Calculate costs for ALL unique accounts ever used
    const allEmails = await all('SELECT DISTINCT email FROM subscriptions');
    let totalCost = 0;

    for (const row of allEmails) {
        if (row.email) {
            const costRow = await get('SELECT cost_price FROM account_costs WHERE email = ?', [row.email]);
            if (costRow) {
                totalCost += costRow.cost_price;
            }
        }
    }

    return {
        revenue: revenue.total || 0,
        cost: totalCost,
        profit: (revenue.total || 0) - totalCost
    };
}

// Licensing Functions
async function createLicense(key, days) {
    return run('INSERT INTO licenses (key, duration_days) VALUES (?, ?)', [key, days]);
}

async function getLicense(key) {
    return get('SELECT * FROM licenses WHERE key = ?', [key]);
}

async function markLicenseUsed(key) {
    return run('UPDATE licenses SET is_used = 1 WHERE key = ?', [key]);
}

async function getLicenseExpiry() {
    const res = await get('SELECT value FROM system_config WHERE key = ?', ['license_expiry']);
    return res ? res.value : null;
}

async function updateLicenseExpiry(newDate) {
    return run('INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)', ['license_expiry', newDate]);
}

async function setCountryCode(code) {
    return run('INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)', ['country_code', code]);
}

async function getCountryCode() {
    const res = await get('SELECT value FROM system_config WHERE key = ?', ['country_code']);
    return res ? res.value : '593'; // Default to 593 (Ecuador)
}

// This function replaces the existing getExpiringSubscriptions
async function getExpiringSubscriptions(days) {
    const today = new Date();
    const futureDate = new Date();
    futureDate.setDate(today.getDate() + days);

    const futureStr = futureDate.toISOString().split('T')[0];

    // Query: Active clients with subs expiring <= futureDate (includes expired ones)
    // We want to show expired ones too, so we just check expiry_date <= futureStr
    // But maybe we want to limit how far back? For now, let's show all expired + upcoming.
    // Actually, usually "expiring soon" implies active ones.
    // But user said "proximos a caducar [los que les resta 3 dias o vencidas]".
    // So simply expiry_date <= futureStr.

    const query = `
        SELECT c.id, c.name, c.phone, s.id as sub_id, s.service_name, s.expiry_date, s.email, s.password
        FROM clients c
        JOIN subscriptions s ON c.id = s.client_id
        WHERE c.is_active = 1 AND s.expiry_date <= ?
        ORDER BY s.expiry_date ASC
    `;

    return all(query, [futureStr]);
}

module.exports = {
    initDatabase,
    addClient,
    getClientByPhone,
    addSubscription,
    getExpiringSubscriptions,
    getAllSubscriptions,
    renewSubscription,
    deleteClient,
    deleteSubscriptionById,
    getAllClientsWithSubs,
    updateSubscription,
    updateBulkSubscriptions,
    getSubscriptionCount,
    getSubscriptionsByEmail,
    deleteSubscriptionsByEmail,
    updateSubscriptionById,
    updateClient,
    getClientsWithCount,
    getClientCount,
    getTotalSubscriptionCount,
    getExpiringCount,
    getTopPlatforms,
    getAllClientPhones,
    addAccountCost,
    getAccountCost,
    updateSubscriptionPrice,
    getFinancialStats,
    createLicense,
    getLicense,
    markLicenseUsed,
    getLicenseExpiry,
    updateLicenseExpiry,
    setCountryCode,
    getCountryCode
};
