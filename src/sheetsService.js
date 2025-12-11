const { GoogleSpreadsheet } = require('google-spreadsheet');
const fs = require('fs');
const path = require('path');
const db = require('./database');
const logger = require('./logger');

// CONFIGURATION
const CREDENTIALS_PATH = path.join(__dirname, '..', 'cloud', 'credentials.json');
// TODO: User must provide this ID from their URL
// https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1Sine3kGma8YlmGgkGA9z2urEO9JerHTh8e_B84fY5tM';

let doc = null;

async function initSheets() {
    if (!fs.existsSync(CREDENTIALS_PATH)) {
        logger.error('[Sheets] credentials.json not found. Skipping Sync.');
        return;
    }

    try {
        const creds = require(CREDENTIALS_PATH);
        doc = new GoogleSpreadsheet(SPREADSHEET_ID);

        await doc.useServiceAccountAuth(creds);
        await doc.loadInfo();
        logger.info(`[Sheets] Connected to: ${doc.title}`);

        await setupSheets();
    } catch (err) {
        logger.error('[Sheets] Connection Failed:', err);
    }
}

async function setupSheets() {
    if (!doc) return;

    // Check/Create "Clientes" tab
    let clientsSheet = doc.sheetsByTitle['Clientes'];
    if (!clientsSheet) {
        clientsSheet = await doc.addSheet({ title: 'Clientes', headerValues: ['ID', 'Nombre', 'Telefono', 'Referidos', 'Puntos'] });
    }

    // Check/Create "Suscripciones" tab
    let subsSheet = doc.sheetsByTitle['Suscripciones'];
    if (!subsSheet) {
        subsSheet = await doc.addSheet({ title: 'Suscripciones', headerValues: ['Cliente', 'Servicio', 'Email', 'Password', 'Vence'] });
    }
}

async function syncData() {
    if (!doc) return;
    logger.info('[Sheets] Syncing data...');

    try {
        // 1. Sync Clients
        const clients = await db.getAllClientsWithSubs(); // This gets subs, let's use raw sql for just clients if needed, or process this.
        // db.getAllClientsWithSubs returns flattened list. 
        // Let's get unique clients.
        const allClients = await db.getClientsWithCount(); // Assuming this exists or similar
        // If not, let's just query DB directly if `database.js` allows or add a getter.
        // `getAllClientsWithSubs` is fine, we can process it, but `db.all('SELECT * FROM clients')` is better.
        // Since `db` module exposes `run`, `get`, `all` is not exported directly?
        // Checking `database.js` exports... `all` is NOT exported.
        // I should stick to public methods. `getAllClientsWithSubs` gives me everything I need.

        // Actually, let's just do a full dump for now.
        const rows = await db.getAllClientsWithSubs();

        const sheet = doc.sheetsByTitle['Suscripciones'];
        await sheet.clearRows(); // Simple wipe and replace for Phase 1

        const newRows = rows.map(r => ({
            Cliente: r.client_name,
            Servicio: r.service_name,
            Email: r.email,
            Password: r.password,
            Vence: r.expiry_date
        }));

        await sheet.addRows(newRows);
        logger.info('[Sheets] Sync Complete.');

    } catch (err) {
        logger.error('[Sheets] Sync Error:', err);
    }
}

module.exports = {
    initSheets,
    syncData
};
