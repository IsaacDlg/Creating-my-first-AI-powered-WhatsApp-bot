const schedule = require('node-schedule');
const fs = require('fs');
const path = require('path');
const { MessageMedia } = require('whatsapp-web.js');
const botLogic = require('./botLogic');
const db = require('./database');
const sheetsService = require('./sheetsService');

const DB_PATH = path.join(__dirname, '..', 'streaming_bot.db');

function initCronJobs(client) {
    console.log('Initializing Cron Jobs...');

    // 1. Daily Backup at Midnight (00:00)
    schedule.scheduleJob('0 0 * * *', async () => {
        console.log('Running daily backup...');
        try {
            console.log('Optimizing database (VACUUM)...');
            await db.vacuum();

            const chat = await client.getChatById(client.info.wid._serialized);
            const media = MessageMedia.fromFilePath(DB_PATH);
            await chat.sendMessage(media, { caption: '📦 Backup Diario de Base de Datos' });
            console.log('Backup sent to Saved Messages.');
        } catch (err) {
            console.error('Backup failed:', err);
        }
    });

    // 2. Daily Reminders at 09:00 AM
    schedule.scheduleJob('0 9 * * *', async () => {
        console.log('Running daily reminders...');
        await botLogic.checkReminders(client);

        // Notify admin (self) about execution
        try {
            const chat = await client.getChatById(client.info.wid._serialized);
            await chat.sendMessage('🤖 Recordatorios diarios ejecutados.');
        } catch (e) {
            console.error('Failed to notify admin about reminders:', e);
        }
    });

    // 3. Memory Watchdog (Hourly) - Auto-restart if RAM > 800MB
    schedule.scheduleJob('0 * * * *', async () => {
        const used = process.memoryUsage().rss / 1024 / 1024;
        console.log(`[Watchdog] Memory Usage: ${Math.round(used)} MB`);

        if (used > 800) {
            console.error('[Watchdog] Memory limit exceeded. Restarting...');
            // Notify Admin
            try {
                const botNumber = client.info.wid._serialized;
                await client.sendMessage(botNumber, `⚠️ *REINICIO AUTOMÁTICO*\n\nConsumo de RAM alto (${Math.round(used)} MB). Reiniciando para liberar memoria...`);
            } catch (e) { }

            // Allow time for message to send
            setTimeout(() => {
                process.exit(1); // Exit with error to trigger container restart
            }, 5000);
        }
    });

    // 4. Google Sheets Sync (Every 5 minutes)
    schedule.scheduleJob('*/5 * * * *', async () => {
        await sheetsService.syncData();
    });
}

module.exports = { initCronJobs };
