const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const archiver = require("archiver");
const { Readable } = require("stream");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (parseInt(process.env.MAX_UPLOAD_MB || "25", 10) || 25) * 1024 * 1024 },
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "change-this-jwt-secret";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
const OWNER_API_KEY = process.env.OWNER_API_KEY || "change-this-owner-key";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const DEFAULT_ADMIN_EMAIL = process.env.DEFAULT_ADMIN_EMAIL || "admin@orchegentra.ai";
const DEFAULT_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || "Admin@7575";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*").split(",").map(s => s.trim()).filter(Boolean);
const AUTONOMY_ENABLED = String(process.env.AUTONOMY_ENABLED || "true") === "true";
const AUTONOMY_INTERVAL_MS = parseInt(process.env.AUTONOMY_INTERVAL_MS || "300000", 10);
const AUTONOMY_COOLDOWN_MS = parseInt(process.env.AUTONOMY_COOLDOWN_MS || "900000", 10);
const MAX_CONCURRENT_EXECUTIONS = parseInt(process.env.MAX_CONCURRENT_EXECUTIONS || "2", 10);
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "orchegentra-files";

const hasSupabase = !!process.env.SUPABASE_URL && !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);
const supabase = hasSupabase
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY)
  : null;

app.use(helmet());
app.use(cors({
  origin(origin, cb) {
    if (!origin || ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error("CORS blocked"));
  }
}));
app.use(express.json({ limit: "4mb" }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 120 }));

const runtime = {
  startedAt: new Date().toISOString(),
  lastAutonomyAt: null,
  activeExecutions: 0,
  workerClaims: 0,
  users: [],
  tasks: [],
  queueJobs: [],
  uploadedFiles: [],
  securityEvents: [],
};

