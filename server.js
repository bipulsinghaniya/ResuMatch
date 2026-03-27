require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const PORT = process.env.PORT || 3000;

console.log("hello world");
console.log("KEY:", process.env.GEMINI_API_KEY);

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Multer config for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) =>
    cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"), false);
    }
  },
});

// Serve static frontend
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─── API: Analyze Resume vs JD ───────────────────────────────────────────────

app.post("/api/analyze", upload.single("resumeFile"), async (req, res) => {
  try {
    const { jobDescription, resumeText } = req.body;

    if (!jobDescription || (!resumeText && !req.file)) {
      return res.status(400).json({
        error: "Please provide both a job description and a resume (text or PDF).",
      });
    }

    // Extract resume content
    let resume = resumeText || "";

    if (req.file) {
      try {
        const pdfBuffer = fs.readFileSync(req.file.path);
        const pdfData = await pdfParse(pdfBuffer);
        resume = pdfData.text;
      } catch (pdfErr) {
        return res.status(400).json({
          error: "Failed to parse PDF file. Please try pasting the text instead.",
        });
      } finally {
        // Clean up uploaded file
        fs.unlink(req.file.path, () => {});
      }
    }

    if (!resume.trim()) {
      return res.status(400).json({ error: "Resume content is empty." });
    }

    // Build the AI prompt
    const prompt = `
You are an expert ATS (Applicant Tracking System) and career advisor. Analyze the following resume against the job description.

Return your analysis STRICTLY as a valid JSON object with the following structure (no markdown, no code fences, ONLY raw JSON):

{
  "matchPercentage": <number 0-100>,
  "overallSummary": "<2-3 sentence summary of the match>",
  "strongPoints": ["<strength 1>", "<strength 2>", ...],
  "missingSkills": ["<missing skill 1>", "<missing skill 2>", ...],
  "suggestions": ["<actionable suggestion 1>", "<actionable suggestion 2>", ...]
}

Rules:
- matchPercentage must be a realistic number (don't always give 50 or 70).
- strongPoints: list skills/experiences from the resume that match the JD (max 6).
- missingSkills: list skills/qualifications required in the JD but missing in the resume (max 8).
- suggestions: give actionable tips to improve the resume for THIS specific JD (max 6).

───── JOB DESCRIPTION ─────
${jobDescription}

───── RESUME ─────
${resume}
`;

    // Call Gemini
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    // Parse JSON from response (strip code fences if any)
    let cleaned = responseText.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const analysis = JSON.parse(cleaned);

    return res.json({
      success: true,
      data: {
        matchPercentage: analysis.matchPercentage ?? 0,
        overallSummary: analysis.overallSummary ?? "",
        strongPoints: analysis.strongPoints ?? [],
        missingSkills: analysis.missingSkills ?? [],
        suggestions: analysis.suggestions ?? [],
      },
      resumeText: resume,
    });
  } catch (err) {
    console.error("Analysis error:", err);

    if (err.message?.includes("API_KEY")) {
      return res.status(500).json({
        error: "Invalid or missing Gemini API key. Please check your .env file.",
      });
    }

    return res.status(500).json({
      error: "Something went wrong during analysis. Please try again.",
    });
  }
});

// ─── API: Generate Fixed Resume ──────────────────────────────────────────────

