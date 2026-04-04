const fetch = require("node-fetch");

async function callLLM({ message, memory = [] }) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL,
      messages: [
        { role: "system", content: "You are EVA, a smart assistant." },
        ...memory.map(m => ({ role: m.role, content: m.content })),
        { role: "user", content: message }
      ]
    })
  });

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || "No response";
}

module.exports = { callLLM };
