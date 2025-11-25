const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'streaming_bot.db');
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
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

        // Migration: Add columns if they don't exist (for existing databases)
        try { await run('ALTER TABLE subscriptions ADD COLUMN email TEXT'); } catch (e) { }
        try { await run('ALTER TABLE subscriptions ADD COLUMN password TEXT'); } catch (e) { }
        try { await run('ALTER TABLE subscriptions ADD COLUMN profile_name TEXT'); } catch (e) { }
        try { await run('ALTER TABLE subscriptions ADD COLUMN profile_pin TEXT'); } catch (e) { }

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
    return get('SELECT * FROM clients WHERE phone = ?', [phone]);
}

async function addSubscription(clientId, serviceName, expiryDate, email, password, profileName, profilePin) {
    return run('INSERT INTO subscriptions (client_id, service_name, expiry_date, email, password, profile_name, profile_pin) VALUES (?, ?, ?, ?, ?, ?, ?)', [clientId, serviceName, expiryDate, email, password, profileName, profilePin]);
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

    // Delete subscriptions first
    await run('DELETE FROM subscriptions WHERE client_id = ?', [client.id]);
    // Delete client
    await run('DELETE FROM clients WHERE id = ?', [client.id]);
    return true;
}

async function deleteSubscriptionById(id) {
    return run('DELETE FROM subscriptions WHERE id = ?', [id]);
}

async function getAllClientsWithSubs() {
    return all(`
        SELECT s.id, c.phone, c.name, s.service_name, s.expiry_date, s.profile_name, s.profile_pin, s.email, s.password 
        FROM clients c 
        LEFT JOIN subscriptions s ON c.id = s.client_id 
        WHERE s.is_active = 1
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
    // 1. Get affected clients to return them (optional, but good for logging)
    const affected = await getSubscriptionsByEmail(email);

    // 2. Delete (or deactivate)
    await run('DELETE FROM subscriptions WHERE email = ?', [email]);

    return affected;
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
        SELECT c.id, c.name, c.phone, COUNT(s.id) as sub_count 
        FROM clients c 
        LEFT JOIN subscriptions s ON c.id = s.client_id AND s.is_active = 1
    `;

    let params = [];
    if (searchTerm) {
        query += ` WHERE c.name LIKE ? OR c.phone LIKE ?`;
        params.push(`%${searchTerm}%`, `%${searchTerm}%`);
    }

    query += ` GROUP BY c.id ORDER BY c.name`;

    return all(query, params);
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
    getAllClientsWithSubs,
    updateSubscription,
    updateBulkSubscriptions,
    getSubscriptionCount,
    getSubscriptionsByEmail,
    deleteSubscriptionsByEmail,
    updateSubscriptionById,
    updateClient,
    deleteSubscriptionById,
    getClientsWithCount
};
