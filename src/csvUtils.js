const fs = require('fs');
const path = require('path');

/**
 * Generates a CSV file from an array of objects.
 * @param {Array} data - Array of objects containing the data.
 * @param {Array} columns - Array of column headers (keys in the objects).
 * @param {string} filename - Name of the file to save.
 * @returns {string} - Absolute path to the generated file.
 */
function generateCSV(data, columns, filename) {
    const header = columns.join(',') + '\n';
    const rows = data.map(row => {
        return columns.map(col => {
            let val = row[col] || '';
            // Escape quotes and wrap in quotes if contains comma
            val = String(val).replace(/"/g, '""');
            if (val.includes(',') || val.includes('"') || val.includes('\n')) {
                val = `"${val}"`;
            }
            return val;
        }).join(',');
    }).join('\n');

    const csvContent = header + rows;
    const filePath = path.join(__dirname, '..', 'temp', filename);

    // Ensure temp dir exists
    const tempDir = path.dirname(filePath);
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    fs.writeFileSync(filePath, csvContent, 'utf8');
    return filePath;
}

module.exports = { generateCSV };
