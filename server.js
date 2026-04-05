const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const fetch = require("node-fetch");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const app = express();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

app.use(helmet());
app.use(express.json());
app.use(cors());
app.use(rateLimit({ windowMs: 60000, max: 100 }));

// ===== AGENTS =====
const AGENTS = {
  chairman: "You are Chairman Agent. Decide strategy and direction.",
  cto: "You are CTO Agent. Design technical architecture.",
  ops: "You are Operations Agent. Break work into steps.",
  analyst: "You are Analyst Agent. Provide insights.",
  builder: "You are Builder Agent. Generate implementation.",
  security: "You are Security Agent. Check risks and safety.",
  eva: "You are EVA. Respond clearly and professionally."
};

// ===== LLM CALL =====
async function callLLM(prompt, system) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt }
      ]
    })
  });

  const data = await res.json();
  return data?.choices?.[0]?.message?.content || "No response";
}

// ===== TASK CREATE =====
app.post("/api/tasks/create", async (req, res) => {
  try {
    const { title, description } = req.body;

    const { data, error } = await supabase
      .from("tasks")
      .insert([{ title, description, status: "created" }])
      .select()
      .single();

    if (error) throw error;

    res.json({ ok: true, task: data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ===== TASK EXECUTE =====
app.post("/api/tasks/:id/execute", async (req, res) => {
  try {
    const id = req.params.id;

    const { data: task } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", id)
      .single();

    let context = task.description;

    for (const agent in AGENTS) {
      const output = await callLLM(context, AGENTS[agent]);

      await supabase.from("agent_runs").insert([
        {
          task_id: id,
          agent_id: agent,
          output_text: output
        }
      ]);

      context += "\n" + output;
    }

    await supabase
      .from("tasks")
      .update({ status: "completed", final_output: context })
      .eq("id", id);

    res.json({ ok: true, result: context });

  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ===== GET TASKS =====
app.get("/api/tasks", async (_req, res) => {
  const { data } = await supabase.from("tasks").select("*").limit(20);
  res.json({ ok: true, data });
});

// ===== HEALTH =====
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, system: "ORCHEGENTRA SYSTEM-AUTH RUNNING" });
});

app.listen(3000, () => console.log("Server running"));
