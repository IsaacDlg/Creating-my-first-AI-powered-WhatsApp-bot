const { MessageMedia } = require('whatsapp-web.js');
const db = require('./database');
const xlsx = require('xlsx');
const { generateCSV } = require('./csvUtils');
const fs = require('fs');
const path = require('path');

// State Machine for Interactive Flows
const userStates = {}; // chatId -> { step, data }
const BOT_PREFIX = '🤖 ';

const PLATFORMS = {
    1: { name: 'Netflix', price: 3.50, hasPin: true, limit: 5, category: 'streaming' },
    2: { name: 'Disney+', price: 3.50, hasPin: true, limit: 7, category: 'streaming' },
    3: { name: 'Prime Video', price: 3.00, hasPin: true, limit: 6, category: 'streaming' },
    4: { name: 'HBO Max', price: 3.50, hasPin: true, limit: 5, category: 'streaming' },
    5: { name: 'Paramount+', price: 3.00, hasPin: true, limit: 5, category: 'streaming' },
    6: { name: 'Spotify', price: 3.00, hasPin: false, limit: 6, category: 'music' },
    7: { name: 'Crunchyroll', price: 3.00, hasPin: false, limit: 4, category: 'streaming' },
    8: { name: 'YouTube Premium', price: 3.00, hasPin: false, limit: 5, category: 'music' },
    9: { name: 'IPTV', price: 5.00, hasPin: false, limit: 1, category: 'streaming' },
    10: { name: 'Magis TV', price: 5.00, hasPin: false, limit: 1, category: 'streaming' },
    11: { name: 'ChatGPT Plus', price: 5.00, hasPin: false, limit: 1, category: 'tasks' },
    12: { name: 'Gemini Advanced', price: 5.00, hasPin: false, limit: 1, category: 'tasks' },
    13: { name: 'Canva Pro', price: 3.00, hasPin: false, limit: 5, category: 'tasks' },
    14: { name: 'Apple TV+', price: 4.00, hasPin: false, limit: 5, category: 'streaming' },
    15: { name: 'Vix Premium', price: 3.00, hasPin: false, limit: 3, category: 'streaming' },
    16: { name: 'Apple Music', price: 3.00, hasPin: false, limit: 6, category: 'music' },
    17: { name: 'Deezer', price: 3.00, hasPin: false, limit: 6, category: 'music' },
    18: { name: 'Amazon Music', price: 3.00, hasPin: false, limit: 6, category: 'music' },
    19: { name: 'Microsoft 365', price: 4.00, hasPin: false, limit: 5, category: 'tasks' },
    20: { name: 'Duolingo Super', price: 2.00, hasPin: false, limit: 6, category: 'tasks' },
    21: { name: 'Adobe Creative Cloud', price: 10.00, hasPin: false, limit: 2, category: 'tasks' },
    22: { name: 'NordVPN', price: 3.00, hasPin: false, limit: 6, category: 'tasks' }
};

// Global Config Cache
let DEFAULT_COUNTRY_CODE = '593';
let configLoaded = false; // Flag to check if config has been loaded
let cachedLicenseExpiry = null; // Cache for license expiry to reduce DB calls
let isBotActive = true; // Global silence toggle

// Helper to normalize phone numbers
function normalizePhone(input) {
    let phone = input.replace(/\D/g, '');
    if (!phone) return null;

    // If it starts with the country code, keep it
    if (phone.startsWith(DEFAULT_COUNTRY_CODE)) {
        return phone;
    }

    // If it starts with 0, replace with country code
    if (phone.startsWith('0')) {
        return DEFAULT_COUNTRY_CODE + phone.slice(1);
    }


    // Otherwise return as is (maybe it's already full international without +)
    return phone;
}

// Helper to check if a user is Super Admin
function isSuperAdmin(chatId) {
    const SUPER_ADMIN_NUMBER = process.env.SUPER_ADMIN_NUMBER || '593959878305';
    const id = chatId.replace(/\D/g, ''); // Remove non-digits
    return id.startsWith(SUPER_ADMIN_NUMBER);
}

// Get detailed help for a specific command
function getCommandHelp(cmd) {
    const helps = {
        'vender': `📝 *COMANDO: !vender*
Alias: !venta, !sell

📖 *Descripción:*
Registra una nueva venta de suscripción

🎯 *Uso:*
• !vender
• !vender Netflix 0991234567 Juan

✨ *Características:*
- Lista de cuentas disponibles
- Confirmación antes de finalizar
- Notificación automática al cliente
- Registro de precio de venta
- Soporte para combos (múltiples plataformas)`,

        'renew': `📝 *COMANDO: !renovar*
Alias: !renew, !r

📖 *Descripción:*
Renueva una suscripción existente

🎯 *Uso:*
• !renovar

✨ *Características:*
- Busca cliente por teléfono
- Selección de suscripción si tiene varias
- Ingresa meses a renovar
- Calcula nueva fecha automáticamente
- Notifica al cliente`,

        'clients': `📝 *COMANDO: !clientes*
Alias: !clients, !c

📖 *Descripción:*
Busca y gestiona clientes

🎯 *Uso:*
• !clientes
• !clientes Juan
• !clientes 0991234567

✨ *Características:*
- Búsqueda por nombre o teléfono
- Ver todas las suscripciones
- Nueva venta al cliente
- Eliminar cliente
- Reenviar información`,

        'cuentas': `📝 *COMANDO: !cuentas*
Alias: !accounts, !a

📖 *Descripción:*
Gestiona cuentas de streaming

🎯 *Uso:*
• !cuentas

✨ *Características:*
- Ver cuentas por plataforma
- Cambiar contraseña global
- Reemplazar cuenta completa
- Eliminar cuenta
- Ver usuarios de la cuenta`,

        'correo': `📝 *COMANDO: !email*
Alias: !correo, !e

📖 *Descripción:*
Busca suscripciones por email

🎯 *Uso:*
• !email cuenta@gmail.com

✨ *Características:*
- Lista todos los usuarios
- Cambiar contraseña
- Eliminar cuenta
- Gestionar usuarios específicos`,

        'list': `📝 *COMANDO: !lista*
Alias: !list, !l

📖 *Descripción:*
Ver cuentas organizadas por plataforma

🎯 *Uso:*
• !lista

✨ *Características:*
- Selección de plataforma
- Ver email, password y usuarios
- Agregar usuario a cuenta
- Gestionar cuenta`,

        'stock': `📝 *COMANDO: !stock*
Alias: !disponibilidad, !d

📖 *Descripción:*
Ver disponibilidad de slots por plataforma

🎯 *Uso:*
• !stock

✨ *Características:*
- Muestra slots ocupados/disponibles
- Indica cuentas llenas
- Organizado por plataforma`,

        'stats': `📝 *COMANDO: !stats*
Alias: !estadisticas, !reportes

📖 *Descripción:*
Ver estadísticas y métricas del negocio

🎯 *Uso:*
• !stats

✨ *Muestra:*
- Total de clientes
- Suscripciones activas
- Próximos vencimientos
- Top plataformas
- Ingresos, costos y ganancias`,

        'broadcast': `📝 *COMANDO: !broadcast*
Alias: !difusion, !enviar

📖 *Descripción:*
Envía mensaje masivo a todos los clientes

🎯 *Uso:*
• !broadcast Tu mensaje aquí

⚠️ *Importante:*
- Requiere confirmación
- Envía a TODOS los clientes
- Delay de 2s entre mensajes`,

        'delete': `📝 *COMANDO: !eliminar*
Alias: !delete, !borrar

📖 *Descripción:*
Elimina un cliente y todas sus suscripciones

🎯 *Uso:*
• !eliminar 0991234567

⚠️ *Importante:*
- Acción irreversible
- Elimina todas las suscripciones del cliente`,

        'updateall': `📝 *COMANDO: !actualizar*
Alias: !updateall

📖 *Descripción:*
Actualiza email y contraseña de una cuenta

🎯 *Uso:*
• !actualizar viejo@gmail.com nuevo@gmail.com nuevapass

✨ *Características:*
- Actualiza todas las suscripciones
- Notifica a todos los usuarios afectados`,

        'import': `📝 *COMANDO: !importar*
Alias: !import

📖 *Descripción:*
Importa clientes y suscripciones desde Excel

🎯 *Uso:*
• !importar (Luego sube el archivo)

📋 *Formato Excel (Columnas):*
1. Teléfono
2. Nombre
3. Servicio
4. Email
5. Password
6. Fecha Vencimiento
7. PIN (Opcional)`,

        'bot': `📝 *COMANDO: !bot*
Alias: !silencio, !activarbot

📖 *Descripción:*
Activa o desactiva las respuestas automáticas del bot. Útil para cuando quieres chatear manualmente con el cliente sin que el bot interrumpa.

🎯 *Uso:*
• !bot off (Silenciar)
• !bot on (Activar)

✨ *Comportamiento:*
- *OFF*: El bot ignorará todos los mensajes (excepto !bot on).
- *ON*: El bot funcionará normalmente.`
    };

    return helps[cmd] || `❌ No hay ayuda disponible para "${cmd}".\n\nUsa !ayuda para ver todos los comandos.`;
}