app.post("/api/generate-resume", express.json(), async (req, res) => {
  try {
    const { resumeText, layout } = req.body;

    if (!resumeText || !resumeText.trim()) {
      return res.status(400).json({ error: "Please provide resume text." });
    }

    if (!layout || !["left-right", "up-down"].includes(layout)) {
      return res.status(400).json({ error: "Invalid layout. Choose 'left-right' or 'up-down'." });
    }

    // Use Gemini to parse resume into structured JSON
    const parsePrompt = `
You are an expert resume parser. Parse the following raw resume text into a well-structured JSON object.

Return STRICTLY valid JSON (no markdown, no code fences, ONLY raw JSON) with this structure:
{
  "name": "Full Name",
  "title": "Professional Title / Headline (infer if not present)",
  "email": "email if found or empty string",
  "phone": "phone if found or empty string",
  "location": "location if found or empty string",
  "linkedin": "linkedin URL if found or empty string",
  "github": "github URL if found or empty string",
  "website": "portfolio/website URL if found or empty string",
  "summary": "Professional summary (write one if not present, 2-3 sentences)",
  "skills": ["skill1", "skill2", ...],
  "experience": [
    {
      "company": "Company Name",
      "role": "Job Title",
      "duration": "Start - End",
      "bullets": ["achievement 1", "achievement 2", ...]
    }
  ],
  "education": [
    {
      "institution": "University Name",
      "degree": "Degree Name",
      "duration": "Start - End",
      "details": "GPA or relevant details if any"
    }
  ],
  "projects": [
    {
      "name": "Project Name",
      "description": "Brief description",
      "tech": "Technologies used"
    }
  ],
  "certifications": ["Cert 1", "Cert 2"]
}

Rules:
- Extract as much info as possible from the resume.
- If a section is missing, return an empty array or empty string.
- Make sure all text is clean and professional.
- Keep bullet points concise and impactful.

───── RESUME TEXT ─────
${resumeText}
`;

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(parsePrompt);
    const responseText = result.response.text();

    let cleaned = responseText.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const data = JSON.parse(cleaned);

    // Generate the HTML resume
    const htmlResume = generateResumeHTML(data, layout);

    return res.json({
      success: true,
      html: htmlResume,
    });
  } catch (err) {
    console.error("Resume generation error:", err);
    return res.status(500).json({
      error: "Failed to generate resume. Please try again.",
    });
  }
});

// ─── Resume HTML Generator ──────────────────────────────────────────────────

