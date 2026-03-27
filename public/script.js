// ═══════════════════════════════════════════════════════════════════════════
//  ResuMatch — Frontend Logic
// ═══════════════════════════════════════════════════════════════════════════

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ─── DOM Refs ─────────────────────────────────────────────────────────────

const jdInput = $("#jd-input");
const btnNext1 = $("#btn-next-1");
const btnBack2 = $("#btn-back-2");
const btnAnalyze = $("#btn-analyze");
const btnStartOver = $("#btn-start-over");

const toggleText = $("#toggle-text");
const toggleFile = $("#toggle-file");
const resumeTextArea = $("#resume-text-area");
const resumeFileArea = $("#resume-file-area");
const resumeTextInput = $("#resume-text-input");
const resumeFileInput = $("#resume-file-input");
const dropZone = $("#drop-zone");
const filePreview = $("#file-preview");
const fileName = $("#file-name");
const fileSize = $("#file-size");
const btnRemoveFile = $("#btn-remove-file");

const resultsContainer = $("#results-container");
const errorToast = $("#error-toast");
const toastText = $("#toast-text");

// Fix Resume elements
const fixResumeCta = $("#fix-resume-cta");
const btnFixResume = $("#btn-fix-resume");
const layoutModal = $("#layout-modal");
const modalClose = $("#modal-close");
const layoutLeftRight = $("#layout-left-right");
const layoutUpDown = $("#layout-up-down");
const modalLoading = $("#modal-loading");
const resumeDownloadArea = $("#resume-download-area");
const resumePreviewFrame = $("#resume-preview-frame");
const btnDownloadResume = $("#btn-download-resume");
const btnRegenerate = $("#btn-regenerate");

const steps = [$("#step-1"), $("#step-2"), $("#step-3")];
const dots = [$("#dot-1"), $("#dot-2"), $("#dot-3")];
const lines = [$("#line-1"), $("#line-2")];

let currentStep = 0;
let selectedFile = null;
let inputMode = "text"; // "text" or "file"
let generatedResumeHTML = null; // stores generated resume HTML for download
let extractedResumeText = null; // stores resume text from analysis (works for PDF too)

// ─── Step Navigation ──────────────────────────────────────────────────────

function goToStep(stepIndex) {
  steps[currentStep].classList.remove("active");
  steps[stepIndex].classList.add("active");

  // update dots & lines
  dots.forEach((dot, i) => {
    dot.classList.remove("active", "done");
    if (i < stepIndex) dot.classList.add("done");
    if (i === stepIndex) dot.classList.add("active");
  });

  lines.forEach((line, i) => {
    line.classList.toggle("done", i < stepIndex);
  });

  currentStep = stepIndex;
}

// ─── Step 1: JD Input ─────────────────────────────────────────────────────

function checkJdInput() {
  btnNext1.disabled = jdInput.value.trim().length < 20;
}
jdInput.addEventListener("input", checkJdInput);
jdInput.addEventListener("paste", () => setTimeout(checkJdInput, 50));
jdInput.addEventListener("change", checkJdInput);
jdInput.addEventListener("keyup", checkJdInput);

btnNext1.addEventListener("click", () => goToStep(1));

// ─── Step 2: Resume Input ─────────────────────────────────────────────────

// Toggle between text and file
toggleText.addEventListener("click", () => {
  inputMode = "text";
  toggleText.classList.add("active");
  toggleFile.classList.remove("active");
  resumeTextArea.classList.remove("hidden");
  resumeFileArea.classList.add("hidden");
  updateAnalyzeBtn();
});

toggleFile.addEventListener("click", () => {
  inputMode = "file";
  toggleFile.classList.add("active");
  toggleText.classList.remove("active");
  resumeFileArea.classList.remove("hidden");
  resumeTextArea.classList.add("hidden");
  updateAnalyzeBtn();
});

// Text input
resumeTextInput.addEventListener("input", updateAnalyzeBtn);

// File upload
dropZone.addEventListener("click", () => resumeFileInput.click());

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (file && file.type === "application/pdf") {
    handleFileSelect(file);
  } else {
    showToast("Please drop a PDF file.");
  }
});

resumeFileInput.addEventListener("change", () => {
  if (resumeFileInput.files[0]) {
    handleFileSelect(resumeFileInput.files[0]);
  }
});

function handleFileSelect(file) {
  selectedFile = file;
  fileName.textContent = file.name;
  fileSize.textContent = formatFileSize(file.size);
  dropZone.classList.add("hidden");
  filePreview.classList.remove("hidden");
  updateAnalyzeBtn();
}

btnRemoveFile.addEventListener("click", () => {
  selectedFile = null;
  resumeFileInput.value = "";
  filePreview.classList.add("hidden");
  dropZone.classList.remove("hidden");
  updateAnalyzeBtn();
});

function updateAnalyzeBtn() {
  if (inputMode === "text") {
    btnAnalyze.disabled = resumeTextInput.value.trim().length < 20;
  } else {
    btnAnalyze.disabled = !selectedFile;
  }
}

