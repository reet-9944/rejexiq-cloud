const http = require("http");
const express = require("express");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const multer = require("multer");
const { Storage } = require("@google-cloud/storage");

try { require("dotenv").config({ path: path.join(__dirname, ".env") }); } catch (_) {}

const gcsBucketName = process.env.GCS_BUCKET_NAME;
const gcs = gcsBucketName ? new Storage() : null;
const bucket = gcs ? gcs.bucket(gcsBucketName) : null;

const app = express();
const PORT = process.env.PORT || 5000;

const storyRoutes = require("./storyRoutes");
const careerRoutes = require("./careerRoutes");
const { router: authRouter, authMiddleware: newAuthMiddleware } = require("./authRoutes");

const JWT_SECRET = process.env.JWT_SECRET || "rejexiq_dev_secret_2025";
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";
const MONGO_URI  = process.env.MONGO_URI  || "";

if (!MONGO_URI) {
  process.env.MONGO_URI = "mongodb://127.0.0.1:27017/rejexiq";
}
const mongoose = require("mongoose");
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected to", process.env.MONGO_URI))
  .catch(err => console.error("⚠️  MongoDB connection failed:", err.message));

const users = [];
const assessments = [];

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.static(path.join(__dirname, "../dist")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use((req, res, next) => {
  const log = `[${new Date().toISOString()}] ${req.method} ${req.path}\n`;
  fs.appendFile(path.join(__dirname, "access.log"), log, (err) => {
    if (err) console.error("Log write error:", err);
  });
  console.log(log.trim());
  next();
});

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authorization token required" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function isValidEmail(email) {
  if (/[,\s]/.test(email)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const ROLES = {
  frontend: { label: "Frontend Developer", skills: { JavaScript: 85, React: 80, CSS: 75, ProblemSolving: 70 } },
  backend: { label: "Backend Developer", skills: { JavaScript: 75, Python: 80, SystemDesign: 80, DataStructures: 75 } },
  fullstack: { label: "Full Stack Developer", skills: { JavaScript: 85, React: 75, Python: 70, SystemDesign: 70 } },
  dataAnalyst: { label: "Data Analyst", skills: { Python: 85, DataStructures: 75, ProblemSolving: 80 } },
  devops: { label: "DevOps Engineer", skills: { SystemDesign: 90, ProblemSolving: 80, Python: 70 } }
};

function calcReadiness(userSkills, roleKey) {
  const role = ROLES[roleKey];
  if (!role) return 0;
  let total = 0, count = 0;
  for (const [skill, required] of Object.entries(role.skills)) {
    total += Math.min(100, ((userSkills[skill] || 0) / required) * 100);
    count++;
  }
  return Math.round(total / count);
}

function generateReport(userSkills) {
  const scores = {};
  let best = { key: null, score: 0 };
  for (const key of Object.keys(ROLES)) {
    const score = calcReadiness(userSkills, key);
    scores[key] = score;
    if (score > best.score) best = { key, score };
  }
  const avgScore = Math.round(Object.values(userSkills).reduce((a, b) => a + b, 0) / Object.values(userSkills).length);
  return { scores, bestRole: best, overallReadiness: avgScore };
}

app.use("/api/auth", authRouter);

const communityRoutes = require("./communityRoutes");
app.use("/api/community", communityRoutes);
app.use("/api", storyRoutes);
app.use("/api/career", careerRoutes);

app.get("/api", (req, res) => {
  res.json({
    message: "RejexIQ API v1.0",
    endpoints: ["/api/auth/register", "/api/auth/login", "/api/profile", "/api/assessment", "/api/market-demand"],
    status: "running",
    timestamp: new Date().toISOString()
  });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: "All fields are required" });
    if (!isValidEmail(email)) return res.status(400).json({ error: "Invalid email format. No spaces or commas allowed." });
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
    const existing = users.find(u => u.email === email);
    if (existing) return res.status(409).json({ error: "Email already registered" });
    const hashed = await bcrypt.hash(password, 10);
    const userId = `user_${Date.now()}`;
    const newUser = { id: userId, name, email, password: hashed, skills: {}, createdAt: new Date().toISOString() };
    users.push(newUser);
    const token = jwt.sign({ id: userId, email, name }, JWT_SECRET, { expiresIn: "7d" });
    res.status(201).json({ message: "Account created successfully", token, user: { id: userId, name, email, skills: {} } });
  } catch (err) {
    next(err);
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password are required" });
    if (!isValidEmail(email)) return res.status(400).json({ error: "Invalid email format" });
    const user = users.find(u => u.email === email);
    if (!user) return res.status(401).json({ error: "Invalid email or password" });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: "Invalid email or password" });
    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ message: "Login successful", token, user: { id: user.id, name: user.name, email: user.email, skills: user.skills } });
  } catch (err) {
    next(err);
  }
});

