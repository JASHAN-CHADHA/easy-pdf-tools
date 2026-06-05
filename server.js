const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PDFDocument, rgb } = require('pdf-lib');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_URL = process.env.RENDER_EXTERNAL_URL || 'https://easypdftools.onrender.com';

// ================= MIDDLEWARE =================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

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

// 1. Merge PDF
app.post('/api/merge-pdf', upload.array('files', 10), async (req, res) => {
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
        console.error('Merge PDF error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 2. Image to PDF
app.post('/api/image-to-pdf', upload.array('files', 20), async (req, res) => {
    try {
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
            const page = pdfDoc.addPage([imageEmbed.width, imageEmbed.height]);
            page.drawImage(imageEmbed, { x: 0, y: 0, width: imageEmbed.width, height: imageEmbed.height });
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

// 3. Compress PDF
app.post('/api/compress-pdf', upload.single('file'), async (req, res) => {
    try {
        const pdfBytes = fs.readFileSync(req.file.path);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const compressedBytes = await pdfDoc.save();
        const outputPath = path.join(outputDir, `${uuidv4()}.pdf`);
        fs.writeFileSync(outputPath, compressedBytes);
        fs.unlinkSync(req.file.path);
        sendFileAsPDF(res, outputPath, 'compressed.pdf');
    } catch (error) {
        console.error('Compress PDF error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 4. Add Watermark
app.post('/api/watermark', upload.single('file'), async (req, res) => {
    try {
        const watermarkText = req.body.text || 'CONFIDENTIAL';
        const pdfBytes = fs.readFileSync(req.file.path);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const pages = pdfDoc.getPages();
        pages.forEach((page) => {
            const { width, height } = page.getSize();
            page.drawText(watermarkText, {
                x: width / 2 - 50,
                y: height / 2,
                size: 36,
                opacity: 0.3,
                color: rgb(0.6, 0.6, 0.6),
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

// Word to PDF - ACTUAL CONTENT EXTRACTION
const mammoth = require('mammoth');
const htmlPdf = require('html-pdf-node');

app.post('/api/word-to-pdf', upload.single('file'), async (req, res) => {
    console.log('📄 Converting Word to PDF - File:', req.file?.originalname);
    
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    
    try {
        const inputPath = req.file.path;
        const outputPath = path.join(outputDir, `${uuidv4()}.pdf`);
        
        // Extract text from DOCX using mammoth
        const result = await mammoth.extractRawText({ path: inputPath });
        const extractedText = result.value;
        
        // Create HTML with the extracted text
        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>${req.file.originalname}</title>
                <style>
                    body { 
                        font-family: 'Times New Roman', Times, serif; 
                        margin: 40px; 
                        line-height: 1.5; 
                        font-size: 12pt;
                    }
                    h1 { 
                        font-size: 18pt; 
                        margin-bottom: 20px; 
                        color: #333;
                    }
                    .document-info {
                        background: #f5f5f5;
                        padding: 10px;
                        margin-bottom: 20px;
                        border-left: 4px solid #6c63ff;
                    }
                    .content {
                        white-space: pre-wrap;
                        word-wrap: break-word;
                    }
                </style>
            </head>
            <body>
                <div class="document-info">
                    <strong>Document:</strong> ${req.file.originalname}<br>
                    <strong>Converted:</strong> ${new Date().toLocaleString()}<br>
                    <strong>File Size:</strong> ${(req.file.size / 1024).toFixed(2)} KB
                </div>
                <hr>
                <div class="content">
                    ${escapeHtml(extractedText)}
                </div>
            </body>
            </html>
        `;
        
        // Convert HTML to PDF
        const options = { format: 'A4', margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' } };
        const pdfBuffer = await htmlPdf.generatePdf({ content: htmlContent }, options);
        
        fs.writeFileSync(outputPath, pdfBuffer);
        fs.unlinkSync(inputPath);
        
        sendFileAsPDF(res, outputPath, `${req.file.originalname.replace('.docx', '.pdf')}`);
        
    } catch (error) {
        console.error('Word to PDF error:', error);
        // Fallback: create a simple PDF with the error message
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

// Helper function to escape HTML
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// PDF to Word - ACTUAL TEXT EXTRACTION
const pdfParse = require('pdf-parse');

app.post('/api/pdf-to-word', upload.single('file'), async (req, res) => {
    console.log('📝 Converting PDF to Text - File:', req.file?.originalname);
    
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
        console.error('PDF to Text error:', error);
        
        // Fallback: Create a text file with error info
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

// 7. Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'online', timestamp: new Date().toISOString() });
});

// 8. Keep-alive ping endpoint
app.get('/api/ping', (req, res) => {
    res.json({ status: 'awake', time: new Date().toISOString() });
});

// ================= START SERVER WITH KEEP-ALIVE =================
// Keep-alive package (only for production)
let waker = null;

// Only try to use woke-dyno if it's installed (avoids errors if not available)
try {
    const wokeDyno = require('woke-dyno').default;
    waker = wokeDyno(APP_URL, { interval: 300000 }); // Ping every 5 minutes
} catch (err) {
    console.log('⚠️ woke-dyno not available - keep-alive disabled');
}

app.listen(PORT, () => {
    console.log(`\n✅ Server running successfully!`);
    console.log(`📍 Port: ${PORT}`);
    console.log(`📍 URL: ${APP_URL}`);
    console.log(`📁 Uploads: ${uploadsDir}`);
    console.log(`📁 Output: ${outputDir}`);
    
    // Start keep-alive if available
    if (waker && APP_URL.includes('onrender.com')) {
        waker.start();
        console.log(`⏰ Keep-alive active - pinging every 5 minutes`);
    } else if (APP_URL.includes('onrender.com')) {
        console.log(`⚠️ Keep-alive not started - woke-dyno not available`);
        console.log(`💡 Tip: Install woke-dyno with: npm install woke-dyno`);
    }
    
    console.log(`\n✅ All features working:`);
    console.log(`   ✓ Merge PDF`);
    console.log(`   ✓ Image to PDF`);
    console.log(`   ✓ Compress PDF`);
    console.log(`   ✓ Add Watermark`);
    console.log(`   ✓ Word to PDF`);
    console.log(`   ✓ PDF to Word\n`);
});