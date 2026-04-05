const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const fetch = require("node-fetch");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const app = express();

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const SUPABASE_ANON_KEY = (process.env.SUPABASE_ANON_KEY || "").trim();
const OPENROUTER_API_KEY = (process.env.OPENROUTER_API_KEY || "").trim();
const OPENROUTER_BASE_URL = (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").trim().replace(/\/$/, "");
const OPENROUTER_MODEL = (process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini").trim();
const FRONTEND_URL = process.env.FRONTEND_URL || "*";
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map(v => v.trim().toLowerCase())
  .filter(Boolean);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  global: { fetch },
});

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(
  rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
    max: Number(process.env.RATE_LIMIT_MAX || 100),
    standardHeaders: true,
    legacyHeaders: false,
  })
);

const AGENTS = [
  {
    id: "chairman",
    name: "Chairman Agent",
    role: "Strategic command and final priority control",
    department: "Leadership",
    systemPrompt:
      "You are Chairman Agent for Orchegentra AI. You set direction, prioritize work, decide which specialist agent should handle the task, and keep answers strategic, executive and decisive.",
  },
  {
    id: "eva",
    name: "EVA",
    role: "Executive communication and user interaction",
    department: "Executive Office",
    systemPrompt:
      "You are EVA, a warm, intelligent, professional executive AI assistant for Orchegentra AI. Communicate clearly, politely, concisely and professionally.",
  },
  {
    id: "cto",
    name: "CTO Agent",
    role: "Architecture, backend, frontend and system design",
    department: "Technology",
    systemPrompt:
      "You are CTO Agent for Orchegentra AI. You think like a strong engineering architect and produce practical, implementation-ready technical guidance.",
  },
  {
    id: "ops",
    name: "Operations Agent",
    role: "Execution planning, coordination and follow-through",
    department: "Operations",
    systemPrompt:
      "You are Operations Agent for Orchegentra AI. You structure work into steps, owners, dependencies, checkpoints and execution plans.",
  },
  {
    id: "analyst",
    name: "Analyst Agent",
    role: "Analysis, decision support and structured insights",
    department: "Analytics",
    systemPrompt:
      "You are Analyst Agent for Orchegentra AI. You analyze requests, identify patterns, extract decisions, summarize implications and recommend next steps.",
  },
  {
    id: "security",
    name: "Security Agent",
    role: "Security review, guardrails and risk identification",
    department: "Security",
    systemPrompt:
      "You are Security Agent for Orchegentra AI. You review risk, access control, secret handling, data exposure and safe operational design.",
  },
  {
    id: "builder",
    name: "Builder Agent",
    role: "Delivery, implementation and output generation",
    department: "Engineering Delivery",
    systemPrompt:
      "You are Builder Agent for Orchegentra AI. You turn plans into concrete deliverables, implementation steps, structures and production-ready outputs.",
  },
];

function getAgentById(agentId) {
  return AGENTS.find((a) => a.id === agentId);
}

function guessPrimaryAgent(taskText) {
  const text = (taskText || "").toLowerCase();

  if (
    text.includes("security") ||
    text.includes("permission") ||
    text.includes("access") ||
    text.includes("risk") ||
    text.includes("token") ||
    text.includes("auth")
  ) return "security";

  if (
    text.includes("architecture") ||
    text.includes("backend") ||
    text.includes("frontend") ||
    text.includes("database") ||
    text.includes("api") ||
    text.includes("code") ||
    text.includes("app") ||
    text.includes("website")
  ) return "cto";

  if (
    text.includes("analyze") ||
    text.includes("analysis") ||
    text.includes("insight") ||
    text.includes("report") ||
    text.includes("summary") ||
    text.includes("forecast")
  ) return "analyst";

  if (
    text.includes("plan") ||
    text.includes("execute") ||
    text.includes("workflow") ||
    text.includes("timeline") ||
    text.includes("coordinate") ||
    text.includes("operations")
  ) return "ops";

  if (
    text.includes("build") ||
    text.includes("create") ||
    text.includes("generate") ||
    text.includes("deliver") ||
    text.includes("implement")
  ) return "builder";

  return "eva";
}

function buildTaskPlan(taskText) {
  const primaryAgent = guessPrimaryAgent(taskText);
  const plan = [
    {
      step_no: 1,
      agent_id: "chairman",
      title: "Interpret and prioritize request",
      status: "planned",
    },
    {
      step_no: 2,
      agent_id: primaryAgent,
      title: "Lead specialist execution",
      status: "planned",
    },
    {
      step_no: 3,
      agent_id: "ops",
      title: "Convert output into execution steps",
      status: "planned",
    },
    {
      step_no: 4,
      agent_id: "security",
      title: "Review security and operational risk",
      status: "planned",
    },
    {
      step_no: 5,
      agent_id: "eva",
      title: "Prepare final user-facing response",
      status: "planned",
    },
  ];
  return { primaryAgent, steps: plan };
}

