const db = require('./src/database');

async function check() {
    await db.initDatabase();
    const subs = await db.getAllClientsWithSubs();
    console.log('Subscriptions found:', subs.length);
    if (subs.length > 0) {
        console.log('First 5 subscriptions:');
        console.log(JSON.stringify(subs.slice(0, 5), null, 2));
    } else {
        console.log('No subscriptions found.');
    }
}

check();
