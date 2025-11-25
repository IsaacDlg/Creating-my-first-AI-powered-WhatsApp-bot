const db = require('./database');

// State Machine for Interactive Flows
const userStates = {}; // chatId -> { step, data }
const BOT_PREFIX = '🤖 ';

const PLATFORMS = {
    1: { name: 'Netflix', hasPin: true, limit: 5 },
    2: { name: 'Disney+', hasPin: true, limit: 7 },
    3: { name: 'Prime Video', hasPin: true, limit: 6 },
    4: { name: 'HBO Max', hasPin: true, limit: 5 },
    5: { name: 'Paramount+', hasPin: true, limit: 5 },
    6: { name: 'Spotify', hasPin: false, limit: 6 },
    7: { name: 'Crunchyroll', hasPin: false, limit: 4 },
    8: { name: 'YouTube Premium', hasPin: false, limit: 5 },
    9: { name: 'IPTV', hasPin: false, limit: 1 },
    10: { name: 'Magis TV', hasPin: false, limit: 1 }
};

// Helper to normalize phone numbers
function normalizePhone(input) {
    let phone = input.replace(/\D/g, '');
    if (!phone) return null;
    if (phone.startsWith('0')) {
        phone = '593' + phone.slice(1);
    } else if (phone.length === 9) {
        phone = '593' + phone;
    }
    return phone;
}

