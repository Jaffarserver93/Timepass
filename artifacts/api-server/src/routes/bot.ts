import { Router, type IRouter } from "express";
import fs from "fs";

const router: IRouter = Router();

const SCREENSHOT_FILE    = "/tmp/bot-screenshot.png";
const STATUS_FILE        = "/tmp/bot-status.json";
const LOGS_FILE          = "/tmp/bot-logs.json";
const NETWORK_LOG_FILE   = "/tmp/bot-network-log.json";

function readJsonFile(path: string, fallback: unknown): unknown {
  try {
    return JSON.parse(fs.readFileSync(path, "utf-8"));
  } catch {
    return fallback;
  }
}

// ── Screenshot endpoint (single frame) ───────────────────────────────────────
router.get("/bot/screenshot", (_req, res) => {
  if (!fs.existsSync(SCREENSHOT_FILE)) {
    res.status(404).json({ error: "No screenshot yet — bot may still be starting up." });
    return;
  }
  const img = fs.readFileSync(SCREENSHOT_FILE);
  res.set("Content-Type", "image/png");
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.set("Pragma", "no-cache");
  res.send(img);
});

// ── MJPEG stream endpoint — one connection, server pushes frames ──────────────
const BOUNDARY = "botframe";
const STREAM_INTERVAL_MS = 200; // 5 fps — smooth with minimal CPU

