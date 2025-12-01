const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const qrcodeGen = require('qrcode');
const fs = require('fs');
const path = require('path');
const schedule = require('node-schedule');
const db = require('./database');
const botLogic = require('./botLogic');
const cronJobs = require('./cronJobs');

// Initialize Database
(async () => {
    // SEED DATABASE IF MISSING IN PERSISTENT VOLUME
    if (process.env.DATA_DIR) {
        try {
            const dbName = 'streaming_bot.db';
            const sourcePath = path.join(__dirname, '..', dbName); // Image copy
            const destPath = path.join(process.env.DATA_DIR, dbName); // Volume copy

            if (!fs.existsSync(destPath)) {
                console.log('Creating persistent database from seed...');
                if (fs.existsSync(sourcePath)) {
                    fs.copyFileSync(sourcePath, destPath);
                    console.log('Database seeded successfully!');
                } else {
                    console.log('Seed database not found in image at:', sourcePath);
                }
            }
        } catch (seedErr) {
            console.error('Error seeding database:', seedErr);
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
    console.log('QR RECEIVED', qr);
    latestQr = qr;
    botStatus = 'QR Code Received - Waiting for Scan';
    qrcode.generate(qr, { small: true }, function (qrcode) {
        console.log(qrcode);
    });
});

client.on('ready', () => {
    console.log('El bot está listo y conectado!');
    latestQr = null;
    botStatus = 'Connected and Ready!';
    cronJobs.initCronJobs(client);
});

client.on('auth_failure', () => {
    botStatus = 'Authentication Failed - Restarting...';
});

client.on('disconnected', () => {
    botStatus = 'Disconnected - Restarting...';
});

client.on('message_create', async msg => {
    console.log('[INDEX] Event received:', msg.body);
    console.time('Message Processing Time');
    await botLogic.handleMessage(msg);
    console.timeEnd('Message Processing Time');
});

client.initialize().then(() => {
    botStatus = 'Browser Launched - Waiting for WhatsApp...';
}).catch(err => {
    botStatus = 'Error Launching Browser: ' + err.message;
    console.error(err);
});

// --- FLY.IO HEALTH CHECK & QR SERVER ---
const http = require('http');
const port = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
    if (req.url === '/logout' && req.method === 'POST') {
        try {
            console.log('Logging out via web interface...');
            await client.logout();
            botStatus = 'Logged out. Restarting...';
            setTimeout(() => {
                process.exit(0); // Restart container to get fresh session
            }, 1000);
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<h1>Cerrando sesion... El bot se reiniciara en unos segundos. Recarga la pagina.</h1>');
            return;
        } catch (err) {
            console.error('Logout error:', err);
            res.writeHead(500);
            res.end('Error logging out');
            return;
        }
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });

    let htmlContent = `
        <html>
            <head>
                <title>WhatsApp Bot Status</title>
                <meta http-equiv="refresh" content="15"> <!-- Auto refresh every 15s -->
                <style>
                    body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #f0f2f5; margin: 0; }
                    .container { text-align: center; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); max-width: 400px; width: 90%; }
                    h1 { color: #075e54; margin-bottom: 20px; }
                    .status { margin-bottom: 20px; padding: 10px; background: #e8f5e9; border-radius: 6px; color: #2e7d32; font-weight: bold; }
                    .error { background: #ffebee; color: #c62828; }
                    img { width: 280px; height: 280px; margin: 20px 0; border: 1px solid #ddd; }
                    p { color: #666; font-size: 14px; }
                    .btn-logout { background: #d32f2f; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; font-size: 14px; margin-top: 15px; }
                    .btn-logout:hover { background: #b71c1c; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>WhatsApp Bot</h1>
                    <div class="status ${botStatus.includes('Error') ? 'error' : ''}">Status: ${botStatus}</div>
    `;

    if (latestQr) {
        try {
            const qrImage = await qrcodeGen.toDataURL(latestQr);
            htmlContent += `
                <img src="${qrImage}" alt="QR Code"/>
                <p>Escanea este código con WhatsApp en tu celular.</p>
                <p>Menu > Dispositivos vinculados > Vincular dispositivo</p>
            `;
        } catch (err) {
            htmlContent += `<p class="error">Error generating QR image</p>`;
        }
    } else if (botStatus.includes('Connected')) {
        htmlContent += `
            <p>✅ El bot está funcionando correctamente.</p>
            <form action="/logout" method="post">
                <button class="btn-logout" type="submit">Cerrar Sesión / Vincular Nuevo</button>
            </form>
        `;
    } else {
        htmlContent += `<p>⏳ Esperando código QR... (La página se recargará sola)</p>`;
    }

    htmlContent += `
                </div>
            </body>
        </html>
    `;

    res.end(htmlContent);
});

server.listen(port, () => {
    console.log(`Server listening on port ${port} for Fly.io health checks`);
});