async function handleMessage(msg) {
    const chatId = msg.from;
    const body = msg.body.trim();

    if (body.startsWith(BOT_PREFIX)) return;

    if (userStates[chatId]) {
        await handleInteractiveFlow(msg, chatId, body);
        return;
    }

    if (!body.startsWith('!')) return;

    const args = body.slice(1).split(' ');
    const command = args.shift().toLowerCase();

    try {
        switch (command) {
            case 'help':
                await msg.reply(
                    `╭━━━━━━━━━━━━━━━━━━╮\n` +
                    `   🤖 *MENÚ PRINCIPAL* \n` +
                    `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
                    `🛒 *!vender* - Nueva suscripción\n` +
                    `🔄 *!renew* - Renovar suscripción\n` +
                    `👥 *!clients* - Gestión de Clientes\n` +
                    `📋 *!list* - Ver cuentas por plataforma\n` +
                    `✏️ *!update* - Actualizar suscripción\n` +
                    `🗑️ *!delete* - Eliminar cliente\n` +
                    `📧 *!correo* - Buscar por email\n` +
                    `❌ *!cancel* - Cancelar operación`
                );
                break;

            case 'vender':
                userStates[chatId] = { step: 'SELECT_PLATFORM', data: {} };
                let menu = `╭━━━━━━━━━━━━━━━━━━╮\n   🛒 *NUEVA VENTA*\n╰━━━━━━━━━━━━━━━━━━╯\n👇 *Selecciona la Plataforma:*\n\n`;
                for (const [key, val] of Object.entries(PLATFORMS)) {
                    menu += `*${key}.* ${val.name} ${val.hasPin ? '🔴' : '🟢'}\n`;
                }
                await msg.reply(menu);
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
                    const updateMsg = `╭━━━━━━━━━━━━━━━━━━╮\n   ✨ *DATOS ACTUALIZADOS*\n╰━━━━━━━━━━━━━━━━━━╯\n` +
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
                userStates[chatId] = { step: 'LIST_SELECT_PLATFORM', data: {} };
                let listMenu = `╭━━━━━━━━━━━━━━━━━━╮\n   📋 *VER LISTA*\n╰━━━━━━━━━━━━━━━━━━╯\n👇 *Selecciona la Plataforma:*\n\n`;
                for (const [key, val] of Object.entries(PLATFORMS)) {
                    listMenu += `*${key}.* ${val.name}\n`;
                }
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
                    data: { email: searchEmail, subs: subs }
                };

                let emailMsg = `╭━━━━━━━━━━━━━━━━━━╮\n   📧 *RESULTADOS*\n╰━━━━━━━━━━━━━━━━━━╯\n*Email:* ${searchEmail}\n`;
                subs.forEach((sub, index) => {
                    emailMsg += `\n*${index + 1}.* ${sub.client_name} (${sub.client_phone})`;
                    emailMsg += `\n    ${sub.service_name} | Vence: ${sub.expiry_date}`;
                });

                emailMsg += `\n\n👇 *Opciones de Gestión:*\n` +
                    `A. 🔑 Cambiar Contraseña (Global)\n` +
                    `B. 🗑️ Eliminar Todo el Correo\n` +
                    `C. 👤 Gestionar Usuario Específico\n` +
                    `D. ❌ Cancelar\n\n` +
                    `Responde con la letra.`;

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
                userStates[chatId] = { step: 'RENEW_ENTER_PHONE', data: {} };
                await msg.reply(BOT_PREFIX + 'Ingresa el *número de teléfono* del cliente para renovar:');
                break;

            case 'clients':
                const searchTerm = args.join(' ');
                const clients = await db.getClientsWithCount(searchTerm);

                if (clients.length === 0) {
                    await msg.reply(BOT_PREFIX + `❌ No se encontraron clientes${searchTerm ? ' con "' + searchTerm + '"' : ''}.`);
                    return;
                }

                userStates[chatId] = {
                    step: 'CLIENTS_SELECTION',
                    data: { clients: clients }
                };

                let clientsMsg = `╭━━━━━━━━━━━━━━━━━━╮\n   👥 *RESULTADOS (${clients.length})*\n╰━━━━━━━━━━━━━━━━━━╯\n`;

                for (let i = 0; i < clients.length; i++) {
                    const c = clients[i];
                    clientsMsg += `\n*${i + 1}.* 👤 ${c.name} (${c.phone})`;

                    const cSubs = await db.getAllSubscriptions(c.id);
                    if (cSubs.length > 0) {
                        cSubs.forEach(s => {
                            clientsMsg += `\n    📺 ${s.service_name} | 📅 ${s.expiry_date}`;
                            clientsMsg += `\n    📧 ${s.email} | 🔑 ${s.password}`;
                        });
                    } else {
                        clientsMsg += `\n    ⚠️ Sin suscripciones activas`;
                    }
                    clientsMsg += `\n`;
                }

                clientsMsg += `\n👇 *Responde con el número para gestionar*`;

                await msg.reply(clientsMsg);
                break;

            default:
                break;
        }
    } catch (err) {
        console.error('Error handling message:', err);
        await msg.reply(BOT_PREFIX + 'Ocurrió un error al procesar el comando.');
    }
}

async function proceedToPinOrFinish(msg, chatId, state) {
    if (state.data.platform.hasPin) {
        state.step = 'ENTER_PROFILE_PIN';
        await msg.reply(BOT_PREFIX + `Esta cuenta requiere perfil.\n\nIngresa el *Nombre del Perfil* y el *PIN*.\nEjemplo: Juan 1234`);
    } else {
        state.data.profileName = 'N/A';
        state.data.profilePin = 'N/A';
        await finishSale(msg, chatId, state.data);
    }
}

async function finishSale(msg, chatId, data) {
    delete userStates[chatId];

    const date = new Date();
    date.setDate(date.getDate() + 30);
    const expiryDate = date.toISOString().split('T')[0];

    let client = await db.getClientByPhone(data.phone);
    if (!client) {
        await db.addClient(data.phone, data.name);
        client = await db.getClientByPhone(data.phone);
    }

    await db.addSubscription(
        client.id,
        data.platform.name,
        expiryDate,
        data.email,
        data.password,
        data.profileName,
        data.profilePin
    );

    let receipt = `╭━━━━━━━━━━━━━━━━━━╮\n   ✨ *NUEVA CUENTA* ✨\n╰━━━━━━━━━━━━━━━━━━╯\n` +
        `👤 *Cliente:* ${data.name}\n` +
        `📺 *Servicio:* ${data.platform.name}\n\n` +
        `📧 *Email:* ${data.email}\n` +
        `🔑 *Pass:* ${data.password}\n`;

    if (data.platform.hasPin) {
        receipt += `👤 *Perfil:* ${data.profileName}\n` +
            `🔒 *PIN:* ${data.profilePin}\n`;
    }

    receipt += `\n📅 *Vence:* ${expiryDate}\n\n` +
        `Gracias por tu compra! 🙌`;

    try {
        await msg.client.sendMessage(`${data.phone}@c.us`, receipt);
        await msg.reply(BOT_PREFIX + `✅ Venta registrada y notificado a ${data.name}.`);
    } catch (e) {
        await msg.reply(BOT_PREFIX + `✅ Venta registrada, pero ERROR al notificar.`);
    }
}

async function handleInteractiveFlow(msg, chatId, input) {
    const state = userStates[chatId];

    if (input.toLowerCase() === '!cancel' || input.toLowerCase() === 'd') {
        delete userStates[chatId];
        await msg.reply(BOT_PREFIX + '❌ Operación cancelada.');
        return;
    }

    try {
        switch (state.step) {
            case 'SELECT_PLATFORM':
                const platformId = parseInt(input);
                if (!PLATFORMS[platformId]) { return; }
                state.data.platform = PLATFORMS[platformId];
                state.step = 'ENTER_CLIENT_INFO';
                await msg.reply(BOT_PREFIX + `Has seleccionado *${state.data.platform.name}*.\n\nAhora ingresa el *Nombre* y *Teléfono* del cliente.\nEjemplo: Juan 0991234567`);
                break;

            case 'ENTER_CLIENT_INFO':
                if (state.data.preFilledClient) {
                    state.data.phone = state.data.preFilledClient.phone;
                    state.data.name = state.data.preFilledClient.name;
                    state.step = 'ENTER_CREDENTIALS';
                    await msg.reply(BOT_PREFIX + `Cliente: ${state.data.name} (${state.data.phone})\n\nAhora ingresa el *Correo* y *Contraseña* de la cuenta.\nEjemplo: user@gmail.com clave123`);
                    return;
                }

                const phoneRegex = /(?:\+?593|0)(?:[\s-]*\d){9}/;
                const match = input.match(phoneRegex);
                let phone = '';
                let name = '';

                if (match) {
                    phone = normalizePhone(match[0]);
                    name = input.replace(match[0], '').trim().replace(/^[\s,.-]+|[\s,.-]+$/g, '');
                } else {
                    const tokens = input.split(/\s+/);
                    let nameParts = [];
                    for (const token of tokens) {
                        const cleanToken = token.replace(/\D/g, '');
                        const potentialPhone = normalizePhone(cleanToken);
                        if (cleanToken.length > 6 && !phone && potentialPhone) {
                            phone = potentialPhone;
                        } else {
                            nameParts.push(token);
                        }
                    }
                    if (phone) name = nameParts.join(' ');
                }

                if (!phone) {
                    await msg.reply(BOT_PREFIX + '❌ No detecté un número válido. Intenta de nuevo: Nombre y Teléfono.');
                    return;
                }
                if (!name || name.length < 2) {
                    await msg.reply(BOT_PREFIX + '❌ Falta el nombre. Intenta de nuevo: Nombre y Teléfono.');
                    return;
                }

                state.data.phone = phone;
                state.data.name = name;

                if (state.data.isAddingToExisting) {
                    await proceedToPinOrFinish(msg, chatId, state);
                } else {
                    state.step = 'ENTER_CREDENTIALS';
                    await msg.reply(BOT_PREFIX + `Cliente: ${name} (${phone})\n\nAhora ingresa el *Correo* y *Contraseña* de la cuenta.\nEjemplo: user@gmail.com clave123`);
                }
                break;

            case 'ENTER_CREDENTIALS':
                const creds = input.split(/\s+/);
                if (creds.length < 2) {
                    await msg.reply(BOT_PREFIX + '❌ Formato incorrecto. Correo y Contraseña separados por espacio.');
                    return;
                }
                const email = creds[0];
                const password = creds[1];
                state.data.email = email;
                state.data.password = password;

                const currentCount = await db.getSubscriptionCount(state.data.platform.name, email);
                const limit = state.data.platform.limit || 5;

                if (currentCount >= limit) {
                    state.step = 'CONFIRM_OVERBOOKING';
                    await msg.reply(BOT_PREFIX + `⚠️ *ALERTA DE CAPACIDAD*\n\nLa cuenta ${email} ya tiene *${currentCount}/${limit}* perfiles ocupados.\n\n¿Deseas continuar?\nResponde *SI* o *NO*.`);
                    return;
                }
                await proceedToPinOrFinish(msg, chatId, state);
                break;

            case 'CONFIRM_OVERBOOKING':
                if (input.toLowerCase() === 'si') {
                    await proceedToPinOrFinish(msg, chatId, state);
                } else if (input.toLowerCase() === 'no') {
                    state.step = 'ENTER_CREDENTIALS';
                    await msg.reply(BOT_PREFIX + 'Ingresa un *Correo* y *Contraseña* diferentes.');
                } else {
                    await msg.reply(BOT_PREFIX + '❌ Responde SI o NO.');
                }
                break;

            case 'ENTER_PROFILE_PIN':
                const pinTokens = input.split(/\s+/);
                let pin = '';
                let profileParts = [];
                for (const token of pinTokens) {
                    if (/^\d{4}$/.test(token) && !pin) pin = token;
                    else profileParts.push(token);
                }
                if (!pin) {
                    if (pinTokens.length >= 2) {
                        pin = pinTokens.pop();
                        profileParts = pinTokens;
                    } else {
                        await msg.reply(BOT_PREFIX + '❌ Formato incorrecto. Perfil y PIN (4 dígitos).');
                        return;
                    }
                }
                state.data.profilePin = pin;
                state.data.profileName = profileParts.join(' ');
                await finishSale(msg, chatId, state.data);
                break;

            // --- !correo FLOW ---
            case 'MANAGE_EMAIL_MENU':
                const choice = input.toUpperCase();
                if (choice === 'A') {
                    state.step = 'MANAGE_EMAIL_NEW_PASS';
                    await msg.reply(BOT_PREFIX + 'Ingresa la *Nueva Contraseña*:');
                } else if (choice === 'B') {
                    state.step = 'MANAGE_EMAIL_CONFIRM_DELETE';
                    await msg.reply(BOT_PREFIX + `⚠️ ¿Eliminar TODAS las suscripciones de ${state.data.email}?\nResponde *SI*.`);
                } else if (choice === 'C') {
                    state.step = 'MANAGE_EMAIL_SELECT_USER';
                    await msg.reply(BOT_PREFIX + 'Ingresa el *Número* del usuario (ej. 1, 2...):');
                } else {
                    await msg.reply(BOT_PREFIX + 'Opción no válida.');
                }
                break;

            case 'MANAGE_EMAIL_NEW_PASS':
                const newPass = input.trim();
                await db.updateBulkSubscriptions(state.data.email, state.data.email, newPass);
                await msg.reply(BOT_PREFIX + `✅ Contraseña actualizada.`);
                delete userStates[chatId];
                break;

            case 'MANAGE_EMAIL_CONFIRM_DELETE':
                if (input.toLowerCase() === 'si') {
                    await db.deleteSubscriptionsByEmail(state.data.email);
                    await msg.reply(BOT_PREFIX + `✅ Suscripciones eliminadas.`);
                } else {
                    await msg.reply(BOT_PREFIX + 'Cancelado.');
                }
                delete userStates[chatId];
                break;

            case 'MANAGE_EMAIL_SELECT_USER':
                const index = parseInt(input) - 1;
                if (isNaN(index) || index < 0 || index >= state.data.subs.length) {
                    await msg.reply(BOT_PREFIX + 'Número inválido.');
                    return;
                }
                state.data.selectedSub = state.data.subs[index];
                state.step = 'MANAGE_USER_ACTION';
                await msg.reply(BOT_PREFIX + `Usuario: *${state.data.selectedSub.client_name}*\n\n` +
                    `1. Eliminar Usuario\n` +
                    `2. Editar Perfil\n` +
                    `3. Editar PIN\n` +
                    `4. Editar Nombre\n` +
                    `5. Editar Teléfono\n` +
                    `6. Cancelar`);
                break;

            case 'MANAGE_USER_ACTION':
                const action = parseInt(input);
                if (action === 1) {
                    await db.deleteSubscriptionById(state.data.selectedSub.id);
                    await msg.reply(BOT_PREFIX + `✅ Usuario eliminado.`);
                    delete userStates[chatId];
                } else if (action === 2) {
                    state.step = 'EDIT_PROFILE_NAME';
                    await msg.reply(BOT_PREFIX + 'Nuevo Nombre del Perfil:');
                } else if (action === 3) {
                    state.step = 'EDIT_PROFILE_PIN';
                    await msg.reply(BOT_PREFIX + 'Nuevo PIN:');
                } else if (action === 4) {
                    state.step = 'EDIT_CLIENT_NAME';
                    await msg.reply(BOT_PREFIX + 'Nuevo Nombre Cliente:');
                } else if (action === 5) {
                    state.step = 'EDIT_CLIENT_PHONE';
                    await msg.reply(BOT_PREFIX + 'Nuevo Teléfono:');
                } else if (action === 6) {
                    delete userStates[chatId];
                    await msg.reply(BOT_PREFIX + 'Cancelado.');
                }
                break;

            case 'EDIT_PROFILE_NAME':
                await db.updateSubscriptionById(state.data.selectedSub.id, { profile_name: input });
                await msg.reply(BOT_PREFIX + '✅ Perfil actualizado.');
                delete userStates[chatId];
                break;
            case 'EDIT_PROFILE_PIN':
                await db.updateSubscriptionById(state.data.selectedSub.id, { profile_pin: input });
                await msg.reply(BOT_PREFIX + '✅ PIN actualizado.');
                delete userStates[chatId];
                break;
            case 'EDIT_CLIENT_NAME':
                await db.updateClient(state.data.selectedSub.client_phone, input, null);
                await msg.reply(BOT_PREFIX + '✅ Nombre actualizado.');
                delete userStates[chatId];
                break;
            case 'EDIT_CLIENT_PHONE':
                const newPhone = normalizePhone(input);
                if (!newPhone) { await msg.reply(BOT_PREFIX + '❌ Inválido.'); return; }
                await db.updateClient(state.data.selectedSub.client_phone, state.data.selectedSub.client_name, newPhone);
                await msg.reply(BOT_PREFIX + '✅ Teléfono actualizado.');
                delete userStates[chatId];
                break;

            // --- !list INTERACTIVE FLOW ---
            case 'LIST_SELECT_PLATFORM':
                const listPlatId = parseInt(input);
                if (!PLATFORMS[listPlatId]) { return; }

                const selectedPlatform = PLATFORMS[listPlatId].name;
                const allClients = await db.getAllClientsWithSubs();

                const platformSubs = allClients.filter(s => s.service_name === selectedPlatform);

                if (platformSubs.length === 0) {
                    await msg.reply(BOT_PREFIX + `No hay suscripciones activas para ${selectedPlatform}.`);
                    delete userStates[chatId];
                    return;
                }

                const accounts = {};
                let accountList = [];

                platformSubs.forEach(sub => {
                    const key = `${sub.email}|${sub.password}`;
                    if (!accounts[key]) {
                        accounts[key] = {
                            service: sub.service_name,
                            email: sub.email,
                            password: sub.password,
                            subs: []
                        };
                        accountList.push(accounts[key]);
                    }
                    accounts[key].subs.push(sub);
                });

                state.step = 'LIST_SELECTION';
                state.data.accountList = accountList;

                let listMsg = `╭━━━━━━━━━━━━━━━━━━╮\n   📋 *LISTA ${selectedPlatform.toUpperCase()}*\n╰━━━━━━━━━━━━━━━━━━╯\n`;

                accountList.forEach((acc, idx) => {
                    listMsg += `\n*${idx + 1}.* 📧 ${acc.email}\n    🔑 ${acc.password}\n`;
                    acc.subs.forEach(s => {
                        listMsg += `    - ${s.name} (${s.phone}) | ${s.expiry_date}\n`;
                    });
                });

                listMsg += `\n👇 *Escribe el número de la cuenta para gestionar*`;

                await msg.reply(listMsg);
                break;

            case 'LIST_SELECTION':
                const listIdx = parseInt(input) - 1;
                if (isNaN(listIdx) || listIdx < 0 || listIdx >= state.data.accountList.length) {
                    await msg.reply(BOT_PREFIX + 'Número inválido.');
                    return;
                }
                state.data.selectedAccount = state.data.accountList[listIdx];
                state.step = 'LIST_ACCOUNT_ACTION';
                await msg.reply(BOT_PREFIX + `Cuenta: *${state.data.selectedAccount.service}* (${state.data.selectedAccount.email})\n\n` +
                    `1. Agregar Usuario (Vender)\n` +
                    `2. Ver/Gestionar Usuarios\n` +
                    `3. Eliminar Cuenta Completa\n` +
                    `4. Editar Credenciales (Email/Pass)\n` +
                    `5. Cancelar\n\n` +
                    `Responde con el número.`);
                break;

            case 'LIST_ACCOUNT_ACTION':
                const act = parseInt(input);
                if (act === 1) {
                    const platformEntry = Object.values(PLATFORMS).find(p => p.name === state.data.selectedAccount.service);
                    if (!platformEntry) {
                        await msg.reply(BOT_PREFIX + '❌ Error: Plataforma no reconocida.');
                        delete userStates[chatId];
                        return;
                    }

                    state.data.platform = platformEntry;
                    state.data.email = state.data.selectedAccount.email;
                    state.data.password = state.data.selectedAccount.password;
                    state.data.isAddingToExisting = true;

                    state.step = 'ENTER_CLIENT_INFO';
                    await msg.reply(BOT_PREFIX + `Agregando usuario a *${state.data.selectedAccount.service}* (${state.data.selectedAccount.email}).\n\nIngresa *Nombre* y *Teléfono* del nuevo cliente.`);

                } else if (act === 2) {
                    state.data.subs = state.data.selectedAccount.subs;
                    let userList = BOT_PREFIX + `*Usuarios en ${state.data.selectedAccount.email}:*\n`;
                    state.data.subs.forEach((sub, i) => {
                        userList += `${i + 1}. ${sub.name} (${sub.phone})\n`;
                    });
                    userList += `\nIngresa el *número* del usuario para gestionar:`;

                    state.step = 'MANAGE_EMAIL_SELECT_USER';
                    await msg.reply(userList);

                } else if (act === 3) {
                    state.step = 'MANAGE_EMAIL_CONFIRM_DELETE';
                    state.data.email = state.data.selectedAccount.email;
                    await msg.reply(BOT_PREFIX + `⚠️ ¿Eliminar TODAS las suscripciones de ${state.data.email}?\nResponde *SI*.`);

                } else if (act === 4) {
                    state.step = 'LIST_EDIT_CREDENTIALS';
                    await msg.reply(BOT_PREFIX + 'Ingresa el *Nuevo Correo* y *Nueva Contraseña* separados por espacio:');

                } else {
                    delete userStates[chatId];
                    await msg.reply(BOT_PREFIX + 'Cancelado.');
                }
                break;

            case 'LIST_EDIT_CREDENTIALS':
                const newCreds = input.split(/\s+/);
                if (newCreds.length < 2) {
                    await msg.reply(BOT_PREFIX + '❌ Formato incorrecto.');
                    return;
                }
                const nEmail = newCreds[0];
                const nPass = newCreds[1];

                await db.updateBulkSubscriptions(state.data.selectedAccount.email, nEmail, nPass);
                await msg.reply(BOT_PREFIX + `✅ Credenciales actualizadas.`);
                delete userStates[chatId];
                break;

            // --- !renew INTERACTIVE FLOW ---
            case 'RENEW_ENTER_PHONE':
                const rPhone = normalizePhone(input);
                if (!rPhone) {
                    await msg.reply(BOT_PREFIX + '❌ Número inválido.');
                    return;
                }

                const rClient = await db.getClientByPhone(rPhone);
                if (!rClient) {
                    await msg.reply(BOT_PREFIX + '❌ Cliente no encontrado.');
                    delete userStates[chatId];
                    return;
                }

                state.data.clientName = rClient.name;
                state.data.clientPhone = rClient.phone;

                const rSubs = await db.getAllSubscriptions(rClient.id);
                if (rSubs.length === 0) {
                    await msg.reply(BOT_PREFIX + '❌ Este cliente no tiene suscripciones activas.');
                    delete userStates[chatId];
                    return;
                }

                if (rSubs.length === 1) {
                    state.data.selectedSub = rSubs[0];
                    state.step = 'RENEW_ENTER_MONTHS';
                    await msg.reply(BOT_PREFIX + `Suscripción: *${state.data.selectedSub.service_name}* (Vence: ${state.data.selectedSub.expiry_date})\n\nIngresa el *número de meses* para renovar (ej. 1, 12):`);
                } else {
                    state.data.subs = rSubs;
                    state.step = 'RENEW_SELECT_SUB';
                    let rMenu = BOT_PREFIX + `*Suscripciones de ${rClient.name}:*\n`;
                    rSubs.forEach((s, i) => {
                        rMenu += `${i + 1}. ${s.service_name} (Vence: ${s.expiry_date})\n`;
                    });
                    rMenu += `\nResponde con el *número* de la suscripción a renovar:`;
                    await msg.reply(rMenu);
                }
                break;

            case 'RENEW_SELECT_SUB':
                const rIdx = parseInt(input) - 1;
                if (isNaN(rIdx) || rIdx < 0 || rIdx >= state.data.subs.length) {
                    await msg.reply(BOT_PREFIX + 'Número inválido.');
                    return;
                }
                state.data.selectedSub = state.data.subs[rIdx];
                state.step = 'RENEW_ENTER_MONTHS';
                await msg.reply(BOT_PREFIX + `Has seleccionado: *${state.data.selectedSub.service_name}*.\n\nIngresa el *número de meses* para renovar:`);
                break;

            case 'RENEW_ENTER_MONTHS':
                const months = parseInt(input);
                if (isNaN(months) || months < 1) {
                    await msg.reply(BOT_PREFIX + '❌ Ingresa un número válido de meses (mínimo 1).');
                    return;
                }

                const currentExpiry = new Date(state.data.selectedSub.expiry_date);
                const now = new Date();
                let baseDate = currentExpiry > now ? currentExpiry : now;
                baseDate.setMonth(baseDate.getMonth() + months);
                const newExpiryDate = baseDate.toISOString().split('T')[0];

                state.data.months = months;
                state.data.newExpiryDate = newExpiryDate;
                state.step = 'RENEW_CONFIRM';

                await msg.reply(BOT_PREFIX + `Vas a renovar a *${state.data.clientName}* (${state.data.clientPhone})\n` +
                    `Servicio: ${state.data.selectedSub.service_name}\n` +
                    `Tiempo: ${months} mes(es)\n` +
                    `Nueva Vencimiento: ${newExpiryDate}\n\n` +
                    `¿Estás seguro? Responde *SI* para confirmar.`);
                break;

            case 'RENEW_CONFIRM':
                if (input.toLowerCase() === 'si' || input.toLowerCase() === 'aceptar') {
                    await db.renewSubscription(state.data.selectedSub.id, state.data.newExpiryDate);
                    const renewMsg = `╭━━━━━━━━━━━━━━━━━━╮\n   ✨ *RENOVACIÓN EXITOSA*\n╰━━━━━━━━━━━━━━━━━━╯\n` +
                        `Tu cuenta de *${state.data.selectedSub.service_name}* ha sido renovada.\n\n` +
                        `📧 *Email:* ${state.data.selectedSub.email}\n` +
                        `📅 *Vence:* ${state.data.newExpiryDate}\n\n` +
                        `Gracias por tu preferencia! 🙌`;
                    try {
                        await msg.client.sendMessage(`${state.data.clientPhone}@c.us`, renewMsg);
                        await msg.reply(BOT_PREFIX + `✅ Renovación exitosa y mensaje enviado.`);
                    } catch (e) {
                        await msg.reply(BOT_PREFIX + `✅ Renovación exitosa, pero ERROR al enviar mensaje.`);
                    }
                } else {
                    await msg.reply(BOT_PREFIX + '❌ Renovación cancelada.');
                }
                delete userStates[chatId];
                break;

            // --- !clients INTERACTIVE FLOW ---
            case 'CLIENTS_SELECTION':
                const cIdx = parseInt(input) - 1;
                if (isNaN(cIdx) || cIdx < 0 || cIdx >= state.data.clients.length) {
                    await msg.reply(BOT_PREFIX + '❌ Número inválido.');
                    return;
                }
                state.data.selectedClient = state.data.clients[cIdx];
                state.step = 'CLIENTS_ACTION';
                await msg.reply(
                    `╭━━━━━━━━━━━━━━━━━━╮\n` +
                    `   ✨ *CLIENTE SELECCIONADO*\n` +
                    `╰━━━━━━━━━━━━━━━━━━╯\n` +
                    `👤 *Nombre:* ${state.data.selectedClient.name}\n` +
                    `📱 *Tel:* ${state.data.selectedClient.phone}\n\n` +
                    `1️⃣  🛒 *Nueva Venta*\n` +
                    `2️⃣  📋 *Ver Suscripciones*\n` +
                    `3️⃣  🗑️ *Eliminar Cliente*\n` +
                    `4️⃣  📤 *Reenviar Información*\n` +
                    `5️⃣  ❌ *Cancelar*\n\n` +
                    `👇 *Responde con el número*`
                );
                break;

            case 'CLIENTS_ACTION':
                const cAct = parseInt(input);
                if (cAct === 1) {
                    userStates[chatId] = {
                        step: 'SELECT_PLATFORM',
                        data: {
                            preFilledClient: {
                                name: state.data.selectedClient.name,
                                phone: state.data.selectedClient.phone
                            }
                        }
                    };

                    let menu = `╭━━━━━━━━━━━━━━━━━━╮\n   🛒 *NUEVA VENTA*\n╰━━━━━━━━━━━━━━━━━━╯\n` +
                        `👤 Cliente: *${state.data.selectedClient.name}*\n\n` +
                        `👇 *Selecciona la Plataforma:*\n\n`;

                    for (const [key, val] of Object.entries(PLATFORMS)) {
                        menu += `*${key}.* ${val.name} ${val.hasPin ? '🔴' : '🟢'}\n`;
                    }
                    await msg.reply(menu);

                } else if (cAct === 2) {
                    const cSubs = await db.getAllSubscriptions(state.data.selectedClient.id);
                    if (cSubs.length === 0) {
                        await msg.reply(BOT_PREFIX + '❌ Este cliente no tiene suscripciones activas.');
                        return;
                    }

                    state.data.subs = cSubs;
                    state.step = 'CLIENTS_SELECT_SUB';

                    let subList = `╭━━━━━━━━━━━━━━━━━━╮\n   📋 *SUSCRIPCIONES*\n╰━━━━━━━━━━━━━━━━━━╯\n` +
                        `👤 *${state.data.selectedClient.name}*\n`;

                    cSubs.forEach((s, i) => {
                        subList += `\n*${i + 1}.* ${s.service_name}\n    📧 ${s.email}\n    📅 Vence: ${s.expiry_date}`;
                    });
                    subList += `\n\n👇 *Responde con el número para gestionar*`;
                    await msg.reply(subList);

                } else if (cAct === 3) {
                    await db.deleteClient(state.data.selectedClient.phone);
                    await msg.reply(BOT_PREFIX + `✅ Cliente *${state.data.selectedClient.name}* eliminado correctamente.`);
                    delete userStates[chatId];

                } else if (cAct === 4) {
                    // Resend Info
                    const cSubs = await db.getAllSubscriptions(state.data.selectedClient.id);
                    if (cSubs.length === 0) {
                        await msg.reply(BOT_PREFIX + '❌ No hay información para reenviar.');
                        return;
                    }

                    let infoMsg = `╭━━━━━━━━━━━━━━━━━━╮\n   ✨ *TUS CUENTAS* ✨\n╰━━━━━━━━━━━━━━━━━━╯\n` +
                        `Hola *${state.data.selectedClient.name}*, aquí tienes tus suscripciones activas:\n`;

                    cSubs.forEach(s => {
                        infoMsg += `\n📺 *${s.service_name}*\n` +
                            `📧 ${s.email}\n` +
                            `🔑 ${s.password}\n` +
                            `📅 Vence: ${s.expiry_date}\n`;
                        if (s.profile_pin) infoMsg += `👤 Perfil: ${s.profile_name} | 🔒 PIN: ${s.profile_pin}\n`;
                    });

                    infoMsg += `\nGracias por tu preferencia! 🙌`;

                    try {
                        await msg.client.sendMessage(`${state.data.selectedClient.phone}@c.us`, infoMsg);
                        await msg.reply(BOT_PREFIX + `✅ Información reenviada a *${state.data.selectedClient.name}*.`);
                    } catch (e) {
                        await msg.reply(BOT_PREFIX + `❌ Error al enviar mensaje al cliente.`);
                    }
                    delete userStates[chatId];

                } else {
                    // If input is not a valid option number, don't cancel immediately unless it's an explicit cancel command
                    if (input.toLowerCase() === 'cancel' || input.toLowerCase() === 'x') {
                        delete userStates[chatId];
                        await msg.reply(BOT_PREFIX + '❌ Operación cancelada.');
                    } else {
                        await msg.reply(BOT_PREFIX + '❌ Opción no válida. Responde con 1, 2, 3, 4 o 5.');
                    }
                }
                break;

            case 'CLIENTS_SELECT_SUB':
                const sIdx = parseInt(input) - 1;
                if (isNaN(sIdx) || sIdx < 0 || sIdx >= state.data.subs.length) {
                    await msg.reply(BOT_PREFIX + '❌ Número inválido.');
                    return;
                }
                state.data.selectedSub = state.data.subs[sIdx];
                state.step = 'CLIENTS_SUB_ACTION';

                const sub = state.data.selectedSub;
                let details = `╭━━━━━━━━━━━━━━━━━━╮\n   🔐 *DETALLES DE CUENTA*\n╰━━━━━━━━━━━━━━━━━━╯\n` +
                    `📺 *Servicio:* ${sub.service_name}\n` +
                    `📧 *Email:* ${sub.email}\n` +
                    `🔑 *Pass:* ${sub.password}\n`;

                if (sub.profile_name) details += `👤 *Perfil:* ${sub.profile_name}\n`;
                if (sub.profile_pin) details += `🔒 *PIN:* ${sub.profile_pin}\n`;

                details += `📅 *Vence:* ${sub.expiry_date}\n\n` +
                    `1️⃣  🔄 *Renovar*\n` +
                    `2️⃣  🗑️ *Eliminar esta suscripción*\n` +
                    `3️⃣  🔙 *Volver*\n\n` +
                    `👇 *Elige una opción*`;

                await msg.reply(details);
                break;

            case 'CLIENTS_SUB_ACTION':
                const sAct = parseInt(input);
                if (sAct === 1) {
                    state.data.clientName = state.data.selectedClient.name;
                    state.data.clientPhone = state.data.selectedClient.phone;
                    state.step = 'RENEW_ENTER_MONTHS';
                    await msg.reply(BOT_PREFIX + `Renovando *${state.data.selectedSub.service_name}*.\n\nIngresa el *número de meses* para renovar:`);

                } else if (sAct === 2) {
                    await db.deleteSubscriptionById(state.data.selectedSub.id);
                    await msg.reply(BOT_PREFIX + `✅ Suscripción eliminada.`);
                    delete userStates[chatId];
                } else {
                    delete userStates[chatId];
                    await msg.reply(BOT_PREFIX + 'Operación finalizada.');
                }
                break;
        }
    } catch (e) {
        console.error('Error in flow:', e);
        await msg.reply(BOT_PREFIX + 'Ocurrió un error. Intenta de nuevo con !vender.');
        delete userStates[chatId];
    }
}

async function checkReminders(client) {
    try {
        const expiringSubs = await db.getExpiringSubscriptions(7);

        for (const sub of expiringSubs) {
            const message = `Hola ${sub.client_name}, tu suscripción de ${sub.service_name} vence el ${sub.expiry_date}. Por favor contacta para renovar.`;
            const chatId = `${sub.phone}@c.us`;
            try {
                await client.sendMessage(chatId, message);
                console.log(`Reminder sent to ${sub.client_name} (${sub.phone})`);
            } catch (err) {
                console.error(`Failed to send reminder to ${sub.phone}:`, err);
            }
        }
    } catch (err) {
        console.error('Error checking reminders:', err);
    }
}

module.exports = {
    handleMessage,
    checkReminders
};
