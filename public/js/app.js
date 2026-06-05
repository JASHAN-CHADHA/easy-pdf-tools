// API Configuration
const API_URL = '';
// Tool Data
const TOOLS = [
    { id: 'merge-pdf', name: 'Merge PDF', desc: 'Combine multiple PDFs into one', icon: 'fa-object-group', cat: 'edit', endpoint: '/api/merge-pdf', accept: '.pdf', multiple: true, fieldName: 'files' },
    { id: 'image-to-pdf', name: 'Image to PDF', desc: 'Convert JPG, PNG to PDF', icon: 'fa-images', cat: 'convert', endpoint: '/api/image-to-pdf', accept: 'image/*', multiple: true, fieldName: 'files' },
    { id: 'compress-pdf', name: 'Compress PDF', desc: 'Reduce PDF file size', icon: 'fa-compress-alt', cat: 'optimize', endpoint: '/api/compress-pdf', accept: '.pdf', multiple: false, fieldName: 'file' },
    { id: 'watermark', name: 'Add Watermark', desc: 'Add text watermark to PDF', icon: 'fa-tint', cat: 'edit', endpoint: '/api/watermark', accept: '.pdf', multiple: false, fieldName: 'file' },
    // split-pdf REMOVED
    { id: 'word-to-pdf', name: 'Word to PDF', desc: 'Convert DOCX to PDF', icon: 'fa-file-word', cat: 'convert', endpoint: '/api/word-to-pdf', accept: '.docx', multiple: false, fieldName: 'file' },
    { id: 'pdf-to-word', name: 'PDF to Word', desc: 'Convert PDF to DOCX', icon: 'fa-file-pdf', cat: 'convert', endpoint: '/api/pdf-to-word', accept: '.pdf', multiple: false, fieldName: 'file' },
];

// State
let currentTool = null;
let selectedFiles = [];

// DOM Elements
let toolsGrid, dropZone, browseBtn, fileInput, fileListDiv, fileCountSpan, convertBtn, activeToolName, dropZoneText;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    toolsGrid = document.getElementById('tools-grid');
    dropZone = document.getElementById('drop-zone');
    browseBtn = document.getElementById('browse-btn');
    fileInput = document.getElementById('file-input');
    fileListDiv = document.getElementById('file-list');
    fileCountSpan = document.getElementById('file-count-label');
    convertBtn = document.getElementById('convert-btn');
    activeToolName = document.getElementById('active-tool-name');
    dropZoneText = document.getElementById('drop-zone-text');
    
    if (toolsGrid) renderTools();
    setupEventListeners();
    testBackend();
});

// Test backend
async function testBackend() {
    try {
        const response = await fetch(`${API_URL}/api/health`);
        if (response.ok) {
            console.log('✅ Backend connected');
        }
    } catch (error) {
        console.error('Backend error:', error);
    }
}

// Render tools
function renderTools() {
    const category = document.querySelector('.tab-btn.active')?.dataset.category || 'all';
    const filtered = category === 'all' ? TOOLS : TOOLS.filter(t => t.cat === category);
    
    toolsGrid.innerHTML = filtered.map(tool => `
        <div class="tool-card" onclick="selectTool('${tool.id}')">
            <div class="tool-icon"><i class="fas ${tool.icon}"></i></div>
            <h3>${tool.name}</h3>
            <p>${tool.desc}</p>
        </div>
    `).join('');
    
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderTools();
        };
    });
}

// Select tool
window.selectTool = function(toolId) {
    currentTool = TOOLS.find(t => t.id === toolId);
    if (!currentTool) return;
    
    if (activeToolName) activeToolName.textContent = `📄 ${currentTool.name}`;
    
    let acceptText = '';
    if (currentTool.accept === 'image/*') {
        acceptText = 'Accepts: JPG, PNG, GIF images';
    } else if (currentTool.accept === '.pdf') {
        acceptText = 'Accepts: PDF files only';
    } else if (currentTool.accept === '.docx') {
        acceptText = 'Accepts: Word (.docx) files';
    }
    
    if (dropZoneText) dropZoneText.textContent = acceptText;
    
    if (fileInput) {
        fileInput.accept = currentTool.accept;
        fileInput.multiple = currentTool.multiple;
    }
    
    clearFiles();
    showToast(`Selected: ${currentTool.name}`, 'success');
};

// Setup event listeners
function setupEventListeners() {
    if (browseBtn) {
        browseBtn.onclick = (e) => {
            e.preventDefault();
            if (fileInput) fileInput.click();
        };
    }
    
    if (fileInput) {
        fileInput.onchange = (e) => {
            addFiles(Array.from(e.target.files));
        };
    }
    
    if (dropZone) {
        dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); };
        dropZone.ondragleave = () => dropZone.classList.remove('drag-over');
        dropZone.ondrop = (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            addFiles(Array.from(e.dataTransfer.files));
        };
    }
    
    if (convertBtn) convertBtn.onclick = startConversion;
}

