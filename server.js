const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PDFDocument, rgb } = require('pdf-lib');
const { v4: uuidv4 } = require('uuid');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const https = require('https');
const { execFile } = require('child_process');

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

// Helper function to escape HTML
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Locate Ghostscript binary
function getGhostscriptPath() {
    if (process.env.GHOSTSCRIPT_PATH && fs.existsSync(process.env.GHOSTSCRIPT_PATH)) {
        return process.env.GHOSTSCRIPT_PATH;
    }
    const bundledWin = path.join(__dirname, 'node_modules', 'compress-pdf', 'bin', 'gs', 'bin', 'gswin64c.exe');
    if (process.platform === 'win32' && fs.existsSync(bundledWin)) {
        return bundledWin;
    }
    const bundledWinAlt = path.join(__dirname, 'node_modules', 'compress-pdf', 'bin', 'gs', 'gswin64c.exe');
    if (process.platform === 'win32' && fs.existsSync(bundledWinAlt)) {
        return bundledWinAlt;
    }
    const bundledLinux = path.join(__dirname, 'node_modules', 'compress-pdf', 'bin', 'gs', 'bin', 'gs');
    if (fs.existsSync(bundledLinux)) {
        return bundledLinux;
    }
    return process.platform === 'win32' ? 'gswin64c' : 'gs';
}

function compressPdfWithGhostscript(inputPath, outputPath, setting) {
    setting = setting || '/ebook';
    return new Promise((resolve, reject) => {
        const gsPath = getGhostscriptPath();
        const args = [
            '-sDEVICE=pdfwrite',
            '-dCompatibilityLevel=1.4',
            '-dPDFSETTINGS=' + setting,
            '-dNOPAUSE',
            '-dQUIET',
            '-dBATCH',
            '-sOutputFile=' + outputPath,
            inputPath
        ];
        execFile(gsPath, args, { maxBuffer: 1024 * 1024 * 50 }, (error) => {
            if (error) return reject(error);
            resolve(outputPath);
        });
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
        
        req.files.forEach(file => { try { fs.unlinkSync(file.path); } catch(e) {} });
        sendFileAsPDF(res, outputPath, 'merged.pdf');
    } catch (error) {
        console.error('Merge error:', error);
        if (req.files) req.files.forEach(file => { try { fs.unlinkSync(file.path); } catch(e) {} });
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
        const pdfDoc = await PDFDocument.create();
        
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
        
        req.files.forEach(file => { try { fs.unlinkSync(file.path); } catch(e) {} });
        sendFileAsPDF(res, outputPath, 'converted.pdf');
    } catch (error) {
        console.error('Image to PDF error:', error);
        if (req.files) req.files.forEach(file => { try { fs.unlinkSync(file.path); } catch(e) {} });
        res.status(500).json({ error: error.message });
    }
});

// 3. COMPRESS PDF
app.post('/api/compress-pdf', upload.single('file'), async (req, res) => {
    console.log('📦 Compress PDF - File:', req.file?.originalname);
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    
    const inputPath = req.file.path;
    const outputPath = path.join(outputDir, `${uuidv4()}.pdf`);
    
    try {
        const originalSize = fs.statSync(inputPath).size;
        const requestedLevel = req.body.level || 'recommended';
        
        let gsSetting = '/ebook';
        if (requestedLevel === 'extreme') gsSetting = '/screen';
        else if (requestedLevel === 'low') gsSetting = '/printer';
        
        let compressedSuccessfully = false;
        
        // 1. Ghostscript compression (downsamples images, optimizes fonts & streams)
        try {
            await compressPdfWithGhostscript(inputPath, outputPath, gsSetting);
            if (fs.existsSync(outputPath)) {
                const newSize = fs.statSync(outputPath).size;
                console.log(`Ghostscript compressed: ${originalSize} -> ${newSize} bytes (${Math.round((1 - newSize/originalSize) * 100)}% reduction)`);
                // Only consider successful if it actually reduced the size and is not empty
                if (newSize > 0 && newSize < originalSize) {
                    compressedSuccessfully = true;
                }
            }
        } catch (gsError) {
            console.warn('Ghostscript compression unavailable or failed, falling back to pdf-lib:', gsError.message);
        }
        
        // 2. Fallback: pdf-lib stream & object stream optimization
        if (!compressedSuccessfully) {
            const pdfBytes = fs.readFileSync(inputPath);
            const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
            const optimizedBytes = await pdfDoc.save({ useObjectStreams: true });
            
            if (optimizedBytes.length < originalSize) {
                fs.writeFileSync(outputPath, optimizedBytes);
                console.log(`pdf-lib optimized: ${originalSize} -> ${optimizedBytes.length} bytes`);
            } else {
                // If file is already compact, output original bytes
                fs.writeFileSync(outputPath, pdfBytes);
                console.log('File is already at optimal compression');
            }
        }
        
        try { fs.unlinkSync(inputPath); } catch(e) {}
        sendFileAsPDF(res, outputPath, req.file.originalname.replace(/\.pdf$/i, '_compressed.pdf'));
    } catch (error) {
        console.error('Compress error:', error);
        try { fs.unlinkSync(inputPath); } catch(e) {}
        try { fs.unlinkSync(outputPath); } catch(e) {}
        res.status(500).json({ error: 'Failed to compress PDF: ' + error.message });
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
            page.drawText(watermarkText, {
                x: width / 2 - 50,
                y: height / 2,
                size: 40,
                opacity: 0.3,
                color: rgb(0.6, 0.6, 0.6),
            });
            page.drawText(watermarkText, {
                x: width / 2 - 45,
                y: height / 4,
                size: 24,
                opacity: 0.2,
                color: rgb(0.5, 0.5, 0.5),
            });
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
        
        try { fs.unlinkSync(req.file.path); } catch(e) {}
        sendFileAsPDF(res, outputPath, 'watermarked.pdf');
    } catch (error) {
        console.error('Watermark error:', error);
        try { fs.unlinkSync(req.file.path); } catch(e) {}
        res.status(500).json({ error: error.message });
    }
});

