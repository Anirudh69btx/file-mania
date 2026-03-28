const pdfParse = require('pdf-parse');
const { Document, Packer, Paragraph, TextRun } = require('docx');
const fs = require('fs');

async function test() {
    try {
        const buffer = fs.readFileSync('test.pdf');
        console.log('Read test.pdf, size:', buffer.length);
        
        // v1.1.1
        const data = await pdfParse(buffer);
        console.log('PDF parsed, text length:', data.text.length);
        
        const lines = data.text.split('\n').filter(line => line.trim() !== '');
        const paragraphs = lines.map(line => new Paragraph({
            children: [new TextRun({ text: line, break: 1 })],
        }));

        const doc = new Document({
            sections: [{
                children: paragraphs,
            }],
        });

        const wordBuffer = await Packer.toBuffer(doc);
        console.log('Word buffer created, size:', wordBuffer.length);
        fs.writeFileSync('output_test.docx', wordBuffer);
        console.log('File written to output_test.docx');
    } catch (err) {
        console.error('Test failed:', err);
    }
}

test();