btnBack2.addEventListener("click", () => goToStep(0));

// ─── Analyze ──────────────────────────────────────────────────────────────

btnAnalyze.addEventListener("click", async () => {
  const jd = jdInput.value.trim();
  if (!jd) return showToast("Please enter a job description.");

  // Build form data
  const formData = new FormData();
  formData.append("jobDescription", jd);

  if (inputMode === "text") {
    const text = resumeTextInput.value.trim();
    if (!text) return showToast("Please enter your resume text.");
    formData.append("resumeText", text);
  } else {
    if (!selectedFile) return showToast("Please upload a PDF resume.");
    formData.append("resumeFile", selectedFile);
  }

  // UI loading state
  setLoading(true);

  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || "Analysis failed.");
    }

    // Store extracted resume text (from PDF or pasted) for Fix Resume feature
    if (data.resumeText) {
      extractedResumeText = data.resumeText;
    }

    renderResults(data.data);
    goToStep(2);
  } catch (err) {
    showToast(err.message || "Something went wrong. Please try again.");
  } finally {
    setLoading(false);
  }
});

function setLoading(loading) {
  btnAnalyze.disabled = loading;
  $(".btn-analyze-text").classList.toggle("hidden", loading);
  $(".btn-loading").classList.toggle("hidden", !loading);
}

// ─── Render Results ───────────────────────────────────────────────────────

function renderResults(data) {
  const pct = Math.round(data.matchPercentage);
  const circumference = 2 * Math.PI * 70; // r=70
  const offset = circumference - (pct / 100) * circumference;

  // Color based on percentage
  let pctColor;
  if (pct >= 75) pctColor = "#10b981";
  else if (pct >= 50) pctColor = "#f59e0b";
  else pctColor = "#ef4444";

  resultsContainer.innerHTML = `
    <!-- Hero: Match Percentage -->
    <div class="result-hero">
      <div class="ring-container">
        <svg class="ring-svg" viewBox="0 0 180 180">
          <defs>
            <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#6366f1"/>
              <stop offset="50%" stop-color="#a855f7"/>
              <stop offset="100%" stop-color="#ec4899"/>
            </linearGradient>
          </defs>
          <circle class="ring-bg" cx="90" cy="90" r="70"/>
          <circle class="ring-fill" cx="90" cy="90" r="70"
            style="stroke-dasharray: ${circumference}; stroke-dashoffset: ${circumference};"
            data-target="${offset}"/>
        </svg>
        <div class="ring-percent">
          <span class="ring-number" id="ring-counter">0</span>
          <span class="ring-label">Match</span>
        </div>
      </div>
      <p class="result-summary">${data.overallSummary}</p>
    </div>

    <!-- Strong Points -->
    ${data.strongPoints.length ? `
    <div class="result-section">
      <div class="result-section-title">
        <span class="result-section-icon">✅</span> Strong Points
      </div>
      <div class="chip-list">
        ${data.strongPoints.map((s) => `<span class="chip chip-strong">${s}</span>`).join("")}
      </div>
    </div>` : ""}

    <!-- Missing Skills -->
    ${data.missingSkills.length ? `
    <div class="result-section">
      <div class="result-section-title">
        <span class="result-section-icon">❌</span> Missing Skills
      </div>
      <div class="chip-list">
        ${data.missingSkills.map((s) => `<span class="chip chip-missing">${s}</span>`).join("")}
      </div>
    </div>` : ""}

    <!-- Suggestions -->
    ${data.suggestions.length ? `
    <div class="result-section">
      <div class="result-section-title">
        <span class="result-section-icon">💡</span> Suggestions to Improve
      </div>
      <ul class="suggestion-list">
        ${data.suggestions.map((s, i) => `
          <li class="suggestion-item">
            <span class="suggestion-number">${i + 1}</span>
            <span>${s}</span>
          </li>
        `).join("")}
      </ul>
    </div>` : ""}
  `;

  // Animate ring fill
  requestAnimationFrame(() => {
    const ring = $(".ring-fill");
    if (ring) {
      ring.style.strokeDashoffset = offset;
    }
  });

  // Animate counter
  animateCounter($("#ring-counter"), pct);

  // Show the "Fix Your Resume" button
  fixResumeCta.classList.remove("hidden");
}

