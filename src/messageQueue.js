const logger = require('./logger');

class MessageQueue {
    constructor(client) {
        this.client = client;
        this.queue = [];
        this.isProcessing = false;
        // Jitter: 2s base + random 0-1s = 2-3s delay between messages
        this.delayBase = 2000;
        this.delayRandom = 1000;
    }

    add(to, body) {
        this.queue.push({ to, body });
        this.process();
    }

    async process() {
        if (this.isProcessing) return;
        if (this.queue.length === 0) return;

        this.isProcessing = true;
        logger.info(`[Queue] Processing ${this.queue.length} messages...`);

        while (this.queue.length > 0) {
            const item = this.queue.shift();
            try {
                // Determine if 'to' is phone or formatted (simple check)
                // If it's just digits, append @c.us
                const chatId = item.to.includes('@') ? item.to : `${item.to}@c.us`;

                await this.client.sendMessage(chatId, item.body);
                // logger.debug(`[Queue] Sent to ${chatId}`);
            } catch (err) {
                logger.error(`[Queue] Failed to send to ${item.to}:`, err);
                // We could re-queue here with retry count, but avoiding infinite loops for now
            }

            // Anti-Ban Delay
            const waitTime = this.delayBase + Math.floor(Math.random() * this.delayRandom);
            await new Promise(r => setTimeout(r, waitTime));
        }

        this.isProcessing = false;
        logger.info('[Queue] Processing complete.');
    }
}

let instance = null;

module.exports = {
    init: (client) => {
        instance = new MessageQueue(client);
    },
    add: (to, body) => {
        if (!instance) {
            logger.error('[Queue] Not initialized!');
            return;
        }
        instance.add(to, body);
    }
};
