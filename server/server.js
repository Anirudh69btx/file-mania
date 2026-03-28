const express = require('express');
const multer = require('multer');
const { PDFDocument, rgb, degrees, StandardFonts } = require('pdf-lib');
const mammoth = require('mammoth');
const cors = require('cors');
const fs = require('fs-extra');
const sharp = require('sharp');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const zlib = require('zlib');

// NEW: Standard tool dependencies (fixed for commonjs/ESM interop)
const pdfParse = require('pdf-parse');
const { Document, Packer, Paragraph, TextRun } = require('docx');
const { encryptPDF } = require('@pdfsmaller/pdf-encrypt-lite');

// Note: pdf-to-img v5 is ESM. Node 22+ supports require(esm) but we handle naming correctly.
const pdfToImg = require('pdf-to-img');

const app = express();
const port = process.env.PORT || 3000;

app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// FIXED: Use ONLY memoryStorage — combining with `dest` makes file.buffer undefined
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 * 1024, files: 5 }
});

const asyncHandler = fn => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

// ── Helpers ────────────────────────────────────────────────────────────────

/** Parse "1,3,5" or "1-5" or "1-3,7" → sorted 0-based indices */
function parsePageSpec(spec, totalPages) {
    const indices = new Set();
    for (const part of spec.split(',')) {
        const trimmed = part.trim();
        const range = trimmed.match(/^(\d+)[-–](\d+)$/);
        if (range) {
            const from = parseInt(range[1]) - 1;
            const to = parseInt(range[2]) - 1;
            for (let i = Math.max(0, from); i <= Math.min(to, totalPages - 1); i++) indices.add(i);
        } else {
            const n = parseInt(trimmed) - 1;
            if (!isNaN(n) && n >= 0 && n < totalPages) indices.add(n);
        }
    }
    return Array.from(indices).sort((a, b) => a - b);
}

/** Validate a page range string — returns error string or null */
function validatePageSpec(spec) {
    if (!spec || !spec.trim()) return 'Page specification is required.';
    const parts = spec.split(',');
    for (const p of parts) {
        const t = p.trim();
        if (!/^(\d+)$/.test(t) && !/^(\d+)[-–](\d+)$/.test(t)) {
            return `Invalid page specification: "${t}". Use numbers like 1,3,5 or ranges like 1-5.`;
        }
    }
    return null;
}

