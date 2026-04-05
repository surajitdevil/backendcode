const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const fetch = require("node-fetch");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const app = express();

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  global: {
    fetch,
  },
});

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

async function callLLM({ message, history = [] }) {
  const apiKey = (process.env.OPENROUTER_API_KEY || "").trim();
  const baseUrl = (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1")
    .trim()
    .replace(/\/$/, "");
  const model = (process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini").trim();

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is missing in Railway variables.");
  }

  const messages = [
    {
      role: "system",
      content:
        "You are EVA, a warm, intelligent, professional executive AI assistant for Orchegentra AI. Reply clearly in English, naturally and helpfully. Greet politely when appropriate.",
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

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://orchegentra.ai",
      "X-Title": "Orchegentra EVA",
    },
    body: JSON.stringify({
      model,
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

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "*",
    credentials: true,
  })
);
app.use(
  rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
    max: Number(process.env.RATE_LIMIT_MAX || 60),
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    message: "Orchegentra backend is running",
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/debug", (_req, res) => {
  res.json({
    ok: true,
    env: {
      SUPABASE_URL: SUPABASE_URL ? `${SUPABASE_URL.slice(0, 20)}...` : "MISSING",
      SUPABASE_SERVICE_ROLE_KEY: SUPABASE_KEY ? "SET" : "MISSING",
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ? "SET" : "MISSING",
      OPENROUTER_BASE_URL:
        (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1")
          .trim()
          .replace(/\/$/, ""),
      OPENROUTER_MODEL: (process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini").trim(),
    },
  });
});

app.get("/api/supabase-test", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("eva_memory")
      .select("*")
      .limit(1);

    if (error) {
      throw error;
    }

    return res.json({
      ok: true,
      message: "Supabase connection works",
      rows: data || [],
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Supabase test failed",
    });
  }
});

app.get("/api/agents/list", (_req, res) => {
  res.json({
    ok: true,
    agents: [
      { id: "eva", name: "EVA", role: "Executive AI Assistant" },
      { id: "guardian", name: "Guardian Agent", role: "System Monitor" },
      { id: "qa", name: "QA Agent", role: "Bug and quality monitoring" },
      { id: "security", name: "Security Agent", role: "Security monitoring" },
      { id: "cto", name: "CTO Agent", role: "Architecture and tech direction" },
      { id: "builder", name: "Builder Agent", role: "Implementation and delivery" },
    ],
  });
});

app.get("/api/guardian/overview", (_req, res) => {
  res.json({
    ok: true,
    guardian: {
      systemStatus: "active",
      alerts: 0,
      backend: "online",
      summary: "Guardian Agent is watching core system health.",
    },
  });
});

app.post("/api/eva/chat", async (req, res) => {
  try {
    const { userId = "anonymous", channel = "text", message } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ ok: false, error: "message is required" });
    }

    const history = await getMessages(userId);
    await addMessage(userId, "user", message, channel);

    const reply = await callLLM({ message, history });

    await addMessage(userId, "assistant", reply, channel);

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
    console.error("/api/eva/chat error:", error.message);
    return res.status(500).json({
      ok: false,
      error: error.message || "EVA failed",
    });
  }
});

app.get("/api/eva/history", async (req, res) => {
  try {
    const userId = req.query.userId || "anonymous";
    const items = await getMessages(userId);

    return res.json({
      ok: true,
      items,
    });
  } catch (error) {
    console.error("/api/eva/history error:", error.message);
    return res.status(500).json({
      ok: false,
      error: error.message || "History failed",
    });
  }
});

app.post("/api/eva/clear-memory", async (req, res) => {
  try {
    const { userId = "anonymous" } = req.body || {};
    await clearMessages(userId);

    return res.json({
      ok: true,
      message: "Memory cleared",
    });
  } catch (error) {
    console.error("/api/eva/clear-memory error:", error.message);
    return res.status(500).json({
      ok: false,
      error: error.message || "Clear memory failed",
    });
  }
});

app.get("/api/voice/status", (_req, res) => {
  res.json({
    ok: true,
    status: "voice_phase_started",
    note: "Real-time voice provider wiring comes next.",
  });
});

app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    ok: false,
    error: "internal_server_error",
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