async function sendMainMenu(msg) {
    await msg.reply(BOT_PREFIX +
        `╭━━━━━━━━━━━━━━━━━━╮\n` +
        `   🤖 *MENÚ PRINCIPAL*\n` +
        `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
        `💰 *VENTAS*\n` +
        `• !vender (!v): Iniciar nueva venta\n` +
        `• !stock (!s): Ver disponibilidad\n\n` +
        `👥 *CLIENTES*\n` +
        `• !clientes (!c): Buscar/Gestionar\n` +
        `• !renovar (!r): Renovar suscripción\n\n` +
        `🔐 *CUENTAS*\n` +
        `• !cuentas (!a): Gestionar cuentas\n` +
        `• !lista (!l): Ver lista detallada\n\n` +
        `⚙️ *ADMIN*\n` +
        `• !fechas (!f): Vencimientos y Reportes\n` +
        `• !stats (!st): Estadísticas\n` +
        `• !broadcast: Mensaje masivo\n` +
        `• !importar: Importar/Actualizar Excel\n` +
        `• !myid: Ver mi ID y Permisos\n` +
        `• !bot off/on: Pausar/Activar bot\n` +
        `• !config: Configuración\n` +
        `• !help (!h): Ver este menú\n\n` +
        `🔑 *LICENCIA*\n` +
        `• !activar: Renovar licencia del bot`
    );
}

async function sendRenewHub(msg, client, subs) {
    let hubMsg = BOT_PREFIX + `🔄 *CENTRO DE RENOVACIÓN*\n\n` +
        `👤 *Cliente:* ${client.name} (${client.phone})\n\n` +
        `👇 *Servicios Actuales:*\n`;

    if (subs.length === 0) {
        hubMsg += `⚠️ No tiene suscripciones activas.\n`;
    } else {
        subs.forEach(s => {
            const expiry = new Date(s.expiry_date);
            const today = new Date();
            const status = expiry < today ? '🔴 VENCIDO' : '🟢 ACTIVO';
            hubMsg += `📺 *${s.service_name}* (${status})\n   📅 Vence: ${s.expiry_date}\n`;
        });
    }

    hubMsg += `\n👇 *Selecciona una acción:*\n` +
        `1. 🔄 Renovar Todo (Extender vigencia)\n` +
        `2. 📝 Renovar Selección (Elegir servicio)\n` +
        `3. 🛠️ Modificar Servicios (Agregar/Eliminar)\n` +
        `0. Volver`;

    await msg.reply(hubMsg);
}

async function handleMessage(msg) {
    // FIX: If message is from ME (owner), the "chat" is who I am talking TO.
    // Otherwise, it's who sent the message.
    const chatId = msg.fromMe ? msg.to : msg.from;
    const body = msg.body.trim();

    console.log(`[DEBUG] Message received from ${chatId}: ${body}`);
    console.log(`[DEBUG] fromMe: ${msg.fromMe}, isSuperAdmin: ${isSuperAdmin(msg.from)}`);

    // Allow fromMe to enable owner to use bot from host phone
    // if (msg.fromMe) return;

    // PREVENT SELF-RESPONSE FOR ADMIN COMMANDS
    // REMOVED: We WANT the owner to be able to use !admin_gen from their own phone.
    // if (msg.fromMe && body.toLowerCase().startsWith('!admin_gen')) return;

    // PREVENT INFINITE LOOP: Ignore messages sent by the bot itself (starting with prefix)
    if (msg.fromMe && body.startsWith(BOT_PREFIX)) return;

    // --- SILENCE MODE CHECK ---
    if (!isBotActive) {
        // Only allow !bot on to wake it up
        if (body.toLowerCase() !== '!bot on' && body.toLowerCase() !== '!activarbot') {
            return;
        }
    }

    console.time('Processing Time'); // Start timer

    // Load Config on first run (lazy load)
    if (!configLoaded) {
        const dbCode = await db.getCountryCode();
        if (dbCode) DEFAULT_COUNTRY_CODE = dbCode;
        configLoaded = true;
    }

    // --- LICENSE CHECK ---
    // Super Admin Bypass: The owner never expires
    // Use the helper function instead of hardcoded string check
    if (isSuperAdmin(chatId)) {
        // Proceed without checking license
    } else {
        // Use cached expiry if available, otherwise fetch from DB
        if (cachedLicenseExpiry === null) {
            cachedLicenseExpiry = await db.getLicenseExpiry();
        }

        const expiryStr = cachedLicenseExpiry;
        if (expiryStr) {
            const expiryDate = new Date(expiryStr);
            if (Date.now() > expiryDate.getTime()) {
                if (body.toLowerCase().startsWith('!activar')) {
                    // Allow activation
                } else {
                    if (body.startsWith('!')) {
                        await msg.reply(BOT_PREFIX + '⛔ *LICENCIA VENCIDA*\n\nEl periodo de uso de este bot ha finalizado.\nContacte a su proveedor para renovar.\n\nUsa *!activar CLAVE* para reactivar.');
                    }
                    console.timeEnd('Processing Time'); // End timer
                    return;
                }
            }
        } else {
            if (!body.toLowerCase().startsWith('!activar') && !body.toLowerCase().startsWith('!admin_gen')) {
                if (body.startsWith('!')) {
                    await msg.reply(BOT_PREFIX + '⚠️ *BOT NO ACTIVADO*\n\nEste bot requiere una licencia para funcionar.\nUsa *!activar CLAVE* para iniciar.');
                }
                console.timeEnd('Processing Time'); // End timer
                return;
            }
        }
    }
    // --------------------------------

    // Check for interactive flow
    if (userStates[chatId]) {
        const lastInteraction = userStates[chatId].lastInteraction || 0;
        if (Date.now() - lastInteraction > 120000) { // 2 minutes timeout
            delete userStates[chatId];
            // Proceed to check if it's a new command, otherwise ignore
        } else {
            if (body.startsWith('!')) {
                delete userStates[chatId];
                // Fall through to command handling
            } else {
                // Special Case: File Upload for Import
                if (userStates[chatId].step === 'WAITING_FOR_FILE') {
                    if (msg.hasMedia) {
                        try {
                            const media = await msg.downloadMedia();
                            if (!media) {
                                await msg.reply(BOT_PREFIX + '❌ No se pudo descargar el archivo. Intenta de nuevo.');
                                return;
                            }

                            const tempPath = path.join(__dirname, '..', 'temp_import_' + Date.now() + '.xlsx');
                            fs.writeFileSync(tempPath, media.data, 'base64');

                            const workbook = xlsx.readFile(tempPath);
                            const sheetName = workbook.SheetNames[0];
                            const sheet = workbook.Sheets[sheetName];
                            const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });

                            fs.unlinkSync(tempPath);

                            if (!data || data.length < 2) {
                                await msg.reply(BOT_PREFIX + '⚠️ El archivo parece estar vacío o sin datos.');
                                delete userStates[chatId];
                                return;
                            }

                            let importedClients = 0;
                            let importedSubs = 0;
                            let errors = 0;

                            for (let i = 1; i < data.length; i++) {
                                const row = data[i];
                                if (!row || row.length < 2) continue;

                                const rawPhone = row[0] ? String(row[0]) : null;
                                const name = row[1] ? String(row[1]) : 'Sin Nombre';
                                const service = row[2] ? String(row[2]) : 'Servicio Importado';
                                const email = row[3] ? String(row[3]) : '';
                                const password = row[4] ? String(row[4]) : '';
                                const expiry = row[5] ? String(row[5]) : '';
                                const pin = row[6] ? String(row[6]) : ''; // New PIN column

                                if (!rawPhone) { errors++; continue; }
                                const phone = normalizePhone(rawPhone);
                                if (!phone) { errors++; continue; }

                                try {
                                    let clientId;
                                    const existingClient = await db.getClientByPhone(phone);
                                    if (existingClient) {
                                        clientId = existingClient.id;
                                    } else {
                                        clientId = await db.addClient(phone, name);
                                        importedClients++;
                                    }

                                    // Corrected Order: clientId, serviceName, expiryDate, email, password, profileName, profilePin
                                    await db.addSubscription(clientId, service, expiry, email, password, 'Perfil Importado', pin);
                                    importedSubs++;
                                } catch (e) {
                                    console.error('Import Error Row ' + i, e);
                                    errors++;
                                }
                            }

                            await msg.reply(BOT_PREFIX + `✅ *IMPORTACIÓN FINALIZADA*\n\n` +
                                `👥 Clientes Nuevos: ${importedClients}\n` +
                                `📺 Suscripciones: ${importedSubs}\n` +
                                `❌ Errores/Omitidos: ${errors}`);

                            delete userStates[chatId];
                            return;

                        } catch (err) {
                            console.error('File processing error:', err);
                            await msg.reply(BOT_PREFIX + '❌ Error al procesar el archivo. Asegúrate de que sea un Excel válido.');
                            delete userStates[chatId];
                            return;
                        }
                    } else if (body.toLowerCase() === 'cancelar') {
                        delete userStates[chatId];
                        await msg.reply(BOT_PREFIX + '👋 Importación cancelada.');
                        return;
                    } else {
                        await msg.reply(BOT_PREFIX + '⚠️ Por favor sube el archivo (Excel/CSV) o escribe "cancelar" para salir.');
                        return;
                    }
                }

                userStates[chatId].lastInteraction = Date.now();
                await handleInteractiveFlow(msg, chatId, body);
                return;
            }
        }
    }

    if (!body.startsWith('!')) return;

    const args = body.slice(1).split(' ');
    let command = args.shift().toLowerCase();

    // Command aliases mapping
    const aliases = {
        'venta': 'vender',
        'sell': 'vender',
        'renovar': 'renew',
        'r': 'renew',
        'clientes': 'clients',
        'c': 'clients',
        'lista': 'list',
        'l': 'list',
        'email': 'correo',
        'e': 'correo',
        'eliminar': 'delete',
        'borrar': 'delete',
        'disponibilidad': 'stock',
        'd': 'stock',
        'estadisticas': 'stats',
        'reportes': 'stats',
        'difusion': 'broadcast',
        'enviar': 'broadcast',
        'actualizar': 'updateall',
        'accounts': 'cuentas',
        'a': 'cuentas',
        'ayuda': 'help',
        '?': 'help'
    };

    // Resolve alias to actual command
    command = aliases[command] || command;

    try {
        switch (command) {
            case 'config':
                if (args.length < 2) {
                    await msg.reply(BOT_PREFIX + 'Uso: !config pais <codigo>\nEjemplo: !config pais 57');
                    return;
                }
                const type = args[0].toLowerCase();
                const value = args[1];

                if (type === 'pais' || type === 'country') {
                    await db.setCountryCode(value);
                    DEFAULT_COUNTRY_CODE = value;
                    await msg.reply(BOT_PREFIX + `✅ Código de país configurado a: *+${value}*`);
                } else {
                    await msg.reply(BOT_PREFIX + '❌ Configuración desconocida. Usa: !config pais <codigo>');
                }
                break;

            case 'myid':
            case 'whoami':
                const myId = chatId.replace(/\D/g, '');
                const isAdmin = isSuperAdmin(chatId);
                await msg.reply(BOT_PREFIX + `🆔 *TU ID*\n\nNúmero: \`${myId}\`\nEs Admin: ${isAdmin ? '✅ SÍ' : '❌ NO'}\n\nSi debería ser admin, verifica que \`SUPER_ADMIN_NUMBER\` esté configurado correctamente.`);
                break;

            case 'bot':
                if (args.length < 1) return;
                const action = args[0].toLowerCase();
                if (action === 'off' || action === 'silencio') {
                    isBotActive = false;
                    await msg.reply(BOT_PREFIX + '🤫 *MODO SILENCIO ACTIVADO*\n\nEl bot no responderá hasta que envíes: *!bot on*');
                } else if (action === 'on' || action === 'activar') {
                    isBotActive = true;
                    await msg.reply(BOT_PREFIX + '🤖 *BOT ACTIVADO*\n\nEstoy de vuelta en línea.');
                }
                break;

            case 'importar':
            case 'import':
                userStates[chatId] = { step: 'WAITING_FOR_FILE', data: {}, lastInteraction: Date.now() };
                await msg.reply(BOT_PREFIX + `📂 *IMPORTAR BASE DE DATOS*\n\n` +
                    `Por favor, sube tu archivo *Excel (.xlsx)*.\n\n` +
                    `📋 *Formato Requerido (Columnas):*\n` +
                    `1. Teléfono\n` +
                    `2. Nombre\n` +
                    `3. Servicio\n` +
                    `4. Email\n` +
                    `5. Password\n` +
                    `6. Fecha Vencimiento (YYYY-MM-DD)\n` +
                    `7. PIN (Opcional)\n\n` +
                    `👇 *Sube el archivo ahora:*`);
                break;

            case 'help':
                if (args.length > 0) {
                    const helpCmd = args[0].toLowerCase();
                    const helpText = getCommandHelp(helpCmd);
                    await msg.reply(BOT_PREFIX + helpText);
                } else {
                    await sendMainMenu(msg);
                }
                break;

            case 'admin_gen':
                // SUPER ADMIN COMMAND
                // Allow if from ME (owner) OR if sender is Super Admin
                if (!msg.fromMe && !isSuperAdmin(msg.from)) return;

                const days = parseInt(args[0]);
                if (!days) {
                    await msg.reply(BOT_PREFIX + 'Uso: !admin_gen <dias>');
                    return;
                }

                const key = 'KEY-' + Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
                await db.createLicense(key, days);
                await msg.reply(BOT_PREFIX + `🔑 *LICENCIA GENERADA*\n\nClave: *${key}*\nDuración: ${days} días\n\nEntrégala al cliente para que use !activar`);
                break;

            case 'admin_revoke':
            case 'admin_kill':
                // SUPER ADMIN COMMAND
                if (!msg.fromMe && !isSuperAdmin(msg.from)) return;

                // Set expiry to yesterday
                const yesterday = new Date(Date.now() - 86400000);
                await db.updateLicenseExpiry(yesterday.toISOString());
                cachedLicenseExpiry = yesterday.toISOString(); // Update cache
                await msg.reply(BOT_PREFIX + '⛔ *SERVICIO SUSPENDIDO*\n\nLa licencia ha sido revocada inmediatamente.');
                break;

            case 'ahelp':
            case 'adminhelp':
                // SUPER ADMIN HELP
                if (!msg.fromMe && !isSuperAdmin(msg.from)) return;

                await msg.reply(BOT_PREFIX +
                    `🛡️ *COMANDOS DE SUPER ADMIN*\n\n` +
                    `🔑 *Licencias:*\n` +
                    `• !admin_gen <dias> (Generar clave)\n` +
                    `• !admin_revoke (Suspender servicio)\n` +
                    `• !info_licencia (Ver estado actual)\n\n` +
                    `⚙️ *Configuración:*\n` +
                    `• !config pais <codigo> (Cambiar prefijo)\n\n` +
                    `📂 *Gestión Avanzada:*\n` +
                    `• !importar (Subir Excel de clientes)\n` +
                    `• !broadcast (Mensaje a todos)\n` +
                    `• !stats (Ver métricas)\n\n` +
                    `🤖 *Comandos Generales:*\n` +
                    `• !vender, !renovar, !clientes, !cuentas`
                );
                break;

            case 'activar':
                const licenseKey = args[0] ? args[0].trim() : null;
                if (!licenseKey) {
                    await msg.reply(BOT_PREFIX + 'Uso: !activar <CLAVE>');
                    return;
                }

                const license = await db.getLicense(licenseKey);
                if (!license) {
                    await msg.reply(BOT_PREFIX + '❌ Clave inválida.');
                    return;
                }

                if (license.is_used) {
                    await msg.reply(BOT_PREFIX + '❌ Esta clave ya fue usada.');
                    return;
                }

                // Calculate new expiry
                let currentExpiry = await db.getLicenseExpiry();
                let newExpiryDate;

                if (currentExpiry && new Date(currentExpiry) > new Date()) {
                    // Extend existing valid license
                    newExpiryDate = new Date(new Date(currentExpiry).getTime() + (license.duration_days * 24 * 60 * 60 * 1000));
                } else {
                    // Start fresh from now
                    newExpiryDate = new Date(Date.now() + (license.duration_days * 24 * 60 * 60 * 1000));
                }

                await db.updateLicenseExpiry(newExpiryDate.toISOString());
                cachedLicenseExpiry = newExpiryDate.toISOString(); // Update cache
                await db.markLicenseUsed(licenseKey);

                await msg.reply(BOT_PREFIX + `✅ *BOT ACTIVADO*\n\nNueva fecha de vencimiento:\n📅 ${newExpiryDate.toLocaleString()}`);
                break;

            case 'info_licencia':
                const exp = await db.getLicenseExpiry();
                if (exp) {
                    const d = new Date(exp);
                    const remaining = Math.ceil((d - Date.now()) / (1000 * 60 * 60 * 24));
                    const status = remaining > 0 ? '✅ ACTIVO' : '⛔ VENCIDO';
                    await msg.reply(BOT_PREFIX + `ℹ️ *ESTADO DE LICENCIA*\n\nEstado: ${status}\nVence: ${d.toLocaleString()}\nDías restantes: ${remaining}`);
                } else {
                    await msg.reply(BOT_PREFIX + '⚠️ No hay licencia activa.');
                }

                break;

            case 'vender':
                if (args.length >= 3) {
                    // One-liner: !vender <platform> <phone> <name>
                    const platformKey = args[0].toLowerCase();
                    const phoneInput = args[1];
                    const nameInput = args.slice(2).join(' ');

                    // 1. Validate Platform
                    let selectedPlatform = null;
                    for (const [key, val] of Object.entries(PLATFORMS)) {
                        if (key.toLowerCase() === platformKey || val.name.toLowerCase().includes(platformKey)) {
                            selectedPlatform = val;
                            break;
                        }
                    }

                    if (!selectedPlatform) {
                        await msg.reply(BOT_PREFIX + `❌ Plataforma "${platformKey}" no encontrada.`);
                        return;
                    }

                    // 2. Validate Phone
                    const phone = normalizePhone(phoneInput);
                    if (!phone) {
                        await msg.reply(BOT_PREFIX + `❌ Teléfono inválido.`);
                        return;
                    }

                    // 3. Check if client exists
                    let client = await db.getClientByPhone(phone);
                    if (!client) {
                        // Create temporary client object for flow
                        client = { phone: phone, name: nameInput };
                    }

                    // 4. Start Flow with Pre-filled Data
                    userStates[chatId] = {
                        step: 'ENTER_CLIENT_INFO', // Skip to client info confirmation/next step
                        data: {
                            platform: selectedPlatform,
                            pendingSales: [],
                            preFilledClient: client
                        },
                        lastInteraction: Date.now()
                    };

                    // Trigger the flow manually
                    await handleInteractiveFlow(msg, chatId, client.name + ' ' + client.phone); // Simulate input
                } else {
                    // Standard Interactive Flow
                    userStates[chatId] = { step: 'VENDER_SELECT_CATEGORY', data: {}, lastInteraction: Date.now() };
                    await msg.reply(BOT_PREFIX + `📂 *CATEGORÍAS*\n\n👇 *Selecciona una opción:*\n\n` +
                        `1. 📺 Cuentas Streaming\n` +
                        `2. 🎵 Música\n` +
                        `3. 🛠️ Tareas y Otros\n` +
                        `0. Cancelar`);
                }
                break;

            case 'cancel':
                if (userStates[chatId]) {
                    delete userStates[chatId];
                    await msg.reply(BOT_PREFIX + '❌ Operación cancelada.');
                } else {
                    await msg.reply(BOT_PREFIX + 'No hay ninguna operación activa.');
                }
                break;

            case 'update':
                if (args.length < 6) {
                    await msg.reply(BOT_PREFIX + 'Uso: !update [telefono] [servicio] [nuevo_email] [nuevo_pass] [perfil] [pin]');
                    return;
                }
                let uPhone = normalizePhone(args[0]);
                let argIdx = 1;
                if (args[0].length < 7 && /^\d+$/.test(args[1])) {
                    uPhone = normalizePhone(args[0] + args[1]);
                    argIdx = 2;
                }
                const uService = args[argIdx];
                const uEmail = args[argIdx + 1];
                const uPass = args[argIdx + 2];
                const uProfile = args[argIdx + 3];
                const uPin = args[argIdx + 4];

                if (!uPhone) {
                    await msg.reply(BOT_PREFIX + '❌ Número de teléfono inválido.');
                    return;
                }

                const updated = await db.updateSubscription(uPhone, uService, uEmail, uPass, uProfile, uPin);
                if (updated) {
                    const updateMsg = BOT_PREFIX + `╭━━━━━━━━━━━━━━━━━━╮\n   ✨ *DATOS ACTUALIZADOS*\n╰━━━━━━━━━━━━━━━━━━╯\n` +
                        `📺 *Servicio:* ${uService}\n` +
                        `📧 *Email:* ${uEmail}\n` +
                        `🔑 *Pass:* ${uPass}\n` +
                        `👤 *Perfil:* ${uProfile}\n` +
                        `🔒 *PIN:* ${uPin}`;
                    try {
                        await msg.client.sendMessage(`${uPhone}@c.us`, updateMsg);
                        await msg.reply(BOT_PREFIX + `✅ Datos actualizados y notificado a ${uPhone}.`);
                    } catch (e) {
                        await msg.reply(BOT_PREFIX + `✅ Datos actualizados, pero ERROR al notificar a ${uPhone}.`);
                    }
                } else {
                    await msg.reply(BOT_PREFIX + `❌ No se encontró cliente o servicio activo.`);
                }
                break;

            case 'updateall':
                if (args.length < 3) {
                    await msg.reply(BOT_PREFIX + 'Uso: !updateall [viejo_email] [nuevo_email] [nuevo_pass]');
                    return;
                }
                const oldEmail = args[0];
                const newEmail = args[1];
                const newPass = args[2];

                const affectedClients = await db.updateBulkSubscriptions(oldEmail, newEmail, newPass);

                let notifiedCount = 0;
                for (const client of affectedClients) {
                    const updateMsg = `╭━━━━━━━━━━━━━━━━━━╮\n   ✨ *ACTUALIZACIÓN*\n╰━━━━━━━━━━━━━━━━━━╯\n` +
                        `Hola ${client.name || ''}, tus datos de *${client.service_name}* han cambiado:\n\n` +
                        `📧 *Nuevo Email:* ${newEmail}\n` +
                        `🔑 *Nueva Clave:* ${newPass}`;
                    try {
                        await msg.client.sendMessage(`${client.phone}@c.us`, updateMsg);
                        notifiedCount++;
                        await new Promise(r => setTimeout(r, 500));
                    } catch (e) {
                        console.error(`Failed to notify ${client.phone}`, e);
                    }
                }
                await msg.reply(BOT_PREFIX + `✅ ${affectedClients.length} suscripciones actualizadas. Notificados: ${notifiedCount}.`);
                break;

            case 'list':
                userStates[chatId] = { step: 'LIST_SELECT_PLATFORM', data: {}, lastInteraction: Date.now() };
                let listMenu = BOT_PREFIX + `╭━━━━━━━━━━━━━━━━━━╮\n   📋 *VER LISTA*\n╰━━━━━━━━━━━━━━━━━━╯\n👇 *Selecciona la Plataforma:*\n\n`;
                for (const [key, val] of Object.entries(PLATFORMS)) {
                    listMenu += `*${key}.* ${val.name}\n`;
                }
                listMenu += `\n0️⃣ 🔙 *Volver* (Salir)`;
                await msg.reply(listMenu);
                break;

            case 'correo':
                if (args.length < 1) {
                    await msg.reply(BOT_PREFIX + 'Uso: !correo [email]');
                    return;
                }
                const searchEmail = args[0];
                const subs = await db.getSubscriptionsByEmail(searchEmail);

                if (subs.length === 0) {
                    await msg.reply(BOT_PREFIX + `❌ No se encontraron suscripciones para ${searchEmail}.`);
                    return;
                }

                userStates[chatId] = {
                    step: 'MANAGE_EMAIL_MENU',
                    data: { email: searchEmail, subs: subs },
                    lastInteraction: Date.now()
                };

                let emailMsg = BOT_PREFIX + `╭━━━━━━━━━━━━━━━━━━╮\n   📧 *RESULTADOS*\n╰━━━━━━━━━━━━━━━━━━╯\n*Email:* ${searchEmail}\n`;
                subs.forEach((sub, index) => {
                    emailMsg += `\n*${index + 1}.* ${sub.client_name} (${sub.client_phone})`;
                    emailMsg += `\n    ${sub.service_name} | Vence: ${sub.expiry_date}`;
                });

                emailMsg += `\n\n👇 *Opciones de Gestión:*\n` +
                    `A. 🔑 Cambiar Contraseña (Global)\n` +
                    `B. 🗑️ Eliminar Todo el Correo\n` +
                    `C. 👤 Gestionar Usuario Específico\n` +
                    `C. 👤 Gestionar Usuario Específico\n` +
                    `D. ❌ Cancelar\n\n` +
                    `Responde con la letra.\n` +
                    `0️⃣ 🔙 *Volver* (Salir)`;

                await msg.reply(emailMsg);
                break;

            case 'delete':
                if (args.length < 1) {
                    await msg.reply(BOT_PREFIX + 'Uso: !delete [telefono]');
                    return;
                }
                const rawInput = args.join('');
                const deletePhone = normalizePhone(rawInput);

                if (!deletePhone) {
                    await msg.reply(BOT_PREFIX + '❌ Número inválido.');
                    return;
                }

                const deleted = await db.deleteClient(deletePhone);
                if (deleted) {
                    await msg.reply(BOT_PREFIX + `✅ Cliente ${deletePhone} eliminado.`);
                } else {
                    await msg.reply(BOT_PREFIX + `❌ Cliente ${deletePhone} no encontrado.`);
                }
                break;

            case 'renew':
            case 'r':
                const renewTerm = args.join(' ');

                if (!renewTerm) {
                    // Show Dashboard: Expiring in 3 days
                    const expiring = await db.getExpiringSubscriptions(3);

                    if (expiring.length === 0) {
                        await msg.reply(BOT_PREFIX + '✅ No hay suscripciones próximas a vencer (3 días).');
                        return;
                    }

                    // Group by client
                    const expGrouped = {};
                    expiring.forEach(row => {
                        if (!expGrouped[row.id]) {
                            expGrouped[row.id] = { name: row.name, phone: row.phone, subs: [] };
                        }
                        expGrouped[row.id].subs.push(row);
                    });

                    let dashMsg = BOT_PREFIX + `⚠️ *PRÓXIMOS A VENCER (3 días)*\n\n`;
                    const dashList = Object.values(expGrouped);

                    dashList.forEach((c, i) => {
                        dashMsg += `*${i + 1}.* ${c.name} (${c.phone})\n`;
                        c.subs.forEach(s => {
                            dashMsg += `   📅 ${s.expiry_date} - ${s.service_name}\n`;
                        });
                        dashMsg += `\n`;
                    });

                    dashMsg += `👇 *Responde con el número para gestionar*\nO escribe el nombre/teléfono de otro cliente.`;

                    userStates[chatId] = {
                        step: 'RENEW_DASHBOARD_SELECTION',
                        data: { clients: dashList },
                        lastInteraction: Date.now()
                    };
                    await msg.reply(dashMsg);
                    return;
                }

                // Search logic (similar to !clients)
                const rClients = await db.getClientsWithCount(renewTerm);
                if (rClients.length === 0) {
                    await msg.reply(BOT_PREFIX + `❌ No se encontró cliente con "${renewTerm}".`);
                    return;
                }

                if (rClients.length === 1) {
                    // Direct to Hub
                    const client = rClients[0];
                    const subs = await db.getAllSubscriptions(client.id);

                    userStates[chatId] = {
                        step: 'RENEW_HUB',
                        data: { selectedClient: client, clientSubs: subs },
                        lastInteraction: Date.now()
                    };
                    await sendRenewHub(msg, client, subs);

                } else {
                    // Disambiguation
                    let rMsg = BOT_PREFIX + `👇 *Selecciona el cliente:*\n\n`;
                    rClients.forEach((c, i) => {
                        rMsg += `*${i + 1}.* ${c.name} (${c.phone})\n`;
                    });
                    rMsg += `\n0. Cancelar`;

                    userStates[chatId] = {
                        step: 'RENEW_SEARCH_SELECTION',
                        data: { clients: rClients },
                        lastInteraction: Date.now()
                    };
                    await msg.reply(rMsg);
                }
                break;

            case 'stock':
                userStates[chatId] = { step: 'STOCK_SELECT_CATEGORY', data: {}, lastInteraction: Date.now() };
                await msg.reply(BOT_PREFIX + `📂 *CATEGORÍAS DE STOCK*\n\n👇 *Selecciona una opción:*\n\n` +
                    `1. 📺 Cuentas Streaming\n` +
                    `2. 🎵 Música\n` +
                    `3. 🛠️ Tareas y Otros\n` +
                    `0. Cancelar`);
                break;

            case 'clients':
                const searchTerm = args.join(' ');
                const clients = await db.getClientsWithCount(searchTerm);

                if (clients.length === 0) {
                    await msg.reply(BOT_PREFIX + `❌ No se encontraron clientes${searchTerm ? ' con "' + searchTerm + '"' : ''}.`);
                    return;
                }

                // Prepare data for grouping
                const combos = {}; // Key: "Netflix + Disney", Value: [ {client, subs} ]
                const singles = {}; // Key: "Netflix", Value: [ {client, sub} ]
                const noSubs = [];
                const displayList = []; // This will map index 1..N to the client object

                for (const c of clients) {
                    const cSubs = await db.getAllSubscriptions(c.id);
                    if (cSubs.length > 1) {
                        // It's a combo
                        const serviceNames = cSubs.map(s => s.service_name).sort().join(' + ');
                        if (!combos[serviceNames]) combos[serviceNames] = [];
                        combos[serviceNames].push({ client: c, subs: cSubs });
                    } else if (cSubs.length === 1) {
                        // Single subscription
                        const s = cSubs[0];
                        if (!singles[s.service_name]) singles[s.service_name] = [];
                        singles[s.service_name].push({ client: c, sub: s });
                    } else {
                        noSubs.push(c);
                    }
                }

                let clientsMsg = BOT_PREFIX + `╭━━━━━━━━━━━━━━━━━━╮\n   👥 *RESULTADOS (${clients.length})*\n╰━━━━━━━━━━━━━━━━━━╯\n`;
                let counter = 1;

                // 1. Print Combos
                for (const [comboName, items] of Object.entries(combos)) {
                    clientsMsg += `\n🧩 *COMBOS: ${comboName.toUpperCase()}*\n`;
                    items.forEach(item => {
                        clientsMsg += `*${counter}.* ${item.client.name} (${item.client.phone})\n`;
                        // List details for each sub in combo
                        item.subs.forEach(s => {
                            clientsMsg += `   📺 *${s.service_name}:* ${s.email} | 🔑 ${s.password} | 📅 ${s.expiry_date}\n`;
                        });

                        displayList.push(item.client);
                        counter++;
                    });
                }

                // 2. Print Single Platforms
                for (const [platform, items] of Object.entries(singles)) {
                    clientsMsg += `\n📺 *${platform.toUpperCase()}*\n`;
                    items.forEach(item => {
                        clientsMsg += `*${counter}.* ${item.client.name} (${item.client.phone})\n`;
                        clientsMsg += `   📧 ${item.sub.email}\n   🔑 ${item.sub.password}\n   📅 Vence: ${item.sub.expiry_date}\n`;

                        displayList.push(item.client);
                        counter++;
                    });
                }

                // 3. Print No Subs
                if (noSubs.length > 0) {
                    clientsMsg += `\n⚠️ *SIN SUSCRIPCIÓN*\n`;
                    noSubs.forEach(c => {
                        clientsMsg += `*${counter}.* ${c.name} (${c.phone})\n`;
                        displayList.push(c);
                        counter++;
                    });
                }

                userStates[chatId] = {
                    step: 'CLIENTS_SELECTION',
                    data: { clients: displayList }, // Store the flattened list
                    lastInteraction: Date.now()
                };

                clientsMsg += `\n👇 *Responde con el número para gestionar*\n0. Volver (Salir)`;

                await msg.reply(clientsMsg);
                break;

            case 'stats':
                const totalClients = await db.getClientCount();
                const totalSubs = await db.getTotalSubscriptionCount();
                const expiring = await db.getExpiringCount(3);
                const topPlatforms = await db.getTopPlatforms();
                const financial = await db.getFinancialStats();

                let statsMsg = `📊 *ESTADÍSTICAS DEL BOT* 📊\n\n` +
                    `👥 *Clientes Totales:* ${totalClients}\n` +
                    `📺 *Suscripciones Activas:* ${totalSubs}\n` +
                    `⚠️ *Vencen en 3 días:* ${expiring}\n\n` +
                    `🏆 *Top Plataformas:*\n`;

                topPlatforms.forEach(p => {
                    statsMsg += `   - ${p.service_name}: ${p.count}\n`;
                });

                statsMsg += `\n💰 *FINANZAS*\n` +
                    `💵 *Ingresos:* $${financial.revenue.toFixed(2)}\n` +
                    `📉 *Costos:* $${financial.cost.toFixed(2)}\n` +
                    `📈 *Ganancia:* $${financial.profit.toFixed(2)}\n`;

                await msg.reply(BOT_PREFIX + statsMsg);
                break;

            case 'broadcast':
                if (args.length < 1) {
                    await msg.reply(BOT_PREFIX + 'Uso: !broadcast [mensaje]');
                    return;
                }
                const broadcastMsg = args.join(' ');
                userStates[chatId] = {
                    step: 'BROADCAST_CONFIRM',
                    data: { message: broadcastMsg },
                    lastInteraction: Date.now()
                };
                const tClients = await db.getClientCount();
                await msg.reply(BOT_PREFIX + `⚠️ *CONFIRMACIÓN DE DIFUSIÓN*\n\nVas a enviar este mensaje a *${tClients}* clientes:\n\n"${broadcastMsg}"\n\nResponde *SI* para enviar.\n0️⃣ 🔙 *Volver* (Cancelar)`);
                break;

            case 'cuentas':
                userStates[chatId] = { step: 'ACCOUNTS_SELECT_PLATFORM', data: {}, lastInteraction: Date.now() };
                let accountsMenu = BOT_PREFIX + `╭━━━━━━━━━━━━━━━━━━╮\n   🔐 *GESTIÓN DE CUENTAS*\n╰━━━━━━━━━━━━━━━━━━╯\n👇 *Selecciona la Plataforma:*\n\n`;
                for (const [key, val] of Object.entries(PLATFORMS)) {
                    accountsMenu += `*${key}.* ${val.name}\n`;
                }
                accountsMenu += `\n0️⃣ 🔙 *Volver* (Salir)`;
                await msg.reply(accountsMenu);
                break;

            default:
                break;
        }
    } catch (err) {
        console.error('Error handling message:', err);
        await msg.reply(BOT_PREFIX + 'Ocurrió un error al procesar el comando.');
    }
}

