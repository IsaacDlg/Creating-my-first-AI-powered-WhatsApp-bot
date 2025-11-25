const fs = require('fs');
const db = require('./src/database');

const CSV_FILE = 'clientes.csv';
const DEFAULT_SERVICE = 'Netflix'; // Asumimos Netflix por la imagen

async function importClients() {
    if (!fs.existsSync(CSV_FILE)) {
        console.error(`❌ No se encontró el archivo ${CSV_FILE}`);
        console.log('Por favor crea un archivo "clientes.csv" con las columnas: Nombre, Celular, Correo, Clave, Expiracion');
        return;
    }

    const content = fs.readFileSync(CSV_FILE, 'utf8');
    const lines = content.split('\n');

    console.log(`Procesando ${lines.length} líneas...`);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // Skip empty lines or header (if it contains "Nombre")
        if (!line || line.toLowerCase().includes('nombre')) continue;

        // Expected format: Nombre, Celular, Correo, Clave, Expiracion (DD-MM)
        // Split by comma or semicolon (Excel sometimes uses semicolon)
        const parts = line.split(/[,;]/);

        if (parts.length < 5) {
            console.log(`⚠️ Línea ${i + 1} incompleta: ${line}`);
            continue;
        }

        const name = parts[0].trim();
        let phone = parts[1].trim().replace(/\s/g, '').replace(/-/g, '');
        const email = parts[2].trim();
        const password = parts[3].trim();
        const rawDate = parts[4].trim(); // 19-12

        // Fix phone: If starts with 09, replace 0 with 593 (Ecuador)
        if (phone.startsWith('09') && phone.length === 10) {
            phone = '593' + phone.substring(1);
        }

        // Fix date: DD-MM -> YYYY-MM-DD
        // Assuming 2025 based on context
        let expiryDate = rawDate;
        // Check if date is DD-MM or DD/MM
        const dateMatch = rawDate.match(/^(\d{1,2})[-/](\d{1,2})$/);
        if (dateMatch) {
            const day = dateMatch[1].padStart(2, '0');
            const month = dateMatch[2].padStart(2, '0');
            expiryDate = `2025-${month}-${day}`;
        } else if (rawDate.match(/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/)) {
            // If full date DD/MM/YYYY
            const parts = rawDate.split(/[-/]/);
            expiryDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }

        try {
            // Add Client
            let client = await db.getClientByPhone(phone);
            if (!client) {
                await db.addClient(phone, name);
                client = await db.getClientByPhone(phone);
                console.log(`✅ Cliente creado: ${name} (${phone})`);
            }

            // Add Subscription
            await db.addSubscription(client.id, DEFAULT_SERVICE, expiryDate, email, password);
            console.log(`   - Suscripción agregada: ${DEFAULT_SERVICE} (${expiryDate})`);

        } catch (err) {
            console.error(`❌ Error en línea ${i + 1}:`, err.message);
        }
    }
}

// Initialize DB then run
(async () => {
    await db.initDatabase();
    await importClients();
})();