function safeNow() { return new Date().toISOString(); }
function id(prefix = "id") { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`; }

async function logSecurity(event_type, severity = "info", detail = {}) {
  if (hasSupabase) {
    try { await supabase.from("security_events").insert({ event_type, severity, detail }); } catch {}
  } else {
    runtime.securityEvents.unshift({ id: id("sec"), event_type, severity, detail, created_at: safeNow() });
    runtime.securityEvents = runtime.securityEvents.slice(0, 500);
  }
}

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function auth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: "missing_token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ ok: false, error: "invalid_token" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ ok: false, error: "forbidden" });
    next();
  };
}

function ownerGuard(req, res, next) {
  const incoming = req.headers["x-owner-key"];
  if (incoming !== OWNER_API_KEY) return res.status(401).json({ ok: false, error: "invalid_owner_key" });
  next();
}

function normalizeTaskInput(body = {}) {
  const title = String(body.title || "").trim();
  const description = String(body.description || "").trim();
  const priority = ["low", "medium", "high"].includes(body.priority) ? body.priority : "medium";
  const category = String(body.category || "general").trim().toLowerCase();
  if (!title || !description) return { ok: false, error: "title_and_description_required" };
  return { ok: true, data: { title, description, priority, category } };
}

async function ensureDefaultAdmin() {
  const hash = bcrypt.hashSync(DEFAULT_ADMIN_PASSWORD, 10);

  if (hasSupabase) {
    const { data } = await supabase.from("app_users").select("*").eq("email", DEFAULT_ADMIN_EMAIL).maybeSingle();
    if (!data) {
      await supabase.from("app_users").insert({
        id: id("usr"),
        email: DEFAULT_ADMIN_EMAIL,
        password_hash: hash,
        role: "admin",
        is_active: true,
        must_change_password: true,
        created_at: safeNow(),
      });
    }
  } else {
    const existing = runtime.users.find(u => u.email === DEFAULT_ADMIN_EMAIL);
    if (!existing) {
      runtime.users.push({
        id: id("usr"),
        email: DEFAULT_ADMIN_EMAIL,
        password_hash: hash,
        role: "admin",
        is_active: true,
        must_change_password: true,
        created_at: safeNow(),
      });
    }
  }
}

async function getUserByEmail(email) {
  if (hasSupabase) {
    const { data } = await supabase.from("app_users").select("*").eq("email", email).maybeSingle();
    return data || null;
  }
  return runtime.users.find(u => u.email === email) || null;
}

async function updateUserPassword(userId, password) {
  const hash = bcrypt.hashSync(password, 10);
  if (hasSupabase) {
    await supabase.from("app_users").update({
      password_hash: hash,
      must_change_password: false,
      password_changed_at: safeNow(),
    }).eq("id", userId);
  } else {
    const u = runtime.users.find(x => x.id === userId);
    if (u) {
      u.password_hash = hash;
      u.must_change_password = false;
      u.password_changed_at = safeNow();
    }
  }
}

async function createTaskRecord(task) {
  const record = {
    id: id("task"),
    user_id: task.user_id || "admin",
    user_email: task.user_email || DEFAULT_ADMIN_EMAIL,
    title: task.title,
    description: task.description,
    priority: task.priority || "medium",
    category: task.category || "general",
    status: task.status || "pending",
    primary_agent: null,
    final_output: null,
    structured_output: null,
    selected_agents: task.selected_agents || [],
    created_at: safeNow(),
    updated_at: safeNow(),
  };

  if (hasSupabase) {
    const { data, error } = await supabase.from("tasks").insert(record).select().single();
    if (error) throw error;
    return data;
  }
  runtime.tasks.unshift(record);
  return record;
}

async function updateTask(taskId, patch) {
  patch.updated_at = safeNow();
  if (hasSupabase) {
    const { data, error } = await supabase.from("tasks").update(patch).eq("id", taskId).select().single();
    if (error) throw error;
    return data;
  }
  const t = runtime.tasks.find(x => x.id === taskId);
  if (t) Object.assign(t, patch);
  return t;
}

async function getTask(taskId) {
  if (hasSupabase) {
    const { data } = await supabase.from("tasks").select("*").eq("id", taskId).maybeSingle();
    return data || null;
  }
  return runtime.tasks.find(t => t.id === taskId) || null;
}

async function listTasks(limit = 100) {
  if (hasSupabase) {
    const { data } = await supabase.from("tasks").select("*").order("created_at", { ascending: false }).limit(limit);
    return data || [];
  }
  return runtime.tasks.slice(0, limit);
}

async function createQueueJob(taskId, source = "manual") {
  const row = {
    id: id("job"),
    task_id: taskId,
    source,
    status: "queued",
    worker_id: null,
    error_message: null,
    created_at: safeNow(),
    started_at: null,
    finished_at: null,
  };
  if (hasSupabase) {
    const { data, error } = await supabase.from("queue_jobs").insert(row).select().single();
    if (error) throw error;
    return data;
  }
  runtime.queueJobs.unshift(row);
  return row;
}

async function claimNextJob(workerId) {
  if (runtime.activeExecutions >= MAX_CONCURRENT_EXECUTIONS) return null;

  if (hasSupabase) {
    const { data } = await supabase.from("queue_jobs").select("*").eq("status", "queued").order("created_at", { ascending: true }).limit(1);
    const job = data?.[0];
    if (!job) return null;

    const { data: updated } = await supabase.from("queue_jobs").update({
      status: "running",
      worker_id: workerId,
      started_at: safeNow(),
    }).eq("id", job.id).eq("status", "queued").select().maybeSingle();

    return updated || null;
  }

  const job = runtime.queueJobs.find(j => j.status === "queued");
  if (!job) return null;
  job.status = "running";
  job.worker_id = workerId;
  job.started_at = safeNow();
  return job;
}

async function completeJob(jobId, status, errorMessage = null) {
  if (hasSupabase) {
    await supabase.from("queue_jobs").update({
      status,
      error_message: errorMessage,
      finished_at: safeNow(),
    }).eq("id", jobId);
    return;
  }
  const j = runtime.queueJobs.find(x => x.id === jobId);
  if (j) {
    j.status = status;
    j.error_message = errorMessage;
    j.finished_at = safeNow();
  }
}

function detectTaskType(task) {
  const text = `${task.title} ${task.description}`.toLowerCase();
  if (/ppt|deck|presentation|slides/.test(text)) return "presentation";
  if (/letter|email|draft|cover letter|message/.test(text)) return "document";
  if (/machine learning|ml|model training|prediction|classification|forecast/.test(text)) return "ml";
  if (/data engineering|pipeline|etl|warehouse/.test(text)) return "data_engineering";
  if (/data science|analysis|analytics|kpi|dashboard/.test(text)) return "data_science";
  if (/agentic ai|multi-agent|autonomous ai/.test(text)) return "agentic_ai";
  if (/website|portfolio|landing page/.test(text)) return "website";
  if (/app|saas|platform|system|tool/.test(text)) return "app_saas";
  return "general";
}

function buildPrompt(taskType, task) {
  return `
You are ORCHEGENTRA AI in production artifact mode.

TASK TYPE: ${taskType}
TITLE: ${task.title}
DESCRIPTION: ${task.description}

Rules:
- Return production-ready output, not generic advice.
- No pseudo-code unless unavoidable.
- Include architecture, modules, security basics, validation, QA, deployment readiness.
- Make output premium, original, practical, and implementation-focused.

Required response JSON structure:
{
  "task_type": "...",
  "objective": "...",
  "artifacts": {
    "architecture": "...",
    "frontend": "...",
    "backend": "...",
    "database": "...",
    "apis": "...",
    "qa": "...",
    "security": "...",
    "deployment": "...",
    "business_copy": "..."
  },
  "final_summary": "..."
}
`.trim();
}

async function callGemini(prompt) {
  if (!GEMINI_API_KEY) {
    return JSON.stringify({
      task_type: "offline_fallback",
      objective: "Gemini key missing, generated fallback production pack.",
      artifacts: {
        architecture: "Modular full-stack architecture with responsive frontend, REST API backend, and secure persistence.",
        frontend: "Responsive premium UI with dashboard, settings, auth, task views, artifact viewer, and upload manager.",
        backend: "Express API with JWT auth, role checks, task queue hooks, observability, upload validation, and artifact export.",
        database: "Users, tasks, queue jobs, uploaded files, memory records, security events, execution logs.",
        apis: "Auth, tasks, stats, observability, uploads, worker claim/complete, artifact export.",
        qa: "Functional, auth, upload, export, role, and regression tests.",
        security: "JWT, hashed passwords, CORS allowlist, rate limit, input validation, upload scan.",
        deployment: "Deploy backend, apply SQL, set env vars, optionally attach worker service.",
        business_copy: "Enterprise-grade autonomous AI operating system for real production outputs."
      },
      final_summary: "Fallback production artifact pack generated because GEMINI_API_KEY is not set."
    });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7, topP: 0.95, maxOutputTokens: 4096 }
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await resp.json();
  if (!resp.ok) throw new Error(data?.error?.message || "Gemini request failed");
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
}

function tryParseJson(text) {
  try { return JSON.parse(text); } catch {}
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }
  return {
    task_type: "parsed_text",
    objective: "Returned plain text output.",
    artifacts: {
      architecture: text,
      frontend: "",
      backend: "",
      database: "",
      apis: "",
      qa: "",
      security: "",
      deployment: "",
      business_copy: ""
    },
    final_summary: text.slice(0, 2000)
  };
}

async function executeTask(taskId) {
  const task = await getTask(taskId);
  if (!task) throw new Error("task_not_found");

  runtime.activeExecutions += 1;
  try {
    await updateTask(taskId, { status: "running" });

    const taskType = detectTaskType(task);
    const prompt = buildPrompt(taskType, task);
    const llmText = await callGemini(prompt);
    const structured = tryParseJson(llmText);

    const finalOutput = structured.final_summary || "Task completed.";
    const updated = await updateTask(taskId, {
      status: "completed",
      primary_agent: "production-artifact-engine",
      structured_output: structured,
      final_output: finalOutput,
      selected_agents: ["chairman", "cto", "builder", "qa", "security"],
    });

    if (hasSupabase) {
      try {
        await supabase.from("memory_records").insert({
          id: id("mem"),
          key: `${taskId}-summary`,
          title: task.title,
          task_id: taskId,
          summary: finalOutput.slice(0, 1000),
          content: structured,
          category: taskType,
          source: "system",
          created_at: safeNow(),
        });
      } catch {}
    }

    return updated;
  } finally {
    runtime.activeExecutions = Math.max(0, runtime.activeExecutions - 1);
  }
}

function scanFile(file) {
  const blockedExt = [".exe", ".bat", ".cmd", ".sh", ".msi", ".apk"];
  const name = (file.originalname || "").toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  const dangerous = blockedExt.includes(ext);
  return {
    ok: !dangerous,
    result: dangerous ? "blocked_dangerous_extension" : "clean",
    ext,
  };
}

async function saveUpload(file, uploadedBy = DEFAULT_ADMIN_EMAIL) {
  const scan = scanFile(file);
  if (!scan.ok) throw new Error(scan.result);

  const fileId = id("file");
  const storagePath = `${fileId}-${file.originalname}`;

  let publicUrl = null;
  if (hasSupabase) {
    const { error: uploadError } = await supabase.storage.from(SUPABASE_STORAGE_BUCKET).upload(storagePath, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });
    if (uploadError) throw uploadError;
    const { data: pub } = supabase.storage.from(SUPABASE_STORAGE_BUCKET).getPublicUrl(storagePath);
    publicUrl = pub?.publicUrl || null;

    await supabase.from("uploaded_files").insert({
      id: fileId,
      file_name: file.originalname,
      mime_type: file.mimetype,
      ext: scan.ext,
      size_bytes: file.size,
      status: "stored",
      scan_result: scan.result,
      storage_path: storagePath,
      public_url: publicUrl,
      uploaded_by: uploadedBy,
      created_at: safeNow(),
    });
  } else {
    runtime.uploadedFiles.unshift({
      id: fileId,
      file_name: file.originalname,
      mime_type: file.mimetype,
      ext: scan.ext,
      size_bytes: file.size,
      status: "stored",
      scan_result: scan.result,
      storage_path: storagePath,
      public_url: null,
      uploaded_by: uploadedBy,
      created_at: safeNow(),
    });
  }

  return { id: fileId, storagePath, publicUrl, scanResult: scan.result };
}

function buildZipResponse(task, res) {
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${(task.title || "artifact").replace(/[^a-z0-9-_]+/gi, "_")}.zip"`);

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.pipe(res);

  const structured = task.structured_output || {};
  archive.append(JSON.stringify(task, null, 2), { name: "task.json" });
  archive.append(task.final_output || "", { name: "final-summary.txt" });
  archive.append(JSON.stringify(structured, null, 2), { name: "artifacts.json" });

  const artifacts = structured.artifacts || {};
  Object.entries(artifacts).forEach(([key, value]) => {
    archive.append(String(value || ""), { name: `artifacts/${key}.txt` });
  });

  archive.finalize();
}