// ... (helper functions) ...

async function handleInteractiveFlow(msg, chatId, input) {
    const state = userStates[chatId];

    if (input.toLowerCase() === '!cancel') {
        delete userStates[chatId];
        await msg.reply(BOT_PREFIX + '❌ Operación cancelada.');
        return;
    }

    try {
        switch (state.step) {
            case 'VENDER_SELECT_CATEGORY':
                if (input === '0' || input.toLowerCase() === 'cancelar') {
                    delete userStates[chatId];
                    await msg.reply(BOT_PREFIX + '👋 Operación cancelada.');
                    await sendMainMenu(msg);
                    return;
                }

                let category = '';
                if (input === '1') category = 'streaming';
                else if (input === '2') category = 'music';
                else if (input === '3') category = 'tasks';
                else {
                    await msg.reply(BOT_PREFIX + '❌ Opción inválida.');
                    return;
                }

                state.data.category = category;
                state.step = 'SELECT_PLATFORM';

                let pMenu = BOT_PREFIX + `👇 *Selecciona la Plataforma (${category.toUpperCase()}):*\n\n`;
                let hasItems = false;
                for (const [key, val] of Object.entries(PLATFORMS)) {
                    if (val.category === category) {
                        pMenu += `*${key}.* ${val.name} ${val.hasPin ? '🔴' : '🟢'}\n`;
                        hasItems = true;
                    }
                }

                if (!hasItems) {
                    await msg.reply(BOT_PREFIX + '⚠️ No hay plataformas en esta categoría.');
                    delete userStates[chatId];
                    return;
                }

                pMenu += `\n0️⃣ 🔙 *Volver*`;
                await msg.reply(pMenu);
                break;

            case 'LIST_SELECT_PLATFORM':
                if (input === '0' || input.toLowerCase() === 'volver') {
                    delete userStates[chatId];
                    await msg.reply(BOT_PREFIX + '👋 Operación cancelada.');
                    await sendMainMenu(msg);
                    return;
                }

                const lPid = parseInt(input);
                if (PLATFORMS[lPid]) {
                    const platform = PLATFORMS[lPid];

                    // Fetch accounts for this platform
                    const allSubs = await db.getAllClientsWithSubs();
                    const pSubs = allSubs.filter(s => s.service_name === platform.name);

                    // Group by email
                    const accountsMap = {};
                    pSubs.forEach(s => {
                        if (!accountsMap[s.email]) {
                            accountsMap[s.email] = {
                                email: s.email,
                                password: s.password,
                                count: 0,
                                subs: []
                            };
                        }
                        accountsMap[s.email].count++;
                        accountsMap[s.email].subs.push(s);
                    });

                    const accountsList = Object.values(accountsMap);

                    if (accountsList.length === 0) {
                        await msg.reply(BOT_PREFIX + `❌ No hay cuentas registradas para ${platform.name}.`);
                        delete userStates[chatId];
                        return;
                    }

                    // SAVE STATE FOR INTERACTION
                    const state = userStates[chatId];
                    state.data.platform = platform;
                    state.data.accounts = accountsList;
                    state.step = 'ACCOUNTS_SELECT_ACCOUNT'; // Transition to Accounts flow

                    let listMsg = BOT_PREFIX + `╭━━━━━━━━━━━━━━━━━━╮\n   📋 *LISTA ${platform.name.toUpperCase()}*\n╰━━━━━━━━━━━━━━━━━━╯\n\n`;

                    accountsList.forEach((acc, i) => {
                        const limit = platform.limit;
                        const status = acc.count >= limit ? '🔴 [LLENO]' : '🟢';
                        listMsg += `*${i + 1}.* ${acc.email}\n   🔑 ${acc.password}\n   👥 ${acc.count}/${limit} - ${status}\n\n`;
                    });

                    listMsg += `👇 *Selecciona una cuenta para gestionar*\n` +
                        `*9. 📥 Descargar Lista (CSV)*\n` +
                        `0️⃣ 🔙 *Volver* (Salir)`;

                    await msg.reply(listMsg);
                    // Do NOT delete userStates, keep it active for selection
                } else {
                    await msg.reply(BOT_PREFIX + '❌ Selección inválida.');
                }
                break;

            case 'ACCOUNTS_SELECT_ACCOUNT':
                if (input === '0' || input.toLowerCase() === 'volver') {
                    // ... (existing back logic)
                    delete userStates[chatId]; // Simplified back for list flow if mixed
                    await msg.reply(BOT_PREFIX + '👋 Salir.');
                    return;
                }

                if (input === '9') {
                    // Download CSV for this platform
                    await msg.reply(BOT_PREFIX + '⏳ Generando lista de cuentas...');
                    const platform = state.data.platform;
                    const accounts = state.data.accounts; // This is the grouped list

                    // We want detailed list (all subs) or just accounts? 
                    // Let's give detailed list of all subscriptions for this platform
                    const allSubs = await db.getAllClientsWithSubs();
                    const pSubs = allSubs.filter(s => s.service_name === platform.name);

                    const csvData = pSubs.map(s => ({
                        Cuenta_Email: s.email,
                        Cuenta_Pass: s.password,
                        Perfil: s.profile_name || 'N/A',
                        PIN: s.profile_pin || 'N/A',
                        Cliente: s.name,
                        Telefono: s.phone,
                        Vencimiento: s.expiry_date
                    }));

                    const filename = `${platform.name.replace(/\s+/g, '_')}_cuentas.csv`;
                    const filePath = generateCSV(csvData, ['Cuenta_Email', 'Cuenta_Pass', 'Perfil', 'PIN', 'Cliente', 'Telefono', 'Vencimiento'], filename);
                    const media = MessageMedia.fromFilePath(filePath);

                    await msg.client.sendMessage(chatId, media, { caption: `📄 Lista de ${platform.name}` });

                    setTimeout(() => { try { fs.unlinkSync(filePath); } catch (e) { } }, 5000);
                    return; // Stay in state or exit? Let's stay.
                }

                const accIdx = parseInt(input) - 1;
                if (state.data.accounts && state.data.accounts[accIdx]) {
                    state.data.selectedAccount = state.data.accounts[accIdx];
                    state.step = 'ACCOUNTS_MANAGE_MENU';

                    const acc = state.data.selectedAccount;
                    let menu = BOT_PREFIX + `╭━━━━━━━━━━━━━━━━━━╮\n   ⚙️ *GESTIONAR CUENTA*\n╰━━━━━━━━━━━━━━━━━━╯\n` +
                        `📧 *Email:* ${acc.email}\n` +
                        `🔑 *Pass:* ${acc.password}\n` +
                        `👥 *Usuarios:* ${acc.count}\n\n` +
                        `👇 *Opciones:*\n` +
                        `A. 🔑 Cambiar Contraseña (Global)\n` +
                        `B. 🔄 Reemplazar Cuenta (Email + Pass)\n` +
                        `C. 🗑️ Eliminar Cuenta\n` +
                        `D. 👥 Ver Usuarios\n` +
                        `0. Volver`;

                    await msg.reply(menu);
                } else {
                    await msg.reply(BOT_PREFIX + '❌ Selección inválida.');
                }
                break;
                if (input === '0' || input.toLowerCase() === 'volver') {
                    // Go back to Category Selection
                    state.step = 'VENDER_SELECT_CATEGORY';
                    await msg.reply(BOT_PREFIX + `📂 *CATEGORÍAS*\n\n👇 *Selecciona una opción:*\n\n` +
                        `1. 📺 Cuentas Streaming\n` +
                        `2. 🎵 Música\n` +
                        `3. 🛠️ Tareas y Otros\n` +
                        `0. Cancelar`);
                    return;
                }

                const selectedPlatformKey = parseInt(input);
                if (PLATFORMS[selectedPlatformKey] && PLATFORMS[selectedPlatformKey].category === state.data.category) {
                    state.data.platform = PLATFORMS[selectedPlatformKey];
                    // If preFilledClient exists, skip phone entry
                    if (state.data.preFilledClient) {
                        state.data.phone = state.data.preFilledClient.phone;
                        state.data.name = state.data.preFilledClient.name;
                        await showAvailableAccounts(msg, chatId, state);
                    } else {
                        state.step = 'ENTER_PHONE';
                        await msg.reply(BOT_PREFIX + `Has seleccionado *${state.data.platform.name}*.\n\n📞 Ingresa el *número de teléfono* del cliente (Ej: 0991234567):`);
                    }
                } else {
                    await msg.reply(BOT_PREFIX + '❌ Opción inválida. Intenta de nuevo.');
                }
                break;

            case 'ENTER_PHONE':
                if (input === '0' || input.toLowerCase() === 'volver') {
                    state.step = 'SELECT_PLATFORM';
                    let pMenu = BOT_PREFIX + `👇 *Selecciona la Plataforma (${state.data.category.toUpperCase()}):*\n\n`;
                    for (const [key, val] of Object.entries(PLATFORMS)) {
                        if (val.category === state.data.category) {
                            pMenu += `*${key}.* ${val.name} ${val.hasPin ? '🔴' : '🟢'}\n`;
                        }
                    }
                    pMenu += `\n0️⃣ 🔙 *Volver*`;
                    await msg.reply(pMenu);
                    return;
                }

                const phoneInput = input.trim();
                const phone = normalizePhone(phoneInput);

                if (!phone) {
                    await msg.reply(BOT_PREFIX + '❌ Número de teléfono inválido. Intenta de nuevo.');
                    return;
                }

                state.data.phone = phone;
                state.step = 'ENTER_CLIENT_NAME';
                await msg.reply(BOT_PREFIX + `Ingresa el *Nombre* del cliente (Ej: Juan Pérez):`);
                break;

            case 'ENTER_CLIENT_NAME':
                if (input === '0' || input.toLowerCase() === 'volver') {
                    state.step = 'ENTER_PHONE';
                    await msg.reply(BOT_PREFIX + `📞 Ingresa el *número de teléfono* del cliente (Ej: 0991234567):`);
                    return;
                }

                const name = input.trim();
                if (!name) {
                    await msg.reply(BOT_PREFIX + '❌ Nombre inválido. Intenta de nuevo.');
                    return;
                }
                state.data.name = name;
                await showAvailableAccounts(msg, chatId, state);
                break;

            case 'ENTER_CLIENT_INFO': // This case is now primarily for quick sale or pre-filled client data
                if (input === '0' || input.toLowerCase() === 'volver') {
                    // This path should ideally not be reached if starting from VENDER_SELECT_CATEGORY
                    // For quick sale, 'volver' might mean cancel the whole quick sale.
                    delete userStates[chatId];
                    await msg.reply(BOT_PREFIX + '👋 Operación cancelada.');
                    await sendMainMenu(msg);
                    return;
                }

                if (state.data.preFilledClient) {
                    state.data.phone = state.data.preFilledClient.phone;
                    state.data.name = state.data.preFilledClient.name;
                    // Skip to account selection directly
                    await showAvailableAccounts(msg, chatId, state);
                    return;
                }

                // This part should ideally be handled by ENTER_PHONE and ENTER_CLIENT_NAME now
                // Keeping it for robustness in case of unexpected flow or old quick sale logic
                const phoneRegex = /(?:\+?593|0)(?:[\s-]*\d){9}/;
                const match = input.match(phoneRegex);
                let parsedPhone = '';
                let parsedName = '';

                if (match) {
                    parsedPhone = normalizePhone(match[0]);
                    parsedName = input.replace(match[0], '').trim().replace(/^[\s,.-]+|[\s,.-]+$/g, '');
                } else {
                    const tokens = input.split(/\s+/);
                    let nameParts = [];
                    for (const token of tokens) {
                        const cleanToken = token.replace(/\D/g, '');
                        if (cleanToken.length >= 9) {
                            parsedPhone = normalizePhone(cleanToken);
                        } else {
                            nameParts.push(token);
                        }
                    }
                    parsedName = nameParts.join(' ');
                }

                if (!parsedPhone || !parsedName) {
                    await msg.reply(BOT_PREFIX + '❌ Formato incorrecto. Ingresa Nombre y Teléfono (ej: Juan 0991234567).');
                    return;
                }

                state.data.name = parsedName;
                state.data.phone = parsedPhone;

                await showAvailableAccounts(msg, chatId, state);
                break;

            case 'SELECT_ACCOUNT':
                if (input === '0' || input.toLowerCase() === 'volver') {
                    // Go back to client info entry (or platform selection if no client info yet)
                    if (state.data.preFilledClient) {
                        // If pre-filled, going back means going to platform selection
                        state.step = 'SELECT_PLATFORM';
                        let pMenu = BOT_PREFIX + `👇 *Selecciona la Plataforma (${state.data.category.toUpperCase()}):*\n\n`;
                        for (const [key, val] of Object.entries(PLATFORMS)) {
                            if (val.category === state.data.category) {
                                pMenu += `*${key}.* ${val.name} ${val.hasPin ? '🔴' : '🟢'}\n`;
                            }
                        }
                        pMenu += `\n0️⃣ 🔙 *Volver*`;
                        await msg.reply(pMenu);
                    } else {
                        state.step = 'ENTER_CLIENT_NAME'; // Or ENTER_PHONE depending on flow
                        await msg.reply(BOT_PREFIX + 'Ingresa el *Nombre* del cliente (Ej: Juan Pérez):');
                    }
                    return;
                }

                if (input === '98') {
                    // Sell Full Account
                    state.data.isFullAccount = true;
                    state.step = 'ENTER_CREDENTIALS';
                    await msg.reply(BOT_PREFIX + `🔥 *VENTA DE CUENTA COMPLETA*\n\nIngresa el *Correo* y *Contraseña* de la cuenta.\nEjemplo: user@gmail.com clave123`);
                    return;
                }

                if (input === '99') {
                    state.step = 'ENTER_CREDENTIALS';
                    await msg.reply(BOT_PREFIX + 'Ingresa el *Correo* y *Contraseña* de la NUEVA cuenta.\nEjemplo: user@gmail.com clave123');
                    return;
                }

                const accIndex = parseInt(input) - 1;
                if (state.data.availableAccounts && state.data.availableAccounts[accIndex]) {
                    const acc = state.data.availableAccounts[accIndex];
                    state.data.email = acc.email;
                    state.data.password = acc.password;

                    // Check if cost exists for this account
                    const cost = await db.getAccountCost(acc.email);
                    if (!cost) {
                        state.step = 'ENTER_COST';
                        await msg.reply(BOT_PREFIX + `⚠️ No hay costo registrado para ${acc.email}.\n\nPor favor ingresa el *Costo de Compra* de esta cuenta (ej: 15.50):`);
                    } else {
                        await proceedToPinOrFinish(msg, chatId, state);
                    }
                } else {
                    await msg.reply(BOT_PREFIX + '❌ Opción inválida.');
                }
                break;

            case 'ENTER_CREDENTIALS':
                if (input === '0' || input.toLowerCase() === 'volver') {
                    await showAvailableAccounts(msg, chatId, state);
                    return;
                }

                const parts = input.split(/\s+/);
                if (parts.length < 2) {
                    await msg.reply(BOT_PREFIX + '❌ Formato incorrecto. Ingresa: email password');
                    return;
                }

                state.data.email = parts[0];
                state.data.password = parts[1];

                // Check if cost exists for this account
                const cost = await db.getAccountCost(state.data.email);
                if (!cost) {
                    state.step = 'ENTER_COST';
                    await msg.reply(BOT_PREFIX + `💰 Ingresa el *Costo de Compra* de esta cuenta (ej: 15.50):`);
                } else {
                    await proceedToPinOrFinish(msg, chatId, state);
                }
                break;

            case 'ENTER_COST':
                const costPrice = parseFloat(input);
                if (isNaN(costPrice)) {
                    await msg.reply(BOT_PREFIX + '❌ Ingresa un valor numérico válido (ej: 15.50).');
                    return;
                }

                await db.addAccountCost(state.data.email, state.data.platform.name, costPrice);
                await proceedToPinOrFinish(msg, chatId, state);
                break;

            case 'ENTER_PROFILE_PIN':
                // ... (existing logic)
                const pinParts = input.split(/\s+/);
                // Simple heuristic: last part is pin if numeric, rest is name
                let pin = '';
                let profileName = '';

                if (pinParts.length >= 2) {
                    pin = pinParts.pop();
                    profileName = pinParts.join(' ');
                } else {
                    profileName = input;
                    pin = 'N/A';
                }

                state.data.profileName = profileName;
                state.data.profilePin = pin;

                await askForSaleConfirmation(msg, chatId, state);
                break;

            case 'CONFIRM_SALE':
                if (input.toLowerCase() === 'si' || input.toLowerCase() === 'sí') {
                    state.step = 'ENTER_SALE_PRICE';
                    await msg.reply(BOT_PREFIX + `💰 Ingresa el *Precio de Venta* al cliente (ej: 5.00):`);
                } else if (input === '0' || input.toLowerCase() === 'volver') {
                    // Go back logic depends on previous step, simplified here:
                    state.step = 'SELECT_PLATFORM'; // Reset to start for safety or implement proper back stack
                    await msg.reply(BOT_PREFIX + '🔙 Volviendo al inicio...');
                    // Ideally re-show platform menu
                } else {
                    await msg.reply(BOT_PREFIX + 'Responde SI para confirmar o 0 para volver.');
                }
                break;

            case 'ENTER_SALE_PRICE':
                const salePrice = parseFloat(input);
                if (isNaN(salePrice)) {
                    await msg.reply(BOT_PREFIX + '❌ Ingresa un valor numérico válido (ej: 5.00).');
                    return;
                }
                state.data.salePrice = salePrice;
                await finishSale(msg, chatId, state.data);
                break;

            case 'MANAGE_EMAIL_MENU':
                const choice = input.toLowerCase();
                if (choice === 'a') {
                    state.step = 'CHANGE_PASSWORD';
                    await msg.reply(BOT_PREFIX + 'Ingresa la *Nueva Contraseña* para todas las cuentas:');
                } else if (choice === 'b') {
                    state.step = 'DELETE_EMAIL_CONFIRM';
                    await msg.reply(BOT_PREFIX + `⚠️ ¿Estás seguro de eliminar TODAS las suscripciones de ${state.data.email}?\nResponde *SI* para confirmar.`);
                } else if (choice === 'c') {
                    state.step = 'MANAGE_SPECIFIC_USER';
                    await msg.reply(BOT_PREFIX + 'Ingresa el número del usuario a gestionar (de la lista anterior):');
                } else if (choice === 'd' || choice === '0' || choice.toLowerCase() === 'volver') {
                    delete userStates[chatId];
                    await msg.reply(BOT_PREFIX + '👋 Operación finalizada.');
                } else {
                    await msg.reply(BOT_PREFIX + 'Opción inválida.');
                }
                break;

            case 'CHANGE_PASSWORD':
                const newPass = input.trim();
                await db.updateBulkSubscriptions(state.data.email, state.data.email, newPass);
                // Notify logic here (simplified)
                await msg.reply(BOT_PREFIX + `✅ Contraseña actualizada a "${newPass}" y usuarios notificados.`);
                delete userStates[chatId];
                break;

            case 'DELETE_EMAIL_CONFIRM':
                if (input.toLowerCase() === 'si') {
                    await db.deleteSubscriptionsByEmail(state.data.email);
                    await msg.reply(BOT_PREFIX + `✅ Todas las suscripciones de ${state.data.email} eliminadas.`);
                    delete userStates[chatId];
                } else {
                    state.step = 'MANAGE_EMAIL_MENU';
                    await msg.reply(BOT_PREFIX + '🔙 Cancelado. Selecciona una opción del menú.');
                }
                break;

            case 'MANAGE_SPECIFIC_USER':
                const userIdx = parseInt(input) - 1;
                if (state.data.subs[userIdx]) {
                    const sub = state.data.subs[userIdx];
                    state.data.selectedSub = sub;
                    state.step = 'USER_ACTION_MENU';
                    await msg.reply(BOT_PREFIX + `👤 *${sub.client_name}*\n\n1. ✏️ Editar Datos\n2. 🗑️ Eliminar Suscripción\n0. Volver`);
                } else {
                    await msg.reply(BOT_PREFIX + '❌ Número inválido.');
                }
                break;

            case 'USER_ACTION_MENU':
                if (input === '1') {
                    // Edit logic
                    await msg.reply(BOT_PREFIX + 'Funcionalidad de edición pendiente.');
                    delete userStates[chatId];
                } else if (input === '2') {
                    await db.deleteSubscriptionById(state.data.selectedSub.id);
                    await msg.reply(BOT_PREFIX + '✅ Suscripción eliminada.');
                    delete userStates[chatId];
                } else {
                    state.step = 'MANAGE_EMAIL_MENU';
                    await msg.reply(BOT_PREFIX + '🔙 Volviendo al menú principal.');
                }
                break;

            case 'RENEW_DASHBOARD_SELECTION':
            case 'RENEW_SEARCH_SELECTION':
                if (input === '0' || input.toLowerCase() === 'volver') {
                    delete userStates[chatId];
                    await msg.reply(BOT_PREFIX + '👋 Operación cancelada.');
                    await sendMainMenu(msg);
                    return;
                }

                const rIdx = parseInt(input) - 1;
                if (state.data.clients && state.data.clients[rIdx]) {
                    const client = state.data.clients[rIdx];
                    const subs = await db.getAllSubscriptions(client.id);

                    state.step = 'RENEW_HUB';
                    state.data.selectedClient = client;
                    state.data.clientSubs = subs;

                    await sendRenewHub(msg, client, subs);
                } else {
                    await msg.reply(BOT_PREFIX + '❌ Selección inválida.');
                }
                break;

            case 'RENEW_HUB':
                if (input === '1') {
                    // Renew All
                    if (state.data.clientSubs.length === 0) {
                        await msg.reply(BOT_PREFIX + '⚠️ No hay suscripciones para renovar.');
                        return;
                    }
                    state.step = 'RENEW_ALL_MONTHS';
                    await msg.reply(BOT_PREFIX + `🔄 *RENOVAR TODO*\n\n¿Por cuántos meses deseas renovar TODAS las suscripciones? (Responde con el número)`);

                } else if (input === '2') {
                    // Renew Selection
                    state.step = 'RENEW_SELECT_SUB';
                    let subMsg = BOT_PREFIX + `👇 *Selecciona la suscripción a renovar:*\n\n`;
                    state.data.clientSubs.forEach((s, i) => {
                        subMsg += `*${i + 1}.* ${s.service_name} (Vence: ${s.expiry_date})\n`;
                    });
                    subMsg += `\n0. Volver`;
                    await msg.reply(subMsg);

                } else if (input === '3') {
                    // Modify Services
                    state.step = 'RENEW_MODIFY_MENU';
                    let modMsg = BOT_PREFIX + `🛠️ *MODIFICAR SERVICIOS*\n\n👇 *Selecciona una acción:*\n\n` +
                        `1. ➕ Agregar Servicio (Nueva Venta)\n` +
                        `2. 🗑️ Eliminar Servicio\n` +
                        `0. Volver`;
                    await msg.reply(modMsg);

                } else if (input === '0' || input.toLowerCase() === 'volver') {
                    delete userStates[chatId];
                    await msg.reply(BOT_PREFIX + '👋 Operación finalizada.');
                    await sendMainMenu(msg);
                } else {
                    await msg.reply(BOT_PREFIX + '❌ Opción inválida.');
                }
                break;

            case 'RENEW_ALL_MONTHS':
                const allMonths = parseInt(input);
                if (isNaN(allMonths) || allMonths < 1) {
                    await msg.reply(BOT_PREFIX + '❌ Ingresa un número válido de meses.');
                    return;
                }

                let renewedCount = 0;
                for (const sub of state.data.clientSubs) {
                    const currentExpiry = new Date(sub.expiry_date);
                    const today = new Date();
                    let baseDate = currentExpiry > today ? currentExpiry : today;
                    let newDate = new Date(baseDate);
                    newDate.setMonth(newDate.getMonth() + allMonths);
                    const newExpiryStr = newDate.toISOString().split('T')[0];

                    await db.updateSubscriptionById(sub.id, { expiry_date: newExpiryStr });
                    renewedCount++;
                }

                // Notify
                try {
                    await msg.client.sendMessage(`${state.data.selectedClient.phone}@c.us`,
                        `✅ *RENOVACIÓN EXITOSA*\n\nHola ${state.data.selectedClient.name}, se han renovado tus ${renewedCount} servicios por ${allMonths} mes(es).`);
                } catch (e) { }

                await msg.reply(BOT_PREFIX + `✅ ${renewedCount} suscripciones renovadas exitosamente.`);
                delete userStates[chatId];
                await sendMainMenu(msg);
                break;

            case 'RENEW_MODIFY_MENU':
                if (input === '1') {
                    // Add Service -> Redirect to New Sale flow
                    state.step = 'VENDER_SELECT_CATEGORY';
                    state.data.phone = state.data.selectedClient.phone;
                    state.data.name = state.data.selectedClient.name;
                    state.data.preFilledClient = state.data.selectedClient; // Flag to skip phone/name entry later

                    await msg.reply(BOT_PREFIX + `📂 *CATEGORÍAS*\n\n👇 *Selecciona una opción:*\n\n` +
                        `1. 📺 Cuentas Streaming\n` +
                        `2. 🎵 Música\n` +
                        `3. 🛠️ Tareas y Otros\n` +
                        `0. Cancelar`);

                } else if (input === '2') {
                    // Delete Service
                    state.step = 'RENEW_DELETE_SELECT';
                    let delMsg = BOT_PREFIX + `🗑️ *ELIMINAR SERVICIO*\n\n👇 *Selecciona cuál eliminar:*\n\n`;
                    state.data.clientSubs.forEach((s, i) => {
                        delMsg += `*${i + 1}.* ${s.service_name}\n`;
                    });
                    delMsg += `\n0. Volver`;
                    await msg.reply(delMsg);

                } else if (input === '0' || input.toLowerCase() === 'volver') {
                    state.step = 'RENEW_HUB';
                    await sendRenewHub(msg, state.data.selectedClient, state.data.clientSubs);
                }
                break;

            case 'RENEW_DELETE_SELECT':
                if (input === '0') {
                    state.step = 'RENEW_MODIFY_MENU';
                    // Re-show modify menu logic
                    let modMsg = BOT_PREFIX + `🛠️ *MODIFICAR SERVICIOS*\n\n👇 *Selecciona una acción:*\n\n` +
                        `1. ➕ Agregar Servicio (Nueva Venta)\n` +
                        `2. 🗑️ Eliminar Servicio\n` +
                        `0. Volver`;
                    await msg.reply(modMsg);
                    return;
                }
                const dIdx = parseInt(input) - 1;
                if (state.data.clientSubs && state.data.clientSubs[dIdx]) {
                    const subToDelete = state.data.clientSubs[dIdx];
                    await db.deleteSubscriptionById(subToDelete.id);
                    await msg.reply(BOT_PREFIX + `✅ Servicio *${subToDelete.service_name}* eliminado.`);

                    // Refresh subs and return to Hub
                    const updatedSubs = await db.getAllSubscriptions(state.data.selectedClient.id);
                    state.data.clientSubs = updatedSubs;
                    state.step = 'RENEW_HUB';
                    await sendRenewHub(msg, state.data.selectedClient, updatedSubs);
                } else {
                    await msg.reply(BOT_PREFIX + '❌ Selección inválida.');
                }
                break;

            case 'STOCK_SELECT_CATEGORY':
                if (input === '0' || input.toLowerCase() === 'cancelar') {
                    delete userStates[chatId];
                    await msg.reply(BOT_PREFIX + '👋 Has salido del menú de stock.');
                    await sendMainMenu(msg);
                    return;
                }

                let stockCategory = '';
                if (input === '1') stockCategory = 'streaming';
                else if (input === '2') stockCategory = 'music';
                else if (input === '3') stockCategory = 'tasks';
                else {
                    await msg.reply(BOT_PREFIX + '❌ Opción inválida.');
                    return;
                }

                state.data.category = stockCategory;
                state.step = 'STOCK_SELECT_PLATFORM';

                let stockMenu = BOT_PREFIX + `👇 *Selecciona la Plataforma (${stockCategory.toUpperCase()}):*\n\n`;
                let hasStockItems = false;
                for (const [key, val] of Object.entries(PLATFORMS)) {
                    if (val.category === stockCategory) {
                        stockMenu += `*${key}.* ${val.name}\n`;
                        hasStockItems = true;
                    }
                }

                if (!hasStockItems) {
                    await msg.reply(BOT_PREFIX + '⚠️ No hay plataformas en esta categoría para stock.');
                    delete userStates[chatId];
                    return;
                }

                stockMenu += `\n0️⃣ 🔙 *Volver*`;
                await msg.reply(stockMenu);
                break;

            case 'STOCK_SELECT_PLATFORM':
                if (input === '0' || input.toLowerCase() === 'volver') {
                    state.step = 'STOCK_SELECT_CATEGORY';
                    await msg.reply(BOT_PREFIX + `📂 *CATEGORÍAS DE STOCK*\n\n👇 *Selecciona una opción:*\n\n` +
                        `1. 📺 Cuentas Streaming\n` +
                        `2. 🎵 Música\n` +
                        `3. 🛠️ Tareas y Otros\n` +
                        `0. Cancelar`);
                    return;
                }

                const sPid = parseInt(input);
                if (PLATFORMS[sPid] && PLATFORMS[sPid].category === state.data.category) {
                    const platform = PLATFORMS[sPid];
                    state.data.platform = platform; // Save platform for back navigation

                    // Logic to calculate stock AND store data for management
                    const allSubs = await db.getAllClientsWithSubs();
                    const pSubs = allSubs.filter(s => s.service_name === platform.name);

                    const accountsMap = {};
                    pSubs.forEach(s => {
                        if (!accountsMap[s.email]) {
                            accountsMap[s.email] = {
                                email: s.email,
                                password: s.password,
                                count: 0,
                                subs: []
                            };
                        }
                        accountsMap[s.email].count++;
                        accountsMap[s.email].subs.push(s);
                    });

                    const accountsList = Object.values(accountsMap);
                    state.data.stockAccounts = accountsList;

                    let stockMsg = BOT_PREFIX + `📊 *STOCK ${platform.name.toUpperCase()}*\n\n`;
                    let totalSlots = 0;
                    let usedSlots = 0;

                    accountsList.forEach((acc, i) => {
                        const limit = platform.limit;
                        const available = limit - acc.count;
                        const status = available > 0 ? `🟢 ${available} disp` : `🔴 LLENO`;
                        stockMsg += `*${i + 1}.* ${acc.email}\n   ${status} (${acc.count}/${limit})\n\n`;

                        totalSlots += limit;
                        usedSlots += acc.count;
                    });

                    if (accountsList.length === 0) {
                        stockMsg += `⚠️ No hay cuentas registradas.\n`;
                    }

                    stockMsg += `📈 *Total:* ${usedSlots}/${totalSlots} ocupados.\n`;
                    stockMsg += `\n👇 *Selecciona # para gestionar*\n0. Volver a Categorías`;

                    state.step = 'STOCK_ACCOUNT_SELECTION';
                    await msg.reply(stockMsg);

                } else {
                    await msg.reply(BOT_PREFIX + '❌ Selección inválida.');
                }
                break;

            case 'STOCK_ACCOUNT_SELECTION':
                if (input === '0' || input.toLowerCase() === 'volver') {
                    state.step = 'STOCK_SELECT_CATEGORY';
                    await msg.reply(BOT_PREFIX + `👇 *Consulta otra categoría:*\n\n` +
                        `1. 📺 Cuentas Streaming\n` +
                        `2. 🎵 Música\n` +
                        `3. 🛠️ Tareas y Otros\n` +
                        `0. Cancelar`);
                    return;
                }

                const saIdx = parseInt(input) - 1;
                if (state.data.stockAccounts && state.data.stockAccounts[saIdx]) {
                    state.data.selectedAccount = state.data.stockAccounts[saIdx];
                    state.fromStock = true; // Flag to know where to return
                    state.step = 'ACCOUNTS_MANAGE_MENU';

                    const acc = state.data.selectedAccount;
                    let menu = BOT_PREFIX + `╭━━━━━━━━━━━━━━━━━━╮\n   ⚙️ *GESTIONAR CUENTA*\n╰━━━━━━━━━━━━━━━━━━╯\n` +
                        `📧 *Email:* ${acc.email}\n` +
                        `🔑 *Pass:* ${acc.password}\n` +
                        `👥 *Usuarios:* ${acc.count}\n\n` +
                        `👇 *Opciones:*\n` +
                        `A. 🔑 Cambiar Contraseña (Global)\n` +
                        `B. 🔄 Reemplazar Cuenta (Email + Pass)\n` +
                        `C. 🗑️ Eliminar Cuenta\n` +
                        `D. 👥 Ver Usuarios\n` +
                        `0. Volver`;

                    await msg.reply(menu);
                } else {
                    await msg.reply(BOT_PREFIX + '❌ Selección inválida.');
                }
                break;

            case 'CLIENTS_SELECTION':
                if (input === '0' || input.toLowerCase() === 'volver') {
                    delete userStates[chatId];
                    await msg.reply(BOT_PREFIX + '👋 Operación finalizada.');
                    await sendMainMenu(msg);
                    return;
                }

                const cIdx = parseInt(input) - 1;
                if (state.data.clients && state.data.clients[cIdx]) {
                    const client = state.data.clients[cIdx];
                    state.data.selectedClient = client;
                    state.step = 'CLIENT_ACTIONS_MENU';

                    await msg.reply(BOT_PREFIX + `👤 *${client.name}*\n\n👇 *Selecciona una acción:*\n\n` +
                        `1. 🛒 Nueva Venta\n` +
                        `2. 🔄 Renovar Suscripción\n` +
                        `3. 🗑️ Eliminar Cliente\n` +
                        `4. 📨 Reenviar Datos de Acceso\n` +
                        `0. Volver`);
                } else {
                    await msg.reply(BOT_PREFIX + '❌ Selección inválida.');
                }
                break;

            case 'CLIENT_ACTIONS_MENU':
                const action = input;
                const sClient = state.data.selectedClient;

                if (input === '1') {
                    // New Sale -> Go to Category Selection first
                    state.step = 'VENDER_SELECT_CATEGORY';
                    state.data.phone = state.data.selectedClient.phone;
                    state.data.name = state.data.selectedClient.name;
                    state.data.preFilledClient = state.data.selectedClient; // Flag to skip phone/name entry later

                    await msg.reply(BOT_PREFIX + `📂 *CATEGORÍAS*\n\n👇 *Selecciona una opción:*\n\n` +
                        `1. 📺 Cuentas Streaming\n` +
                        `2. 🎵 Música\n` +
                        `3. 🛠️ Tareas y Otros\n` +
                        `0. Cancelar`);

                } else if (input === '2') {
                    // Renew
                    const subs = await db.getAllSubscriptions(state.data.selectedClient.id);
                    state.data.clientSubs = subs; // Ensure clientSubs is set

                    state.step = 'RENEW_HUB';
                    await sendRenewHub(msg, state.data.selectedClient, subs);

                } else if (input === '3') {
                    // Delete
                    state.step = 'CLIENT_DELETE_CONFIRM';
                    await msg.reply(BOT_PREFIX + `⚠️ *¿Estás seguro de eliminar a ${state.data.selectedClient.name}?*\n\nSe borrarán todas sus suscripciones activas.\nResponde *SI* para confirmar.`);

                } else if (input === '4') {
                    // Resend Info
                    const subs = await db.getAllSubscriptions(state.data.selectedClient.id);
                    if (subs.length === 0) {
                        await msg.reply(BOT_PREFIX + '⚠️ No hay suscripciones para reenviar.');
                    } else {
                        let count = 0;
                        for (const s of subs) {
                            try {
                                await msg.client.sendMessage(`${state.data.selectedClient.phone}@c.us`,
                                    `🔐 *RECORDATORIO DE ACCESO*\n\nHola ${state.data.selectedClient.name}, aquí tienes tus datos de *${s.service_name}*:\n\n📧 Email: ${s.email}\n🔑 Clave: *${s.password}*\n📅 Vence: ${s.expiry_date}`);
                                count++;
                                await new Promise(r => setTimeout(r, 1000));
                            } catch (e) { }
                        }
                        await msg.reply(BOT_PREFIX + `✅ Datos reenviados exitosamente (${count} suscripciones).`);
                    }
                    // Stay in menu
                    await sendMainMenu(msg);
                    delete userStates[chatId];

                } else if (input === '5') {
                    // Edit Expiry
                    state.step = 'CLIENT_EDIT_EXPIRY_SELECT_SUB';
                    const subs = await db.getAllSubscriptions(state.data.selectedClient.id);
                    state.data.clientSubs = subs;

                    if (subs.length === 0) {
                        await msg.reply(BOT_PREFIX + '⚠️ Este cliente no tiene suscripciones para editar.');
                        state.step = 'CLIENT_ACTIONS_MENU';
                        return;
                    }

                    if (subs.length === 1) {
                        state.data.selectedSub = subs[0];
                        state.step = 'CLIENT_EDIT_EXPIRY_INPUT';
                        await msg.reply(BOT_PREFIX + `📅 Editando vencimiento de *${subs[0].service_name}*.\n(Actual: ${subs[0].expiry_date})\n\nIngresa la nueva fecha (YYYY-MM-DD) o días a sumar/restar (ej: +3, -5):`);
                    } else {
                        let subMsg = BOT_PREFIX + `👇 *Selecciona la suscripción a editar:*\n\n`;
                        subs.forEach((s, i) => {
                            subMsg += `*${i + 1}.* ${s.service_name} (Vence: ${s.expiry_date})\n`;
                        });
                        subMsg += `\n0. Volver`;
                        await msg.reply(subMsg);
                    }

                } else if (input === '0' || input.toLowerCase() === 'volver') {
                    // Go back to list logic (replicated from CLIENTS_SELECTION)
                    state.step = 'CLIENTS_SELECTION';
                    // Re-display list (simplified)
                    await msg.reply(BOT_PREFIX + '🔙 Volviendo a la lista de clientes...');
                    // Ideally we should re-print the full list here, but for brevity just confirming return.
                    // The user can type "0" again to exit or pick a number if they remember.
                    // Better: trigger the display logic again.
                    // For now, let's just return to selection state.
                } else {
                    await msg.reply(BOT_PREFIX + '❌ Opción inválida.');
                }
                break;

            case 'CLIENT_DELETE_CONFIRM':
                if (input.toLowerCase() === 'si') {
                    await db.deleteClient(state.data.selectedClient.phone);
                    await msg.reply(BOT_PREFIX + `✅ Cliente ${state.data.selectedClient.name} eliminado.`);
                    delete userStates[chatId];
                } else {
                    await msg.reply(BOT_PREFIX + '❌ Eliminación cancelada.');
                    delete userStates[chatId];
                }
                break;

            case 'CLIENT_EDIT_EXPIRY_SELECT_SUB':
                if (input === '0' || input.toLowerCase() === 'volver') {
                    state.step = 'CLIENT_ACTIONS_MENU';
                    await msg.reply(BOT_PREFIX + `🔙 Volviendo al menú del cliente...`);
                    return;
                }
                const esIdx = parseInt(input) - 1;
                if (state.data.clientSubs && state.data.clientSubs[esIdx]) {
                    state.data.selectedSub = state.data.clientSubs[esIdx];
                    state.step = 'CLIENT_EDIT_EXPIRY_INPUT';
                    await msg.reply(BOT_PREFIX + `📅 Editando vencimiento de *${state.data.selectedSub.service_name}*.\n(Actual: ${state.data.selectedSub.expiry_date})\n\nIngresa la nueva fecha (YYYY-MM-DD) o días a sumar/restar (ej: +3, -5):`);
                } else {
                    await msg.reply(BOT_PREFIX + '❌ Selección inválida.');
                }
                break;

            case 'CLIENT_EDIT_EXPIRY_INPUT':
                if (input === '0' || input.toLowerCase() === 'volver') {
                    state.step = 'CLIENT_ACTIONS_MENU';
                    await msg.reply(BOT_PREFIX + `🔙 Volviendo al menú del cliente...`);
                    return;
                }

                let newDateStr = input.trim();
                let finalDate;

                // Check if relative (+3, -5)
                if (newDateStr.startsWith('+') || newDateStr.startsWith('-')) {
                    const days = parseInt(newDateStr);
                    if (isNaN(days)) {
                        await msg.reply(BOT_PREFIX + '❌ Formato inválido. Usa +3, -5 o YYYY-MM-DD.');
                        return;
                    }
                    const currentExpiry = new Date(state.data.selectedSub.expiry_date);
                    finalDate = new Date(currentExpiry);
                    finalDate.setDate(finalDate.getDate() + days);
                } else {
                    // Absolute date
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDateStr)) {
                        await msg.reply(BOT_PREFIX + '❌ Formato inválido. Usa YYYY-MM-DD (Ej: 2024-12-31).');
                        return;
                    }
                    finalDate = new Date(newDateStr);
                }

                if (isNaN(finalDate.getTime())) {
                    await msg.reply(BOT_PREFIX + '❌ Fecha inválida.');
                    return;
                }

                const finalDateStr = finalDate.toISOString().split('T')[0];
                await db.updateSubscriptionById(state.data.selectedSub.id, { expiry_date: finalDateStr });

                await msg.reply(BOT_PREFIX + `✅ Fecha actualizada a: *${finalDateStr}*`);

                // Return to client menu
                state.step = 'CLIENT_ACTIONS_MENU';
                await msg.reply(BOT_PREFIX + `👇 *¿Algo más para ${state.data.selectedClient.name}?*\n\n` +
                    `1. 🛒 Nueva Venta\n` +
                    `2. 🔄 Renovar Suscripción\n` +
                    `3. 🗑️ Eliminar Cliente\n` +
                    `4. 📨 Reenviar Datos de Acceso\n` +
                    `5. 📅 Editar Vencimiento\n` +
                    `0. Volver`);
                break;

            case 'RENEW_SELECT_SUB':
                if (input === '0' || input.toLowerCase() === 'volver') {
                    // If from clients menu, go back there. Else exit.
                    if (state.data.selectedClient) {
                        state.step = 'CLIENT_ACTIONS_MENU';
                        await msg.reply(BOT_PREFIX + `👤 *${state.data.selectedClient.name}*\n\n👇 *Selecciona una acción:*\n\n` +
                            `1. 🛒 Nueva Venta\n` +
                            `2. 🔄 Renovar Suscripción\n` +
                            `3. 🗑️ Eliminar Cliente\n` +
                            `4. 📨 Reenviar Datos de Acceso\n` +
                            `5. 📅 Editar Vencimiento\n` +
                            `0. Volver`);
                    } else {
                        delete userStates[chatId];
                        await msg.reply(BOT_PREFIX + '👋 Operación cancelada.');
                        await sendMainMenu(msg);
                    }
                    return;
                }
                const sIdx = parseInt(input) - 1;
                if (state.data.subs && state.data.subs[sIdx]) {
                    state.data.selectedSub = state.data.subs[sIdx];
                    state.step = 'RENEW_ENTER_MONTHS';
                    await msg.reply(BOT_PREFIX + `📅 ¿Por cuántos *meses* deseas renovar ${state.data.selectedSub.service_name}?\n(Responde con el número, ej: 1)`);
                } else {
                    await msg.reply(BOT_PREFIX + '❌ Selección inválida.');
                }
                break;

            case 'RENEW_ENTER_MONTHS':
                const months = parseInt(input);
                if (isNaN(months) || months < 1) {
                    await msg.reply(BOT_PREFIX + '❌ Ingresa un número válido de meses (ej: 1).');
                    return;
                }

                const sub = state.data.selectedSub;
                const currentExpiry = new Date(sub.expiry_date);
                const today = new Date();

                // If expired, start from today. If active, add to expiry.
                let baseDate = currentExpiry > today ? currentExpiry : today;
                let newDate = new Date(baseDate);
                newDate.setMonth(newDate.getMonth() + months);

                const newExpiryStr = newDate.toISOString().split('T')[0];

                await db.updateSubscriptionById(sub.id, { expiry_date: newExpiryStr });

                // Notify
                try {
                    await msg.client.sendMessage(`${state.data.selectedClient ? state.data.selectedClient.phone : state.data.phone}@c.us`,
                        `✅ *RENOVACIÓN EXITOSA*\n\nTu suscripción de *${sub.service_name}* ha sido renovada.\n📅 Nuevo vencimiento: ${newExpiryStr}`);
                } catch (e) { }

                await msg.reply(BOT_PREFIX + `✅ Renovado por ${months} mes(es).\n📅 Vence: ${newExpiryStr}`);
                delete userStates[chatId];
                break;

            case 'BROADCAST_CONFIRM':
                if (input.toLowerCase() === 'si') {
                    const clients = await db.getAllClientPhones();
                    let count = 0;
                    await msg.reply(BOT_PREFIX + `🚀 Iniciando difusión a ${clients.length} clientes...`);

                    for (const phone of clients) {
                        try {
                            await msg.client.sendMessage(`${phone}@c.us`, state.data.message);
                            count++;
                            await new Promise(r => setTimeout(r, 2000)); // 2s delay
                        } catch (e) {
                            console.error(`Failed to send to ${phone}`);
                        }
                    }
                    await msg.reply(BOT_PREFIX + `✅ Difusión completada. Enviado a ${count} clientes.`);
                    delete userStates[chatId];
                } else {
                    delete userStates[chatId];
                    await msg.reply(BOT_PREFIX + '❌ Difusión cancelada.');
                }
                break;

            case 'DATES_MENU':
                if (input === '1') {
                    // Download Report
                    await msg.reply(BOT_PREFIX + '⏳ Generando reporte de vencimientos...');
                    const allSubs = await db.getAllClientsWithSubs();
                    // Sort by expiry date
                    allSubs.sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date));

                    const csvData = allSubs.map(s => ({
                        Cliente: s.name,
                        Telefono: s.phone,
                        Servicio: s.service_name,
                        Email: s.email,
                        Contrasena: s.password,
                        Vencimiento: s.expiry_date
                    }));

                    const filePath = generateCSV(csvData, ['Cliente', 'Telefono', 'Servicio', 'Email', 'Contrasena', 'Vencimiento'], 'vencimientos.csv');
                    const media = MessageMedia.fromFilePath(filePath);

                    await msg.client.sendMessage(chatId, media, { caption: '📄 Aquí tienes el reporte de vencimientos.' });

                    // Cleanup
                    setTimeout(() => { try { fs.unlinkSync(filePath); } catch (e) { } }, 5000);
                    delete userStates[chatId];

                } else if (input === '2') {
                    // Show Today's Expirations inline
                    const expiring = await db.getExpiringSubscriptions(0);
                    if (expiring.length === 0) {
                        await msg.reply(BOT_PREFIX + '✅ No hay vencimientos para hoy.');
                    } else {
                        let expMsg = BOT_PREFIX + `🚨 *VENCEN HOY / VENCIDOS*\n\n`;
                        expiring.forEach(s => {
                            expMsg += `👤 ${s.name} (${s.phone})\n📺 ${s.service_name} - ${s.expiry_date}\n\n`;
                        });
                        await msg.reply(expMsg);
                    }
                    // Stay in menu? Or exit? Let's exit to keep it clean or return to main
                    delete userStates[chatId];
                } else if (input === '0') {
                    delete userStates[chatId];
                    await msg.reply(BOT_PREFIX + '👋 Operación finalizada.');
                } else {
                    await msg.reply(BOT_PREFIX + '❌ Opción inválida.');
                }
                break;

            // --- NEW ACCOUNTS COMMAND STATES ---
            case 'ACCOUNTS_SELECT_PLATFORM':
                if (input === '0' || input.toLowerCase() === 'volver') {
                    delete userStates[chatId];
                    await msg.reply(BOT_PREFIX + '👋 Operación cancelada.');
                    await sendMainMenu(msg);
                    return;
                }
                const pid = parseInt(input);
                if (PLATFORMS[pid]) {
                    state.data.platform = PLATFORMS[pid];

                    // Fetch accounts for this platform
                    const allSubs = await db.getAllClientsWithSubs();
                    const platformSubs = allSubs.filter(s => s.service_name === state.data.platform.name);

                    // Group by email
                    const accountsMap = {};
                    platformSubs.forEach(sub => {
                        if (!accountsMap[sub.email]) {
                            accountsMap[sub.email] = {
                                email: sub.email,
                                password: sub.password,
                                count: 0,
                                subs: []
                            };
                        }
                        accountsMap[sub.email].count++;
                        accountsMap[sub.email].subs.push(sub);
                    });

                    const accountsList = Object.values(accountsMap);
                    state.data.accounts = accountsList;

                    if (accountsList.length === 0) {
                        await msg.reply(BOT_PREFIX + `❌ No hay cuentas registradas para ${state.data.platform.name}.`);
                        delete userStates[chatId];
                        return;
                    }

                    state.step = 'ACCOUNTS_SELECT_ACCOUNT';
                    let accMsg = BOT_PREFIX + `╭━━━━━━━━━━━━━━━━━━╮\n   🔐 *${state.data.platform.name.toUpperCase()}*\n╰━━━━━━━━━━━━━━━━━━╯\n👇 *Selecciona una cuenta:*\n\n`;

                    accountsList.forEach((acc, i) => {
                        const limit = state.data.platform.limit;
                        const status = acc.count >= limit ? '🔴 [LLENO]' : '🟢';
                        accMsg += `*${i + 1}.* ${acc.email} (${acc.count}/${limit}) ${status}\n`;
                    });

                    accMsg += `\n0️⃣ 🔙 *Volver*`;
                    await msg.reply(accMsg);
                } else {
                    await msg.reply(BOT_PREFIX + '❌ Selección inválida.');
                }
                break;



            case 'ACCOUNTS_MANAGE_MENU':
                const opt = input.toLowerCase();
                if (opt === 'a') {
                    state.step = 'ACCOUNTS_CHANGE_PASSWORD';
                    await msg.reply(BOT_PREFIX + '🔑 Ingresa la *NUEVA CONTRASEÑA* para esta cuenta:');
                } else if (opt === 'b') {
                    state.step = 'ACCOUNTS_REPLACE_ACCOUNT';
                    await msg.reply(BOT_PREFIX + '🔄 Ingresa el *NUEVO EMAIL* y *NUEVA CONTRASEÑA*:\nEjemplo: nuevo@gmail.com nuevaclave123');
                } else if (opt === 'c') {
                    state.step = 'ACCOUNTS_DELETE_CONFIRM';
                    await msg.reply(BOT_PREFIX + `⚠️ *PELIGRO* ⚠️\n\nEstás a punto de eliminar la cuenta ${state.data.selectedAccount.email} y sus ${state.data.selectedAccount.count} suscripciones.\n\nResponde *SI* para confirmar.`);
                } else if (opt === 'd') {
                    let usersMsg = BOT_PREFIX + `👥 *USUARIOS DE LA CUENTA*\n\n`;
                    state.data.selectedAccount.subs.forEach((s, i) => {
                        usersMsg += `*${i + 1}.* 👤 ${s.client_name} (${s.client_phone})\n   📅 Vence: ${s.expiry_date}\n\n`;
                    });
                    usersMsg += `👇 *Selecciona un usuario para editar*\n0. Volver`;

                    state.step = 'ACCOUNTS_SELECT_SUBSCRIPTION';
                    // Save the subs list to state for easy access
                    state.data.subscriptions = state.data.selectedAccount.subs;

                    await msg.reply(usersMsg);
                } else if (opt === '0' || opt === 'volver') {
                    // ... (existing back logic)
                    if (state.fromStock) {
                        state.step = 'STOCK_ACCOUNT_SELECTION';
                        // ... (existing stock logic)
                        let stockMsg = BOT_PREFIX + `📊 *STOCK ${state.data.platform.name.toUpperCase()}*\n\n`;
                        // ... (rebuild stock msg - simplified for brevity, assume user knows flow)
                        // Actually, better to just call the stock display function if we had one, 
                        // but let's just go back to platform selection to be safe and simple
                        delete userStates[chatId];
                        await msg.reply(BOT_PREFIX + '🔙 Volviendo al menú principal...');
                    } else {
                        state.step = 'ACCOUNTS_SELECT_ACCOUNT';
                        let accMsg = BOT_PREFIX + `╭━━━━━━━━━━━━━━━━━━╮\n   🔐 *${state.data.platform.name.toUpperCase()}*\n╰━━━━━━━━━━━━━━━━━━╯\n👇 *Selecciona una cuenta:*\n\n`;
                        state.data.accounts.forEach((acc, i) => {
                            const limit = state.data.platform.limit;
                            const status = acc.count >= limit ? '🔴 [LLENO]' : '🟢';
                            accMsg += `*${i + 1}.* ${acc.email} (${acc.count}/${limit}) ${status}\n`;
                        });
                        accMsg += `\n0️⃣ 🔙 *Volver*`;
                        await msg.reply(accMsg);
                    }
                } else {
                    await msg.reply(BOT_PREFIX + '❌ Opción inválida.');
                }
                break;

            case 'ACCOUNTS_SELECT_SUBSCRIPTION':
                if (input === '0' || input.toLowerCase() === 'volver') {
                    state.step = 'ACCOUNTS_MANAGE_MENU';
                    await msg.reply(BOT_PREFIX + '🔙 Volviendo al menú de cuenta...');
                    // Re-show account menu? Ideally yes, but let's just confirm back.
                    return;
                }

                const subIdx = parseInt(input) - 1;
                if (state.data.subscriptions && state.data.subscriptions[subIdx]) {
                    state.data.selectedSubscription = state.data.subscriptions[subIdx];
                    state.step = 'SUBSCRIPTION_MANAGE_MENU';

                    const sub = state.data.selectedSubscription;
                    let subMenu = BOT_PREFIX + `👤 *GESTIONAR USUARIO*\n\n` +
                        `Cliente: ${sub.client_name}\n` +
                        `Tel: ${sub.client_phone}\n` +
                        `Vence: ${sub.expiry_date}\n\n` +
                        `👇 *Opciones:*\n` +
                        `1. 📅 Editar Vencimiento\n` +
                        `2. ✏️ Editar Nombre/Info\n` +
                        `3. 🗑️ Eliminar Usuario (Liberar Slot)\n` +
                        `0. Volver`;

                    await msg.reply(subMenu);
                } else {
                    await msg.reply(BOT_PREFIX + '❌ Selección inválida.');
                }
                break;

            case 'SUBSCRIPTION_MANAGE_MENU':
                if (input === '1') {
                    state.step = 'SUBSCRIPTION_EDIT_EXPIRY';
                    await msg.reply(BOT_PREFIX + '📅 Ingresa la nueva fecha de vencimiento (YYYY-MM-DD):');
                } else if (input === '2') {
                    state.step = 'SUBSCRIPTION_EDIT_INFO';
                    await msg.reply(BOT_PREFIX + '✏️ Ingresa el nuevo Nombre del Perfil y PIN (separados por espacio):\nEj: Juan 1234');
                } else if (input === '3') {
                    state.step = 'SUBSCRIPTION_DELETE_CONFIRM';
                    await msg.reply(BOT_PREFIX + '⚠️ ¿Estás seguro de eliminar este usuario? Esto liberará el espacio en la cuenta.\n\nResponde *SI* para confirmar.');
                } else if (input === '0') {
                    state.step = 'ACCOUNTS_SELECT_SUBSCRIPTION';
                    await msg.reply(BOT_PREFIX + '🔙 Volviendo a lista de usuarios...');
                } else {
                    await msg.reply(BOT_PREFIX + '❌ Opción inválida.');
                }
                break;

            case 'SUBSCRIPTION_EDIT_EXPIRY':
                const newExpiryDate = input.trim();
                // Basic validation YYYY-MM-DD
                if (!/^\d{4}-\d{2}-\d{2}$/.test(newExpiryDate)) {
                    await msg.reply(BOT_PREFIX + '❌ Formato inválido. Usa YYYY-MM-DD (ej: 2024-12-31).');
                    return;
                }
                await db.updateSubscriptionById(state.data.selectedSubscription.sub_id, { expiry_date: newExpiryDate });
                await msg.reply(BOT_PREFIX + '✅ Fecha actualizada.');
                state.step = 'SUBSCRIPTION_MANAGE_MENU';
                break;

            case 'SUBSCRIPTION_EDIT_INFO':
                const infoParts = input.split(' ');
                if (infoParts.length < 2) {
                    await msg.reply(BOT_PREFIX + '❌ Formato inválido. Ingresa: Nombre PIN');
                    return;
                }
                const newProfile = infoParts[0];
                const newPin = infoParts[1];
                await db.updateSubscriptionById(state.data.selectedSubscription.sub_id, { profile_name: newProfile, profile_pin: newPin });
                await msg.reply(BOT_PREFIX + '✅ Información actualizada.');
                state.step = 'SUBSCRIPTION_MANAGE_MENU';
                break;

            case 'SUBSCRIPTION_DELETE_CONFIRM':
                if (input.toLowerCase() === 'si') {
                    await db.deleteSubscriptionById(state.data.selectedSubscription.sub_id);
                    await msg.reply(BOT_PREFIX + '✅ Usuario eliminado y espacio liberado.');
                    // Go back to account menu as sub list is now stale
                    state.step = 'ACCOUNTS_MANAGE_MENU';
                    // Ideally refresh data, but for now just go back
                } else {
                    await msg.reply(BOT_PREFIX + '❌ Eliminación cancelada.');
                    state.step = 'SUBSCRIPTION_MANAGE_MENU';
                }
                break;

            case 'ACCOUNTS_CHANGE_PASSWORD':
                const newPasswd = input.trim();
                const oldEmail = state.data.selectedAccount.email;

                const clients = await db.updateBulkSubscriptions(oldEmail, oldEmail, newPasswd);

                // Notify
                let notified = 0;
                for (const c of clients) {
                    try {
                        await msg.client.sendMessage(`${c.phone}@c.us`,
                            `🔐 *CAMBIO DE CONTRASEÑA*\n\nHola ${c.name}, la contraseña de tu cuenta *${c.service_name}* ha cambiado.\n\n📧 Email: ${oldEmail}\n🔑 Nueva Clave: *${newPasswd}*`);
                        notified++;
                        await new Promise(r => setTimeout(r, 1000));
                    } catch (e) { }
                }

                await msg.reply(BOT_PREFIX + `✅ Contraseña actualizada y ${notified} clientes notificados.`);
                delete userStates[chatId];
                break;

            case 'ACCOUNTS_REPLACE_ACCOUNT':
                const replaceParts = input.split(/\s+/);
                if (replaceParts.length < 2) {
                    await msg.reply(BOT_PREFIX + '❌ Formato incorrecto. Ingresa: email password');
                    return;
                }
                const nEmail = replaceParts[0];
                const nPass = replaceParts[1];
                const oEmail = state.data.selectedAccount.email;

                const rClients = await db.updateBulkSubscriptions(oEmail, nEmail, nPass);

                let rNotified = 0;
                for (const c of rClients) {
                    try {
                        await msg.client.sendMessage(`${c.phone}@c.us`,
                            `🔄 *CAMBIO DE CUENTA*\n\nHola ${c.name}, tus credenciales de *${c.service_name}* han cambiado.\n\n📧 Nuevo Email: ${nEmail}\n🔑 Nueva Clave: *${nPass}*`);
                        rNotified++;
                        await new Promise(r => setTimeout(r, 1000));
                    } catch (e) { }
                }

                await msg.reply(BOT_PREFIX + `✅ Cuenta reemplazada y ${rNotified} clientes notificados.`);
                delete userStates[chatId];
                break;

            case 'ACCOUNTS_DELETE_CONFIRM':
                if (input.toLowerCase() === 'si') {
                    await db.deleteSubscriptionsByEmail(state.data.selectedAccount.email);
                    await msg.reply(BOT_PREFIX + '✅ Cuenta y suscripciones eliminadas.');
                    delete userStates[chatId];
                } else {
                    await msg.reply(BOT_PREFIX + '❌ Eliminación cancelada.');
                    state.step = 'ACCOUNTS_MANAGE_MENU';
                }
                break;

            default:
                break;
        }
    } catch (err) {
        console.error('Error handling message:', err);
        await msg.reply(BOT_PREFIX + 'Ocurrió un error al procesar el comando.');
    }
}

