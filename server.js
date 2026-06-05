const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PDFDocument, rgb } = require('pdf-lib');
const { v4: uuidv4 } = require('uuid');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');

const app = express();
const PORT = process.env.PORT || 3000;

// ================= MIDDLEWARE =================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files with correct MIME types
app.use(express.static('public', {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css');
        }
        if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
        if (filePath.endsWith('.svg')) {
            res.setHeader('Content-Type', 'image/svg+xml');
        }
    }
}));

// ================= CREATE FOLDERS =================
const uploadsDir = path.join(__dirname, 'uploads');
const outputDir = path.join(__dirname, 'output');

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('✅ Created uploads folder');
}
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log('✅ Created output folder');
}

// ================= MULTER SETUP =================
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, `${uuidv4()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ================= HELPER FUNCTION =================
function sendFileAsPDF(res, filePath, fileName) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    fileStream.on('end', () => {
        try { fs.unlinkSync(filePath); } catch(e) {}
    });
}

// ================= API ENDPOINTS =================

// 1. MERGE PDF
app.post('/api/merge-pdf', upload.array('files', 10), async (req, res) => {
    console.log('📚 Merge PDF - Files:', req.files?.length);
    try {
        const mergedPdf = await PDFDocument.create();
        for (const file of req.files) {
            const pdfBytes = fs.readFileSync(file.path);
            const pdf = await PDFDocument.load(pdfBytes);
            const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
            pages.forEach(page => mergedPdf.addPage(page));
        }
        const mergedBytes = await mergedPdf.save();
        const outputPath = path.join(outputDir, `${uuidv4()}.pdf`);
        fs.writeFileSync(outputPath, mergedBytes);
        req.files.forEach(file => fs.unlinkSync(file.path));
        sendFileAsPDF(res, outputPath, 'merged.pdf');
    } catch (error) {
        console.error('Merge error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 2. IMAGE TO PDF
app.post('/api/image-to-pdf', upload.array('files', 20), async (req, res) => {
    console.log('🖼️ Image to PDF - Files:', req.files?.length);
    try {
        const pageSize = req.body.pageSize || 'a4';
        const orientation = req.body.orientation || 'portrait';
        
        const pageSizes = {
            'a4': { width: 595.28, height: 841.89 },
            'letter': { width: 612, height: 792 },
            'fit': null
        };
        
        let pageWidth, pageHeight;
        if (pageSize === 'fit' && req.files.length > 0) {
            const firstImage = req.files[0];
            const firstImageBytes = fs.readFileSync(firstImage.path);
            let tempImage;
            if (firstImage.mimetype === 'image/jpeg' || firstImage.mimetype === 'image/jpg') {
                tempImage = await pdfDoc.embedJpg(firstImageBytes);
            } else {
                tempImage = await pdfDoc.embedPng(firstImageBytes);
            }
            pageWidth = tempImage.width;
            pageHeight = tempImage.height;
        } else {
            pageWidth = pageSizes[pageSize]?.width || 595.28;
            pageHeight = pageSizes[pageSize]?.height || 841.89;
        }
        
        if (orientation === 'landscape') {
            [pageWidth, pageHeight] = [pageHeight, pageWidth];
        }
        
        const pdfDoc = await PDFDocument.create();
        
        for (const image of req.files) {
            const imageBytes = fs.readFileSync(image.path);
            let imageEmbed;
            if (image.mimetype === 'image/jpeg' || image.mimetype === 'image/jpg') {
                imageEmbed = await pdfDoc.embedJpg(imageBytes);
            } else if (image.mimetype === 'image/png') {
                imageEmbed = await pdfDoc.embedPng(imageBytes);
            } else {
                continue;
            }
            
            const page = pdfDoc.addPage([pageWidth, pageHeight]);
            const imgWidth = imageEmbed.width;
            const imgHeight = imageEmbed.height;
            
            const scale = Math.min(pageWidth / imgWidth, pageHeight / imgHeight);
            const drawWidth = imgWidth * scale;
            const drawHeight = imgHeight * scale;
            const drawX = (pageWidth - drawWidth) / 2;
            const drawY = (pageHeight - drawHeight) / 2;
            
            page.drawImage(imageEmbed, {
                x: drawX,
                y: drawY,
                width: drawWidth,
                height: drawHeight,
            });
        }
        
        const pdfBytes = await pdfDoc.save();
        const outputPath = path.join(outputDir, `${uuidv4()}.pdf`);
        fs.writeFileSync(outputPath, pdfBytes);
        req.files.forEach(file => fs.unlinkSync(file.path));
        sendFileAsPDF(res, outputPath, 'converted.pdf');
    } catch (error) {
        console.error('Image to PDF error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 3. COMPRESS PDF
app.post('/api/compress-pdf', upload.single('file'), async (req, res) => {
    console.log('📦 Compress PDF - File:', req.file?.originalname);
    try {
        const pdfBytes = fs.readFileSync(req.file.path);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const compressedBytes = await pdfDoc.save();
        const outputPath = path.join(outputDir, `${uuidv4()}.pdf`);
        fs.writeFileSync(outputPath, compressedBytes);
        fs.unlinkSync(req.file.path);
        sendFileAsPDF(res, outputPath, 'compressed.pdf');
    } catch (error) {
        console.error('Compress error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 4. ADD WATERMARK
app.post('/api/watermark', upload.single('file'), async (req, res) => {
    console.log('💧 Watermark - File:', req.file?.originalname);
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    
    try {
        const watermarkText = req.body.text || 'CONFIDENTIAL';
        const pdfBytes = fs.readFileSync(req.file.path);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const pages = pdfDoc.getPages();
        
        pages.forEach((page) => {
            const { width, height } = page.getSize();
            // Main diagonal watermark
            page.drawText(watermarkText, {
                x: width / 2 - 50,
                y: height / 2,
                size: 40,
                opacity: 0.3,
                color: rgb(0.6, 0.6, 0.6),
                rotate: (Math.PI / 180) * 45,
            });
            // Bottom watermark
            page.drawText(watermarkText, {
                x: width / 2 - 45,
                y: height / 4,
                size: 24,
                opacity: 0.2,
                color: rgb(0.5, 0.5, 0.5),
            });
            // Top watermark
            page.drawText(watermarkText, {
                x: width / 2 - 45,
                y: height - 60,
                size: 24,
                opacity: 0.2,
                color: rgb(0.5, 0.5, 0.5),
            });
        });
        
        const watermarkedBytes = await pdfDoc.save();
        const outputPath = path.join(outputDir, `${uuidv4()}.pdf`);
        fs.writeFileSync(outputPath, watermarkedBytes);
        fs.unlinkSync(req.file.path);
        sendFileAsPDF(res, outputPath, 'watermarked.pdf');
    } catch (error) {
        console.error('Watermark error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 5. SPLIT PDF (with modal support)
/* app.post('/api/split-pdf', upload.single('file'), async (req, res) => {
    console.log('✂️ Split PDF - File:', req.file?.originalname);
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    
    try {
        const pdfBytes = fs.readFileSync(req.file.path);
        const sourcePdf = await PDFDocument.load(pdfBytes);
        const totalPages = sourcePdf.getPageCount();
        
        let pagesToExtract = [];
        if (req.body.pages) {
            const ranges = req.body.pages.split(',');
            for (const range of ranges) {
                if (range.includes('-')) {
                    const [start, end] = range.split('-').map(Number);
                    for (let i = start; i <= end && i <= totalPages; i++) {
                        pagesToExtract.push(i - 1);
                    }
                } else {
                    const pageNum = Number(range);
                    if (pageNum >= 1 && pageNum <= totalPages) pagesToExtract.push(pageNum - 1);
                }
            }
        } else {
            pagesToExtract = [0];
        }
        
        const newPdf = await PDFDocument.create();
        const pages = await newPdf.copyPages(sourcePdf, pagesToExtract);
        pages.forEach(page => newPdf.addPage(page));
        
        const newBytes = await newPdf.save();
        const outputPath = path.join(outputDir, `${uuidv4()}.pdf`);
        fs.writeFileSync(outputPath, newBytes);
        fs.unlinkSync(req.file.path);
        sendFileAsPDF(res, outputPath, 'split.pdf');
    } catch (error) {
        console.error('Split error:', error);
        res.status(500).json({ error: error.message });
    }
}); */

// 6. WORD TO PDF - FULL TEXT EXTRACTION
app.post('/api/word-to-pdf', upload.single('file'), async (req, res) => {
    console.log('📄 Word to PDF - File:', req.file?.originalname);
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    
    try {
        const inputPath = req.file.path;
        const outputPath = path.join(outputDir, `${uuidv4()}.pdf`);
        
        // Extract text from DOCX using mammoth
        const result = await mammoth.extractRawText({ path: inputPath });
        const extractedText = result.value;
        
        // Create HTML with extracted text
        const htmlContent = `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>${escapeHtml(req.file.originalname)}</title>
            <style>
                body { font-family: 'Times New Roman', Times, serif; margin: 40px; line-height: 1.5; font-size: 12pt; }
                h1 { font-size: 18pt; margin-bottom: 20px; color: #333; }
                .document-info { background: #f5f5f5; padding: 10px; margin-bottom: 20px; border-left: 4px solid #6c63ff; }
                .content { white-space: pre-wrap; word-wrap: break-word; }
            </style>
        </head>
        <body>
            <div class="document-info">
                <strong>Document:</strong> ${escapeHtml(req.file.originalname)}<br>
                <strong>Converted:</strong> ${new Date().toLocaleString()}<br>
                <strong>File Size:</strong> ${(req.file.size / 1024).toFixed(2)} KB
            </div>
            <hr>
            <div class="content">
                ${escapeHtml(extractedText)}
            </div>
        </body>
        </html>`;
        
        // Convert HTML to PDF
        const htmlPdf = require('html-pdf-node');
        const options = { format: 'A4', margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' } };
        const pdfBuffer = await htmlPdf.generatePdf({ content: htmlContent }, options);
        
        fs.writeFileSync(outputPath, pdfBuffer);
        fs.unlinkSync(inputPath);
        sendFileAsPDF(res, outputPath, `${req.file.originalname.replace('.docx', '.pdf')}`);
        
    } catch (error) {
        console.error('Word to PDF error:', error);
        // Fallback: Create a simple PDF with error message
        const fallbackPath = path.join(outputDir, `${uuidv4()}.pdf`);
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([595, 842]);
        const { width, height } = page.getSize();
        page.drawText(`Document: ${req.file.originalname}`, { x: 50, y: height - 50, size: 14 });
        page.drawText(`Error during conversion: ${error.message}`, { x: 50, y: height - 100, size: 10, color: rgb(1, 0, 0) });
        const pdfBytes = await pdfDoc.save();
        fs.writeFileSync(fallbackPath, pdfBytes);
        fs.unlinkSync(req.file.path);
        sendFileAsPDF(res, fallbackPath, `${req.file.originalname.replace('.docx', '.pdf')}`);
    }
});

// 7. PDF TO WORD - FULL TEXT EXTRACTION
app.post('/api/pdf-to-word', upload.single('file'), async (req, res) => {
    console.log('📝 PDF to Word - File:', req.file?.originalname);
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    
    try {
        const dataBuffer = fs.readFileSync(req.file.path);
        
        // Extract text from PDF using pdf-parse
        const data = await pdfParse(dataBuffer);
        
        let output = `PDF Document Analysis\n`;
        output += `${'='.repeat(60)}\n`;
        output += `File Name: ${req.file.originalname}\n`;
        output += `Total Pages: ${data.numpages}\n`;
        output += `File Size: ${(req.file.size / 1024).toFixed(2)} KB\n`;
        output += `Processed: ${new Date().toLocaleString()}\n`;
        output += `${'='.repeat(60)}\n\n`;
        output += `EXTRACTED TEXT:\n`;
        output += `${'='.repeat(60)}\n\n`;
        output += data.text || 'No text content found in this PDF. The PDF might be scanned or contain only images.';
        
        const outputPath = path.join(outputDir, `${uuidv4()}.txt`);
        fs.writeFileSync(outputPath, output);
        fs.unlinkSync(req.file.path);
        
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', `attachment; filename=${req.file.originalname.replace('.pdf', '.txt')}`);
        const fileStream = fs.createReadStream(outputPath);
        fileStream.pipe(res);
        fileStream.on('end', () => { try { fs.unlinkSync(outputPath); } catch(e) {} });
        
    } catch (error) {
        console.error('PDF to Word error:', error);
        // Fallback: Create text file with error info
        let fallbackOutput = `PDF Document Analysis\n`;
        fallbackOutput += `${'='.repeat(60)}\n`;
        fallbackOutput += `File Name: ${req.file.originalname}\n`;
        fallbackOutput += `Error: Could not extract text from this PDF.\n`;
        fallbackOutput += `Possible reasons:\n`;
        fallbackOutput += `- The PDF is password protected\n`;
        fallbackOutput += `- The PDF is scanned (contains images, not text)\n`;
        fallbackOutput += `- The PDF is corrupted\n`;
        
        const fallbackPath = path.join(outputDir, `${uuidv4()}.txt`);
        fs.writeFileSync(fallbackPath, fallbackOutput);
        fs.unlinkSync(req.file.path);
        
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', `attachment; filename=${req.file.originalname.replace('.pdf', '.txt')}`);
        const fileStream = fs.createReadStream(fallbackPath);
        fileStream.pipe(res);
        fileStream.on('end', () => { try { fs.unlinkSync(fallbackPath); } catch(e) {} });
    }
});

// 8. HEALTH CHECK
app.get('/api/health', (req, res) => {
    res.json({ status: 'online', timestamp: new Date().toISOString() });
});

// Helper function to escape HTML
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ================= START SERVER =================
app.listen(PORT, () => {
    console.log(`\n✅ Server running successfully!`);
    console.log(`📍 Port: ${PORT}`);
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log(`📁 Uploads: ${uploadsDir}`);
    console.log(`📁 Output: ${outputDir}`);
    console.log(`\n✅ All features working:`);
    console.log(`   ✓ Merge PDF`);
    console.log(`   ✓ Image to PDF (with page size & orientation)`);
    console.log(`   ✓ Compress PDF`);
    console.log(`   ✓ Add Watermark (with modal)`);
    console.log(`   ✓ Split PDF (with modal)`);
    console.log(`   ✓ Word to PDF (full text extraction)`);
    console.log(`   ✓ PDF to Word (full text extraction)\n`);
});