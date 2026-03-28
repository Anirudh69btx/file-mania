// ─── Theme Management ──────────────────────────────────────────────────────
const themeBtns = document.querySelectorAll('.theme-btn');
let currentThemeColor = '#ff1493';

function setTheme(name) {
    document.body.setAttribute('data-theme', name);
    localStorage.setItem('file-mania-theme', name);
    const map = { pink: '#ff1493', yellow: '#ffd700', red: '#ff4500', black: '#ffffff' };
    currentThemeColor = map[name] || '#ff1493';
}

themeBtns.forEach(btn => btn.addEventListener('click', () => setTheme(btn.dataset.theme)));
const savedTheme = localStorage.getItem('file-mania-theme');
if (savedTheme) setTheme(savedTheme);

// ─── Particle System ───────────────────────────────────────────────────────
const canvas = document.getElementById('particles-canvas');
const ctx    = canvas.getContext('2d');
let particles = [];
const PARTICLE_COUNT = 100;
let mouse = { x: null, y: null };

function resizeCanvas() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
window.addEventListener('mouseout',  () => { mouse.x = null; mouse.y = null; });

class Particle {
    constructor() {
        this.x      = Math.random() * canvas.width;
        this.y      = Math.random() * canvas.height;
        this.size   = Math.random() * 3 + 1;
        this.speedX = Math.random() * 2 - 1;
        this.speedY = Math.random() * 2 - 1;
    }
    update() {
        this.x += this.speedX;
        this.y += this.speedY;
        if (this.x > canvas.width || this.x < 0) this.speedX *= -1;
        if (this.y > canvas.height || this.y < 0) this.speedY *= -1;
    }
    draw() {
        ctx.fillStyle = currentThemeColor;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
    }
}

function initParticles() {
    particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(new Particle());
}

function animateParticles() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
        p.update();
        p.draw();
        if (mouse.x !== null) {
            const dx = mouse.x - p.x, dy = mouse.y - p.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 120) {
                ctx.beginPath();
                ctx.strokeStyle  = currentThemeColor;
                ctx.globalAlpha  = 1 - dist / 120;
                ctx.lineWidth    = 1;
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(mouse.x, mouse.y);
                ctx.stroke();
                ctx.globalAlpha  = 1;
            }
        }
    });
    requestAnimationFrame(animateParticles);
}
initParticles();
animateParticles();

// ─── DOM References ────────────────────────────────────────────────────────
const toolCards              = document.querySelectorAll('.tool-card');
const modal                  = document.getElementById('upload-modal');
const closeBtn               = document.querySelector('.close-btn');
const modalTitle             = document.getElementById('modal-title');
const modalDesc              = document.getElementById('modal-desc');
const dropZone               = document.getElementById('drop-zone');
const fileInput              = document.getElementById('file-input');
const fileList               = document.getElementById('file-list');
const processBtn             = document.getElementById('process-btn');
const progressContainer      = document.getElementById('progress-container');
const progressBar            = document.getElementById('progress-bar');
const progressText           = document.getElementById('progress-text');
const fileSizeDisplay        = document.getElementById('file-size-display');
const statusText             = document.getElementById('status-text');
const dynamicParamsContainer = document.getElementById('dynamic-params-container');
const devBanner              = document.getElementById('dev-banner');
const toolHintText           = document.getElementById('tool-hint-text');
const validationError        = document.getElementById('validation-error');

let currentTool    = '';
let currentFiles   = [];
let isMultiple     = false;
let isDevTool      = false;

const MAX_SINGLE_FILE  = 5 * 1024 * 1024 * 1024;
const MAX_BATCH_FILES  = 5;
const MAX_BATCH_SINGLE = 1 * 1024 * 1024 * 1024;

// ─── API Base Detection ────────────────────────────────────────────────────
const API_HOSTNAME = window.location.hostname || 'localhost';
const API_BASE = window.location.port === '3000' ? '' : `http://${API_HOSTNAME}:3000`;

// ─── Tool Card Click ───────────────────────────────────────────────────────
toolCards.forEach(card => {
    card.addEventListener('click', () => {
        currentTool = card.dataset.tool;
        isDevTool   = card.dataset.dev === 'true';

        modalTitle.textContent = card.querySelector('h2').textContent.replace('Coming Soon', '').trim();
        modalDesc.textContent  = card.querySelector('p').textContent.replace('Coming Soon', '').trim();

        fileInput.accept   = card.dataset.accept || '*';
        isMultiple         = card.dataset.multiple === 'true';
        fileInput.multiple = isMultiple;

        // Show/hide under-development banner
        devBanner.classList.toggle('hidden', !isDevTool);

        // Show/hide tool-level hint
        if (card.dataset.hint) {
            toolHintText.textContent = '💡 ' + card.dataset.hint;
            toolHintText.classList.remove('hidden');
        } else {
            toolHintText.classList.add('hidden');
        }

        // Build dynamic param inputs
        dynamicParamsContainer.innerHTML = '';
        if (card.dataset.params) {
            const params = JSON.parse(card.dataset.params);
            params.forEach(p => {
                const wrapper = document.createElement('div');
                wrapper.className = 'param-wrapper';

                const label = document.createElement('label');
                label.textContent = p.label;
                label.htmlFor     = `param-${p.name}`;

                let input;
                if (p.type === 'select') {
                    input = document.createElement('select');
                    (p.options || []).forEach(opt => {
                        const option = document.createElement('option');
                        option.value       = opt;
                        option.textContent = opt;
                        input.appendChild(option);
                    });
                } else {
                    input = document.createElement('input');
                    input.type        = p.type;
                    input.placeholder = p.placeholder || `Enter ${p.label}`;
                    if (p.type === 'number') {
                        input.min  = 1;
                        input.step = 1;
                    }
                }
                input.id   = `param-${p.name}`;
                input.name = p.name;

                wrapper.appendChild(label);
                wrapper.appendChild(input);

                // Hint text below the input
                if (p.hint) {
                    const hint = document.createElement('small');
                    hint.className   = 'param-hint';
                    hint.textContent = '💡 ' + p.hint;
                    wrapper.appendChild(hint);
                }

                dynamicParamsContainer.appendChild(wrapper);
            });
        }

        resetModal();
        modal.classList.add('active');
    });
});

