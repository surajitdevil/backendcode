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
const MODEL = "gemini-1.5-flash";

async function callLLM(systemPrompt, userPrompt) {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
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
    return `Fallback: ${userPrompt}`;
  }
}
function buildDepartmentPrompt(roleName, roleInstruction, task, previousOutputs) {
  return `
You are the ${roleName} inside ORCHEGENTRA AI, a premium enterprise AI company OS.

Your role:
${roleInstruction}

User task:
Title: ${task.title}
Description: ${task.description}

Previous department outputs:
${JSON.stringify(previousOutputs, null, 2)}

Rules:
1. Be specific to the user's exact task.
2. Do not give generic advice.
3. Build on previous agent outputs.
4. Keep output practical, structured, and implementation-oriented.
5. If task is about app, SaaS, AI tools, agentic systems, or automation, tailor deeply to that.
6. Return plain text only.
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
    key: "cto",
    label: "CTO",
    instruction: `
Act as Chief Technology Officer.
Design technical architecture, stack, system modules, backend/frontend structure, scalability, and deployment strategy.
`
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

async function runDepartmentAgents(task) {
  const outputs = {};

  for (const dept of DEPARTMENTS) {
    const systemPrompt = buildDepartmentPrompt(
      dept.label,
      dept.instruction,
      task,
      outputs
    );

    const userPrompt = `Generate the ${dept.label} output for this task.`;

    const result = await callLLM(systemPrompt, userPrompt);
    outputs[dept.key] = result;
  }

  return outputs;
}

function formatLegacyOutput(structured) {
  const orderedKeys = [
    "chairman",
    "cto",
    "cmo",
    "hr",
    "data_scientist",
    "data_engineer",
    "ml_engineer",
    "builder",
    "automation",
    "qa",
    "operations",
    "security",
    "final_summary"
  ];

  return orderedKeys
    .map((key) => {
      const title = key.replace(/_/g, " ").toUpperCase();
      return `[${title}]\n${structured[key] || ""}`;
    })
    .join("\n\n");
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
    const { title, description } = req.body || {};

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
        structured_output: null
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

    const structuredOutput = await runDepartmentAgents(task);
    const finalOutput = formatLegacyOutput(structuredOutput);

    const { error: updateError } = await supabase
      .from("tasks")
      .update({
        status: "completed",
        primary_agent: "multi-agent-company-os",
        final_output: finalOutput,
        structured_output: structuredOutput
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
    const { title, description } = req.body || {};

    if (!title || !description) {
      return res.status(400).json({
        ok: false,
        error: "title_and_description_required"
      });
    }

    // Run AI agents
    const structuredOutput = await runDepartmentAgents({ title, description });
    const finalOutput = formatLegacyOutput(structuredOutput);

    res.json({
      ok: true,
      structured_output: structuredOutput,
      final_output: finalOutput
    });
app.get("/api/debug-env", (_req, res) => {
  res.json({
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    model: MODEL
  });
});
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`ORCHEGENTRA backend running on port ${PORT}`);
});