async function getStats() {
  const tasks = await listTasks(500);
  const total = tasks.length;
  const completed = tasks.filter(t => t.status === "completed").length;
  const running = tasks.filter(t => t.status === "running").length;
  const pending = tasks.filter(t => t.status === "pending").length;
  const failed = tasks.filter(t => t.status === "failed").length;
  return {
    total,
    completed,
    running,
    pending,
    failed,
    success_rate: total ? `${Math.round((completed / total) * 100)}%` : "0%",
    active_executions: runtime.activeExecutions,
    started_at: runtime.startedAt,
    last_autonomy_at: runtime.lastAutonomyAt,
  };
}

app.get("/", (_req, res) => {
  res.send("ORCHEGENTRA ENTERPRISE BACKEND RUNNING");
});

app.get("/api/health", async (_req, res) => {
  res.json({
    ok: true,
    service: "ORCHEGENTRA",
    hasSupabase,
    hasGemini: !!GEMINI_API_KEY,
    uptime_seconds: process.uptime(),
  });
});

app.get("/api/stats", async (_req, res) => {
  res.json({ ok: true, ...(await getStats()) });
});

app.get("/api/observability", async (_req, res) => {
  const tasks = await listTasks(200);
  res.json({
    ok: true,
    runtime: {
      startedAt: runtime.startedAt,
      activeExecutions: runtime.activeExecutions,
      workerClaims: runtime.workerClaims,
      memoryFallbackMode: !hasSupabase,
    },
    recentTasks: tasks.slice(0, 10).map(t => ({
      id: t.id, title: t.title, status: t.status, priority: t.priority, created_at: t.created_at
    })),
    queueDepth: hasSupabase ? null : runtime.queueJobs.filter(j => j.status === "queued").length,
  });
});