async function auditLog({
  actorId = "system",
  actorEmail = "",
  action,
  status = "ok",
  details = {},
}) {
  try {
    await supabase.from("audit_logs").insert([
      {
        actor_id: actorId,
        actor_email: actorEmail,
        action,
        status,
        details,
      },
    ]);
  } catch (error) {
    console.error("audit_log_failed:", error.message);
  }
}

async function addMessage(userId, role, content, channel = "text") {
  const { error } = await supabase.from("eva_memory").insert([
    {
      user_id: userId || "anonymous",
      role,
      content,
      channel,
    },
  ]);

  if (error) {
    throw new Error(`Supabase addMessage error: ${error.message}`);
  }
}

async function getMessages(userId) {
  const { data, error } = await supabase
    .from("eva_memory")
    .select("*")
    .eq("user_id", userId || "anonymous")
    .order("created_at", { ascending: true })
    .limit(20);

  if (error) {
    throw new Error(`Supabase getMessages error: ${error.message}`);
  }

  return data || [];
}

async function clearMessages(userId) {
  const { error } = await supabase
    .from("eva_memory")
    .delete()
    .eq("user_id", userId || "anonymous");

  if (error) {
    throw new Error(`Supabase clearMessages error: ${error.message}`);
  }
}

async function createTaskRecord({ userId, userEmail, title, description, priority = "medium", primaryAgent }) {
  const { data, error } = await supabase
    .from("tasks")
    .insert([
      {
        user_id: userId,
        user_email: userEmail || "",
        title,
        description,
        priority,
        status: "queued",
        primary_agent: primaryAgent,
      },
    ])
    .select("*")
    .single();

  if (error) {
    throw new Error(`Task create error: ${error.message}`);
  }

  return data;
}

async function insertTaskSteps(taskId, steps) {
  const payload = steps.map((step) => ({
    task_id: taskId,
    step_no: step.step_no,
    agent_id: step.agent_id,
    title: step.title,
    status: step.status || "planned",
  }));

  const { error } = await supabase.from("task_steps").insert(payload);

  if (error) {
    throw new Error(`Task steps insert error: ${error.message}`);
  }
}

async function updateTaskStatus(taskId, status, finalOutput = null) {
  const update = { status };
  if (finalOutput !== null) update.final_output = finalOutput;

  const { error } = await supabase.from("tasks").update(update).eq("id", taskId);
  if (error) {
    throw new Error(`Task status update error: ${error.message}`);
  }
}

async function updateTaskStep(taskId, stepNo, status, output = null) {
  const update = { status };
  if (output !== null) update.output = output;

  const { error } = await supabase
    .from("task_steps")
    .update(update)
    .eq("task_id", taskId)
    .eq("step_no", stepNo);

  if (error) {
    throw new Error(`Task step update error: ${error.message}`);
  }
}

async function addAgentRun({ taskId, agentId, inputText, outputText, status = "ok" }) {
  const { error } = await supabase.from("agent_runs").insert([
    {
      task_id: taskId,
      agent_id: agentId,
      input_text: inputText,
      output_text: outputText,
      status,
    },
  ]);

  if (error) {
    throw new Error(`Agent run insert error: ${error.message}`);
  }
}

async function getRecentTasks(userId) {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    throw new Error(`Recent tasks fetch error: ${error.message}`);
  }

  return data || [];
}

async function getTaskWithSteps(taskId, userId) {
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .eq("user_id", userId)
    .single();

  if (taskError) {
    throw new Error(`Task fetch error: ${taskError.message}`);
  }

  const { data: steps, error: stepsError } = await supabase
    .from("task_steps")
    .select("*")
    .eq("task_id", taskId)
    .order("step_no", { ascending: true });

  if (stepsError) {
    throw new Error(`Task steps fetch error: ${stepsError.message}`);
  }

  return { task, steps: steps || [] };
}

async function callLLM({ message, history = [], systemPrompt }) {
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is missing in Railway variables.");
  }

  const messages = [
    {
      role: "system",
      content:
        systemPrompt ||
        "You are EVA, a warm, intelligent, professional executive AI assistant for Orchegentra AI. Reply clearly in English, naturally and helpfully.",
    },
    ...history.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    })),
    {
      role: "user",
      content: message,
    },
  ];

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://orchegentra.ai",
      "X-Title": "Orchegentra Phase B",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages,
      temperature: 0.7,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("OPENROUTER ERROR:", JSON.stringify(data));
    throw new Error(`OpenRouter error ${response.status}: ${JSON.stringify(data)}`);
  }

  return data?.choices?.[0]?.message?.content || "No response returned.";
}