app.get("/api/profile", authMiddleware, (req, res) => {
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ id: user.id, name: user.name, email: user.email, skills: user.skills });
});

app.post("/api/assessment", authMiddleware, (req, res) => {
  const { skills } = req.body;
  if (!skills || typeof skills !== "object") return res.status(400).json({ error: "Skills object is required" });
  const user = users.find(u => u.id === req.user.id);
  if (user) user.skills = skills;
  const report = generateReport(skills);
  assessments.push({ userId: req.user.id, skills, report, date: new Date().toISOString() });
  res.json({
    message: "Assessment saved",
    report,
    bestRole: { key: report.bestRole.key, label: ROLES[report.bestRole.key]?.label, score: report.bestRole.score },
    overallReadiness: report.overallReadiness
  });
});

app.get("/api/skill-score/:userId", authMiddleware, (req, res) => {
  const { userId } = req.params;
  if (userId !== req.user.id) return res.status(403).json({ error: "Access denied" });
  const user = users.find(u => u.id === userId);
  if (!user || Object.keys(user.skills).length === 0) return res.status(404).json({ error: "No assessment found for this user" });
  const report = generateReport(user.skills);
  res.json({ userId, skills: user.skills, report });
});

app.get("/api/market-demand", authMiddleware, (req, res) => {
  const marketData = [
    { skill: "JavaScript", demand: 92, growth: "+5%" },
    { skill: "Python", demand: 88, growth: "+12%" },
    { skill: "React", demand: 85, growth: "+8%" },
    { skill: "Node.js", demand: 81, growth: "+6%" },
    { skill: "SQL", demand: 79, growth: "+3%" },
    { skill: "TypeScript", demand: 76, growth: "+22%" },
    { skill: "AWS", demand: 73, growth: "+18%" },
    { skill: "Docker", demand: 70, growth: "+25%" }
  ];
  res.json({ data: marketData, lastUpdated: new Date().toISOString() });
});

app.post("/api/resume-data", authMiddleware, async (req, res, next) => {
  try {
    const { resumeData } = req.body;
    if (!resumeData) return res.status(400).json({ error: "Resume data required" });
    const filename = `resume_${req.user.id}_${Date.now()}.json`;

    if (bucket) {
      const blob = bucket.file(`resumes/${filename}`);
      const blobStream = blob.createWriteStream({
        resumable: false,
        contentType: "application/json",
      });
      blobStream.on("error", (err) => next(err));
      blobStream.on("finish", () => {
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
        res.json({ message: "Resume saved to GCS", filename, path: publicUrl });
      });
      blobStream.end(JSON.stringify(resumeData, null, 2));
    } else {
      const filePath = path.join(__dirname, "resumes", filename);
      if (!fs.existsSync(path.join(__dirname, "resumes"))) {
        fs.mkdirSync(path.join(__dirname, "resumes"), { recursive: true });
      }
      const writeStream = fs.createWriteStream(filePath);
      writeStream.write(JSON.stringify(resumeData, null, 2));
      writeStream.end();
      writeStream.on("finish", () => res.json({ message: "Resume saved", filename, path: filePath }));
      writeStream.on("error", () => res.status(500).json({ error: "Failed to save resume" }));
    }
  } catch (err) {
    next(err);
  }
});

