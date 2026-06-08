/**
 * AFK Bot for vektalnodes.in/earn
 * Uses puppeteer-real-browser with Chromium to avoid detection.
 * Credentials are read from EMAIL and PASSWORD environment variables.
 */

import { connect } from "puppeteer-real-browser";
import { execSync } from "child_process";

// ── Config ────────────────────────────────────────────────────────────────────
const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD;
const TARGET_URL = "https://vektalnodes.in/earn";
const LOGIN_URL = "https://vektalnodes.in/login";

// How often to do a keep-alive interaction (ms)
const KEEPALIVE_INTERVAL_MS = 30_000; // 30 seconds
// How long to wait before retrying after an error (ms)
const RETRY_DELAY_MS = 15_000;
// Max retries before giving up
const MAX_RETRIES = 10;

// ── Helpers ───────────────────────────────────────────────────────────────────
function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Find the Chromium binary installed by Nix */
function findChromiumPath() {
  try {
    const path = execSync("which chromium", { encoding: "utf8" }).trim();
    if (path) return path;
  } catch (_) {}
  // Fallback: find via nix store glob
  try {
    const path = execSync(
      "find /nix/store -name 'chromium' -type f 2>/dev/null | grep '/bin/chromium$' | head -1",
      { encoding: "utf8" }
    ).trim();
    if (path) return path;
  } catch (_) {}
  return null;
}

// ── Main bot logic ────────────────────────────────────────────────────────────
async function launchBrowser() {
  const chromePath = findChromiumPath();
  if (!chromePath) throw new Error("Chromium binary not found. Ensure chromium is installed.");
  log(`Using Chromium at: ${chromePath}`);

  const { browser, page } = await connect({
    headless: true,
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
      "--window-size=1280,800",
    ],
    executablePath: chromePath,
    customConfig: {},
    turnstile: true,
    connectOption: {},
    disableXvfb: false,
  });

  return { browser, page };
}

async function doLogin(page) {
  log("Navigating to login page…");
  await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 60_000 });
  await sleep(2_000);

  log("Looking for email + password fields…");

  // Try common selector patterns for email fields
  const emailSelectors = [
    'input[type="email"]',
    'input[name="email"]',
    'input[id="email"]',
    'input[placeholder*="email" i]',
    'input[placeholder*="Email" i]',
  ];
  const passwordSelectors = [
    'input[type="password"]',
    'input[name="password"]',
    'input[id="password"]',
    'input[placeholder*="password" i]',
    'input[placeholder*="Password" i]',
  ];

  let emailInput = null;
  for (const sel of emailSelectors) {
    try {
      await page.waitForSelector(sel, { timeout: 3_000 });
      emailInput = sel;
      break;
    } catch (_) {}
  }

  let passwordInput = null;
  for (const sel of passwordSelectors) {
    try {
      await page.waitForSelector(sel, { timeout: 3_000 });
      passwordInput = sel;
      break;
    } catch (_) {}
  }

  if (!emailInput) throw new Error("Could not find email input on login page.");
  if (!passwordInput) throw new Error("Could not find password input on login page.");

  log(`Using email selector: ${emailInput}, password selector: ${passwordInput}`);

  // Clear + type credentials with human-like delay
  await page.click(emailInput, { clickCount: 3 });
  await page.type(emailInput, EMAIL, { delay: 80 });
  await sleep(500);
  await page.click(passwordInput, { clickCount: 3 });
  await page.type(passwordInput, PASSWORD, { delay: 80 });
  await sleep(500);

  // Submit — try button selectors
  const submitSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:contains("Login")',
    'button:contains("Sign in")',
    'button:contains("Log in")',
  ];

  let submitted = false;
  for (const sel of submitSelectors) {
    try {
      await page.click(sel);
      submitted = true;
      log(`Clicked submit using: ${sel}`);
      break;
    } catch (_) {}
  }

  if (!submitted) {
    // Fallback: press Enter in the password field
    await page.focus(passwordInput);
    await page.keyboard.press("Enter");
    log("Pressed Enter to submit login.");
  }

  // Wait for navigation after login
  await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30_000 }).catch(() => {});
  await sleep(2_000);

  const currentUrl = page.url();
  log(`After login, current URL: ${currentUrl}`);

  if (currentUrl.includes("login") || currentUrl.includes("signin")) {
    throw new Error("Still on login page after submit — credentials may be wrong or CAPTCHA is blocking.");
  }

  log("Login successful!");
}

async function navigateToEarn(page) {
  log("Navigating to earn page…");
  await page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 60_000 });
  await sleep(3_000);
  const url = page.url();
  log(`Earn page URL: ${url}`);

  // If redirected to login, we need to re-login
  if (url.includes("login") || url.includes("signin")) {
    log("Redirected to login — session expired.");
    return false;
  }
  return true;
}

/** Perform periodic interactions to stay active */
async function keepAlive(page) {
  try {
    // Scroll down a bit then back up
    await page.evaluate(() => {
      window.scrollBy(0, 100);
    });
    await sleep(1_000);
    await page.evaluate(() => {
      window.scrollBy(0, -100);
    });

    // Move mouse to a random position
    const x = 200 + Math.floor(Math.random() * 600);
    const y = 200 + Math.floor(Math.random() * 400);
    await page.mouse.move(x, y, { steps: 10 });

    // Click any visible "claim" / "start" / "earn" button if present
    const claimSelectors = [
      'button:contains("Claim")',
      'button:contains("Start")',
      'button:contains("Earn")',
      'button:contains("Mine")',
      'button:contains("Collect")',
      '[class*="claim" i]',
      '[class*="earn" i]',
      '[class*="mine" i]',
      '[id*="claim" i]',
    ];
    for (const sel of claimSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          const isVisible = await el.isIntersectingViewport();
          if (isVisible) {
            await el.click();
            log(`Clicked element: ${sel}`);
          }
        }
      } catch (_) {}
    }

    log("Keep-alive tick done ✓");
  } catch (err) {
    log(`Keep-alive tick error (non-fatal): ${err.message}`);
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

  let retries = 0;

  while (retries < MAX_RETRIES) {
    let browser;
    try {
      const launched = await launchBrowser();
      browser = launched.browser;
      const page = launched.page;

      // Set a realistic user-agent
      await page.setViewport({ width: 1280, height: 800 });

      await doLogin(page);

      const onEarnPage = await navigateToEarn(page);
      if (!onEarnPage) {
        log("Could not reach earn page after login. Retrying…");
        await browser.close();
        retries++;
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      log("=== Bot is now AFK on the earn page. Running keep-alive loop… ===");
      retries = 0; // Reset retries on success

      // Keep-alive loop
      while (true) {
        await sleep(KEEPALIVE_INTERVAL_MS);

        // Check if we are still on the earn page
        const currentUrl = page.url();
        if (currentUrl.includes("login") || currentUrl.includes("signin")) {
          log("Session expired — re-logging in…");
          await doLogin(page);
          const back = await navigateToEarn(page);
          if (!back) throw new Error("Could not re-navigate to earn page after re-login.");
        }

        await keepAlive(page);
      }
    } catch (err) {
      log(`Error: ${err.message}`);
      retries++;
      log(`Retry ${retries}/${MAX_RETRIES} — waiting ${RETRY_DELAY_MS / 1000}s…`);
      if (browser) {
        try { await browser.close(); } catch (_) {}
      }
      if (retries >= MAX_RETRIES) {
        log("Max retries reached. Exiting.");
        process.exit(1);
      }
      await sleep(RETRY_DELAY_MS);
    }
  }
}

run();
