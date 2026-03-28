const pdfParse = require('pdf-parse');
console.log('pdfParse keys:', Object.keys(pdfParse));
console.log('pdfParse type:', typeof pdfParse);

const pdfToImg = require('pdf-to-img');
console.log('pdfToImg keys:', Object.keys(pdfToImg));
console.log('pdfToImg type:', typeof pdfToImg);

const docx = require('docx');
console.log('docx keys:', Object.keys(docx).slice(0, 5));