// Add files
function addFiles(files) {
    if (!currentTool) {
        showToast('Select a tool first', 'error');
        return;
    }
    
    const maxFiles = currentTool.multiple ? 10 : 1;
    let filesToAdd = files;
    
    if (selectedFiles.length + files.length > maxFiles) {
        showToast(`Max ${maxFiles} file(s)`, 'warning');
        filesToAdd = files.slice(0, maxFiles - selectedFiles.length);
    }
    
    const validFiles = [];
    for (const file of filesToAdd) {
        let isValid = false;
        if (currentTool.accept === 'image/*') {
            if (file.type.startsWith('image/')) isValid = true;
        } else if (currentTool.accept === '.pdf') {
            if (file.name.toLowerCase().endsWith('.pdf')) isValid = true;
        } else if (currentTool.accept === '.docx') {
            if (file.name.toLowerCase().endsWith('.docx')) isValid = true;
        }
        
        if (isValid) {
            validFiles.push(file);
        } else {
            showToast(`Invalid: ${file.name}`, 'error');
        }
    }
    
    if (validFiles.length === 0) return;
    
    selectedFiles.push(...validFiles);
    renderFileList();
    if (convertBtn) convertBtn.disabled = false;
}

// Render file list
function renderFileList() {
    if (!fileListDiv) return;
    
    if (selectedFiles.length === 0) {
        fileListDiv.innerHTML = '';
        if (fileCountSpan) fileCountSpan.textContent = 'No files selected';
        return;
    }
    
    fileListDiv.innerHTML = selectedFiles.map((file, index) => `
        <div class="file-item">
            <span>📄 ${file.name} (${(file.size / 1024).toFixed(2)} KB)</span>
            <button class="file-item-remove" onclick="removeFile(${index})">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `).join('');
    
    if (fileCountSpan) fileCountSpan.textContent = `${selectedFiles.length} file(s) selected`;
}

// Remove file
window.removeFile = function(index) {
    selectedFiles.splice(index, 1);
    renderFileList();
    if (convertBtn) convertBtn.disabled = selectedFiles.length === 0;
};

// Clear files
function clearFiles() {
    selectedFiles = [];
    renderFileList();
    if (convertBtn) convertBtn.disabled = true;
    if (fileInput) fileInput.value = '';
}

// ============ CUSTOM MODALS ============

// Show Watermark Modal
function showWatermarkModalDialog() {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'watermark-modal';
        modal.innerHTML = `
            <div class="watermark-modal-card">
                <div style="width: 60px; height: 60px; background: rgba(108,99,255,0.1); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto;">
                    <i class="fas fa-tint" style="font-size: 28px; color: var(--accent);"></i>
                </div>
                <h3>Add Watermark</h3>
                <p>Enter the text you want to use as watermark</p>
                <input type="text" id="watermarkInput" class="watermark-input" placeholder="e.g., CONFIDENTIAL, DRAFT" value="CONFIDENTIAL">
                <div class="watermark-preview">
                    <div class="preview-doc">
                        <div class="preview-text" id="previewText">CONFIDENTIAL</div>
                    </div>
                </div>
                <div class="watermark-buttons">
                    <button class="watermark-cancel" id="watermarkCancel">Cancel</button>
                    <button class="watermark-confirm" id="watermarkConfirm">Apply Watermark</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        const input = modal.querySelector('#watermarkInput');
        const previewText = modal.querySelector('#previewText');
        const confirmBtn = modal.querySelector('#watermarkConfirm');
        const cancelBtn = modal.querySelector('#watermarkCancel');
        
        input.addEventListener('input', (e) => {
            const val = e.target.value || 'CONFIDENTIAL';
            previewText.textContent = val;
        });
        
        confirmBtn.onclick = () => {
            const text = input.value.trim();
            modal.remove();
            resolve(text || 'CONFIDENTIAL');
        };
        
        cancelBtn.onclick = () => {
            modal.remove();
            resolve(null);
        };
        
        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.remove();
                resolve(null);
            }
        };
        
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const text = input.value.trim();
                modal.remove();
                resolve(text || 'CONFIDENTIAL');
            }
        });
        
        input.focus();
        input.select();
    });
}

// Show Split PDF Modal
function showSplitModalDialog(totalPages) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'split-modal';
        modal.innerHTML = `
            <div class="split-modal-card">
                <div style="width: 60px; height: 60px; background: rgba(108,99,255,0.1); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto;">
                    <i class="fas fa-cut" style="font-size: 28px; color: var(--accent);"></i>
                </div>
                <h3>Split PDF</h3>
                <p>Enter page numbers to extract from the PDF</p>
                
                <input type="text" id="splitInput" class="split-input" placeholder="e.g., 1-5, 3, 7-9" value="1">
                
                <div class="split-examples">
                    <p><i class="fas fa-lightbulb"></i> Examples:</p>
                    <code>1-5</code> <code>3</code> <code>1,3,5</code> <code>2-4,7</code>
                </div>
                
                <div class="split-preview">
                    <div class="split-preview-info">
                        <i class="fas fa-file-pdf"></i> Total Pages: ${totalPages}
                    </div>
                </div>
                
                <div class="split-buttons">
                    <button class="split-cancel" id="splitCancel">Cancel</button>
                    <button class="split-confirm" id="splitConfirm">Extract Pages</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        const input = modal.querySelector('#splitInput');
        const confirmBtn = modal.querySelector('#splitConfirm');
        const cancelBtn = modal.querySelector('#splitCancel');
        
        // Validate input in real-time
        input.addEventListener('input', (e) => {
            let value = e.target.value;
            value = value.replace(/[^0-9,\-]/g, '');
            e.target.value = value;
        });
        
        confirmBtn.onclick = () => {
            let pages = input.value.trim();
            if (!pages) pages = '1';
            modal.remove();
            resolve(pages);
        };
        
        cancelBtn.onclick = () => {
            modal.remove();
            resolve(null);
        };
        
        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.remove();
                resolve(null);
            }
        };
        
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                let pages = input.value.trim();
                if (!pages) pages = '1';
                modal.remove();
                resolve(pages);
            }
        });
        
        input.focus();
    });
}

