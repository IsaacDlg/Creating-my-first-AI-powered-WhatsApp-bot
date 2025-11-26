const schedule = require('node-schedule');
const fs = require('fs');
const path = require('path');
const { MessageMedia } = require('whatsapp-web.js');
const botLogic = require('./botLogic');

const DB_PATH = path.join(__dirname, '..', 'streaming_bot.db');

function initCronJobs(client) {
    console.log('Initializing Cron Jobs...');

    // 1. Daily Backup at Midnight (00:00)
    schedule.scheduleJob('0 0 * * *', async () => {
        console.log('Running daily backup...');
        try {
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
}

module.exports = { initCronJobs };
