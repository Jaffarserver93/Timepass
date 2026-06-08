# Vektalnodes AFK Bot

An automated bot that keeps a session alive on vektalnodes.in/earn, performing keep-alive actions (scrolling, clicks) on a schedule. Includes a live dashboard to monitor bot state, logs, and browser screenshots.

## Run & Operate

- **AFK Bot** workflow — runs the bot (`pnpm --filter @workspace/scripts run afk-bot`)
- **API Server** workflow — serves the dashboard + API (`pnpm --filter @workspace/api-server run dev`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-server run build` — rebuild the API server bundle only

## Required Secrets

Set these in the Replit Secrets tab:

- `EMAIL` — your vektalnodes.in login email
- `PASSWORD` — your vektalnodes.in login password

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (built with esbuild, served as ESM)
- Bot: Puppeteer Core + `puppeteer-real-browser` (anti-detection)
- Browser: Chromium from Nix store (auto-detected at `/nix/store/.../bin/chromium`)
- Dashboard: Inline HTML served by the API server at `/api/dashboard`
- Validation: Zod (`zod/v4`), `drizzle-zod`

## Where things live

- `scripts/src/afk-bot.mjs` — core bot logic (login, keep-alive loop, screenshot saving)
- `artifacts/api-server/src/` — Express API + dashboard HTML
  - `routes/bot.ts` — `/api/bot/status`, `/api/bot/screenshot`, `/api/bot/logs`, `/api/dashboard`
- `artifacts/api-server/build.mjs` — esbuild bundle config
- `/tmp/bot-screenshot.png` — live screenshot written by bot, read by API
- `/tmp/bot-status.json` — bot state JSON
- `/tmp/bot-logs.json` — recent log lines

## Architecture decisions

- Bot and API server run as separate processes; they communicate via `/tmp` files (no DB needed for transient state)
- `puppeteer-real-browser` is used instead of plain Puppeteer to avoid bot-detection fingerprinting
- Chromium is auto-detected from the Nix store — no manual Chrome install required on Replit
- The dashboard is server-rendered HTML (not the React mockup-sandbox) so it works with zero frontend build step

## Product

- Dashboard at `/api/dashboard` shows live bot state, browser screenshot (refreshed every 100ms), and recent logs
- Bot auto-retries up to 10 times on failure; handles session expiry with automatic re-login

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Chromium is found via nix store search in `findChromiumPath()` — no `google-chrome-stable` install needed
- `DISPLAY=:0` is provided by Replit's environment; the bot detects this and uses it (skips spawning its own Xvfb)
- The API server port is controlled by the `PORT` env var (default 25515); on Replit this is set to `8080`
- Secrets (EMAIL, PASSWORD) must be set before starting the AFK Bot workflow or it exits immediately
