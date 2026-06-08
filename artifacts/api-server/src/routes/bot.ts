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
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bot Dashboard — vektalnodes.in</title>
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      background: #0a0a0f;
      color: #d4d4d8;
      font-family: 'Courier New', monospace;
      height: 100dvh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    header {
      padding: 10px 18px;
      background: #111118;
      border-bottom: 1px solid #1e1e2e;
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }

    .pulse-dot {
      width: 9px; height: 9px;
      border-radius: 50%;
      background: #22c55e;
      flex-shrink: 0;
    }
    .pulse-dot.running  { animation: pulse 1.8s ease-in-out infinite; }
    .pulse-dot.error    { background: #ef4444; }
    .pulse-dot.starting { background: #f59e0b; animation: pulse 1s ease-in-out infinite; }
    .pulse-dot.stopped  { background: #52525b; }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%       { opacity: 0.35; transform: scale(0.85); }
    }

    .header-title { font-size: 13px; font-weight: bold; color: #e4e4e7; letter-spacing: 0.04em; }
    .header-url   { font-size: 11px; color: #52525b; margin-left: 4px; }
    .header-right { margin-left: auto; display: flex; align-items: center; gap: 16px; }
    .refresh-badge {
      font-size: 10px; color: #3b82f6;
      background: #1e3a5f;
      padding: 2px 8px; border-radius: 10px;
    }
    #clock { font-size: 11px; color: #3f3f46; }

    main {
      flex: 1;
      display: flex;
      overflow: hidden;
      min-height: 0;
    }

    /* ── Preview pane ── */
    .preview-pane {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: #05050a;
      border-right: 1px solid #1e1e2e;
      overflow: hidden;
      min-width: 0;
    }

    .preview-toolbar {
      padding: 6px 14px;
      background: #111118;
      border-bottom: 1px solid #1e1e2e;
      font-size: 10px;
      color: #3f3f46;
      display: flex;
      gap: 12px;
      align-items: center;
      flex-shrink: 0;
    }
    .preview-toolbar span { color: #52525b; }
    #live-fps { color: #22c55e; font-weight: bold; }

    .screenshot-wrap {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      padding: 12px;
    }

    #screenshot {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border-radius: 6px;
      border: 1px solid #1e1e2e;
      box-shadow: 0 0 40px rgba(0,0,0,0.8);
      transition: opacity 0.08s;
    }

    #no-screenshot {
      text-align: center;
      color: #27272a;
    }
    #no-screenshot p { font-size: 12px; margin-top: 8px; }

    /* ── Sidebar ── */
    .sidebar {
      width: 300px;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: #0d0d15;
    }

    .panel {
      border-bottom: 1px solid #1e1e2e;
      padding: 14px 16px;
      flex-shrink: 0;
    }

    .panel-title {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: #3f3f46;
      margin-bottom: 12px;
    }

    .stat-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 9px;
      gap: 8px;
      font-size: 11px;
    }
    .stat-label { color: #52525b; flex-shrink: 0; }
    .stat-value {
      color: #a1a1aa;
      text-align: right;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 170px;
      font-size: 11px;
    }
    .stat-value.url-val { font-size: 10px; color: #3b82f6; }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2px 8px;
      border-radius: 20px;
      font-size: 10px;
      font-weight: bold;
      letter-spacing: 0.05em;
    }
    .badge-running  { background: #052e16; color: #22c55e; border: 1px solid #166534; }
    .badge-error    { background: #2d0a0a; color: #ef4444; border: 1px solid #7f1d1d; }
    .badge-starting, .badge-logging-in, .badge-re-login {
      background: #1c1300; color: #f59e0b; border: 1px solid #78350f;
    }
    .badge-stopped, .badge-unknown {
      background: #18181b; color: #52525b; border: 1px solid #27272a;
    }
    .badge-retrying { background: #1c0f2e; color: #a78bfa; border: 1px solid #4c1d95; }

    /* ── Logs pane ── */
    .logs-pane {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-height: 0;
    }

    .logs-header {
      padding: 10px 16px 6px;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: #3f3f46;
      border-bottom: 1px solid #1a1a26;
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
    }
    #log-list::-webkit-scrollbar { width: 4px; }
    #log-list::-webkit-scrollbar-track { background: transparent; }
    #log-list::-webkit-scrollbar-thumb { background: #27272a; border-radius: 2px; }

    .log-line {
      padding: 3px 16px;
      font-size: 9.5px;
      line-height: 1.4;
      border-bottom: 1px solid #0f0f18;
      word-break: break-all;
      color: #3f3f46;
    }
    .log-line.fresh   { color: #71717a; }
    .log-line.success { color: #16a34a; }
    .log-line.warn    { color: #b45309; }
    .log-line.error   { color: #b91c1c; }

    footer {
      padding: 5px 16px;
      background: #111118;
      border-top: 1px solid #1e1e2e;
      font-size: 9px;
      color: #27272a;
      display: flex;
      justify-content: space-between;
      flex-shrink: 0;
    }
  </style>
</head>
<body>

<header>
  <div class="pulse-dot starting" id="pulse-dot"></div>
  <span class="header-title">Bot Dashboard</span>
  <span class="header-url">vektalnodes.in/earn</span>
  <div class="header-right">
    <span class="refresh-badge">⚡ 100ms refresh</span>
    <span id="clock">—</span>
  </div>
</header>

<main>
  <div class="preview-pane">
    <div class="preview-toolbar">
      <span>LIVE PREVIEW</span>
      <span id="live-fps">— fps</span>
      <span id="img-size" style="margin-left:auto;">—</span>
    </div>
    <div class="screenshot-wrap">
      <div id="no-screenshot">
        <div style="font-size:28px;color:#1e1e2e;">⬛</div>
        <p>Waiting for screenshot…</p>
        <p style="color:#3f3f46;font-size:10px;margin-top:4px;">Bot is starting up</p>
      </div>
      <img id="screenshot" style="display:none;" alt="Bot view" />
    </div>
  </div>

  <div class="sidebar">
    <div class="panel">
      <div class="panel-title">Status</div>
      <div class="stat-row">
        <span class="stat-label">State</span>
        <span class="stat-value" id="s-state"><span class="badge badge-starting">STARTING</span></span>
      </div>
      <div class="stat-row">
        <span class="stat-label">URL</span>
        <span class="stat-value url-val" id="s-url" title="">—</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Last action</span>
        <span class="stat-value" id="s-action" style="white-space:normal;font-size:10px;">—</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Uptime</span>
        <span class="stat-value" id="s-uptime">—</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Keep-alives</span>
        <span class="stat-value" id="s-ka">—</span>
      </div>
      <div class="stat-row" id="error-row" style="display:none;">
        <span class="stat-label" style="color:#b91c1c;">Error</span>
        <span class="stat-value" id="s-error" style="color:#ef4444;white-space:normal;font-size:10px;">—</span>
      </div>
    </div>

    <div class="logs-pane">
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
  let frameCount = 0;
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

  // ── Screenshot — every 100ms ───────────────────────────────────────────────
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
        document.getElementById('img-size').textContent = Math.round(tmp.width) + '×' + Math.round(tmp.height);
        fpsFrames = 0;
        lastFpsTs = now;
      }
    };
    tmp.onerror = () => {};
    tmp.src = '/api/bot/screenshot?t=' + ts;
  }
  setInterval(refreshScreenshot, 100);

  // ── Status — every 600ms ──────────────────────────────────────────────────
  async function refreshStatus() {
    try {
      const r = await fetch('/api/bot/status');
      if (!r.ok) return;
      const d = await r.json();
      const state = (d.state || 'unknown').toLowerCase();

      // Badge
      const stateLabels = {
        running: '● RUNNING', 'logged-in': '● LOGGED IN', starting: '◐ STARTING',
        'logging-in': '◐ LOGGING IN', retrying: '↺ RETRYING', 're-login': '↺ RE-LOGIN',
        error: '✕ ERROR', stopped: '■ STOPPED', unknown: '? UNKNOWN',
      };
      const label = stateLabels[state] || state.toUpperCase();
      const badgeClass = 'badge badge-' + (state.replace(/-/g, '-') || 'unknown');
      document.getElementById('s-state').innerHTML =
        '<span class="' + badgeClass + '">' + label + '</span>';

      // Pulse dot colour
      const dot = document.getElementById('pulse-dot');
      dot.className = 'pulse-dot ' + state;

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

      document.getElementById('last-update').textContent = 'Updated ' + new Date().toLocaleTimeString();
    } catch (_) {}
  }
  setInterval(refreshStatus, 600);
  refreshStatus();

  // ── Logs — every 1200ms ───────────────────────────────────────────────────
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
        return '<div class="log-line ' + cls + '">' +
          line.replace(/</g,'&lt;').replace(/>/g,'&gt;') +
          '</div>';
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
