const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const evaRoutes = require("./src/routes/eva.routes");

const app = express();

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cors({
  origin: process.env.FRONTEND_URL || "*",
  credentials: true,
}));
app.use(rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  max: Number(process.env.RATE_LIMIT_MAX || 60),
  standardHeaders: true,
  legacyHeaders: false,
}));

app.get("/", (_req, res) => {
  res.json({ ok: true, message: "Orchegentra backend is running" });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
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
      { id: "builder", name: "Builder Agent", role: "Implementation and delivery" }
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
      summary: "Guardian Agent is watching core system health."
    }
  });
});

app.use("/api/eva", evaRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: "internal_server_error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on ${PORT}`);
});
