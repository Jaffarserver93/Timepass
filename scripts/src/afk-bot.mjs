/**
 * AFK Bot for vektalnodes.in/earn
 * Uses puppeteer-real-browser with Chromium/Chrome to avoid detection.
 * Credentials are read from EMAIL and PASSWORD environment variables.
 * Saves screenshots + status to /tmp/ so the API dashboard can display them.
 *
 * Network recording: intercepts every request/response after page link clicks,
 * capturing redirects, tokens in URLs/headers, and session cookies.
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
const LINK_CLICK_INTERVAL_MS = 60_000; // click links every 60s

const SCREENSHOT_FILE   = "/tmp/bot-screenshot.png";
const STATUS_FILE       = "/tmp/bot-status.json";
const LOGS_FILE         = "/tmp/bot-logs.json";
const NETWORK_LOG_FILE  = "/tmp/bot-network-log.json";

// ── Shared state ──────────────────────────────────────────────────────────────
let currentPage = null;
let keepAliveCount = 0;
const startTime = Date.now();
const recentLogs = [];

// Network events ring-buffer (last 200 events)
const networkEvents = [];
function pushNetworkEvent(event) {
  networkEvents.push(event);
  if (networkEvents.length > 200) networkEvents.shift();
  try { fs.writeFileSync(NETWORK_LOG_FILE, JSON.stringify(networkEvents)); } catch (_) {}
}

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

// Detect interesting tokens/sessions in a URL or value string
function extractTokenHints(str) {
  if (!str) return [];
  const hints = [];
  const patterns = [
    { name: "token",   re: /[?&](token|access_token|id_token|auth_token|jwt)=([^&\s]+)/gi },
    { name: "session", re: /[?&](session|session_id|sid|ssid)=([^&\s]+)/gi },
    { name: "code",    re: /[?&](code|oauth_code|auth_code)=([^&\s]+)/gi },
    { name: "key",     re: /[?&](api_key|apikey|key)=([^&\s]+)/gi },
    { name: "Bearer",  re: /Bearer\s+([A-Za-z0-9\-_.]+)/gi },
  ];
  for (const { name, re } of patterns) {
    let m;
    while ((m = re.exec(str)) !== null) {
      hints.push({ type: name, value: m[m.length - 1] });
    }
  }
  return hints;
}

// Scrape interesting response/request headers (auth, set-cookie, location, etc.)
function pickHeaders(headers) {
  if (!headers) return {};
  const interesting = [
    "authorization", "set-cookie", "cookie", "location",
    "x-auth-token", "x-access-token", "x-session-token",
    "x-token", "x-api-key",
  ];
  const out = {};
  for (const key of interesting) {
    if (headers[key]) out[key] = headers[key];
  }
  return out;
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
function findChromiumPath() {
  const candidates = [
    "google-chrome-stable", "google-chrome",
    "chromium",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "chromium-browser",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
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

  const hasDisplay = !!process.env.DISPLAY;
  if (!hasDisplay) {
    log("No DISPLAY set — puppeteer-real-browser will manage Xvfb");
  } else {
    log(`Using existing display: ${process.env.DISPLAY}`);
  }

  const { browser, page } = await connect({
    headless: true,
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

// ── Network interception ──────────────────────────────────────────────────────
function attachNetworkRecorder(page) {
  // Intercept requests
  page.on("request", (req) => {
    try {
      const url = req.url();
      const method = req.method();
      const headers = req.headers() || {};
      const tokenHints = extractTokenHints(url);
      const interestingHeaders = pickHeaders(headers);

      // Only record if there's something worth noting, or it's a navigation
      const isNavigation = req.isNavigationRequest?.() ?? false;
      const hasTokens = tokenHints.length > 0;
      const hasAuthHeader = !!interestingHeaders.authorization || !!interestingHeaders["x-auth-token"];
      const hasCookie = !!interestingHeaders.cookie;

      if (isNavigation || hasTokens || hasAuthHeader) {
        pushNetworkEvent({
          type: "request",
          ts: new Date().toISOString(),
          method,
          url,
          isNavigation,
          tokenHints,
          headers: interestingHeaders,
        });
        log(`[NET] ${method} ${url}${tokenHints.length ? ` ⚑ ${tokenHints.map(t => t.type).join(", ")}` : ""}`);
      }
    } catch (_) {}
  });

  // Intercept responses
  page.on("response", async (res) => {
    try {
      const url = res.url();
      const status = res.status();
      const headers = res.headers() || {};
      const tokenHints = extractTokenHints(url);
      const interestingHeaders = pickHeaders(headers);

      const isRedirect = status >= 300 && status < 400;
      const hasSetCookie = !!interestingHeaders["set-cookie"];
      const hasLocation = !!interestingHeaders.location;
      const hasAuthHeader = !!interestingHeaders["x-auth-token"] || !!interestingHeaders["x-access-token"];

      // For redirects, also check the Location header for tokens
      if (hasLocation) {
        const locHints = extractTokenHints(interestingHeaders.location);
        tokenHints.push(...locHints);
      }

      if (isRedirect || hasSetCookie || hasLocation || tokenHints.length > 0 || hasAuthHeader) {
        const event = {
          type: "response",
          ts: new Date().toISOString(),
          status,
          url,
          isRedirect,
          redirectTo: interestingHeaders.location || null,
          tokenHints,
          headers: interestingHeaders,
        };

        // For small JSON responses on auth endpoints, try to capture body
        const contentType = headers["content-type"] || "";
        if (
          contentType.includes("application/json") &&
          (url.includes("login") || url.includes("auth") || url.includes("token") || url.includes("session"))
        ) {
          try {
            const body = await res.text();
            if (body.length < 4096) {
              event.body = body;
              // Extract tokens from body too
              const bodyHints = extractTokenHints(body);
              // Also look for common token field names in JSON
              try {
                const json = JSON.parse(body);
                for (const key of ["token", "access_token", "id_token", "refresh_token", "session", "jwt", "auth"]) {
                  if (json[key]) bodyHints.push({ type: key, value: String(json[key]) });
                }
              } catch (_) {}
              event.tokenHints.push(...bodyHints);
            }
          } catch (_) {}
        }

        pushNetworkEvent(event);
        log(`[NET] ${status} ${url}${isRedirect ? ` → ${interestingHeaders.location}` : ""}${tokenHints.length ? ` ⚑ ${[...new Set(tokenHints.map(t => t.type))].join(", ")}` : ""}`);
      }
    } catch (_) {}
  });

  // Track frame navigations (catches JS-based redirects too)
  page.on("framenavigated", (frame) => {
    try {
      if (frame !== page.mainFrame()) return;
      const url = frame.url();
      const tokenHints = extractTokenHints(url);
      pushNetworkEvent({
        type: "navigation",
        ts: new Date().toISOString(),
        url,
        tokenHints,
      });
      log(`[NAV] → ${url}${tokenHints.length ? ` ⚑ ${tokenHints.map(t => t.type).join(", ")}` : ""}`);
      updateStatus({ currentUrl: url });
    } catch (_) {}
  });
}

// ── Login ─────────────────────────────────────────────────────────────────────
async function doLogin(page) {
  log("Navigating to login page…");
  updateStatus({ state: "logging-in", lastAction: "Navigating to login page" });
  await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 60_000 });
  await sleep(2_000);

  log("Looking for email + password fields…");

  const emailSelectors = [
    'input[type="email"]', 'input[name="email"]',
    'input[id="email"]', 'input[placeholder*="email" i]',
  ];
  const passwordSelectors = [
    'input[type="password"]', 'input[name="password"]',
    'input[id="password"]', 'input[placeholder*="password" i]',
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

// ── Click the Open LinkPays button and record everything ─────────────────────
async function clickLinksOnPage(page) {
  try {
    // Make sure we're on the earn page before scanning
    const pageUrl = page.url();
    if (!pageUrl.includes("vektalnodes.in/earn")) {
      log("[LINKPAYS] Not on earn page, navigating there first…");
      const ok = await navigateToEarn(page);
      if (!ok) return;
    }

    log("[LINKPAYS] Scanning earn page for Open LinkPays button…");
    updateStatus({ lastAction: "Looking for Open LinkPays button…" });

    // Find the "Open LinkPays" submit button specifically
    const linkPaysSelectors = [
      'button.button.button-primary[type="submit"]',
      'button.button-primary[type="submit"]',
      'button[type="submit"]',
    ];

    let btnFound = false;
    for (const sel of linkPaysSelectors) {
      try {
        const btns = await page.$$(sel);
        for (const btn of btns) {
          const text = await btn.evaluate(el => (el.innerText || el.textContent || "").trim());
          if (/open.*linkpays|linkpays/i.test(text)) {
            log(`[LINKPAYS] Found button: "${text}" via selector ${sel}`);
            btnFound = true;

            // Scroll button into view
            await btn.evaluate(el => el.scrollIntoView({ behavior: "smooth", block: "center" }));
            await sleep(800);

            // Record click start + capture all cookies before
            const cookiesBefore = await page.cookies();
            const sessionBefore = cookiesBefore.filter(c =>
              /token|session|auth|jwt|sid/i.test(c.name)
            ).map(c => ({ name: c.name, value: c.value.slice(0, 40) + "…", domain: c.domain, httpOnly: c.httpOnly }));

            pushNetworkEvent({
              type: "click-start",
              ts: new Date().toISOString(),
              href: "",
              text,
              pageUrl: page.url(),
              sessionBefore,
            });
            log(`[LINKPAYS] Clicking "${text}"…`);
            updateStatus({ lastAction: `Clicking "${text}"…` });

            // Listen for new pages (popups/new tabs) that the button might open
            const browser = page.browser();
            let newPageOpened = null;
            const newPagePromise = new Promise((resolve) => {
              browser.once("targetcreated", async (target) => {
                if (target.type() === "page") {
                  resolve(await target.page());
                }
              });
              // Timeout: if no new tab opens within 10s, resolve with null
              setTimeout(() => resolve(null), 10_000);
            });

            // Click the button
            await btn.click();
            await sleep(1_500);

            // Check if a new tab opened
            newPageOpened = await newPagePromise;

            if (newPageOpened) {
              // New tab was opened — attach recorder and capture everything
              attachNetworkRecorder(newPageOpened);
              log("[LINKPAYS] New tab opened, waiting for page to load…");
              updateStatus({ lastAction: "LinkPays tab opened, recording…" });

              await newPageOpened.waitForNavigation({ waitUntil: "networkidle2", timeout: 30_000 }).catch(() => {});
              await sleep(2_000);

              const finalUrl = newPageOpened.url();
              const tokenHints = extractTokenHints(finalUrl);
              const newCookies = await newPageOpened.cookies().catch(() => []);
              const sensitiveCookies = newCookies.filter(c =>
                /token|session|auth|jwt|sid/i.test(c.name)
              ).map(c => ({ name: c.name, domain: c.domain, httpOnly: c.httpOnly, secure: c.secure }));

              // Capture full page URL history via navigation events
              const pageContent = await newPageOpened.evaluate(() => document.title).catch(() => "");

              pushNetworkEvent({
                type: "click-result",
                ts: new Date().toISOString(),
                startUrl: page.url(),
                finalUrl,
                pageTitle: pageContent,
                tokenHints,
                sensitiveCookies,
                openedNewTab: true,
              });

              log(`[LINKPAYS] LinkPays tab final URL: ${finalUrl}${tokenHints.length ? ` ⚑ ${tokenHints.map(t => t.type).join(", ")}` : ""}`);
              if (sensitiveCookies.length) {
                log(`[LINKPAYS] Session cookies in new tab: ${sensitiveCookies.map(c => c.name).join(", ")}`);
              }

              // Keep the new tab open for 10s to capture async redirects
              await sleep(10_000);
              const laterUrl = newPageOpened.url();
              if (laterUrl !== finalUrl) {
                const laterHints = extractTokenHints(laterUrl);
                pushNetworkEvent({
                  type: "navigation",
                  ts: new Date().toISOString(),
                  url: laterUrl,
                  tokenHints: laterHints,
                  note: "post-load redirect",
                });
                log(`[LINKPAYS] Late redirect → ${laterUrl}`);
              }

              try { await newPageOpened.close(); } catch (_) {}
            } else {
              // No new tab — the click may have changed the current page
              const afterUrl = page.url();
              const tokenHints = extractTokenHints(afterUrl);
              const cookiesAfter = await page.cookies();
              const sensitiveCookies = cookiesAfter.filter(c =>
                /token|session|auth|jwt|sid/i.test(c.name)
              ).map(c => ({ name: c.name, domain: c.domain, httpOnly: c.httpOnly, secure: c.secure }));

              pushNetworkEvent({
                type: "click-result",
                ts: new Date().toISOString(),
                startUrl: pageUrl,
                finalUrl: afterUrl,
                tokenHints,
                sensitiveCookies,
                openedNewTab: false,
              });
              log(`[LINKPAYS] Same-page result URL: ${afterUrl}`);

              // Navigate back to earn page if we left it
              if (!afterUrl.includes("vektalnodes.in/earn")) {
                await navigateToEarn(page);
              }
            }

            break; // only click the first matching button
          }
        }
        if (btnFound) break;
      } catch (err) {
        log(`[LINKPAYS] Selector ${sel} error: ${err.message}`);
      }
    }

    if (!btnFound) {
      log("[LINKPAYS] Open LinkPays button not found on page — will retry next cycle.");
      pushNetworkEvent({
        type: "scan",
        ts: new Date().toISOString(),
        pageUrl: page.url(),
        elementsFound: 0,
        note: "Open LinkPays button not found",
      });
    }
  } catch (err) {
    log(`[LINKPAYS] Outer error: ${err.message}`);
    pushNetworkEvent({ type: "click-error", ts: new Date().toISOString(), href: "", error: err.message });
  }
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

      await page.setViewport({ width: 1280, height: 720 });

      // Attach network recorder to main page before login
      attachNetworkRecorder(page);

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

      let lastLinkClickTime = 0;

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

        // Click page links every LINK_CLICK_INTERVAL_MS to record redirects/tokens
        const now = Date.now();
        if (now - lastLinkClickTime >= LINK_CLICK_INTERVAL_MS) {
          lastLinkClickTime = now;
          await clickLinksOnPage(page);
        }
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
