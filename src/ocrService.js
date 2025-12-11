const Tesseract = require('tesseract.js');
const logger = require('./logger');

async function extractTextFromImage(imageBuffer) {
    try {
        const result = await Tesseract.recognize(
            imageBuffer,
            'spa', // Spanish
            { logger: m => console.log(m) } // Optional progress logging
        );
        return result.data.text;
    } catch (err) {
        logger.error('OCR Error:', err);
        return null;
    }
}

function parsePichinchaReceipt(text) {
    const data = {
        amount: null,
        reference: null,
        date: null,
        bank: 'Banco Pichincha'
    };

    // Normalize text (remove extra spaces, lower case for searching)
    const lines = text.split('\n');

    // RegEx based on user provided image
    // "Comprobante: 28173978"
    const refMatch = text.match(/Comprobante:?\s*(\d+)/i);
    if (refMatch) data.reference = refMatch[1];

    // "Monto $ 2.50" or "Monto $2.50"
    // Use a stricter regex to avoid picking up the balance or fee
    const amountMatch = text.match(/Monto\s*\$?\s*(\d+[.,]\d{2})/i);
    if (amountMatch) data.amount = parseFloat(amountMatch[1].replace(',', '.'));

    // "Fecha 10 dic 2025"
    // Just capturing raw string for now
    const dateMatch = text.match(/Fecha\s*(.+)/i);
    if (dateMatch) data.date = dateMatch[1].trim();

    return data;
}

module.exports = {
    processReceipt: async (imageBuffer) => {
        const text = await extractTextFromImage(imageBuffer);
        if (!text) return null;

        // Strategy: Try Pichincha first (since user provided it)
        // In future: Detect bank keywords to switch parsers
        return parsePichinchaReceipt(text);
    }
};
