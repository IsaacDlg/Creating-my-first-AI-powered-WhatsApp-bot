const db = require('./src/database');

const phone = process.argv[2];

if (!phone) {
    console.log('Por favor proporciona un número de teléfono.');
    console.log('Uso: node delete_client.js [telefono]');
    process.exit(1);
}

(async () => {
    try {
        const deleted = await db.deleteClient(phone);
        if (deleted) {
            console.log(`✅ Cliente ${phone} eliminado correctamente.`);
        } else {
            console.log(`❌ Cliente ${phone} no encontrado.`);
        }
    } catch (err) {
        console.error('Error al eliminar:', err);
    }
})();
