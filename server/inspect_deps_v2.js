const pdfParse = require('pdf-parse');
console.log('pdfParse type:', typeof pdfParse);
console.log('pdfParse keys:', Object.keys(pdfParse));

if (pdfParse.default) {
    console.log('pdfParse.default type:', typeof pdfParse.default);
    if (typeof pdfParse.default === 'object') {
        console.log('pdfParse.default keys:', Object.keys(pdfParse.default));
    }
}

// Check other exports as well
for (const key of Object.keys(pdfParse)) {
    if (typeof pdfParse[key] === 'function') {
        console.log(`Found function at key: ${key}`);
    }
}