app.post("/api/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  const user = await getUserByEmail(email);
  if (!user || !user.is_active) {
    await logSecurity("login_failed", "warn", { email, reason: "user_not_found_or_inactive" });
    return res.status(401).json({ ok: false, error: "invalid_credentials" });
  }

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    await logSecurity("login_failed", "warn", { email, reason: "bad_password" });
    return res.status(401).json({ ok: false, error: "invalid_credentials" });
  }

  const token = signToken(user);
  await logSecurity("login_success", "info", { email });

  res.json({
    ok: true,
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      must_change_password: !!user.must_change_password,
    },
    eva_greeting: `Welcome Chairman. Login successful. EVA is online and ready.`,
  });
});

app.post("/api/change-password", auth, async (req, res) => {
  const newPassword = String(req.body.newPassword || "");
  if (newPassword.length < 8) return res.status(400).json({ ok: false, error: "password_too_short" });
  await updateUserPassword(req.user.id, newPassword);
  res.json({ ok: true, message: "password_updated" });
});

app.get("/api/me", auth, async (req, res) => {
  const user = await getUserByEmail(req.user.email);
  res.json({
    ok: true,
    user: {
      id: user?.id,
      email: user?.email,
      role: user?.role,
      must_change_password: !!user?.must_change_password,
    }
  });
});

