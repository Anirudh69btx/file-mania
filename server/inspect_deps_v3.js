const pdfParse = require('pdf-parse');
console.log('--- pdf-parse ---');
for (const [key, value] of Object.entries(pdfParse)) {
    if (typeof value === 'function') console.log(`Function: ${key}`);
}
if (pdfParse.default) {
    console.log('--- pdf-parse.default ---');
    if (typeof pdfParse.default === 'function') console.log('Function: default');
    else for (const [key, value] of Object.entries(pdfParse.default)) {
        if (typeof value === 'function') console.log(`Function: default.${key}`);
    }
}

const pdfToImg = require('pdf-to-img');
console.log('--- pdf-to-img ---');
for (const [key, value] of Object.entries(pdfToImg)) {
    if (typeof value === 'function') console.log(`Function: ${key}`);
}
if (pdfToImg.default) {
    console.log('--- pdf-to-img.default ---');
    if (typeof pdfToImg.default === 'function') console.log('Function: default');
    else for (const [key, value] of Object.entries(pdfToImg.default)) {
        if (typeof value === 'function') console.log(`Function: default.${key}`);
    }
}
