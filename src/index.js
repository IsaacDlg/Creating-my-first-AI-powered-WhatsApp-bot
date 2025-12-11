const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const qrcodeGen = require('qrcode');
const fs = require('fs');
const path = require('path');
const schedule = require('node-schedule');
const db = require('./database');
const botLogic = require('./botLogic');
const cronJobs = require('./cronJobs');
const logger = require('./logger'); // Structured Logging
const messageQueue = require('./messageQueue'); // Anti-Ban Queue
const sheetsService = require('./sheetsService'); // Google Sheets

// Initialize Database
(async () => {
    await db.initDatabase();
    // Initialize Sheets (Non-blocking)
    sheetsService.initSheets();
    // sheetsService.syncData(); // Removed forced immediate sync to prevent blocking or racing. Syncs in 5 mins.

    // Resume State
    // stateManager.init(); // This line was commented out in the instruction, assuming it's a placeholder or future addition.
    // SEED DATABASE IF MISSING IN PERSISTENT VOLUME
    if (process.env.DATA_DIR) {
        try {
            const dbName = 'streaming_bot.db';
            const sourcePath = path.join(__dirname, '..', dbName); // Image copy
            const destPath = path.join(process.env.DATA_DIR, dbName); // Volume copy

            if (!fs.existsSync(destPath)) {
                logger.info('Creating persistent database from seed...');
                if (fs.existsSync(sourcePath)) {
                    fs.copyFileSync(sourcePath, destPath);
                    logger.info('Database seeded successfully!');
                } else {
                    logger.info('Seed database not found in image at:', sourcePath);
                }
            }
        } catch (seedErr) {
            logger.error('Error seeding database:', seedErr);
        }
    }

    await db.initDatabase();
})();

// Initialize WhatsApp Client
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: process.env.DATA_DIR ? process.env.DATA_DIR : './.wwebjs_auth'
    }),
    // webVersionCache: { type: 'none' },
    // authTimeoutMs: 0, // Keep disabled to prevent forcing
    // qrMaxRetries: 0, // Keep disabled to prevent forcing
    puppeteer: {
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    }
});

let botStatus = 'Initializing...'; // Track status
let latestQr = null;

client.on('qr', (qr) => {
    logger.info('QR RECEIVED', qr);
    latestQr = qr;
    botStatus = 'QR Code Received - Waiting for Scan';
    qrcode.generate(qr, { small: true }, function (qrcode) {
        console.log(qrcode); // Keep console.log for terminal QR
    });
});

client.on('ready', () => {
    logger.info('El bot está listo y conectado!');
    latestQr = null;
    botStatus = 'Connected and Ready!';
    cronJobs.initCronJobs(client);
});

client.on('auth_failure', () => {
    botStatus = 'Authentication Failed - Restarting...';
    logger.error('Authentication Failed');
});

client.on('disconnected', () => {
    botStatus = 'Disconnected - Restarting...';
    logger.warn('Disconnected');
});

client.on('message_create', async msg => {
    logger.info('[INDEX] Event received:', msg.body);
    // console.time('Message Processing Time'); // Remove or change to log
    await botLogic.handleMessage(msg);
    // console.timeEnd('Message Processing Time');
});

client.initialize().then(() => {
    botStatus = 'Browser Launched - Waiting for WhatsApp...';
}).catch(err => {
    botStatus = 'Error Launching Browser: ' + err.message;
    logger.error('Error Launching Browser:', err);
});

// --- HTTP SERVER FOR FLY.IO & QR DISPLAY ---
const http = require('http');
const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
    if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

        let html = `
        <html>
            <head>
                <title>WhatsApp Bot Status</title>
                <meta http-equiv="refresh" content="10">
                <style>
                    body { font-family: sans-serif; text-align: center; padding: 20px; }
                    .status { padding: 10px; border-radius: 5px; display: inline-block; margin-bottom: 20px; }
                    .ready { background-color: #d4edda; color: #155724; }
                    .error { background-color: #f8d7da; color: #721c24; }
                    .loading { background-color: #fff3cd; color: #856404; }
                </style>
            </head>
            <body>
                <h1>🤖 Bot Status</h1>
                <div class="status ${botStatus.includes('Ready') ? 'ready' : botStatus.includes('Error') || botStatus.includes('Failed') ? 'error' : 'loading'}">
                    <h3>${botStatus}</h3>
                </div>
        `;

        if (latestQr) {
            try {
                const qrImage = await qrcodeGen.toDataURL(latestQr);
                html += `
                    <div>
                        <p>Scan this QR Code to login:</p>
                        <img src="${qrImage}" alt="QR Code" style="width: 300px; height: 300px; border: 1px solid #ccc;"/>
                    </div>
                `;
            } catch (err) {
                html += `<p>Error generating QR image: ${err.message}</p>`;
            }
        }

        html += `
                <p><small>Last Update: ${new Date().toLocaleString()}</small></p>
            </body>
        </html>
        `;

        res.end(html);
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

server.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
});
