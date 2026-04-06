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
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENROUTER_API_KEY) {
  console.error("Missing environment variables.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const MODEL = "openai/gpt-4o-mini";

async function callLLM(systemPrompt, userPrompt) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.4,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || "LLM call failed");
  }

  return data?.choices?.[0]?.message?.content || "";
}

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
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
2. Do not give generic business advice.
3. Respond only with useful department output.
4. Keep it practical, structured, and implementation-oriented.
5. If the task is product-building, tailor your output to that product.
6. Do not repeat previous departments unnecessarily.
7. Output plain text only.
`.trim();
}

const DEPARTMENTS = [
  {
    key: "chairman",
    label: "Chairman",
    instruction: `
Act as strategic decision maker.
Define mission, scope, objectives, product direction, and core vision.
Break the task into high-level business goals and success criteria.
`
  },
  {
    key: "cto",
    label: "CTO",
    instruction: `
Act as Chief Technology Officer.
Design technical architecture, stack, system modules, backend/frontend structure, deployment and scalability plan.
`
  },
  {
    key: "cmo",
    label: "CMO",
    instruction: `
Act as Chief Marketing Officer.
Define market positioning, go-to-market strategy, customer persona, growth channels, pricing ideas, and branding direction.
`
  },
  {
    key: "hr",
    label: "HR",
    instruction: `
Act as HR and talent strategy lead.
Define required roles, team structure, hiring plan, responsibilities, collaboration model, and execution ownership.
`
  },
  {
    key: "data_scientist",
    label: "Data Scientist",
    instruction: `
Act as Data Scientist.
Define business intelligence opportunities, predictive analytics opportunities, experimentation design, data insights, and measurable KPIs.
`
  },
  {
    key: "data_engineer",
    label: "Data Engineer",
    instruction: `
Act as Data Engineer.
Design data pipelines, schemas, ingestion strategy, storage, event tracking, analytics infrastructure, and data flow.
`
  },
  {
    key: "ml_engineer",
    label: "ML Engineer",
    instruction: `
Act as ML Engineer.
Define machine learning or AI architecture, model workflow, training/inference strategy, evaluation and deployment approach if relevant.
If the task does not need ML, state the best AI automation approach instead.
`
  },
  {
    key: "operations",
    label: "Operations",
    instruction: `
Act as Operations Head.
Define execution workflow, milestones, delivery phases, SOPs, dependencies, operational processes, and rollout sequence.
`
  },
  {
    key: "security",
    label: "Security",
    instruction: `
Act as Security Lead.
Define security architecture, auth, secrets handling, API protection, logging, abuse protection, privacy, and compliance considerations.
`
  },
  {
    key: "final_summary",
    label: "Final Summary",
    instruction: `
Act as Executive Integrator.
Combine all department outputs into one clear final action plan.
Summarize what should be built, in what sequence, and what the final recommended strategy is.
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

    const userPrompt = `
Generate the ${dept.label} output for this task.
Be highly relevant to the specific task.
`.trim();

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
    "operations",
    "security",
    "final_summary"
  ];

  return orderedKeys
    .map((key) => {
      const title = key.replaceAll("_", " ").toUpperCase();
      return `[${title}]\n${structured[key] || ""}`;
    })
    .join("\n\n");
}

/**
 * HEALTH
 */
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "ORCHEGENTRA BACKEND",
    status: "running"
  });
});

/**
 * CREATE TASK
 */
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

/**
 * LIST TASKS
 */
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

/**
 * EXECUTE TASK
 */
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
      .update({
        status: "running"
      })
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

/**
 * GET SINGLE TASK
 */
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

app.listen(PORT, () => {
  console.log(`ORCHEGENTRA backend running on port ${PORT}`);
});
