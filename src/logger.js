const fs = require('fs');
const path = require('path');

const LOG_FILE = process.env.DATA_DIR
    ? path.join(process.env.DATA_DIR, 'bot.log')
    : path.join(__dirname, '..', 'bot.log');

function formatMessage(level, message, meta = '') {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] ${message} ${meta ? JSON.stringify(meta) : ''}\n`;
}

function writeLog(level, message, meta) {
    const logLine = formatMessage(level, message, meta);

    // Write to Console
    if (level === 'ERROR') console.error(logLine);
    else console.log(logLine);

    // Write to File
    try {
        fs.appendFileSync(LOG_FILE, logLine);
    } catch (err) {
        console.error('Failed to write to log file:', err);
    }
}

module.exports = {
    info: (msg, meta) => writeLog('INFO', msg, meta),
    error: (msg, meta) => writeLog('ERROR', msg, meta),
    warn: (msg, meta) => writeLog('WARN', msg, meta),
    debug: (msg, meta) => writeLog('DEBUG', msg, meta) // Optional: can disable
};
