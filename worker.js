const SERVER_URL = process.env.SERVER_URL || "http://localhost:3000";
const OWNER_API_KEY = process.env.OWNER_API_KEY || "change-this-owner-key";
const WORKER_POLL_MS = parseInt(process.env.WORKER_POLL_MS || "5000", 10);
const WORKER_ID = process.env.WORKER_ID || "worker-main";

async function api(path, body) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-owner-key": OWNER_API_KEY,
    },
    body: JSON.stringify(body || {}),
  });
  return res.json();
}

async function tick() {
  try {
    const claim = await api("/api/internal/worker/claim", { workerId: WORKER_ID });
    if (!claim.ok || !claim.job) return;

    const job = claim.job;
    await api("/api/internal/worker/process", { taskId: job.task_id, jobId: job.id });
  } catch (e) {
    console.error("Worker tick failed:", e.message);
  }
}

console.log(`Worker ${WORKER_ID} started. Polling ${SERVER_URL} every ${WORKER_POLL_MS}ms`);
setInterval(tick, WORKER_POLL_MS);
tick();