// Start Conversion
async function startConversion() {
    if (!currentTool || selectedFiles.length === 0) {
        showToast('Select a tool and upload files', 'error');
        return;
    }
    
    if (convertBtn) {
        convertBtn.disabled = true;
        convertBtn.innerHTML = '<div class="loading"></div> Converting...';
    }
    
    try {
        const formData = new FormData();
        const fieldName = currentTool.fieldName || (currentTool.multiple ? 'files' : 'file');
        
        if (currentTool.multiple) {
            selectedFiles.forEach(file => formData.append(fieldName, file));
        } else {
            formData.append(fieldName, selectedFiles[0]);
        }
        
        // Watermark with custom modal
        if (currentTool.id === 'watermark') {
            const watermarkText = await showWatermarkModalDialog();
            if (watermarkText) {
                formData.append('text', watermarkText);
            } else {
                showToast('Watermark cancelled', 'warning');
                if (convertBtn) {
                    convertBtn.disabled = false;
                    convertBtn.innerHTML = '<i class="fas fa-magic"></i> Convert Now';
                }
                return;
            }
        }
        
        // Split PDF with custom modal
        if (currentTool.id === 'split-pdf') {
            const totalPages = 100; // Default value
            const pages = await showSplitModalDialog(totalPages);
            if (pages) {
                formData.append('pages', pages);
            } else {
                showToast('Split cancelled', 'warning');
                if (convertBtn) {
                    convertBtn.disabled = false;
                    convertBtn.innerHTML = '<i class="fas fa-magic"></i> Convert Now';
                }
                return;
            }
        }
        
        const response = await fetch(`${API_URL}${currentTool.endpoint}`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) throw new Error('Conversion failed');
        
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        
        let extension = '.pdf';
        if (currentTool.id === 'pdf-to-word') extension = '.docx';
        
        a.download = `${currentTool.id}_${Date.now()}${extension}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        showToast('✅ Conversion successful!', 'success');
        clearFiles();
        
    } catch (error) {
        showToast(`❌ Error: ${error.message}`, 'error');
    } finally {
        if (convertBtn) {
            convertBtn.disabled = false;
            convertBtn.innerHTML = '<i class="fas fa-magic"></i> Convert Now';
        }
    }
}

// Show toast
window.showToast = function(message, type = 'success') {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-msg');
    if (!toast) return;
    if (toastMsg) toastMsg.textContent = message;
    toast.classList.add('show');
    const colors = { error: '#ef4444', warning: '#f59e0b', success: '#10b981' };
    toast.style.background = colors[type] || colors.success;
    setTimeout(() => toast.classList.remove('show'), 3000);
};

// Modal functions
window.openModal = function(type) {
    const modal = document.getElementById('modal');
    if (modal) modal.classList.add('open');
};

window.closeModal = function() {
    const modal = document.getElementById('modal');
    if (modal) modal.classList.remove('open');
};

window.handleSignup = function() {
    const email = document.getElementById('modal-email');
    if (email && email.value.includes('@')) {
        showToast('Thank you for subscribing!');
        closeModal();
        email.value = '';
    } else {
        showToast('Enter valid email', 'error');
    }
};

window.acceptCookies = function() {
    const banner = document.getElementById('cookie-banner');
    if (banner) banner.style.display = 'none';
    localStorage.setItem('cookieAccepted', 'true');
};

window.declineCookies = function() {
    const banner = document.getElementById('cookie-banner');
    if (banner) banner.style.display = 'none';
    localStorage.setItem('cookieAccepted', 'false');
};

window.handleHeroUpload = function(input) {
    const files = Array.from(input.files);
    if (files.length > 0) {
        const file = files[0];
        const ext = file.name.split('.').pop().toLowerCase();
        if (ext === 'pdf') selectTool('merge-pdf');
        else if (['jpg', 'jpeg', 'png'].includes(ext)) selectTool('image-to-pdf');
        else if (ext === 'docx') selectTool('word-to-pdf');
        setTimeout(() => addFiles(files), 100);
    }
};

const cookieBanner = document.getElementById('cookie-banner');
if (cookieBanner && localStorage.getItem('cookieAccepted')) {
    cookieBanner.style.display = 'none';
}

console.log('App loaded!');