const fs = require('fs');
const path = require('path');

const STATE_FILE = process.env.DATA_DIR
    ? path.join(process.env.DATA_DIR, 'bot_state.json')
    : path.join(__dirname, '..', 'bot_state.json');

// In-memory cache
let stateCache = {};

// Load State from Disk
function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const raw = fs.readFileSync(STATE_FILE, 'utf8');
            stateCache = JSON.parse(raw);
            console.log(`[StateManager] Loaded ${Object.keys(stateCache).length} active conversations.`);
        }
    } catch (err) {
        console.error('[StateManager] Failed to load state:', err);
        stateCache = {};
    }
    return stateCache;
}

// Save State to Disk (Async to avoid blocking)
// We throttle this? For now, simplistic write on change is safer for low traffic.
function saveState() {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(stateCache, null, 2));
    } catch (err) {
        console.error('[StateManager] Failed to save state:', err);
    }
}

// Proxy Handler to auto-save on changes
const handler = {
    set(target, property, value) {
        target[property] = value;
        saveState(); // Auto-save on set
        return true;
    },
    deleteProperty(target, property) {
        delete target[property];
        saveState(); // Auto-save on delete
        return true;
    }
};

// Public API
module.exports = {
    init: loadState,
    getPersistentState: () => {
        // Return a proxy wrapping the cache
        return new Proxy(stateCache, handler);
    }
};