router.get("/bot/stream", (req, res) => {
  res.set({
    "Content-Type": `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
    "Cache-Control": "no-cache, no-store",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let lastSize = 0;

  const timer = setInterval(() => {
    if (!fs.existsSync(SCREENSHOT_FILE)) return;
    try {
      const stat = fs.statSync(SCREENSHOT_FILE);
      // Only read + send if the file changed since last frame
      if (stat.size === 0) return;
      const img = fs.readFileSync(SCREENSHOT_FILE);
      const header =
        `--${BOUNDARY}\r\n` +
        `Content-Type: image/png\r\n` +
        `Content-Length: ${img.length}\r\n` +
        `\r\n`;
      res.write(header);
      res.write(img);
      res.write("\r\n");
      lastSize = stat.size;
    } catch (_) {}
  }, STREAM_INTERVAL_MS);

  req.on("close", () => clearInterval(timer));
  req.on("error", () => clearInterval(timer));
});

// ── Status endpoint ───────────────────────────────────────────────────────────
router.get("/bot/status", (_req, res) => {
  const status = readJsonFile(STATUS_FILE, { state: "unknown" });
  res.json(status);
});

// ── Logs endpoint ─────────────────────────────────────────────────────────────
router.get("/bot/logs", (_req, res) => {
  const logs = readJsonFile(LOGS_FILE, []);
  res.json(logs);
});

// ── Network log endpoint ───────────────────────────────────────────────────────
router.get("/bot/network-log", (_req, res) => {
  const events = readJsonFile(NETWORK_LOG_FILE, []);
  res.json(events);
});

// ── Dashboard HTML ────────────────────────────────────────────────────────────
router.get("/dashboard", (_req, res) => {
  res.set("Content-Type", "text/html; charset=utf-8");
  res.set("Cache-Control", "no-store");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
  <title>Bot Dashboard</title>
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      --bg:      #0a0a0f;
      --bg2:     #111118;
      --bg3:     #0d0d15;
      --border:  #1e1e2e;
      --border2: #1a1a26;
      --muted:   #3f3f46;
      --muted2:  #52525b;
      --text:    #d4d4d8;
      --text2:   #a1a1aa;
      --green:   #22c55e;
      --red:     #ef4444;
      --amber:   #f59e0b;
      --blue:    #3b82f6;
      --purple:  #a78bfa;
    }

    html, body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Courier New', monospace;
    }

    /* ── Desktop: fixed full-viewport layout ── */
    @media (min-width: 769px) {
      body   { height: 100dvh; display: flex; flex-direction: column; overflow: hidden; }
      main   { flex: 1; display: flex; overflow: hidden; min-height: 0; }
    }

    /* ── Mobile: natural scroll layout ── */
    @media (max-width: 768px) {
      body { min-height: 100dvh; }
      main { display: flex; flex-direction: column; }
    }

    /* ── Header ── */
    header {
      padding: 10px 14px;
      background: var(--bg2);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
      position: sticky;
      top: 0;
      z-index: 10;
    }

    .pulse-dot {
      width: 9px; height: 9px;
      border-radius: 50%;
      background: var(--green);
      flex-shrink: 0;
    }
    .pulse-dot.running   { animation: pulse 1.8s ease-in-out infinite; }
    .pulse-dot.error     { background: var(--red); }
    .pulse-dot.starting,
    .pulse-dot.logging-in,
    .pulse-dot.re-login  { background: var(--amber); animation: pulse 1s ease-in-out infinite; }
    .pulse-dot.stopped,
    .pulse-dot.unknown   { background: var(--muted2); }
    .pulse-dot.retrying  { background: var(--purple); animation: pulse 0.7s ease-in-out infinite; }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%       { opacity: 0.3; transform: scale(0.8); }
    }

    .header-title { font-size: 13px; font-weight: bold; color: #e4e4e7; letter-spacing: 0.04em; }
    .header-url   { font-size: 11px; color: var(--muted2); }
    .header-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
    .refresh-badge {
      font-size: 10px; color: var(--blue);
      background: #1e3a5f;
      padding: 2px 8px; border-radius: 10px;
      white-space: nowrap;
    }
    #clock { font-size: 11px; color: var(--muted); }
    @media (max-width: 480px) {
      .header-url { display: none; }
      #clock      { display: none; }
    }

    /* ── Mobile tabs ── */
    .tab-bar {
      display: none;
    }
    @media (max-width: 768px) {
      .tab-bar {
        display: flex;
        background: var(--bg2);
        border-bottom: 1px solid var(--border);
        flex-shrink: 0;
        position: sticky;
        top: 41px;
        z-index: 9;
      }
      .tab-btn {
        flex: 1;
        padding: 10px 4px;
        font-size: 11px;
        font-family: inherit;
        background: none;
        border: none;
        color: var(--muted2);
        cursor: pointer;
        border-bottom: 2px solid transparent;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        transition: color 0.15s, border-color 0.15s;
      }
      .tab-btn.active { color: var(--blue); border-bottom-color: var(--blue); }
    }

    /* ── Preview pane ── */
    .preview-pane {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: #05050a;
      border-right: 1px solid var(--border);
      overflow: hidden;
      min-width: 0;
    }
    @media (max-width: 768px) {
      .preview-pane {
        border-right: none;
        border-bottom: 1px solid var(--border);
        flex: none;
      }
    }

    .preview-toolbar {
      padding: 6px 14px;
      background: var(--bg2);
      border-bottom: 1px solid var(--border);
      font-size: 10px;
      color: var(--muted);
      display: flex;
      gap: 12px;
      align-items: center;
      flex-shrink: 0;
    }
    #live-fps { color: var(--green); font-weight: bold; }

    .screenshot-wrap {
      flex: 1;
      position: relative;
      overflow: auto;
      background: #000;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* 16:9 container that scales to fit the pane */
    .screenshot-inner {
      position: relative;
      width: 100%;
      /* enforce 16:9 — matches 1280×720 viewport */
      aspect-ratio: 16 / 9;
      max-width: 100%;
      flex-shrink: 0;
    }

    #screenshot {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: fill; /* pixel-perfect: no letterboxing */
      display: block;
    }

    @media (max-width: 768px) {
      .screenshot-wrap { overflow: hidden; }
      .screenshot-inner { width: 100%; }
    }

    #no-screenshot { text-align: center; color: #27272a; }
    #no-screenshot p { font-size: 12px; margin-top: 8px; }

    /* ── Sidebar ── */
    .sidebar {
      width: 300px;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: var(--bg3);
    }
    @media (max-width: 768px) {
      .sidebar { width: 100%; flex: none; }
    }

    /* ── Status panel ── */
    .panel {
      border-bottom: 1px solid var(--border);
      padding: 14px 16px;
      flex-shrink: 0;
    }
    .panel-title {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--muted);
      margin-bottom: 12px;
    }

    /* On mobile, stats in a 2-col grid */
    .stats-grid {
      display: flex;
      flex-direction: column;
      gap: 0;
    }
    @media (max-width: 768px) {
      .stats-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px 8px;
      }
    }

    .stat-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 9px;
      gap: 8px;
      font-size: 11px;
    }
    @media (max-width: 768px) {
      .stat-row {
        flex-direction: column;
        margin-bottom: 0;
        gap: 3px;
      }
    }
    .stat-label { color: var(--muted2); flex-shrink: 0; font-size: 10px; }
    .stat-value {
      color: var(--text2);
      text-align: right;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 170px;
      font-size: 11px;
    }
    @media (max-width: 768px) {
      .stat-value { text-align: left; max-width: 100%; font-size: 12px; }
    }
    .stat-value.url-val { font-size: 10px; color: var(--blue); }

    .badge {
      display: inline-flex;
      align-items: center;
      padding: 3px 10px;
      border-radius: 20px;
      font-size: 10px;
      font-weight: bold;
      letter-spacing: 0.05em;
    }
    @media (max-width: 768px) { .badge { font-size: 11px; padding: 4px 12px; } }
    .badge-running   { background: #052e16; color: var(--green); border: 1px solid #166534; }
    .badge-error     { background: #2d0a0a; color: var(--red);   border: 1px solid #7f1d1d; }
    .badge-starting,
    .badge-logging-in,
    .badge-re-login  { background: #1c1300; color: var(--amber); border: 1px solid #78350f; }
    .badge-stopped,
    .badge-unknown   { background: #18181b; color: var(--muted2); border: 1px solid #27272a; }
    .badge-retrying  { background: #1c0f2e; color: var(--purple); border: 1px solid #4c1d95; }
    .badge-logged-in { background: #0a2a1a; color: #4ade80; border: 1px solid #166534; }

    /* ── Logs pane ── */
    .logs-pane {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-height: 0;
    }
    @media (max-width: 768px) {
      .logs-pane { min-height: 260px; max-height: 320px; }
    }

    .logs-header {
      padding: 10px 16px 6px;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--muted);
      border-bottom: 1px solid var(--border2);
      flex-shrink: 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    #log-count { color: #27272a; }

    #log-list {
      flex: 1;
      overflow-y: auto;
      padding: 6px 0;
      -webkit-overflow-scrolling: touch;
    }
    #log-list::-webkit-scrollbar { width: 4px; }
    #log-list::-webkit-scrollbar-thumb { background: #27272a; border-radius: 2px; }

    .log-line {
      padding: 4px 16px;
      font-size: 9.5px;
      line-height: 1.5;
      border-bottom: 1px solid #0f0f18;
      word-break: break-all;
      color: var(--muted);
    }
    @media (max-width: 768px) { .log-line { font-size: 10px; padding: 5px 14px; } }
    .log-line.fresh   { color: #71717a; }
    .log-line.success { color: #16a34a; }
    .log-line.warn    { color: #b45309; }
    .log-line.error   { color: #b91c1c; }

    /* ── Footer ── */
    footer {
      padding: 5px 16px;
      background: var(--bg2);
      border-top: 1px solid var(--border);
      font-size: 9px;
      color: #27272a;
      display: flex;
      justify-content: space-between;
      flex-shrink: 0;
    }
    @media (max-width: 768px) { footer { font-size: 10px; padding: 7px 14px; } }

    /* ── Network pane ── */
    .network-pane {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-height: 0;
    }
    @media (max-width: 768px) {
      .network-pane { min-height: 260px; max-height: 420px; }
    }
    .network-header {
      padding: 10px 16px 6px;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--muted);
      border-bottom: 1px solid var(--border2);
      flex-shrink: 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    #net-count { color: #27272a; }
    #net-list {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
      -webkit-overflow-scrolling: touch;
    }
    #net-list::-webkit-scrollbar { width: 4px; }
    #net-list::-webkit-scrollbar-thumb { background: #27272a; border-radius: 2px; }

    .net-event {
      padding: 5px 14px;
      border-bottom: 1px solid #0f0f18;
      font-size: 9px;
      line-height: 1.5;
      word-break: break-all;
    }
    .net-event .net-type {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 8px;
      font-weight: bold;
      letter-spacing: 0.06em;
      margin-right: 5px;
    }
    .net-type-request    { background: #1e3a5f; color: var(--blue); }
    .net-type-response   { background: #052e16; color: var(--green); }
    .net-type-navigation { background: #1c0f2e; color: var(--purple); }
    .net-type-scan       { background: #1c1300; color: var(--amber); }
    .net-type-click-start  { background: #1c1300; color: var(--amber); }
    .net-type-click-result { background: #052e16; color: var(--green); }
    .net-type-click-error  { background: #2d0a0a; color: var(--red); }
    .net-type-external-link { background: #18181b; color: var(--muted2); }
    .net-event .net-url { color: var(--blue); font-size: 9px; }
    .net-event .net-token { color: #f59e0b; font-size: 8px; }
    .net-event .net-cookie { color: #a78bfa; font-size: 8px; }
    .net-event .net-redirect { color: #4ade80; font-size: 8px; }
    .net-event .net-body { color: #52525b; font-size: 8px; margin-top: 2px; white-space: pre-wrap; }

    /* ── Mobile panel visibility controlled by tabs ── */
    @media (max-width: 768px) {
      .panel-section { display: none; }
      .panel-section.active { display: block; }
      .preview-pane { display: none; }
      .preview-pane.active { display: flex; }
      .logs-pane { display: none; }
      .logs-pane.active { display: flex; }
      .network-pane { display: none; }
      .network-pane.active { display: flex; }
    }
  </style>
</head>
<body>

<header>
  <div class="pulse-dot starting" id="pulse-dot"></div>
  <span class="header-title">Bot Dashboard</span>
  <span class="header-url">vektalnodes.in/earn</span>
  <div class="header-right">
    <span class="refresh-badge">⚡ STREAM</span>
    <span id="clock">—</span>
  </div>
</header>

<div class="tab-bar">
  <button class="tab-btn active" onclick="switchTab('preview')">📺 Preview</button>
  <button class="tab-btn" onclick="switchTab('status')">📊 Status</button>
  <button class="tab-btn" onclick="switchTab('logs')">📋 Logs</button>
  <button class="tab-btn" onclick="switchTab('network')">🌐 Network</button>
</div>

<main>
  <!-- Preview -->
  <div class="preview-pane active" id="tab-preview">
    <div class="preview-toolbar">
      <span>LIVE PREVIEW</span>
      <span id="stream-badge" style="color:var(--muted);">CONNECTING…</span>
      <span id="img-size" style="margin-left:auto;">—</span>
    </div>
    <div class="screenshot-wrap">
      <div class="screenshot-inner">
        <div id="no-screenshot" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#27272a;">
          <div style="font-size:36px;">⬛</div>
          <p style="font-size:13px;margin-top:10px;">Waiting for screenshot…</p>
          <p style="color:var(--muted);font-size:11px;margin-top:5px;">Bot is starting up</p>
        </div>
        <img id="screenshot" src="/api/bot/stream" style="display:none;" alt="Bot view" />
      </div>
    </div>
  </div>

  <!-- Sidebar -->
  <div class="sidebar">
    <!-- Status -->
    <div class="panel panel-section active" id="tab-status">
      <div class="panel-title">Status</div>
      <div class="stats-grid">
        <div class="stat-row">
          <span class="stat-label">State</span>
          <span class="stat-value" id="s-state"><span class="badge badge-starting">STARTING</span></span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Uptime</span>
          <span class="stat-value" id="s-uptime">—</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Keep-alives</span>
          <span class="stat-value" id="s-ka">—</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Last action</span>
          <span class="stat-value" id="s-action" style="white-space:normal;">—</span>
        </div>
        <div class="stat-row" style="grid-column:1/-1;">
          <span class="stat-label">URL</span>
          <span class="stat-value url-val" id="s-url" title="">—</span>
        </div>
        <div class="stat-row" id="error-row" style="display:none;grid-column:1/-1;">
          <span class="stat-label" style="color:#b91c1c;">Error</span>
          <span class="stat-value" id="s-error" style="color:var(--red);white-space:normal;">—</span>
        </div>
      </div>
    </div>

    <!-- Logs -->
    <div class="logs-pane panel-section active" id="tab-logs">
      <div class="logs-header">
        <span>Logs</span>
        <span id="log-count">—</span>
      </div>
      <div id="log-list"></div>
    </div>

    <!-- Network -->
    <div class="network-pane panel-section" id="tab-network">
      <div class="network-header">
        <span>Network / Redirects</span>
        <span id="net-count">—</span>
      </div>
      <div id="net-list"></div>
    </div>
  </div>
</main>

<footer>
  <span>AFK Bot • vektalnodes.in/earn</span>
  <span id="last-update">Never updated</span>
</footer>

<script>
  // ── Tab switching (mobile only) ─────────────────────────────
  const TABS = ['preview','status','logs','network'];
  function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach((b, i) => {
      b.classList.toggle('active', TABS[i] === tab);
    });
    TABS.forEach(t => {
      const el = document.getElementById('tab-' + t);
      if (el) el.classList.toggle('active', t === tab);
    });
  }

  // ── MJPEG stream visibility ──────────────────────────────────
  const streamImg = document.getElementById('screenshot');
  const noScreenshot = document.getElementById('no-screenshot');
  const streamBadge = document.getElementById('stream-badge');
  let streamShown = false;

  function showStream() {
    if (streamShown) return;
    streamShown = true;
    noScreenshot.style.display = 'none';
    streamImg.style.display = '';
    streamBadge.textContent = '● LIVE';
    streamBadge.style.color = 'var(--green)';
    // capture dimensions once visible
    requestAnimationFrame(() => {
      if (streamImg.naturalWidth > 0) {
        document.getElementById('img-size').textContent =
          streamImg.naturalWidth + '×' + streamImg.naturalHeight;
      }
    });
  }

  // When the browser receives the first frame it fires 'load'
  streamImg.addEventListener('load', showStream);

  // ── Helpers ─────────────────────────────────────────────────
  function fmtUptime(s) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return h + 'h ' + m + 'm';
    if (m > 0) return m + 'm ' + sec + 's';
    return sec + 's';
  }

  // Clock
  setInterval(() => {
    document.getElementById('clock').textContent = new Date().toLocaleTimeString();
  }, 1000);

  // ── Status — every 600ms ──────────────────────────────────────
  const stateLabels = {
    running: '● RUNNING', 'logged-in': '● LOGGED IN', starting: '◐ STARTING',
    'logging-in': '◐ LOGGING IN', retrying: '↺ RETRYING', 're-login': '↺ RE-LOGIN',
    error: '✕ ERROR', stopped: '■ STOPPED', unknown: '? UNKNOWN',
  };

  async function refreshStatus() {
    try {
      const r = await fetch('/api/bot/status');
      if (!r.ok) return;
      const d = await r.json();
      const state = (d.state || 'unknown').toLowerCase();
      const label = stateLabels[state] || state.toUpperCase();
      const cls = 'badge badge-' + state.replace(/[^a-z-]/g, '');
      document.getElementById('s-state').innerHTML = '<span class="' + cls + '">' + label + '</span>';
      document.getElementById('pulse-dot').className = 'pulse-dot ' + state;
      document.getElementById('s-url').textContent = d.currentUrl || '—';
      document.getElementById('s-url').title = d.currentUrl || '';
      document.getElementById('s-action').textContent = d.lastAction || '—';
      document.getElementById('s-uptime').textContent = d.uptime != null ? fmtUptime(d.uptime) : '—';
      document.getElementById('s-ka').textContent = d.keepAliveCount != null ? d.keepAliveCount : '—';
      const errRow = document.getElementById('error-row');
      if (d.lastError) {
        errRow.style.display = '';
        document.getElementById('s-error').textContent = d.lastError;
      } else {
        errRow.style.display = 'none';
      }
      document.getElementById('last-update').textContent = new Date().toLocaleTimeString();
    } catch (_) {}
  }
  setInterval(refreshStatus, 600);
  refreshStatus();

  // ── Logs — every 1200ms ───────────────────────────────────────
  async function refreshLogs() {
    try {
      const r = await fetch('/api/bot/logs');
      if (!r.ok) return;
      const logs = await r.json();
      const lines = logs.slice(-40).reverse();
      document.getElementById('log-count').textContent = logs.length + ' lines';
      document.getElementById('log-list').innerHTML = lines.map((line, i) => {
        const isErr  = /error|Error|failed|Failed/i.test(line);
        const isOk   = /success|successful|✓|Login success/i.test(line);
        const isWarn = /warn|Warn|retry|Retry|session|Session/i.test(line);
        const cls    = isErr ? 'error' : isOk ? 'success' : isWarn ? 'warn' : i < 3 ? 'fresh' : '';
        return '<div class="log-line ' + cls + '">' + line.replace(/</g,'&lt;') + '</div>';
      }).join('');
    } catch (_) {}
  }
  setInterval(refreshLogs, 1200);
  refreshLogs();

  // ── Network log — every 2000ms ────────────────────────────────
  function esc(s) { return String(s || '').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function renderNetEvent(ev) {
    const type = ev.type || 'unknown';
    const typeClass = 'net-type-' + type.replace(/[^a-z-]/g,'');
    let html = '<div class="net-event">';
    html += '<span class="net-type ' + typeClass + '">' + esc(type.toUpperCase()) + '</span>';
    html += '<span style="color:#3f3f46;font-size:8px;">' + esc((ev.ts||'').slice(11,19)) + '</span>';

    if (ev.type === 'scan') {
      html += '<br><span style="color:#71717a;">Found ' + (ev.elementsFound||0) + ' elements on ' + esc(ev.pageUrl) + '</span>';
      if (ev.elements && ev.elements.length) {
        html += '<br>' + ev.elements.slice(0,5).map(e =>
          '<span style="color:#3f3f46;">  · ' + esc(e.tag) + ' ' + esc(e.text || e.href || '') + '</span>'
        ).join('<br>');
        if (ev.elements.length > 5) html += '<br><span style="color:#3f3f46;">  … +' + (ev.elements.length-5) + ' more</span>';
      }
    } else if (ev.type === 'navigation') {
      html += '<br><span class="net-url">' + esc(ev.url) + '</span>';
    } else if (ev.type === 'request') {
      html += '<span style="color:#52525b;"> ' + esc(ev.method) + '</span>';
      html += '<br><span class="net-url">' + esc(ev.url) + '</span>';
    } else if (ev.type === 'response') {
      const statusColor = ev.status >= 400 ? '#ef4444' : ev.isRedirect ? '#f59e0b' : '#22c55e';
      html += '<span style="color:' + statusColor + ';"> ' + esc(ev.status) + '</span>';
      html += '<br><span class="net-url">' + esc(ev.url) + '</span>';
      if (ev.redirectTo) html += '<br><span class="net-redirect">→ ' + esc(ev.redirectTo) + '</span>';
      if (ev.headers && ev.headers['set-cookie']) html += '<br><span class="net-cookie">🍪 set-cookie: ' + esc(ev.headers['set-cookie']).slice(0,80) + '</span>';
      if (ev.body) html += '<br><span class="net-body">' + esc(ev.body.slice(0,200)) + '</span>';
    } else if (ev.type === 'click-start') {
      html += '<br><span style="color:#a1a1aa;">Clicking: ' + esc(ev.text) + '</span>';
      html += '<br><span class="net-url">' + esc(ev.href) + '</span>';
    } else if (ev.type === 'click-result') {
      html += '<br><span class="net-url">' + esc(ev.startUrl) + '</span>';
      if (ev.finalUrl !== ev.startUrl) html += '<br><span class="net-redirect">→ ' + esc(ev.finalUrl) + '</span>';
      if (ev.sensitiveCookies && ev.sensitiveCookies.length) {
        html += '<br><span class="net-cookie">🍪 ' + ev.sensitiveCookies.map(c => esc(c.name)).join(', ') + '</span>';
      }
    } else if (ev.type === 'external-link') {
      html += '<br><span class="net-url">' + esc(ev.href) + '</span>';
      if (ev.text) html += ' <span style="color:#52525b;">' + esc(ev.text) + '</span>';
    } else if (ev.type === 'click-error') {
      html += '<br><span style="color:#ef4444;">' + esc(ev.error) + '</span>';
    }

    // Token hints — the most important data
    const hints = ev.tokenHints || [];
    if (hints.length) {
      html += '<br>' + [...new Set(hints.map(h => h.type))].map(t =>
        '<span class="net-token">⚑ ' + esc(t) + '</span>'
      ).join(' ');
    }

    html += '</div>';
    return html;
  }

  async function refreshNetworkLog() {
    try {
      const r = await fetch('/api/bot/network-log');
      if (!r.ok) return;
      const events = await r.json();
      document.getElementById('net-count').textContent = events.length + ' events';
      const latest = events.slice(-60).reverse();
      document.getElementById('net-list').innerHTML = latest.map(renderNetEvent).join('');
    } catch (_) {}
  }
  setInterval(refreshNetworkLog, 2000);
  refreshNetworkLog();
</script>
</body>
</html>`);
});

export default router;
