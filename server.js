import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ENV
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = "gemini-1.5-pro-latest";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ========================
// 🔹 HEALTH
// ========================
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "ORCHEGENTRA BACKEND",
    status: "running"
  });
});

// ========================
// 🔹 GEMINI CALL
// ========================
async function callLLM(systemPrompt, userMessage) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: systemPrompt },
              { text: userMessage }
            ]
          }
        ]
      })
    }
  );

  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "No response";
}

// ========================
// 🔹 AGENT MAP
// ========================
function getAgentMap() {
  return {
    chairman: {
      label: "Chairman AI",
      instruction: "You are the Chairman. Think strategically and guide decisions."
    },
    cto: {
      label: "CTO Agent",
      instruction: "You are CTO. Decide architecture and technical execution."
    },
    cmo: {
      label: "CMO Agent",
      instruction: "You are CMO. Focus on marketing and growth."
    },
    hr: {
      label: "HR Agent",
      instruction: "You manage hiring, people and operations."
    },
    data_scientist: {
      label: "Data Scientist",
      instruction: "You analyze data and give insights."
    },
    data_engineer: {
      label: "Dev Engineer",
      instruction: "You build backend and APIs."
    },
    ml_engineer: {
      label: "ML Agent",
      instruction: "You build ML pipelines and models."
    },
    builder: {
      label: "Builder Agent",
      instruction: "You build frontend/UI and product."
    },
    automation: {
      label: "Automation Agent",
      instruction: "You automate workflows and pipelines."
    },
    qa: {
      label: "QA Agent",
      instruction: "You test and validate outputs."
    },
    operations: {
      label: "Operations Agent",
      instruction: "You manage execution and resources."
    },
    security: {
      label: "Security Agent",
      instruction: "You ensure system security."
    }
  };
}

// ========================
// 🔹 TASK CREATE
// ========================
app.post("/api/tasks/create", async (req, res) => {
  const { title, description } = req.body;

  const { data, error } = await supabase
    .from("tasks")
    .insert([{ title, description }])
    .select()
    .single();

  if (error) return res.status(500).json({ ok: false, error });

  res.json({ ok: true, task: data });
});

// ========================
// 🔹 TASK EXECUTION
// ========================
app.post("/api/tasks/:id/execute", async (req, res) => {
  const { id } = req.params;

  const { data: task } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", id)
    .single();

  const agents = getAgentMap();

  // Chairman
  const chairman = await callLLM(
    agents.chairman.instruction,
    task.description
  );

  // CTO decides agents
  const cto = await callLLM(
    agents.cto.instruction,
    chairman
  );

  const selected_agents = ["builder", "qa"];

  const outputs = {
    chairman,
    cto,
    selected_agents
  };

  // Run selected agents
  for (const key of selected_agents) {
    outputs[key] = await callLLM(
      agents[key].instruction,
      task.description
    );
  }

  const final_output = outputs[selected_agents[0]] || "";

  await supabase
    .from("tasks")
    .update({
      structured_output: outputs,
      final_output
    })
    .eq("id", id);

  res.json({
    ok: true,
    structured_output: outputs,
    final_output
  });
});

// ========================
// 🔹 AGENT CHAT
// ========================
app.post("/api/agent/chat", async (req, res) => {
  const { agent, message } = req.body;

  const agentMap = getAgentMap();
  const selected = agentMap[agent];

  if (!selected) {
    return res.status(400).json({ ok: false, error: "Invalid agent" });
  }

  const reply = await callLLM(selected.instruction, message);

  res.json({
    ok: true,
    agent,
    reply
  });
});

// ========================
app.listen(PORT, () => {
  console.log(`ORCHEGENTRA backend running on port ${PORT}`);
});
