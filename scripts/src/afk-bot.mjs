/**
 * AFK Bot for vektalnodes.in/earn
 * Uses puppeteer-real-browser with Chromium/Chrome to avoid detection.
 * Credentials are read from EMAIL and PASSWORD environment variables.
 * Saves screenshots + status to /tmp/ so the API dashboard can display them.
 */

import { connect } from "puppeteer-real-browser";
import { execSync } from "child_process";
import fs from "fs";

// ── Config ────────────────────────────────────────────────────────────────────
const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD;
const TARGET_URL = "https://vektalnodes.in/earn";
const LOGIN_URL = "https://vektalnodes.in/login";

const KEEPALIVE_INTERVAL_MS = 30_000;
const RETRY_DELAY_MS = 15_000;
const MAX_RETRIES = 10;
const SCREENSHOT_INTERVAL_MS = 200;

const SCREENSHOT_FILE = "/tmp/bot-screenshot.png";
const STATUS_FILE = "/tmp/bot-status.json";
const LOGS_FILE = "/tmp/bot-logs.json";

// ── Shared state ──────────────────────────────────────────────────────────────
let currentPage = null;
let keepAliveCount = 0;
const startTime = Date.now();
const recentLogs = [];

let botStatus = {
  state: "starting",
  currentUrl: "",
  lastAction: "Starting…",
  lastActionTime: new Date().toISOString(),
  uptime: 0,
  keepAliveCount: 0,
  lastError: null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  recentLogs.push(line);
  if (recentLogs.length > 100) recentLogs.shift();
  try { fs.writeFileSync(LOGS_FILE, JSON.stringify(recentLogs)); } catch (_) {}
}

function updateStatus(patch) {
  Object.assign(botStatus, patch, {
    uptime: Math.floor((Date.now() - startTime) / 1000),
    keepAliveCount,
  });
  try { fs.writeFileSync(STATUS_FILE, JSON.stringify(botStatus)); } catch (_) {}
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Screenshot loop — runs independently of the main bot loop
setInterval(async () => {
  if (!currentPage) return;
  try {
    await currentPage.screenshot({ path: SCREENSHOT_FILE, type: "png" });
  } catch (_) {}
}, SCREENSHOT_INTERVAL_MS);

// Uptime ticker
setInterval(() => { updateStatus({}); }, 5_000);

// ── Browser launch ────────────────────────────────────────────────────────────

/**
 * Find the best available Chrome/Chromium binary.
 * Prefers google-chrome-stable (.deb install) over snap chromium-browser.
 * The snap wrapper at /usr/bin/chromium-browser does NOT properly forward
 * --remote-debugging-port, causing ECONNREFUSED. Always prefer a real .deb.
 */
function findChromiumPath() {
  const candidates = [
    // Real .deb Google Chrome — most reliable on Ubuntu
    "google-chrome-stable",
    "google-chrome",
    // Nix-store chromium (Replit)
    "chromium",
    // Debian/Ubuntu apt chromium (real .deb, not snap — Ubuntu <22.04)
    "/usr/bin/chromium",
    // Absolute paths for .deb Chrome
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    // Snap chromium — last resort (may cause ECONNREFUSED on Ubuntu ≥22.04)
    "chromium-browser",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    // Linux generic
    "/opt/google/chrome/google-chrome",
  ];

  for (const bin of candidates) {
    try {
      if (bin.startsWith("/")) {
        if (fs.existsSync(bin)) return bin;
      } else {
        const p = execSync(`which ${bin} 2>/dev/null`, { encoding: "utf8" }).trim();
        if (p) return p;
      }
    } catch (_) {}
  }

  // Last-resort: search nix store (Replit only)
  try {
    const p = execSync(
      "find /nix/store -name 'chromium' -type f 2>/dev/null | grep '/bin/chromium$' | head -1",
      { encoding: "utf8" }
    ).trim();
    if (p) return p;
  } catch (_) {}

  return null;
}

async function launchBrowser() {
  const chromePath = findChromiumPath();
  if (!chromePath) {
    throw new Error(
      "No Chrome/Chromium binary found.\n" +
      "Install google-chrome-stable: run start.sh or follow the README."
    );
  }
  log(`Using browser at: ${chromePath}`);

  // If DISPLAY is already set (e.g. start.sh exported it), reuse it.
  // Otherwise let puppeteer-real-browser spawn its own Xvfb.
  const hasDisplay = !!process.env.DISPLAY;
  if (!hasDisplay) {
    log("No DISPLAY set — puppeteer-real-browser will manage Xvfb");
  } else {
    log(`Using existing display: ${process.env.DISPLAY}`);
  }

  const { browser, page } = await connect({
    headless: true,
    // disableXvfb: true  → use the DISPLAY already exported by start.sh
    // disableXvfb: false → let puppeteer-real-browser spawn its own Xvfb
    disableXvfb: hasDisplay,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-site-isolation-trials",
      "--window-size=1280,800",
    ],
    executablePath: chromePath,
    customConfig: {},
    turnstile: true,
    connectOption: {},
  });

  return { browser, page };
}