async function runSingleAgent({ taskId, agentId, inputText }) {
  const agent = getAgentById(agentId);
  if (!agent) {
    throw new Error(`Unknown agent: ${agentId}`);
  }

  const outputText = await callLLM({
    message: inputText,
    history: [],
    systemPrompt: agent.systemPrompt,
  });

  await addAgentRun({
    taskId,
    agentId,
    inputText,
    outputText,
    status: "ok",
  });

  return outputText;
}

async function executeTaskPlan(task, steps) {
  await updateTaskStatus(task.id, "running");

  let currentContext = `Task title: ${task.title}\nTask description: ${task.description}\nPriority: ${task.priority}`;

  for (const step of steps) {
    await updateTaskStep(task.id, step.step_no, "running");

    const stepPrompt = `
You are executing one workflow step inside Orchegentra AI.

Task:
${task.title}

Description:
${task.description}

Current context:
${currentContext}

Current step:
${step.title}

Provide your output for this step clearly.
`.trim();

    const output = await runSingleAgent({
      taskId: task.id,
      agentId: step.agent_id,
      inputText: stepPrompt,
    });

    await updateTaskStep(task.id, step.step_no, "done", output);

    currentContext += `

[Step ${step.step_no} by ${step.agent_id}]
${output}
`;
  }

  await updateTaskStatus(task.id, "completed", currentContext);
  return currentContext;
}

async function requireUser(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

    if (!token) {
      return res.status(401).json({ ok: false, error: "missing_bearer_token" });
    }

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({ ok: false, error: "invalid_or_expired_token" });
    }

    req.user = {
      id: data.user.id,
      email: (data.user.email || "").toLowerCase(),
      token,
    };

    next();
  } catch (error) {
    return res.status(401).json({ ok: false, error: error.message || "auth_failed" });
  }
}

function requireAdmin(req, res, next) {
  const email = req.user?.email || "";
  if (!ADMIN_EMAILS.length || ADMIN_EMAILS.includes(email)) {
    return next();
  }
  return res.status(403).json({ ok: false, error: "admin_only" });
}

app.get("/", (_req, res) => {
  res.json({ ok: true, message: "Orchegentra Phase B backend is running" });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
    phase: "B",
  });
});

app.get("/api/debug", (_req, res) => {
  res.json({
    ok: true,
    env: {
      SUPABASE_URL: SUPABASE_URL ? `${SUPABASE_URL.slice(0, 24)}...` : "MISSING",
      SUPABASE_SERVICE_ROLE_KEY: SUPABASE_SERVICE_ROLE_KEY ? "SET" : "MISSING",
      SUPABASE_ANON_KEY: SUPABASE_ANON_KEY ? "SET" : "MISSING",
      OPENROUTER_API_KEY: OPENROUTER_API_KEY ? "SET" : "MISSING",
      OPENROUTER_BASE_URL,
      OPENROUTER_MODEL,
      FRONTEND_URL,
      ADMIN_EMAILS_COUNT: ADMIN_EMAILS.length,
      AGENTS_COUNT: AGENTS.length,
    },
  });
});

app.get("/api/supabase-test", async (_req, res) => {
  try {
    const { data, error } = await supabase.from("eva_memory").select("*").limit(1);
    if (error) throw error;
    res.json({ ok: true, message: "Supabase connection works", rows: data || [] });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "Supabase test failed" });
  }
});

app.get("/api/agents/list", (_req, res) => {
  res.json({ ok: true, agents: AGENTS });
});

app.get("/api/guardian/overview", (_req, res) => {
  res.json({
    ok: true,
    guardian: {
      systemStatus: "active",
      alerts: 0,
      backend: "online",
      summary: "Guardian Agent is watching core system health.",
      phase: "B",
    },
  });
});

app.get("/api/auth/me", requireUser, async (req, res) => {
  await auditLog({
    actorId: req.user.id,
    actorEmail: req.user.email,
    action: "auth_me",
    status: "ok",
  });

  res.json({
    ok: true,
    user: req.user,
  });
});

app.get("/api/audit/recent", requireUser, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    await auditLog({
      actorId: req.user.id,
      actorEmail: req.user.email,
      action: "audit_recent_read",
      status: "ok",
    });

    res.json({ ok: true, items: data || [] });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "audit_read_failed" });
  }
});

