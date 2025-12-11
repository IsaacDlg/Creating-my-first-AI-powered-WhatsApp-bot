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
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-extensions',
            '--disable-component-extensions-with-background-pages',
            '--disable-default-apps',
            '--mute-audio',
            '--no-default-browser-check',
            '--autoplay-policy=user-gesture-required',
            '--headless=new',
            '--disable-software-rasterizer',
            '--blink-settings=imagesEnabled=false'
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
