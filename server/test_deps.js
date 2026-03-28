try {
    const pdfParse = require('pdf-parse');
    console.log('pdf-parse loaded');
    const { Document, Packer, Paragraph, TextRun } = require('docx');
    console.log('docx loaded');
    const { fromBuffer } = require('pdf-to-img');
    console.log('pdf-to-img loaded');
    const sharp = require('sharp');
    console.log('sharp loaded');
    const { PDFDocument } = require('pdf-lib');
    console.log('pdf-lib loaded');
    console.log('All dependencies loaded successfully');
} catch (err) {
    console.error('Dependency load failed:', err);
    process.exit(1);
}