// 5. SPLIT PDF
app.post('/api/split-pdf', upload.single('file'), async (req, res) => {
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
        
        try { fs.unlinkSync(req.file.path); } catch(e) {}
        sendFileAsPDF(res, outputPath, 'split.pdf');
    } catch (error) {
        console.error('Split error:', error);
        try { fs.unlinkSync(req.file.path); } catch(e) {}
        res.status(500).json({ error: error.message });
    }
});

// 6. WORD TO PDF
app.post('/api/word-to-pdf', upload.single('file'), async (req, res) => {
    console.log('📄 Word to PDF - File:', req.file?.originalname);
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    
    try {
        const inputPath = req.file.path;
        const outputPath = path.join(outputDir, `${uuidv4()}.pdf`);
        
        // Use convertToHtml instead of extractRawText to preserve formatting
        const result = await mammoth.convertToHtml({ path: inputPath });
        const htmlContentFromWord = result.value || '<p>No readable content found in document.</p>';
        
        const htmlContent = `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>${escapeHtml(req.file.originalname)}</title>
            <style>
                body { font-family: 'Times New Roman', Times, serif; margin: 40px; line-height: 1.5; font-size: 12pt; }
                .content { word-wrap: break-word; }
                .content img { max-width: 100%; height: auto; }
                .content table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
                .content th, .content td { border: 1px solid #ddd; padding: 8px; }
                .content h1, .content h2, .content h3 { color: #333; }
            </style>
        </head>
        <body>
            <div class="content">${htmlContentFromWord}</div>
        </body>
        </html>`;
        
        const htmlPdf = require('html-pdf-node');
        const options = { format: 'A4', margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' } };
        const pdfBuffer = await htmlPdf.generatePdf({ content: htmlContent }, options);
        
        fs.writeFileSync(outputPath, pdfBuffer);
        try { fs.unlinkSync(inputPath); } catch(e) {}
        
        sendFileAsPDF(res, outputPath, `${req.file.originalname.replace('.docx', '.pdf')}`);
    } catch (error) {
        console.error('Word to PDF error:', error);
        try { fs.unlinkSync(req.file.path); } catch(e) {}
        res.status(500).json({ error: 'Failed to convert Word to PDF: ' + error.message });
    }
});

// 7. PDF TO WORD
app.post('/api/pdf-to-word', upload.single('file'), async (req, res) => {
    console.log('📝 PDF to Word - File:', req.file?.originalname);
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    
    try {
        const dataBuffer = fs.readFileSync(req.file.path);
        const data = await pdfParse(dataBuffer);
        
        const extractedText = data.text || 'No text content found. The PDF might be scanned.';
        
        const { Document, Packer, Paragraph, TextRun } = require('docx');
        const doc = new Document({
            sections: [{
                properties: {},
                children: extractedText.split('\n').map(line => 
                    new Paragraph({
                        children: [new TextRun(line)]
                    })
                )
            }]
        });
        
        const buffer = await Packer.toBuffer(doc);
        const outputPath = path.join(outputDir, `${uuidv4()}.docx`);
        fs.writeFileSync(outputPath, buffer);
        
        try { fs.unlinkSync(req.file.path); } catch(e) {}
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${req.file.originalname.replace('.pdf', '.docx')}"`);
        
        const fileStream = fs.createReadStream(outputPath);
        fileStream.pipe(res);
        fileStream.on('end', () => { try { fs.unlinkSync(outputPath); } catch(e) {} });
    } catch (error) {
        console.error('PDF to Word error:', error);
        try { fs.unlinkSync(req.file.path); } catch(e) {}
        res.status(500).json({ error: 'Failed to extract text from PDF.' });
    }
});

// 8. HEALTH CHECK
app.get('/api/health', (req, res) => {
    res.json({ status: 'online', timestamp: new Date().toISOString() });
});

// Serve sitemap.xml
app.get('/sitemap.xml', (req, res) => {
    res.setHeader('Content-Type', 'application/xml');
    res.sendFile('sitemap.xml', { root: './public' });
});

// ================= KEEP-ALIVE FUNCTION (Prevents Render from Sleeping) =================
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://easy-pdf-tools7.onrender.com';

function keepAlive() {
    if (process.env.RENDER_EXTERNAL_URL) {
        https.get(RENDER_URL, (res) => {
            console.log(`⏰ Keep-alive ping at ${new Date().toLocaleTimeString()} - Status: ${res.statusCode}`);
        }).on('error', (err) => {
            console.error(`❌ Keep-alive failed: ${err.message}`);
        });
    }
}

// Start keep-alive only on Render
if (process.env.RENDER_EXTERNAL_URL) {
    setInterval(keepAlive, 5 * 60 * 1000); // Every 5 minutes
    console.log(`⏰ Keep-alive service started - pinging every 5 minutes`);
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
    console.log(`   ✓ Image to PDF`);
    console.log(`   ✓ Compress PDF`);
    console.log(`   ✓ Add Watermark`);
    console.log(`   ✓ Split PDF`);
    console.log(`   ✓ Word to PDF (full text extraction)`);
    console.log(`   ✓ PDF to Word (full text extraction)`);
    if (process.env.RENDER_EXTERNAL_URL) {
        console.log(`\n⏰ Keep-alive active - your site will stay awake 24/7!`);
    }
});