app.post("/api/tasks", auth, async (req, res) => {
  const norm = normalizeTaskInput(req.body);
  if (!norm.ok) return res.status(400).json({ ok: false, error: norm.error });
  const task = await createTaskRecord({
    ...norm.data,
    user_id: req.user.id,
    user_email: req.user.email,
  });
  await createQueueJob(task.id, "manual");
  res.json({ ok: true, task });
});

app.get("/api/tasks", auth, async (_req, res) => {
  res.json({ ok: true, data: await listTasks(200) });
});

app.get("/api/tasks/:id", auth, async (req, res) => {
  const task = await getTask(req.params.id);
  if (!task) return res.status(404).json({ ok: false, error: "task_not_found" });
  res.json({ ok: true, task });
});

app.post("/api/tasks/:id/execute", auth, async (req, res) => {
  const task = await getTask(req.params.id);
  if (!task) return res.status(404).json({ ok: false, error: "task_not_found" });
  const updated = await executeTask(task.id);
  res.json({ ok: true, task: updated });
});

app.get("/api/tasks/:id/artifacts", auth, async (req, res) => {
  const task = await getTask(req.params.id);
  if (!task) return res.status(404).json({ ok: false, error: "task_not_found" });
  res.json({ ok: true, artifacts: task.structured_output || {} });
});

app.get("/api/tasks/:id/export.zip", auth, async (req, res) => {
  const task = await getTask(req.params.id);
  if (!task) return res.status(404).json({ ok: false, error: "task_not_found" });
  buildZipResponse(task, res);
});

app.post("/api/eva/chat", auth, async (req, res) => {
  const message = String(req.body.message || "").trim();
  if (!message) return res.status(400).json({ ok: false, error: "message_required" });

  const lower = message.toLowerCase();

  if (lower === "system status kya hai" || lower === "system status") {
    const stats = await getStats();
    return res.json({
      ok: true,
      reply: `System live hai. Total tasks ${stats.total}, completed ${stats.completed}, running ${stats.running}, pending ${stats.pending}.`
    });
  }

  if (lower === "run autonomy") {
    if (!AUTONOMY_ENABLED) return res.json({ ok: true, reply: "Autonomy disabled hai." });
    runtime.lastAutonomyAt = safeNow();
    const task = await createTaskRecord({
      title: "Autonomous Review Cycle",
      description: "Review current system status and propose next production-ready improvements.",
      priority: "medium",
      category: "agentic_ai",
      user_id: req.user.id,
      user_email: req.user.email,
    });
    await createQueueJob(task.id, "autonomy");
    return res.json({ ok: true, reply: `Autonomy run queued. Task ID ${task.id}` });
  }

  if (lower.startsWith("create task:")) {
    const rest = message.slice("create task:".length).trim();
    const [title, description] = rest.split("|").map(x => (x || "").trim());
    if (!title || !description) {
      return res.json({ ok: true, reply: "Format use karo: Create task: title | description" });
    }
    const task = await createTaskRecord({
      title, description, priority: "medium", category: "general",
      user_id: req.user.id, user_email: req.user.email,
    });
    await createQueueJob(task.id, "eva");
    return res.json({ ok: true, reply: `Task created and queued: ${title}` });
  }

  const prompt = `
You are EVA, ORCHEGENTRA's premium executive AI voice assistant.
User message: ${message}
Respond briefly, warmly, professionally, in Hinglish or English depending on the message.
`;
  const text = await callGemini(prompt).catch(() => `Understood. Main is request ko process karne ke liye ready hun.`);
  return res.json({ ok: true, reply: text.slice(0, 2000) });
});

