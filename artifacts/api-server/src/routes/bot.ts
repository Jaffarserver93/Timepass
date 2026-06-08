import { Router, type IRouter } from "express";
import fs from "fs";

const router: IRouter = Router();

const SCREENSHOT_FILE = "/tmp/bot-screenshot.png";
const STATUS_FILE = "/tmp/bot-status.json";
const LOGS_FILE = "/tmp/bot-logs.json";

function readJsonFile(path: string, fallback: unknown): unknown {
  try {
    return JSON.parse(fs.readFileSync(path, "utf-8"));
  } catch {
    return fallback;
  }
}

// ── Screenshot endpoint ───────────────────────────────────────────────────────
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
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      padding: 10px;
    }
    @media (max-width: 768px) {
      .screenshot-wrap { padding: 8px; min-height: 200px; max-height: 52vw; }
    }

    #screenshot {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border-radius: 5px;
      border: 1px solid var(--border);
      box-shadow: 0 0 30px rgba(0,0,0,0.8);
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

    /* ── Mobile panel visibility controlled by tabs ── */
    @media (max-width: 768px) {
      .panel-section { display: none; }
      .panel-section.active { display: block; }
      .preview-pane { display: none; }
      .preview-pane.active { display: flex; }
      .logs-pane { display: none; }
      .logs-pane.active { display: flex; }
    }
  </style>
</head>
<body>

<header>
  <div class="pulse-dot starting" id="pulse-dot"></div>
  <span class="header-title">Bot Dashboard</span>
  <span class="header-url">vektalnodes.in/earn</span>
  <div class="header-right">
    <span class="refresh-badge">⚡ 100ms</span>
    <span id="clock">—</span>
  </div>
</header>

<div class="tab-bar">
  <button class="tab-btn active" onclick="switchTab('preview')">📺 Preview</button>
  <button class="tab-btn" onclick="switchTab('status')">📊 Status</button>
  <button class="tab-btn" onclick="switchTab('logs')">📋 Logs</button>
</div>

<main>
  <!-- Preview -->
  <div class="preview-pane active" id="tab-preview">
    <div class="preview-toolbar">
      <span>LIVE PREVIEW</span>
      <span id="live-fps">— fps</span>
      <span id="img-size" style="margin-left:auto;">—</span>
    </div>
    <div class="screenshot-wrap">
      <div id="no-screenshot">
        <div style="font-size:28px;color:#1e1e2e;">⬛</div>
        <p>Waiting for screenshot…</p>
        <p style="color:var(--muted);font-size:10px;margin-top:4px;">Bot is starting up</p>
      </div>
      <img id="screenshot" style="display:none;" alt="Bot view" />
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
  </div>
</main>

<footer>
  <span>AFK Bot • vektalnodes.in/earn</span>
  <span id="last-update">Never updated</span>
</footer>

<script>
  // ── Tab switching (mobile only) ─────────────────────────────
  function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach((b, i) => {
      b.classList.toggle('active', ['preview','status','logs'][i] === tab);
    });
    document.getElementById('tab-preview').classList.toggle('active', tab === 'preview');
    document.getElementById('tab-status').classList.toggle('active', tab === 'status');
    document.getElementById('tab-logs').classList.toggle('active', tab === 'logs');
  }

  // ── Helpers ─────────────────────────────────────────────────
  let fpsFrames = 0;
  let lastFpsTs = Date.now();
  let firstScreenshot = false;

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

  // ── Screenshot — every 100ms ──────────────────────────────────
  function refreshScreenshot() {
    const ts = Date.now();
    const tmp = new Image();
    tmp.onload = () => {
      const el = document.getElementById('screenshot');
      el.src = tmp.src;
      if (!firstScreenshot) {
        firstScreenshot = true;
        document.getElementById('no-screenshot').style.display = 'none';
        el.style.display = '';
      }
      fpsFrames++;
      const now = Date.now();
      if (now - lastFpsTs >= 1000) {
        const fps = Math.round(fpsFrames * 1000 / (now - lastFpsTs));
        document.getElementById('live-fps').textContent = fps + ' fps';
        document.getElementById('img-size').textContent = tmp.naturalWidth + '×' + tmp.naturalHeight;
        fpsFrames = 0;
        lastFpsTs = now;
      }
    };
    tmp.src = '/api/bot/screenshot?t=' + ts;
  }
  setInterval(refreshScreenshot, 100);

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
</script>
</body>
</html>`);
});

export default router;