// ─── Modal Close ───────────────────────────────────────────────────────────
closeBtn.addEventListener('click', () => modal.classList.remove('active'));
window.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });

// ─── Drag & Drop ───────────────────────────────────────────────────────────
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt =>
    dropZone.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); }, false));

['dragenter', 'dragover'].forEach(evt => dropZone.addEventListener(evt, () => dropZone.classList.add('dragover')));
['dragleave', 'drop'].forEach(evt => dropZone.addEventListener(evt, () => dropZone.classList.remove('dragover')));

dropZone.addEventListener('drop', e => handleFiles(e.dataTransfer.files));
fileInput.addEventListener('change', function () { handleFiles(this.files); });

// ─── File Handling ─────────────────────────────────────────────────────────
function formatBytes(bytes, dec = 2) {
    if (!bytes) return '0 Bytes';
    const k = 1024, sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dec)) + ' ' + sizes[i];
}

function handleFiles(files) {
    const newFiles = Array.from(files);
    const acceptExts = fileInput.accept.split(',').map(e => e.trim().toLowerCase());

    const validFiles = newFiles.filter(f => {
        const ext = '.' + f.name.split('.').pop().toLowerCase();
        return acceptExts.includes('*') || acceptExts.includes(ext);
    });
    if (validFiles.length !== newFiles.length) alert('Some files have unsupported formats and were skipped.');

    currentFiles = isMultiple ? [...currentFiles, ...validFiles] : validFiles.slice(0, 1);

    if (isMultiple && currentFiles.length > MAX_BATCH_FILES) {
        alert(`Maximum ${MAX_BATCH_FILES} files allowed.`);
        currentFiles = currentFiles.slice(0, MAX_BATCH_FILES);
    }

    let errMsg = '';
    currentFiles = currentFiles.filter(f => {
        if (!isMultiple && f.size > MAX_SINGLE_FILE) { errMsg = `"${f.name}" exceeds the 5GB limit.`; return false; }
        if (isMultiple && f.size > MAX_BATCH_SINGLE) { errMsg = `"${f.name}" exceeds the 1GB per-file limit.`; return false; }
        return true;
    });
    if (errMsg) alert(errMsg);

    updateFileList();
    processBtn.disabled = currentFiles.length === 0;
}

function updateFileList() {
    fileList.innerHTML = '';
    currentFiles.forEach((file, i) => {
        const div = document.createElement('div');
        div.className = 'file-item';
        div.innerHTML = `
            <span><i class="fas fa-file"></i> ${file.name} (${formatBytes(file.size)})</span>
            <i class="fas fa-times" style="cursor:pointer;color:var(--accent-primary)" onclick="removeFile(${i})"></i>`;
        fileList.appendChild(div);
    });
}

window.removeFile = function (i) {
    currentFiles.splice(i, 1);
    updateFileList();
    processBtn.disabled = currentFiles.length === 0;
};

function resetModal() {
    currentFiles = [];
    updateFileList();
    processBtn.disabled = true;
    progressContainer.classList.add('hidden');
    progressBar.style.width = '0%';
    progressText.textContent = '0%';
    statusText.style.color = '';
    fileInput.value = '';
    validationError.classList.add('hidden');
    validationError.textContent = '';
}

function showValidationError(msg) {
    validationError.textContent = '⚠️ ' + msg;
    validationError.classList.remove('hidden');
}
function clearValidationError() {
    validationError.classList.add('hidden');
    validationError.textContent = '';
}

