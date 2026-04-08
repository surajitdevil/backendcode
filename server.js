const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const fetch = require("node-fetch");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 120
}));

const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GEMINI_API_KEY) {
  console.error("Missing environment variables.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const MODEL = "gemini-2.5-flash";

async function callLLM(systemPrompt, userPrompt) {
  try {
    const response = await fetch(
     `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `${systemPrompt}\n\n${userPrompt}`
                }
              ]
            }
          ]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || "Gemini failed");
    }

    return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

  } catch (err) {
  console.error("Gemini error:", err.message);
  throw err;
}
}

function buildDepartmentPrompt(roleName, roleInstruction, task, previousOutputs) {
  return `
You are ${roleName} inside ORCHEGENTRA AI — a high-performance multi-agent company OS.

Your responsibility:
${roleInstruction}

USER TASK:
Title: ${task.title}
Description: ${task.description}

PREVIOUS AGENT OUTPUTS:
${JSON.stringify(previousOutputs, null, 2)}

INSTRUCTIONS:
- Think like a real senior professional in your role.
- Build on previous agents (do NOT repeat).
- Be specific, actionable, and implementation-focused.
- Avoid generic advice.

OUTPUT FORMAT (STRICT):
Return ONLY in this structure:

Objective:
- What you are solving

Key Decisions:
- Important decisions taken

Execution Plan:
- Step-by-step execution

Risks:
- Possible issues

Deliverables:
- What will be produced
`.trim();
}
const DEPARTMENTS = [
  {
    key: "chairman",
    label: "Chairman",
    instruction: `
Act as strategic decision maker.
Define mission, scope, objectives, product direction, and business success criteria.
`
  },
  {
    instruction: `
Act as Chief Technology Officer.
Define technical architecture, stack, backend/frontend structure, scalability, and deployment strategy.

You must also decide which specialist agents are required for this task.

At the end of your output, include a section exactly like this:

Selected Agents:
- builder
- qa

Only choose from:
cmo, hr, data_scientist, data_engineer, ml_engineer, builder, automation, qa, operations, security
`,
  },
  {
    key: "cmo",
    label: "CMO",
    instruction: `
Act as Chief Marketing Officer.
Define market positioning, ideal users, go-to-market strategy, customer acquisition direction, and product messaging.
`
  },
  {
    key: "hr",
    label: "HR",
    instruction: `
Act as HR and people strategy lead.
Define required roles, team structure, responsibilities, collaboration model, and hiring priorities.
`
  },
  {
    key: "data_scientist",
    label: "Data Scientist",
    instruction: `
Act as Data Scientist.
Define KPIs, experiment ideas, intelligence opportunities, analytics questions, forecasting opportunities, and decision metrics.
`
  },
  {
    key: "data_engineer",
    label: "Data Engineer",
    instruction: `
Act as Data Engineer.
Define schemas, pipelines, ingestion design, event tracking, analytics infrastructure, storage patterns, and data flow.
`
  },
  {
    key: "ml_engineer",
    label: "ML Engineer",
    instruction: `
Act as ML Engineer.
Define model workflow, AI architecture, inference/training approach, evaluation method, and AI integration pattern.
If task does not need ML, define the best AI/LLM workflow instead.
`
  },
  {
    key: "builder",
    label: "Full Stack Builder",
    instruction: `
Act as Full Stack Builder.
Turn the plan into a build-ready product blueprint.
Define frontend pages, components, backend APIs, database entities, module structure, folder organization, and implementation sequence.
Focus on building apps, SaaS, AI tools, and agentic systems in production style.
`
  },
  {
    key: "automation",
    label: "Automation Agent",
    instruction: `
Act as Automation Agent.
Design workflow automation, triggers, webhooks, scheduled jobs, API integrations, notifications, handoffs, and operational automations.
If the system can use tools like Make, Zapier, n8n, or internal automation pipelines, specify where and how.
`
  },
  {
    key: "qa",
    label: "QA Agent",
    instruction: `
Act as QA Agent.
Define test strategy, edge cases, functional validation, UI/UX checks, performance checks, failure scenarios, and release readiness checks.
Identify likely bugs and what must be validated before production.
`
  },
  {
    key: "operations",
    label: "Operations",
    instruction: `
Act as Operations Head.
Define rollout phases, task sequencing, delivery plan, milestones, SOPs, dependencies, launch order, and operational control.
`
  },
  {
    key: "security",
    label: "Security",
    instruction: `
Act as Security Lead.
Define auth, permissions, secrets handling, API protection, abuse prevention, audit, privacy, file safety, and production security controls.
`
  },
  {
    key: "final_summary",
    label: "Final Summary",
    instruction: `
Act as Executive Integrator.
Combine all department outputs into one clear final action plan.
Summarize exactly what should be built, in what order, and how it should be launched.
`
  }
];
function getAgentMap() {
  return Object.fromEntries(DEPARTMENTS.map(agent => [agent.key, agent]));
}

function extractAgentsFromText(text) {
  if (!text) return [];

  const normalized = text.toLowerCase();

  const agentKeywords = {
    cmo: ["cmo", "marketing", "go-to-market", "growth", "branding"],
    hr: ["hr", "hiring", "recruitment", "team structure", "people"],
    data_scientist: ["data scientist", "analytics", "kpi", "forecast", "experiment"],
    data_engineer: ["data engineer", "pipeline", "etl", "warehouse", "ingestion"],
    ml_engineer: ["ml engineer", "machine learning", "model", "training", "inference", "ai model"],
    builder: ["builder", "full stack", "frontend", "backend", "ui", "api", "database"],
    automation: ["automation", "workflow", "zapier", "n8n", "make", "trigger", "webhook"],
    qa: ["qa", "testing", "validation", "bug", "test cases"],
    operations: ["operations", "launch", "rollout", "milestone", "delivery"],
    security: ["security", "auth", "permission", "privacy", "compliance", "protection"]
  };

  const selected = [];

  for (const [agentKey, keywords] of Object.entries(agentKeywords)) {
    if (keywords.some(keyword => normalized.includes(keyword))) {
      selected.push(agentKey);
    }
  }

  return [...new Set(selected)];
}

function resolveSelectedAgents(ctoOutput, manualAgents = []) {
  const ctoAgents = extractAgentsFromText(ctoOutput);
  const merged = [...new Set([...(manualAgents || []), ...ctoAgents])];

  if (merged.length === 0) {
    return ["builder", "qa"];
  }

  return merged;
}

async function runDepartmentAgents(task, manualAgents = []) {
  const outputs = {};
  const agentMap = getAgentMap();

  const chairman = agentMap["chairman"];
  const cto = agentMap["cto"];
  const finalSummary = agentMap["final_summary"];

  // 1. Chairman
  try {
    const prompt = buildDepartmentPrompt(
      chairman.label,
      chairman.instruction,
      task,
      outputs
    );

    outputs[chairman.key] = await callLLM(
      prompt,
      "Define mission, scope, and objectives clearly."
    );

    console.log(`✅ Chairman done`);
    await new Promise(r => setTimeout(r, 1200));
  } catch (err) {
    outputs[chairman.key] = `ERROR: ${err.message}`;
  }

  // 2. CTO
  let selectedAgents = [];

  try {
    const prompt = buildDepartmentPrompt(
      cto.label,
      cto.instruction,
      task,
      outputs
    );

    outputs[cto.key] = await callLLM(
      prompt,
      "Design system and include 'Selected Agents:' section."
    );

    console.log(`✅ CTO done`);
    await new Promise(r => setTimeout(r, 1200));

    selectedAgents = resolveSelectedAgents(outputs[cto.key], manualAgents);
  } catch (err) {
    outputs[cto.key] = `ERROR: ${err.message}`;
    selectedAgents = manualAgents.length ? manualAgents : ["builder", "qa"];
  }

  // 3. Selected agents
  for (const key of selectedAgents) {
    if (["chairman", "cto", "final_summary"].includes(key)) continue;

    const dept = agentMap[key];
    if (!dept) continue;

    try {
      const prompt = buildDepartmentPrompt(
        dept.label,
        dept.instruction,
        task,
        outputs
      );

      outputs[dept.key] = await callLLM(
        prompt,
        "Execute your role clearly."
      );

      console.log(`✅ ${dept.label} done`);
      await new Promise(r => setTimeout(r, 1200));

    } catch (err) {
      outputs[dept.key] = `ERROR: ${err.message}`;
    }
  }

  // 4. Final summary
  try {
    const prompt = buildDepartmentPrompt(
      finalSummary.label,
      finalSummary.instruction,
      task,
      outputs
    );

    outputs[finalSummary.key] = await callLLM(
      prompt,
      "Combine all outputs into final plan."
    );

    console.log(`✅ Final Summary done`);
  } catch (err) {
    outputs[finalSummary.key] = `ERROR: ${err.message}`;
  }

  outputs.selected_agents = selectedAgents;

  return outputs;
}
function formatLegacyOutput(structured) {
  const selected = structured.selected_agents || [];

  const order = [
    "chairman",
    "cto",
    ...selected,
    "final_summary"
  ];

  const uniqueOrder = [...new Set(order)];

  return uniqueOrder
    .map((key) => {
      if (!structured[key]) return "";
      return `\n\n=== ${key.toUpperCase()} ===\n${structured[key]}`;
    })
    .join("");
}


app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "ORCHEGENTRA BACKEND",
    status: "running"
  });
});

app.post("/api/tasks/create", async (req, res) => {
  try {
    const { title, description, selected_agents = [] } = req.body || {};

    if (!title || !description) {
      return res.status(400).json({
        ok: false,
        error: "title_and_description_required"
      });
    }

    const { data, error } = await supabase
      .from("tasks")
      .insert([{
        user_id: "anonymous",
user_email: null,
title,
description,
priority: "medium",
status: "pending",
primary_agent: null,
final_output: null,
structured_output: null,
selected_agents
      }])
      .select()
      .single();

    if (error) throw error;

    res.json({
      ok: true,
      task: data
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

app.get("/api/tasks", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({
      ok: true,
      data
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

app.post("/api/tasks/:id/execute", async (req, res) => {
  try {
    const id = req.params.id;

    const { data: task, error: fetchError } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !task) {
      return res.status(404).json({
        ok: false,
        error: "task_not_found"
      });
    }

    await supabase
      .from("tasks")
      .update({ status: "running" })
      .eq("id", id);

    const structuredOutput = await runDepartmentAgents(
  task,
  task.selected_agents || []
);
    const finalOutput = formatLegacyOutput(structuredOutput);

    const { error: updateError } = await supabase
      .from("tasks")
      .update({
        status: "completed",
primary_agent: "multi-agent-company-os",
final_output: finalOutput,
structured_output: structuredOutput,
selected_agents: structuredOutput.selected_agents || []
      })
      .eq("id", id);

    if (updateError) throw updateError;

    res.json({
      ok: true,
      id,
      status: "completed",
      structured_output: structuredOutput,
      final_output: finalOutput
    });
  } catch (err) {
    const id = req.params.id;

    await supabase
      .from("tasks")
      .update({
        status: "failed",
        final_output: `Execution failed: ${err.message}`
      })
      .eq("id", id);

    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

app.get("/api/tasks/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (error) throw error;

    res.json({
      ok: true,
      task: data
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});
// NEW: Direct execution API (no task ID required)
app.post("/api/task/execute", async (req, res) => {
  try {
    const { title, description ,agents } = req.body || {};

    if (!title || !description) {
      return res.status(400).json({
        ok: false,
        error: "title_and_description_required"
      });
    }

    
    const structuredOutput = await runDepartmentAgents(
  { title, description },
  agents || []
);
    const finalOutput = formatLegacyOutput(structuredOutput);

    res.json({
      ok: true,
      structured_output: structuredOutput,
      final_output: finalOutput
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});
app.get("/api/test-gemini", async (_req, res) => {
  try {
    const output = await callLLM(
      "You are a helpful AI assistant.",
      "Reply with exactly: Gemini is working"
    );

    res.json({
      ok: true,
      output
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});
app.get("/api/debug-env", (_req, res) => {
  res.json({
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    model: MODEL
  });
});
app.get("/api/list-models", async (_req, res) => {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`
    );
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.listen(PORT, () => {
  console.log(`ORCHEGENTRA backend running on port ${PORT}`);
});
