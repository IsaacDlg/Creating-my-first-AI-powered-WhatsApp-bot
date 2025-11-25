const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const schedule = require('node-schedule');
const db = require('./database');
const botLogic = require('./botLogic');

// Initialize Database
(async () => {
    await db.initDatabase();
})();

// Initialize WhatsApp Client
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox']
    }
});

client.on('qr', (qr) => {
    qrcode.toFile('qr.png', qr, {
        color: {
            dark: '#000000',  // Black dots
            light: '#FFFFFF' // White background
        }
    }, function (err) {
        if (err) throw err;
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] New QR code saved to qr.png - Please scan immediately.`);
    });
});

client.on('ready', () => {
    console.log('El bot está listo y conectado!');

    // Schedule daily check at 10:00 AM
    schedule.scheduleJob('0 10 * * *', () => {
        botLogic.checkReminders(client);
    });
});

client.on('message_create', async msg => {
    // Pass ALL messages to botLogic
    await botLogic.handleMessage(msg);
});

client.initialize();