app.post("/api/eva/chat", async (req, res) => {
  try {
    const { userId = "anonymous", channel = "text", message } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ ok: false, error: "message is required" });
    }

    const history = await getMessages(userId);
    await addMessage(userId, "user", message, channel);

    const reply = await callLLM({
      message,
      history,
      systemPrompt: getAgentById("eva").systemPrompt,
    });

    await addMessage(userId, "assistant", reply, channel);

    await auditLog({
      actorId: userId,
      action: "eva_chat_public",
      status: "ok",
      details: { channel },
    });

    return res.json({
      ok: true,
      reply,
      meta: { userId, channel, memoryCount: history.length + 2 },
    });
  } catch (error) {
    await auditLog({
      actorId: req.body?.userId || "anonymous",
      action: "eva_chat_public",
      status: "error",
      details: { error: error.message },
    });

    return res.status(500).json({ ok: false, error: error.message || "EVA failed" });
  }
});

app.post("/api/secure/eva/chat", requireUser, async (req, res) => {
  try {
    const { channel = "text", message } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ ok: false, error: "message is required" });
    }

    const userId = req.user.id;
    const history = await getMessages(userId);
    await addMessage(userId, "user", message, channel);

    const reply = await callLLM({
      message,
      history,
      systemPrompt: getAgentById("eva").systemPrompt,
    });

    await addMessage(userId, "assistant", reply, channel);

    await auditLog({
      actorId: req.user.id,
      actorEmail: req.user.email,
      action: "eva_chat_secure",
      status: "ok",
      details: { channel },
    });

    return res.json({
      ok: true,
      reply,
      meta: {
        userId,
        channel,
        memoryCount: history.length + 2,
      },
    });
  } catch (error) {
    await auditLog({
      actorId: req.user?.id || "unknown",
      actorEmail: req.user?.email || "",
      action: "eva_chat_secure",
      status: "error",
      details: { error: error.message },
    });

    return res.status(500).json({ ok: false, error: error.message || "EVA secure failed" });
  }
});

app.get("/api/eva/history", async (req, res) => {
  try {
    const userId = req.query.userId || "anonymous";
    const items = await getMessages(userId);
    return res.json({ ok: true, items });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "History failed" });
  }
});

app.post("/api/eva/clear-memory", async (req, res) => {
  try {
    const { userId = "anonymous" } = req.body || {};
    await clearMessages(userId);
    return res.json({ ok: true, message: "Memory cleared" });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Clear memory failed" });
  }
});

app.post("/api/tasks/create", requireUser, async (req, res) => {
  try {
    const { title, description = "", priority = "medium" } = req.body || {};

    if (!title || typeof title !== "string") {
      return res.status(400).json({ ok: false, error: "title is required" });
    }

    const plan = buildTaskPlan(`${title}\n${description}`);
    const task = await createTaskRecord({
      userId: req.user.id,
      userEmail: req.user.email,
      title,
      description,
      priority,
      primaryAgent: plan.primaryAgent,
    });

    await insertTaskSteps(task.id, plan.steps);

    await auditLog({
      actorId: req.user.id,
      actorEmail: req.user.email,
      action: "task_create",
      status: "ok",
      details: { taskId: task.id, primaryAgent: plan.primaryAgent },
    });

    res.json({
      ok: true,
      task,
      plan,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "task_create_failed" });
  }
});

app.post("/api/tasks/:taskId/execute", requireUser, async (req, res) => {
  try {
    const taskId = req.params.taskId;

    const { task, steps } = await getTaskWithSteps(taskId, req.user.id);
    const finalOutput = await executeTaskPlan(task, steps);

    await auditLog({
      actorId: req.user.id,
      actorEmail: req.user.email,
      action: "task_execute",
      status: "ok",
      details: { taskId },
    });

    res.json({
      ok: true,
      taskId,
      finalOutput,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "task_execute_failed" });
  }
});

app.get("/api/tasks/my", requireUser, async (req, res) => {
  try {
    const items = await getRecentTasks(req.user.id);

    await auditLog({
      actorId: req.user.id,
      actorEmail: req.user.email,
      action: "task_list_my",
      status: "ok",
    });

    res.json({ ok: true, items });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "task_list_failed" });
  }
});

app.get("/api/tasks/:taskId", requireUser, async (req, res) => {
  try {
    const data = await getTaskWithSteps(req.params.taskId, req.user.id);

    await auditLog({
      actorId: req.user.id,
      actorEmail: req.user.email,
      action: "task_read",
      status: "ok",
      details: { taskId: req.params.taskId },
    });

    res.json({ ok: true, ...data });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "task_read_failed" });
  }
});

app.get("/api/admin/tasks/recent", requireUser, requireAdmin, async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    res.json({ ok: true, items: data || [] });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "admin_tasks_failed" });
  }
});

app.get("/api/voice/status", (_req, res) => {
  res.json({
    ok: true,
    status: "phase_b_voice_placeholder",
    note: "Real-time voice orchestration remains a later phase.",
  });
});

app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ ok: false, error: "internal_server_error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Phase B server running on port ${PORT}`);
});