// ─── Client-side Validation ────────────────────────────────────────────────
function validateInputs() {
    clearValidationError();

    // Page range fields: remove-pages, extract-pages
    const pageRangeFields = ['pages', 'fromPage', 'toPage'];
    for (const fieldName of pageRangeFields) {
        const el = document.getElementById(`param-${fieldName}`);
        if (!el || !el.value.trim()) continue;

        if (fieldName === 'fromPage' || fieldName === 'toPage') {
            const n = parseInt(el.value);
            if (isNaN(n) || n < 1) {
                showValidationError(`"${fieldName === 'fromPage' ? 'From Page' : 'To Page'}" must be a positive number.`);
                return false;
            }
        } else {
            // Validate comma/dash range notation
            const parts = el.value.split(',');
            for (const part of parts) {
                const t = part.trim();
                if (!/^\d+$/.test(t) && !/^\d+[-–]\d+$/.test(t)) {
                    showValidationError(`Invalid page range: "${t}". Use numbers like 1, 3, 5 or ranges like 1-5.`);
                    return false;
                }
            }
        }
    }

    // Split PDF — fromPage must be <= toPage
    const fromEl = document.getElementById('param-fromPage');
    const toEl   = document.getElementById('param-toPage');
    if (fromEl && toEl && fromEl.value && toEl.value) {
        if (parseInt(fromEl.value) > parseInt(toEl.value)) {
            showValidationError('"From Page" must be less than or equal to "To Page".');
            return false;
        }
    }

    return true;
}

// ─── Process Button ────────────────────────────────────────────────────────
processBtn.addEventListener('click', () => {
    if (currentFiles.length === 0) return;
    if (!validateInputs()) return;

    progressContainer.classList.remove('hidden');
    processBtn.disabled  = true;
    statusText.textContent = 'Uploading...';
    statusText.style.color = '';

    const formData = new FormData();
    currentFiles.forEach(f => formData.append('files', f));

    const inputs = dynamicParamsContainer.querySelectorAll('input, select');
    inputs.forEach(inp => formData.append(inp.name, inp.value));

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/api/pdf/${currentTool}`, true);
    xhr.responseType = 'blob';

    // Upload progress
    xhr.upload.onprogress = function (e) {
        if (e.lengthComputable) {
            const pct = (e.loaded / e.total) * 100;
            progressBar.style.width    = pct + '%';
            progressText.textContent   = Math.round(pct) + '%';
            fileSizeDisplay.textContent = `${formatBytes(e.loaded)} / ${formatBytes(e.total)}`;
            statusText.textContent     = pct >= 100 ? 'Processing on server… please wait' : 'Uploading…';
        }
    };

    // Response handler
    xhr.onload = function () {
        if (this.status === 200) {
            // Show compression stats if available
            const origSize = xhr.getResponseHeader('X-Original-Size');
            const compSize = xhr.getResponseHeader('X-Compressed-Size');
            const savedPct = xhr.getResponseHeader('X-Saved-Percent');
            if (origSize && compSize) {
                const saved = parseInt(origSize) - parseInt(compSize);
                statusText.textContent = saved > 0
                    ? `✅ Done! Saved ${formatBytes(saved)} (${savedPct}% smaller)`
                    : '✅ Done! File is already well-compressed.';
            } else {
                statusText.textContent = '✅ Done! Your file is ready.';
            }
            statusText.style.color = '#00e676';

            // Extract filename from Content-Disposition
            let filename = `processed_${currentTool}`;
            
            // Determine default extension based on tool
            let ext = '.pdf';
            if (currentTool === 'pdf-to-word') ext = '.docx';
            else if (currentTool === 'word-to-pdf') ext = '.pdf';
            else if (currentTool === 'pdf-to-jpg') ext = '.jpg';
            else if (currentTool === 'jpg-to-pdf') ext = '.pdf';
            
            const disp = xhr.getResponseHeader('Content-Disposition');
            if (disp) {
                const match = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disp);
                if (match && match[1]) {
                    filename = match[1].replace(/['"]/g, '');
                } else {
                    filename += ext;
                }
            } else {
                filename += ext;
            }

            // Trigger download
            const contentType = xhr.getResponseHeader('Content-Type') || 'application/octet-stream';
            const blob = new Blob([this.response], { type: contentType });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.style.display = 'none';
            a.href     = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            URL.revokeObjectURL(url);
            a.remove();

            setTimeout(() => modal.classList.remove('active'), 2500);

        } else {
            // Read error blob as text/JSON
            this.response.text().then(text => {
                let errorMsg = `Server error (HTTP ${this.status}).`;
                let isDevError = false;
                try {
                    const json = JSON.parse(text);
                    if (json.error) errorMsg = json.error;
                    if (json.underDevelopment) isDevError = true;
                } catch (_) {
                    if (text && text.length < 200) errorMsg += ' ' + text;
                }

                if (isDevError) {
                    statusText.textContent = '🚧 This feature is under development.';
                    statusText.style.color = '#ffab40';
                    alert(`🚧 Feature Under Development\n\n${errorMsg}`);
                } else {
                    statusText.textContent = '❌ Processing failed.';
                    statusText.style.color = '#ff5252';
                    alert(`❌ Tool Error\n\n${errorMsg}\n\nPlease check if the file is valid or try again.`);
                }
                processBtn.disabled = false;
            });
        }
    };

    xhr.onerror = function () {
        statusText.textContent = '❌ Network error — is the server running?';
        statusText.style.color = '#ff5252';
        alert('Network error: Could not connect to the server. Please make sure the server is running on port 3000.');
        processBtn.disabled = false;
    };

    xhr.send(formData);
});