// ── Login ─────────────────────────────────────────────────────────────────────
async function doLogin(page) {
  log("Navigating to login page…");
  updateStatus({ state: "logging-in", lastAction: "Navigating to login page" });
  await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 60_000 });
  await sleep(2_000);

  log("Looking for email + password fields…");

  const emailSelectors = [
    'input[type="email"]',
    'input[name="email"]',
    'input[id="email"]',
    'input[placeholder*="email" i]',
  ];
  const passwordSelectors = [
    'input[type="password"]',
    'input[name="password"]',
    'input[id="password"]',
    'input[placeholder*="password" i]',
  ];

  let emailInput = null;
  for (const sel of emailSelectors) {
    try { await page.waitForSelector(sel, { timeout: 3_000 }); emailInput = sel; break; } catch (_) {}
  }
  let passwordInput = null;
  for (const sel of passwordSelectors) {
    try { await page.waitForSelector(sel, { timeout: 3_000 }); passwordInput = sel; break; } catch (_) {}
  }

  if (!emailInput) throw new Error("Could not find email input on login page.");
  if (!passwordInput) throw new Error("Could not find password input on login page.");

  log(`Using selectors: ${emailInput}, ${passwordInput}`);
  updateStatus({ lastAction: "Typing credentials" });

  await page.click(emailInput, { clickCount: 3 });
  await page.type(emailInput, EMAIL, { delay: 80 });
  await sleep(500);
  await page.click(passwordInput, { clickCount: 3 });
  await page.type(passwordInput, PASSWORD, { delay: 80 });
  await sleep(500);

  const submitSelectors = ['button[type="submit"]', 'input[type="submit"]'];
  let submitted = false;
  for (const sel of submitSelectors) {
    try { await page.click(sel); submitted = true; log(`Clicked submit: ${sel}`); break; } catch (_) {}
  }
  if (!submitted) {
    await page.focus(passwordInput);
    await page.keyboard.press("Enter");
    log("Pressed Enter to submit.");
  }

  updateStatus({ lastAction: "Waiting for login redirect" });
  await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30_000 }).catch(() => {});
  await sleep(2_000);

  const currentUrl = page.url();
  log(`After login URL: ${currentUrl}`);
  updateStatus({ currentUrl });

  if (currentUrl.includes("login") || currentUrl.includes("signin")) {
    throw new Error("Still on login page — credentials may be wrong or CAPTCHA is blocking.");
  }

  log("Login successful!");
  updateStatus({ state: "logged-in", lastAction: "Login successful", lastError: null });
}

// ── Navigate to earn ──────────────────────────────────────────────────────────
async function navigateToEarn(page) {
  log("Navigating to earn page…");
  updateStatus({ lastAction: "Navigating to earn page" });
  await page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 60_000 });
  await sleep(3_000);
  const url = page.url();
  log(`Earn page URL: ${url}`);
  updateStatus({ currentUrl: url });

  if (url.includes("login") || url.includes("signin")) {
    log("Redirected to login — session expired.");
    return false;
  }
  return true;
}

// ── Keep-alive tick ───────────────────────────────────────────────────────────
async function keepAlive(page) {
  try {
    await page.evaluate(() => { window.scrollBy(0, 100); });
    await sleep(800);
    await page.evaluate(() => { window.scrollBy(0, -100); });

    const x = 200 + Math.floor(Math.random() * 600);
    const y = 200 + Math.floor(Math.random() * 400);
    await page.mouse.move(x, y, { steps: 10 });

    const claimSelectors = [
      '[class*="claim" i] button', '[class*="earn" i] button',
      '[class*="mine" i] button',  '[id*="claim" i]',
      'button[class*="claim" i]',  'button[class*="earn" i]',
    ];
    for (const sel of claimSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          const visible = await el.isIntersectingViewport().catch(() => false);
          if (visible) { await el.click(); log(`Clicked: ${sel}`); }
        }
      } catch (_) {}
    }

    keepAliveCount++;
    log(`Keep-alive tick #${keepAliveCount} ✓`);
    updateStatus({ state: "running", lastAction: `Keep-alive tick #${keepAliveCount}`, lastActionTime: new Date().toISOString() });
  } catch (err) {
    log(`Keep-alive error (non-fatal): ${err.message}`);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────
async function run() {
  if (!EMAIL || !PASSWORD) {
    console.error("ERROR: EMAIL and PASSWORD environment variables must be set.");
    process.exit(1);
  }

  log("=== Vektalnodes AFK Bot starting ===");
  log(`Target: ${TARGET_URL}`);
  updateStatus({ state: "starting", lastAction: "Bot initializing" });

  let retries = 0;

  while (retries < MAX_RETRIES) {
    let browser;
    try {
      const launched = await launchBrowser();
      browser = launched.browser;
      const page = launched.page;
      currentPage = page;

      await page.setViewport({ width: 1280, height: 800 });
      await doLogin(page);

      const onEarnPage = await navigateToEarn(page);
      if (!onEarnPage) {
        log("Could not reach earn page. Retrying…");
        updateStatus({ state: "retrying", lastAction: "Could not reach earn page" });
        currentPage = null;
        await browser.close();
        retries++;
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      log("=== Bot is now AFK on the earn page ===");
      updateStatus({ state: "running", lastAction: "AFK on earn page — keep-alive loop started" });
      retries = 0;

      while (true) {
        await sleep(KEEPALIVE_INTERVAL_MS);
        const url = page.url();
        if (url.includes("login") || url.includes("signin")) {
          log("Session expired — re-logging in…");
          updateStatus({ state: "re-login", lastAction: "Session expired, re-logging in" });
          await doLogin(page);
          const back = await navigateToEarn(page);
          if (!back) throw new Error("Could not re-navigate to earn page after re-login.");
        }
        await keepAlive(page);
      }
    } catch (err) {
      log(`Error: ${err.message}`);
      updateStatus({ state: "error", lastAction: `Error: ${err.message}`, lastError: err.message });
      retries++;
      log(`Retry ${retries}/${MAX_RETRIES} in ${RETRY_DELAY_MS / 1000}s…`);
      currentPage = null;
      if (browser) { try { await browser.close(); } catch (_) {} }
      if (retries >= MAX_RETRIES) {
        log("Max retries reached. Exiting.");
        updateStatus({ state: "stopped", lastAction: "Max retries reached" });
        process.exit(1);
      }
      await sleep(RETRY_DELAY_MS);
    }
  }
}

run();