function generateResumeHTML(data, layout) {
  const escapeHTML = (str) => String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const contactItems = [
    data.email && `<span class="contact-item">📧 ${escapeHTML(data.email)}</span>`,
    data.phone && `<span class="contact-item">📱 ${escapeHTML(data.phone)}</span>`,
    data.location && `<span class="contact-item">📍 ${escapeHTML(data.location)}</span>`,
    data.linkedin && `<span class="contact-item">🔗 ${escapeHTML(data.linkedin)}</span>`,
    data.github && `<span class="contact-item">💻 ${escapeHTML(data.github)}</span>`,
    data.website && `<span class="contact-item">🌐 ${escapeHTML(data.website)}</span>`,
  ].filter(Boolean).join("\n");

  const skillsHTML = (data.skills || []).map(s => `<span class="skill-tag">${escapeHTML(s)}</span>`).join("");

  const experienceHTML = (data.experience || []).map(exp => `
    <div class="exp-item">
      <div class="exp-header">
        <div>
          <h3 class="exp-role">${escapeHTML(exp.role)}</h3>
          <p class="exp-company">${escapeHTML(exp.company)}</p>
        </div>
        <span class="exp-duration">${escapeHTML(exp.duration)}</span>
      </div>
      ${exp.bullets && exp.bullets.length ? `<ul class="exp-bullets">${exp.bullets.map(b => `<li>${escapeHTML(b)}</li>`).join("")}</ul>` : ""}
    </div>
  `).join("");

  const educationHTML = (data.education || []).map(edu => `
    <div class="edu-item">
      <div class="exp-header">
        <div>
          <h3 class="exp-role">${escapeHTML(edu.degree)}</h3>
          <p class="exp-company">${escapeHTML(edu.institution)}</p>
        </div>
        <span class="exp-duration">${escapeHTML(edu.duration)}</span>
      </div>
      ${edu.details ? `<p class="edu-details">${escapeHTML(edu.details)}</p>` : ""}
    </div>
  `).join("");

  const projectsHTML = (data.projects || []).map(proj => `
    <div class="proj-item">
      <h3 class="proj-name">${escapeHTML(proj.name)}</h3>
      <p class="proj-desc">${escapeHTML(proj.description)}</p>
      ${proj.tech ? `<p class="proj-tech">${escapeHTML(proj.tech)}</p>` : ""}
    </div>
  `).join("");

  const certsHTML = (data.certifications || []).map(c => `<li>${escapeHTML(c)}</li>`).join("");

  if (layout === "left-right") {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHTML(data.name)} - Resume</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Inter', sans-serif; background: #f8f9fa; color: #1a1a2e; line-height: 1.6; }
.resume { max-width: 900px; margin: 24px auto; background: #fff; box-shadow: 0 4px 30px rgba(0,0,0,0.08); display: grid; grid-template-columns: 280px 1fr; min-height: 1100px; }
.sidebar { background: linear-gradient(180deg, #1a1a2e 0%, #16213e 100%); color: #e8e8f0; padding: 40px 28px; }
.main { padding: 40px 36px; }
.name { font-size: 1.6rem; font-weight: 800; color: #fff; margin-bottom: 4px; }
.title { font-size: 0.85rem; color: #a5b4fc; font-weight: 500; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 28px; }
.section-title { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: #a5b4fc; margin-bottom: 14px; padding-bottom: 8px; border-bottom: 2px solid rgba(165,180,252,0.3); }
.section-title-dark { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: #6366f1; margin-bottom: 14px; padding-bottom: 8px; border-bottom: 2px solid #e8e8f0; }
.sidebar-section { margin-bottom: 28px; }
.contact-item { display: block; font-size: 0.82rem; margin-bottom: 8px; color: #cbd5e1; word-break: break-all; }
.skill-tag { display: inline-block; background: rgba(165,180,252,0.15); color: #c7d2fe; padding: 4px 10px; border-radius: 4px; font-size: 0.75rem; font-weight: 500; margin: 2px 3px 2px 0; }
.main-section { margin-bottom: 28px; }
.summary-text { font-size: 0.88rem; color: #475569; line-height: 1.7; }
.exp-item { margin-bottom: 20px; }
.exp-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
.exp-role { font-size: 0.95rem; font-weight: 700; color: #1a1a2e; }
.exp-company { font-size: 0.82rem; color: #6366f1; font-weight: 500; }
.exp-duration { font-size: 0.78rem; color: #94a3b8; font-weight: 500; white-space: nowrap; margin-left: 12px; }
.exp-bullets { list-style: none; padding: 0; }
.exp-bullets li { font-size: 0.84rem; color: #475569; padding: 3px 0 3px 16px; position: relative; }
.exp-bullets li::before { content: '▸'; position: absolute; left: 0; color: #6366f1; font-weight: 700; }
.edu-details { font-size: 0.82rem; color: #64748b; margin-top: 4px; }
.proj-item { margin-bottom: 14px; }
.proj-name { font-size: 0.9rem; font-weight: 600; color: #1a1a2e; }
.proj-desc { font-size: 0.82rem; color: #64748b; }
.proj-tech { font-size: 0.78rem; color: #6366f1; font-weight: 500; margin-top: 2px; }
.cert-list { list-style: none; padding: 0; }
.cert-list li { font-size: 0.82rem; color: #cbd5e1; padding: 3px 0 3px 16px; position: relative; }
.cert-list li::before { content: '✦'; position: absolute; left: 0; color: #a5b4fc; }
@media print { body { background: #fff; } .resume { box-shadow: none; margin: 0; } }
</style>
</head>
<body>
<div class="resume">
  <div class="sidebar">
    <h1 class="name">${escapeHTML(data.name)}</h1>
    <p class="title">${escapeHTML(data.title)}</p>

    <div class="sidebar-section">
      <h2 class="section-title">Contact</h2>
      ${contactItems}
    </div>

    ${data.skills && data.skills.length ? `
    <div class="sidebar-section">
      <h2 class="section-title">Skills</h2>
      <div>${skillsHTML}</div>
    </div>` : ""}

    ${data.certifications && data.certifications.length ? `
    <div class="sidebar-section">
      <h2 class="section-title">Certifications</h2>
      <ul class="cert-list">${certsHTML}</ul>
    </div>` : ""}
  </div>

  <div class="main">
    ${data.summary ? `
    <div class="main-section">
      <h2 class="section-title-dark">Profile Summary</h2>
      <p class="summary-text">${escapeHTML(data.summary)}</p>
    </div>` : ""}

    ${data.experience && data.experience.length ? `
    <div class="main-section">
      <h2 class="section-title-dark">Experience</h2>
      ${experienceHTML}
    </div>` : ""}

    ${data.education && data.education.length ? `
    <div class="main-section">
      <h2 class="section-title-dark">Education</h2>
      ${educationHTML}
    </div>` : ""}

    ${data.projects && data.projects.length ? `
    <div class="main-section">
      <h2 class="section-title-dark">Projects</h2>
      ${projectsHTML}
    </div>` : ""}
  </div>
</div>
</body>
</html>`;
  }

  // UP-DOWN layout
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHTML(data.name)} - Resume</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Inter', sans-serif; background: #f8f9fa; color: #1a1a2e; line-height: 1.6; }
.resume { max-width: 800px; margin: 24px auto; background: #fff; box-shadow: 0 4px 30px rgba(0,0,0,0.08); }
.header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%); color: #fff; padding: 44px 40px; text-align: center; }
.name { font-size: 2rem; font-weight: 800; margin-bottom: 4px; }
.title { font-size: 0.9rem; color: #a5b4fc; font-weight: 500; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 18px; }
.contact-row { display: flex; flex-wrap: wrap; justify-content: center; gap: 16px; }
.contact-item { font-size: 0.8rem; color: #cbd5e1; }
.body { padding: 36px 40px; }
.section { margin-bottom: 28px; }
.section-title { font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: #6366f1; margin-bottom: 14px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb; }
.summary-text { font-size: 0.9rem; color: #475569; line-height: 1.7; }
.skills-wrap { display: flex; flex-wrap: wrap; gap: 6px; }
.skill-tag { display: inline-block; background: #eef2ff; color: #4338ca; padding: 5px 12px; border-radius: 4px; font-size: 0.78rem; font-weight: 500; }
.exp-item { margin-bottom: 20px; }
.exp-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
.exp-role { font-size: 0.95rem; font-weight: 700; color: #1a1a2e; }
.exp-company { font-size: 0.84rem; color: #6366f1; font-weight: 500; }
.exp-duration { font-size: 0.78rem; color: #94a3b8; font-weight: 500; white-space: nowrap; margin-left: 12px; }
.exp-bullets { list-style: none; padding: 0; }
.exp-bullets li { font-size: 0.84rem; color: #475569; padding: 3px 0 3px 16px; position: relative; }
.exp-bullets li::before { content: '▸'; position: absolute; left: 0; color: #6366f1; font-weight: 700; }
.edu-details { font-size: 0.82rem; color: #64748b; margin-top: 4px; }
.proj-item { margin-bottom: 14px; }
.proj-name { font-size: 0.9rem; font-weight: 600; color: #1a1a2e; }
.proj-desc { font-size: 0.82rem; color: #64748b; }
.proj-tech { font-size: 0.78rem; color: #6366f1; font-weight: 500; margin-top: 2px; }
.cert-list { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.cert-list li { font-size: 0.82rem; background: #fef3c7; color: #92400e; padding: 5px 12px; border-radius: 4px; font-weight: 500; }
@media print { body { background: #fff; } .resume { box-shadow: none; margin: 0; } }
</style>
</head>
<body>
<div class="resume">
  <div class="header">
    <h1 class="name">${escapeHTML(data.name)}</h1>
    <p class="title">${escapeHTML(data.title)}</p>
    <div class="contact-row">
      ${contactItems}
    </div>
  </div>

  <div class="body">
    ${data.summary ? `
    <div class="section">
      <h2 class="section-title">Profile Summary</h2>
      <p class="summary-text">${escapeHTML(data.summary)}</p>
    </div>` : ""}

    ${data.skills && data.skills.length ? `
    <div class="section">
      <h2 class="section-title">Skills</h2>
      <div class="skills-wrap">${skillsHTML}</div>
    </div>` : ""}

    ${data.experience && data.experience.length ? `
    <div class="section">
      <h2 class="section-title">Experience</h2>
      ${experienceHTML}
    </div>` : ""}

    ${data.education && data.education.length ? `
    <div class="section">
      <h2 class="section-title">Education</h2>
      ${educationHTML}
    </div>` : ""}

    ${data.projects && data.projects.length ? `
    <div class="section">
      <h2 class="section-title">Projects</h2>
      ${projectsHTML}
    </div>` : ""}

    ${data.certifications && data.certifications.length ? `
    <div class="section">
      <h2 class="section-title">Certifications</h2>
      <ul class="cert-list">${certsHTML}</ul>
    </div>` : ""}
  </div>
</div>
</body>
</html>`;
}

// ─── Start Server ────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