app.get("/api/download-log", authMiddleware, (req, res) => {
  const logPath = path.join(__dirname, "access.log");
  if (!fs.existsSync(logPath)) return res.status(404).json({ error: "Log file not found" });
  res.setHeader("Content-Type", "text/plain");
  res.setHeader("Content-Disposition", "attachment; filename=access.log");
  const readStream = fs.createReadStream(logPath);
  readStream.pipe(res);
  readStream.on("error", () => res.status(500).json({ error: "Stream error" }));
});

app.post("/api/parse-resume", async (req, res, next) => {
  try {
    const { fileContent, fileName } = req.body;
    if (!fileContent || !fileName) return res.status(400).json({ error: "File content and name required" });
    const lines = fileContent.split('\n').map(l => l.trim()).filter(Boolean);
    const resumeData = {
      name: lines[0] || "",
      title: lines.find(l => l.match(/engineer|developer|analyst|manager/i)) || "",
      email: lines.find(l => l.includes('@')) || "",
      phone: lines.find(l => /\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(l)) || "",
      location: "", summary: "", skills: [], experience: [], projects: [], education: [], certifications: []
    };
    let currentSection = '';
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (lower.includes('experience') || lower.includes('professional')) currentSection = 'experience';
      else if (lower.includes('project')) currentSection = 'projects';
      else if (lower.includes('skill')) currentSection = 'skills';
      else if (lower.includes('education')) currentSection = 'education';
      else if (lower.includes('certification')) currentSection = 'certifications';
      else if (lower.includes('summary') || lower.includes('about')) currentSection = 'summary';
      else if (line && currentSection) {
        if (currentSection === 'skills' && line.length < 50) resumeData.skills.push(line);
        else if (currentSection === 'summary') resumeData.summary += (resumeData.summary ? ' ' : '') + line;
        else if (currentSection === 'experience' && line.length > 10) {
          resumeData.experience.push({ id: 'e' + Date.now(), role: line, company: "", duration: "", description: "" });
        }
      }
    }
    res.json({ success: true, data: resumeData, message: "Resume parsed successfully" });
  } catch (err) { next(err); }
});

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "uploads");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + file.originalname.replace(/\s+/g, "_"));
  }
});
const upload = multer({
  storage: bucket ? multer.memoryStorage() : diskStorage
});

app.post("/api/upload", newAuthMiddleware, upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    if (bucket) {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const filename = uniqueSuffix + "-" + req.file.originalname.replace(/\s+/g, "_");
      const blob = bucket.file(filename);
      const blobStream = blob.createWriteStream({
        resumable: false,
        contentType: req.file.mimetype,
      });

      blobStream.on("error", (err) => next(err));
      blobStream.on("finish", () => {
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
        res.json({ message: "File uploaded to GCS successfully", fileUrl: publicUrl, fileName: req.file.originalname, fileType: req.file.mimetype });
      });

      blobStream.end(req.file.buffer);
    } else {
      const fileUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
      res.json({ message: "File uploaded successfully", fileUrl, fileName: req.file.originalname, fileType: req.file.mimetype });
    }
  } catch (err) {
    next(err);
  }
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "../dist", "index.html"));
});

app.use((err, req, res, next) => {
  console.error("Server error:", err.message);
  res.status(err.status || 500).json({ error: err.message || "Internal server error", path: req.path, method: req.method });
});

const server = http.createServer(app);
const { initSocket } = require("./socketManager");
const io = initSocket(server, { origin: CLIENT_URL, credentials: true });
app.set("io", io);

server.listen(PORT, () => {
  console.log(`🚀 RejexIQ Server running at http://localhost:${PORT}`);
  console.log(`📋 API at http://localhost:${PORT}/api`);
  console.log(`💬 WebSockets ready`);
});

module.exports = app;