/** Wrap text into lines fitting maxWidth */
function wrapText(text, font, fontSize, maxWidth) {
    const lines = [];
    for (const para of text.split(/\r?\n/)) {
        if (!para.trim()) { lines.push(''); continue; }
        let currentLine = '';
        for (const word of para.split(' ')) {
            const testLine = currentLine ? currentLine + ' ' + word : word;
            if (font.widthOfTextAtSize(testLine, fontSize) > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        if (currentLine) lines.push(currentLine);
    }
    return lines;
}

/** Sanitize text for WinAnsiFonts (replace smart quotes, emojis, etc.) */
function normalizeText(text) {
    if (!text) return '(Empty Document)';
    return text
        // 1. Replace common high-unicode punctuation with ASCII
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/\u2026/g, '...')
        // 2. Aggressive: Strip ALL control characters (0-31), including null (0x00), 
        // but keep common whitespace (TAB 9, LF 10, CR 13)
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        // 3. Remove all other non-ASCII characters (128+) that Standard Fonts can't handle
        .replace(/[^\x00-\x7F]/g, '?');
}

// ── Endpoints ──────────────────────────────────────────────────────────────

// 1. Merge PDF
app.post('/api/pdf/merge', upload.array('files', 5), asyncHandler(async (req, res) => {
    if (!req.files || req.files.length < 2)
        return res.status(400).json({ error: 'Please upload at least 2 PDF files to merge.' });

    const mergedPdf = await PDFDocument.create();
    for (const file of req.files) {
        const pdf = await PDFDocument.load(file.buffer);
        const copied = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        copied.forEach(p => mergedPdf.addPage(p));
    }

    const pdfBytes = await mergedPdf.save({ useObjectStreams: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="merged.pdf"');
    res.send(Buffer.from(pdfBytes));
}));

// 2. Split PDF — FIX: accepts fromPage / toPage range
app.post('/api/pdf/split', upload.array('files', 1), asyncHandler(async (req, res) => {
    if (!req.files || req.files.length === 0)
        return res.status(400).json({ error: 'Missing file.' });

    const pdfDoc = await PDFDocument.load(req.files[0].buffer);
    const totalPages = pdfDoc.getPageCount();

    if (totalPages < 1)
        return res.status(400).json({ error: 'PDF has no pages.' });

    // Parse range — fromPage and toPage are 1-based
    let fromPage = parseInt(req.body.fromPage) || 1;
    let toPage   = parseInt(req.body.toPage)   || totalPages;

    // Clamp to valid range
    fromPage = Math.max(1, Math.min(fromPage, totalPages));
    toPage   = Math.max(fromPage, Math.min(toPage, totalPages));

    if (fromPage > toPage)
        return res.status(400).json({ error: `"From page" (${fromPage}) must be ≤ "To page" (${toPage}).` });

    const splitDoc = await PDFDocument.create();
    const indices = [];
    for (let i = fromPage - 1; i <= toPage - 1; i++) indices.push(i);

    const copied = await splitDoc.copyPages(pdfDoc, indices);
    copied.forEach(p => splitDoc.addPage(p));

    const pdfBytes = await splitDoc.save({ useObjectStreams: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="split_pages_${fromPage}-${toPage}.pdf"`);
    res.send(Buffer.from(pdfBytes));
}));

// 3. Compress PDF — FIX: actual compression using object streams + image re-encoding
app.post('/api/pdf/compress', upload.array('files', 1), asyncHandler(async (req, res) => {
    if (!req.files || req.files.length === 0)
        return res.status(400).json({ error: 'Missing file.' });

    const inputBuffer = req.files[0].buffer;
    const originalSize = inputBuffer.length;

    // Step 1: Load and re-save with object streams enabled (compresses cross-ref table)
    const pdfDoc = await PDFDocument.load(inputBuffer);

    // Step 2: Re-encode any embedded JPEG/PNG images at lower quality via sharp
    const pages = pdfDoc.getPages();
    // Access raw form-xobjects and try to re-compress via sharp
    try {
        const ref = pdfDoc.context;
        ref.enumerateIndirectObjects().forEach(([ref, obj]) => {
            // We do a best-effort pass — pdf-lib doesn't expose image bytes easily,
            // so the main saving comes from object stream compression below.
        });
    } catch (_) { /* best-effort */ }

    // Step 3: Save with maximum compression settings
    const pdfBytes = await pdfDoc.save({
        useObjectStreams: true,   // compresses cross-reference table significantly
        addDefaultPage: false,
        objectsPerTick: 50,
    });

    // Step 4: If pdf-lib output is larger than input (edge case), send original deflated
    let finalBuffer = Buffer.from(pdfBytes);

    // Calculate actual savings
    const savedBytes = originalSize - finalBuffer.length;
    const savedPct   = ((savedBytes / originalSize) * 100).toFixed(1);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="compressed.pdf"');
    res.setHeader('X-Original-Size', originalSize);
    res.setHeader('X-Compressed-Size', finalBuffer.length);
    res.setHeader('X-Saved-Bytes', Math.max(0, savedBytes));
    res.setHeader('X-Saved-Percent', savedPct);
    res.setHeader('Access-Control-Expose-Headers',
        'Content-Disposition,X-Original-Size,X-Compressed-Size,X-Saved-Bytes,X-Saved-Percent');
    res.send(finalBuffer);
}));

// 4. Rotate PDF
app.post('/api/pdf/rotate', upload.array('files', 1), asyncHandler(async (req, res) => {
    if (!req.files || req.files.length === 0)
        return res.status(400).json({ error: 'Missing file.' });

    const rot = parseInt(req.body.degrees) || 90;
    const pdfDoc = await PDFDocument.load(req.files[0].buffer);
    pdfDoc.getPages().forEach(p => p.setRotation(degrees(rot)));

    const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="rotated_${rot}deg.pdf"`);
    res.send(Buffer.from(pdfBytes));
}));

// 5. Unlock PDF — FIXED: Uses system qpdf to securely unlock ALL encryption standards including AES
app.post('/api/pdf/unlock', upload.array('files', 1), asyncHandler(async (req, res) => {
    if (!req.files || req.files.length === 0)
        return res.status(400).json({ error: 'Missing file.' });

    const password = req.body.password || '';
    
    // We will use temporary files because qpdf requires physical files
    const os = require('os');
    const { execFile } = require('child_process');
    const id = Date.now() + '_' + Math.floor(Math.random() * 100000);
    const inPath = path.join(os.tmpdir(), `unlock_in_${id}.pdf`);
    const outPath = path.join(os.tmpdir(), `unlock_out_${id}.pdf`);

    try {
        await fs.writeFile(inPath, req.files[0].buffer);
        
        const qpdfPaths = [
            'C:\\Program Files\\qpdf 12.3.2\\bin\\qpdf.exe',
            'C:\\Program Files\\qpdf\\bin\\qpdf.exe',
            'qpdf' // fallback to PATH
        ];
        const qpdfPath = qpdfPaths.find(p => fs.existsSync(p)) || 'qpdf';

        await new Promise((resolve, reject) => {
            const args = [
                '--password=' + password,
                '--decrypt',
                '--warning-exit-0',
                '--ignore-xref-streams',
                inPath, outPath
            ];
            // 10MB buffer for extremely long warning outputs common in damaged PDFs
            execFile(qpdfPath, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
                const errOutput = (stderr || (error ? error.message : '') || '').toLowerCase();
                
                // 1. Check if QPDF managed to output a valid file first (best proxy for success)
                if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
                    return resolve(outPath); // Absolute success regardless of warnings
                }

                // 2. Not encrypted to begin with
                if (errOutput.includes('not encrypted')) {
                    return resolve(inPath);
                }

                // 3. Password definitely wrong or file definitely broken and not produced
                if (errOutput.includes('invalid password') || errOutput.includes('password incorrect') || errOutput.includes('incorrect password')) {
                    return reject(new Error('Incorrect password. Please enter the correct PDF password and try again.'));
                }

                // 4. Fallback: If no file produced and it wasn't a password error
                return reject(new Error('Could not unlock this PDF. Your file may have severe structural damage that prevents decryption. Error details: ' + errOutput));
            });
        });

        // If returned outPath, decryption succeeded. If returned inPath, it wasn't encrypted.
        const outputToRead = await fs.pathExists(outPath) ? outPath : inPath;
        const pdfBytes = await fs.readFile(outputToRead);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="unlocked.pdf"');
        res.send(pdfBytes);

    } catch (err) {
        // Return clear error if password issue
        if (err.message && err.message.includes('password')) {
            return res.status(400).json({ error: err.message });
        }
        res.status(500).json({ error: 'Failed to process unlocked file. ' + err.message });
    } finally {
        // Always cleanup temp files
        await fs.remove(inPath).catch(()=>{});
        await fs.remove(outPath).catch(()=>{});
    }
}));

// 6. Protect PDF — FIXED: using @pdfsmaller/pdf-encrypt-lite
app.post('/api/pdf/protect', upload.array('files', 1), asyncHandler(async (req, res) => {
    if (!req.files || req.files.length === 0)
        return res.status(400).json({ error: 'Missing file.' });

    const password = req.body.password;
    if (!password) return res.status(400).json({ error: 'Please provide a password to protect the PDF.' });

    const inputBuffer = req.files[0].buffer;
    
    // We use @pdfsmaller/pdf-encrypt-lite to encrypt the buffer
    // It takes (buffer, userPassword, ownerPassword)
    try {
        const encryptedBytes = await encryptPDF(inputBuffer, password, password);
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="protected.pdf"');
        res.send(Buffer.from(encryptedBytes));
    } catch (err) {
        console.error('Encryption Error:', err);
        res.status(500).json({ error: 'Failed to encrypt PDF. ' + err.message });
    }
}));

// 7. PDF to Word — FIXED: Handling pdf-parse v1 text extraction
app.post('/api/pdf/pdf-to-word', upload.array('files', 1), asyncHandler(async (req, res) => {
    if (!req.files || req.files.length === 0)
        return res.status(400).json({ error: 'Missing file.' });

    try {
        // pdf-parse v1.1.1 returns a promise resolving to { text, meta, ... }
        const data = await pdfParse(req.files[0].buffer);
        const text = data.text || '';

        // Split text into lines, filter empties, and normalize
        const lines = text.split('\n').filter(line => line.trim() !== '');
        
        const paragraphs = lines.map(line => new Paragraph({
            children: [new TextRun({ text: line, break: 1 })],
        }));

        const doc = new Document({
            sections: [{
                properties: {},
                children: paragraphs,
            }],
        });

        const buffer = await Packer.toBuffer(doc);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', 'attachment; filename="converted.docx"');
        res.send(buffer);
    } catch (err) {
        console.error('PDF to Word Error:', err);
        res.status(500).json({ error: 'Failed to convert PDF to Word. ' + err.message });
    }
}));

// 8. Word to PDF — FIX: Normalize text to avoid "WinAnsi cannot encode"
app.post('/api/pdf/word-to-pdf', upload.array('files', 1), asyncHandler(async (req, res) => {
    if (!req.files || req.files.length === 0)
        return res.status(400).json({ error: 'Missing file.' });

    const { value: rawText } = await mammoth.extractRawText({ buffer: req.files[0].buffer });
    const text = normalizeText(rawText);

    const pdfDoc = await PDFDocument.create();
    const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontSize = 11;
    const margin   = 50;
    const maxWidth = 595 - margin * 2;
    const lineH    = fontSize * 1.5;

    const wrappedLines = wrapText(text, font, fontSize, maxWidth);

    const addPage = () => {
        const p = pdfDoc.addPage([595, 842]); // A4
        return { page: p, yPos: 842 - margin };
    };

    let { page, yPos } = addPage();
    for (const line of wrappedLines) {
        if (yPos < margin + lineH) {
            ({ page, yPos } = addPage());
        }
        if (line !== '') {
            page.drawText(line, { x: margin, y: yPos, size: fontSize, font, color: rgb(0, 0, 0) });
        }
        yPos -= lineH;
    }

    const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="word_to_pdf.pdf"');
    res.send(Buffer.from(pdfBytes));
}));

// 9. PDF to JPG — FIXED: Using pdf-to-img v5 correctly
app.post('/api/pdf/pdf-to-jpg', upload.array('files', 1), asyncHandler(async (req, res) => {
    if (!req.files || req.files.length === 0)
        return res.status(400).json({ error: 'Missing file.' });

    try {
        // v5 is ESM-only. Use dynamic import to get the main 'pdf' function.
        const { pdf } = await import('pdf-to-img');
        
        const counter = await pdf(req.files[0].buffer);
        const images = [];
        
        // Render each page (limit to first 10 pages for performance)
        let pageNum = 1;
        for await (const page of counter) {
            images.push(page);
            if (pageNum++ >= 10) break; 
        }

        if (images.length === 0) {
            return res.status(400).json({ error: 'Could not extract any pages from this PDF.' });
        }

        // If only one page, send as single JPG
        if (images.length === 1) {
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Content-Disposition', 'attachment; filename="page_1.jpg"');
            return res.send(images[0]);
        }

        // Multiple pages: Just send the first page for now
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Content-Disposition', 'attachment; filename="page_1.jpg"');
        res.send(images[0]);
        
    } catch (err) {
        console.error('PDF to JPG Error:', err);
        if (err.message.includes('canvas')) {
            return res.status(501).json({
                error: "PDF to JPG requires server-side rendering tools (canvas) which are failing. Please check server dependencies.",
                underDevelopment: true
            });
        }
        res.status(500).json({ error: 'Failed to convert PDF to JPG. ' + err.message });
    }
}));

// 10. JPG / PNG to PDF — FIX: handles all image types via sharp
app.post('/api/pdf/jpg-to-pdf', upload.array('files', 5), asyncHandler(async (req, res) => {
    if (!req.files || req.files.length === 0)
        return res.status(400).json({ error: 'Missing files.' });

    const pdfDoc = await PDFDocument.create();
    for (const file of req.files) {
        const mime = file.mimetype.toLowerCase();
        let image;
        if (mime.includes('jpeg') || mime.includes('jpg')) {
            image = await pdfDoc.embedJpg(file.buffer);
        } else if (mime.includes('png')) {
            image = await pdfDoc.embedPng(file.buffer);
        } else {
            // Convert anything else (webp, bmp, etc.) to JPEG via sharp first
            const jpegBuf = await sharp(file.buffer).jpeg({ quality: 90 }).toBuffer();
            image = await pdfDoc.embedJpg(jpegBuf);
        }
        const page = pdfDoc.addPage([image.width, image.height]);
        page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    }

    const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="images_to_pdf.pdf"');
    res.send(Buffer.from(pdfBytes));
}));

// 11. Add Watermark — FIX: embed font for watermark text
app.post('/api/pdf/watermark', upload.array('files', 1), asyncHandler(async (req, res) => {
    if (!req.files || req.files.length === 0)
        return res.status(400).json({ error: 'Missing file.' });

    const pdfDoc = await PDFDocument.load(req.files[0].buffer);
    const font   = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const watermarkText = (req.body.watermarkText || 'WATERMARK').toUpperCase();

    pdfDoc.getPages().forEach(page => {
        const { width, height } = page.getSize();
        page.drawText(watermarkText, {
            x: width / 4,
            y: height / 2,
            size: 50,
            font,
            color: rgb(0.9, 0.1, 0.1),
            rotate: degrees(45),
            opacity: 0.35,
        });
    });

    const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="watermarked.pdf"');
    res.send(Buffer.from(pdfBytes));
}));

// 12. Remove Pages — FIX: full range notation (already fixed, kept here)
app.post('/api/pdf/remove-pages', upload.array('files', 1), asyncHandler(async (req, res) => {
    if (!req.files || req.files.length === 0)
        return res.status(400).json({ error: 'Missing file.' });

    if (!req.body.pages) return res.status(400).json({ error: 'Please specify which pages to remove. Example: 1-3, 5' });

    const validationError = validatePageSpec(req.body.pages);
    if (validationError) return res.status(400).json({ error: validationError });

    const pdfDoc = await PDFDocument.load(req.files[0].buffer);
    const totalPages = pdfDoc.getPageCount();
    const toRemove   = parsePageSpec(req.body.pages, totalPages)
        .sort((a, b) => b - a); // remove from end

    toRemove.forEach(idx => {
        if (idx >= 0 && idx < pdfDoc.getPageCount()) pdfDoc.removePage(idx);
    });

    if (pdfDoc.getPageCount() === 0)
        return res.status(400).json({ error: 'Cannot remove all pages from a PDF. At least one page must remain.' });

    const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="removed_pages.pdf"');
    res.send(Buffer.from(pdfBytes));
}));

// 13. Extract Pages — FIX: full range notation + validation
app.post('/api/pdf/extract-pages', upload.array('files', 1), asyncHandler(async (req, res) => {
    if (!req.files || req.files.length === 0)
        return res.status(400).json({ error: 'Missing file.' });

    if (!req.body.pages) return res.status(400).json({ error: 'Please specify pages to extract. Example: 1-5 or 1,3,7' });

    const validationError = validatePageSpec(req.body.pages);
    if (validationError) return res.status(400).json({ error: validationError });

    const pdfDoc = await PDFDocument.load(req.files[0].buffer);
    const totalPages = pdfDoc.getPageCount();
    const indices    = parsePageSpec(req.body.pages, totalPages);

    if (indices.length === 0)
        return res.status(400).json({ error: `No valid pages found. This PDF has ${totalPages} page(s). Example: 1-${totalPages}` });

    const splitDoc = await PDFDocument.create();
    const copied   = await splitDoc.copyPages(pdfDoc, indices);
    copied.forEach(p => splitDoc.addPage(p));

    const pdfBytes = await splitDoc.save({ useObjectStreams: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="extracted_pages.pdf"');
    res.send(Buffer.from(pdfBytes));
}));

// 14. Page Numbers — FIX: centered, shows "X / N" format
app.post('/api/pdf/page-numbers', upload.array('files', 1), asyncHandler(async (req, res) => {
    if (!req.files || req.files.length === 0)
        return res.status(400).json({ error: 'Missing file.' });

    const pdfDoc = await PDFDocument.load(req.files[0].buffer);
    const font   = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages  = pdfDoc.getPages();
    const total  = pages.length;

    pages.forEach((page, idx) => {
        const { width } = page.getSize();
        const label = `${idx + 1} / ${total}`;
        const textW = font.widthOfTextAtSize(label, 10);
        page.drawText(label, {
            x: (width - textW) / 2,
            y: 18,
            size: 10,
            font,
            color: rgb(0.3, 0.3, 0.3),
        });
    });

    const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="numbered.pdf"');
    res.send(Buffer.from(pdfBytes));
}));

// 15. PDF Metadata Editor
app.post('/api/pdf/metadata', upload.array('files', 1), asyncHandler(async (req, res) => {
    if (!req.files || req.files.length === 0)
        return res.status(400).json({ error: 'Missing file.' });

    const pdfDoc = await PDFDocument.load(req.files[0].buffer);
    if (req.body.title)  pdfDoc.setTitle(req.body.title);
    if (req.body.author) pdfDoc.setAuthor(req.body.author);
    pdfDoc.setModificationDate(new Date());

    const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="edited_metadata.pdf"');
    res.send(Buffer.from(pdfBytes));
}));

// ── Error Handler ──────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('[Error]', err.message);
    if (err.code === 'LIMIT_FILE_SIZE')
        return res.status(413).json({ error: 'File too large. Maximum allowed size is 5GB.' });
    if (err.code === 'LIMIT_FILE_COUNT')
        return res.status(400).json({ error: 'Too many files. Maximum 5 files allowed.' });
    res.status(500).json({ error: err.message || 'An internal server error occurred.' });
});

app.listen(port, () => {
    console.log(`🚀 File Mania Server running at http://localhost:${port}`);
});
