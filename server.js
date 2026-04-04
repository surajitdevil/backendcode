const express = require("express");
const cors = require("cors");

const app = express();

app.use(express.json());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "*",
    credentials: true,
  })
);

app.get("/", (req, res) => {
  res.json({ message: "Backend is running" });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/agents/list", (req, res) => {
  res.json({
    agents: [
      { id: "eva", name: "EVA", role: "Executive Assistant" },
      { id: "guardian", name: "Guardian", role: "System Monitor" }
    ]
  });
});

app.get("/api/guardian/overview", (req, res) => {
  res.json({
    systemStatus: "active",
    alerts: 0,
    backend: "online"
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on ${PORT}`);
});