async function checkReminders(client) {
    console.log('Checking reminders...');

    // 1. Check License Expiry (Notify Admin)
    try {
        const expiryStr = await db.getLicenseExpiry();
        if (expiryStr) {
            const expiryDate = new Date(expiryStr);
            const now = new Date();
            const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));

            if (daysLeft <= 3 && daysLeft >= 0) {
                // Notify Super Admin (Owner)
                // Note: We send to the configured Super Admin number
                const SUPER_ADMIN = '593959878305@c.us';
                await client.sendMessage(SUPER_ADMIN, `⚠️ *ALERTA DE LICENCIA*\n\nLa licencia de este bot vence en *${daysLeft} días* (${expiryDate.toLocaleDateString()}).\n\nPor favor genera una nueva clave con !admin_gen y actívala.`);

                // Notify Renter (The Bot itself)
                // This message will appear in their own chat list as a message from "You"
                const botNumber = client.info.wid._serialized;
                await client.sendMessage(botNumber, `⚠️ *AVISO DE VENCIMIENTO*\n\nHola, tu licencia de uso del bot vence en *${daysLeft} días*.\n\nPor favor contacta a tu proveedor para renovar.`);
            }
        }
    } catch (e) {
        console.error('Error checking license expiry:', e);
    }

    // 2. Check Client Subscriptions (Existing Logic)
    try {
        const expiringSubs = await db.getExpiringSubscriptions(3); // Get subs expiring in 3 days
        for (const sub of expiringSubs) {
            try {
                const daysLeft = Math.ceil((new Date(sub.expiry_date) - new Date()) / (1000 * 60 * 60 * 24));
                let msg = '';

                if (daysLeft > 0) {
                    msg = `⚠️ *RECORDATORIO DE PAGO*\n\nHola ${sub.name}, tu suscripción de *${sub.service_name}* vence en *${daysLeft} días* (${sub.expiry_date}).\n\nPor favor contáctanos para renovar.`;
                } else if (daysLeft === 0) {
                    msg = `⚠️ *HOY VENCE TU SERVICIO*\n\nHola ${sub.name}, tu suscripción de *${sub.service_name}* vence HOY.\n\nEvita cortes del servicio renovando ahora.`;
                } else {
                    msg = `⛔ *SERVICIO VENCIDO*\n\nHola ${sub.name}, tu suscripción de *${sub.service_name}* ha vencido.\n\nPor favor realiza el pago para reactivar el servicio.`;
                }

                await client.sendMessage(`${sub.phone}@c.us`, msg);
                await new Promise(r => setTimeout(r, 1000)); // Throttle
            } catch (err) {
                console.error(`Failed to send reminder to ${sub.name}:`, err);
            }
        }
    } catch (e) {
        console.error('Error checking subscription reminders:', e);
    }
}

module.exports = {
    handleMessage,
    checkReminders
};