function animateCounter(el, target) {
  let current = 0;
  const duration = 1600;
  const startTime = performance.now();

  function tick(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Ease out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    current = Math.round(eased * target);
    el.textContent = current + "%";
    if (progress < 1) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

// ─── Start Over ───────────────────────────────────────────────────────────

btnStartOver.addEventListener("click", () => {
  jdInput.value = "";
  resumeTextInput.value = "";
  selectedFile = null;
  resumeFileInput.value = "";
  filePreview.classList.add("hidden");
  dropZone.classList.remove("hidden");
  btnNext1.disabled = true;
  btnAnalyze.disabled = true;
  resultsContainer.innerHTML = "";
  inputMode = "text";
  toggleText.classList.add("active");
  toggleFile.classList.remove("active");
  resumeTextArea.classList.remove("hidden");
  resumeFileArea.classList.add("hidden");
  fixResumeCta.classList.add("hidden");
  resumeDownloadArea.classList.add("hidden");
  generatedResumeHTML = null;
  extractedResumeText = null;
  resumePreviewFrame.innerHTML = "";
  goToStep(0);
});

// ─── Toast ────────────────────────────────────────────────────────────────

function showToast(msg) {
  toastText.textContent = msg;
  errorToast.classList.remove("hidden");
  setTimeout(() => errorToast.classList.add("hidden"), 4500);
}

// ─── Utility ──────────────────────────────────────────────────────────────

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

// ─── Fix Resume Feature ─────────────────────────────────────────────

// Open layout picker modal
btnFixResume.addEventListener("click", () => {
  layoutModal.classList.remove("hidden");
  modalLoading.classList.add("hidden");
  $$(".layout-option").forEach(opt => opt.classList.remove("disabled"));
});

// Close modal
modalClose.addEventListener("click", () => {
  layoutModal.classList.add("hidden");
});

layoutModal.addEventListener("click", (e) => {
  if (e.target === layoutModal) {
    layoutModal.classList.add("hidden");
  }
});

// Get the resume text — uses extracted text from analysis (works for both PDF and pasted text)
function getResumeText() {
  // First try the extracted text from the analysis API (covers PDF uploads)
  if (extractedResumeText && extractedResumeText.trim()) {
    return extractedResumeText.trim();
  }
  // Fallback to the text input
  return resumeTextInput.value.trim();
}

// Handle layout selection
async function handleLayoutSelect(layout) {
  const resumeText = getResumeText();

  if (!resumeText) {
    layoutModal.classList.add("hidden");
    showToast("Please paste your resume text to generate a formatted resume. PDF-only uploads need text pasted in the text tab.");
    return;
  }

  // Show loading in modal
  modalLoading.classList.remove("hidden");
  $$(".layout-option").forEach(opt => opt.classList.add("disabled"));

  try {
    const res = await fetch("/api/generate-resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resumeText, layout }),
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || "Failed to generate resume.");
    }

    generatedResumeHTML = data.html;

    // Close modal
    layoutModal.classList.add("hidden");

    // Hide the fix-resume button, show download area
    fixResumeCta.classList.add("hidden");
    resumeDownloadArea.classList.remove("hidden");

    // Render preview in iframe
    renderResumePreview(data.html);

  } catch (err) {
    layoutModal.classList.add("hidden");
    showToast(err.message || "Something went wrong generating your resume.");
  }
}

layoutLeftRight.addEventListener("click", () => handleLayoutSelect("left-right"));
layoutUpDown.addEventListener("click", () => handleLayoutSelect("up-down"));

// Render resume preview in an iframe
function renderResumePreview(html) {
  resumePreviewFrame.innerHTML = "";
  const iframe = document.createElement("iframe");
  iframe.id = "resume-iframe";
  iframe.title = "Resume Preview";
  iframe.sandbox = "allow-same-origin";
  resumePreviewFrame.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  // Auto-adjust iframe height after content loads
  iframe.onload = () => {
    try {
      const h = doc.documentElement.scrollHeight;
      iframe.style.height = Math.min(h + 20, 600) + "px";
    } catch (e) {
      iframe.style.height = "500px";
    }
  };
}

// Download resume as PDF
btnDownloadResume.addEventListener("click", () => {
  if (!generatedResumeHTML) return;

  // Create a temporary hidden container to render the resume for PDF conversion
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-9999px";
  container.style.top = "0";
  container.style.width = "210mm"; // A4 width
  container.style.background = "#fff";
  container.innerHTML = generatedResumeHTML;

  // Remove the outer HTML/head/body wrappers, keep just the resume markup
  // Extract content between <body> and </body>
  const bodyMatch = generatedResumeHTML.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) {
    container.innerHTML = bodyMatch[1];
  }

  // Also inject the styles from the generated HTML
  const styleMatch = generatedResumeHTML.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  if (styleMatch) {
    const styleEl = document.createElement("style");
    styleEl.textContent = styleMatch[1];
    container.prepend(styleEl);
  }

  document.body.appendChild(container);

  const opt = {
    margin: 0,
    filename: "my-resume.pdf",
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, letterRendering: true },
    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
  };

  html2pdf().set(opt).from(container).save().then(() => {
    document.body.removeChild(container);
  }).catch(() => {
    document.body.removeChild(container);
    showToast("PDF download failed. Try using your browser's Print → Save as PDF.");
  });
});

// Try other layout — reopen modal
btnRegenerate.addEventListener("click", () => {
  resumeDownloadArea.classList.add("hidden");
  fixResumeCta.classList.remove("hidden");
  generatedResumeHTML = null;
  layoutModal.classList.remove("hidden");
  modalLoading.classList.add("hidden");
  $$(".layout-option").forEach(opt => opt.classList.remove("disabled"));
});