app.post("/api/uploads", auth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "file_required" });
  try {
    const saved = await saveUpload(req.file, req.user.email);
    res.json({ ok: true, file: saved });
  } catch (e) {
    await logSecurity("upload_blocked", "warn", { file: req.file.originalname, reason: e.message });
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get("/api/uploads", auth, async (_req, res) => {
  if (hasSupabase) {
    const { data } = await supabase.from("uploaded_files").select("*").order("created_at", { ascending: false }).limit(100);
    return res.json({ ok: true, data: data || [] });
  }
  res.json({ ok: true, data: runtime.uploadedFiles });
});

app.get("/api/capacity", (_req, res) => {
  res.json({
    ok: true,
    max_concurrent_executions: MAX_CONCURRENT_EXECUTIONS,
    rate_limit_per_minute: 120,
    guidance: "Use separate worker service for higher scale.",
  });
});

app.post("/api/internal/worker/claim", ownerGuard, async (req, res) => {
  const workerId = String(req.body.workerId || "worker-main");
  const job = await claimNextJob(workerId);
  if (!job) return res.json({ ok: true, job: null });
  runtime.workerClaims += 1;
  res.json({ ok: true, job });
});

app.post("/api/internal/worker/complete", ownerGuard, async (req, res) => {
  const { jobId, status, errorMessage } = req.body || {};
  const validStatus = ["completed", "failed"].includes(status) ? status : "failed";
  await completeJob(jobId, validStatus, errorMessage || null);
  res.json({ ok: true });
});

app.post("/api/internal/worker/process", ownerGuard, async (req, res) => {
  const { taskId, jobId } = req.body || {};
  try {
    await executeTask(taskId);
    await completeJob(jobId, "completed");
    res.json({ ok: true });
  } catch (e) {
    await updateTask(taskId, { status: "failed", final_output: `Execution failed: ${e.message}` }).catch(() => {});
    await completeJob(jobId, "failed", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/bootstrap", async (_req, res) => {
  await ensureDefaultAdmin();
  res.json({ ok: true, message: "bootstrap_complete" });
});

async function autonomyTick() {
  if (!AUTONOMY_ENABLED) return;
  const now = Date.now();
  const last = runtime.lastAutonomyAt ? new Date(runtime.lastAutonomyAt).getTime() : 0;
  if (now - last < AUTONOMY_COOLDOWN_MS) return;

  runtime.lastAutonomyAt = safeNow();
  try {
    const task = await createTaskRecord({
      title: "Scheduled Autonomous Review",
      description: "Analyze open tasks, system status, and produce next-step production recommendations.",
      priority: "medium",
      category: "agentic_ai",
      user_id: "system",
      user_email: DEFAULT_ADMIN_EMAIL,
    });
    await createQueueJob(task.id, "scheduler");
  } catch {}
}

ensureDefaultAdmin()
  .then(() => app.listen(PORT, () => console.log(`ORCHEGENTRA server running on ${PORT}`)))
  .catch(err => {
    console.error("Startup failed:", err.message);
    process.exit(1);
  });

setInterval(() => {
  autonomyTick().catch(() => {});
}, AUTONOMY_INTERVAL_MS);
