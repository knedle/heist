# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Path of Exile price tracker for Heist content — specifically Replica unique items and Experimented base types. It proxies poe.ninja and pathofexile.com trade APIs with a 1-hour server-side file cache, serving a single-page frontend.

## Running

```bash
# Directly with Node.js
node server.js

# Via Docker Compose (preferred for deployment)
docker compose up -d
```

Server starts on port 3000 (or `$PORT`). No `npm install` needed — zero dependencies, only Node built-ins.

## Architecture

All logic lives in two files:

**`server.js`** — Node.js HTTP server with no framework:
- `/api/leagues` — proxies PoE trade API for league list
- `/api/cache-status?league=` — checks cache freshness without fetching
- `/api/data?league=` — fetches Replica unique items from poe.ninja (5 categories in parallel), caches to `cache/<league>.json`
- `/api/experimented?league=` — fetches base type prices for Experimented items, filters by `EXPERIMENTED_BASE_TYPES` set and ilvl 83–84, caches to `cache/exp_<league>.json`
- Static file serving for everything else

**`index.html`** — entirely self-contained SPA (inline CSS + JS, no build step):
- On load, auto-detects current challenge league and loads cached data if fresh
- Two tabs: Replicas and Experimented Items, each with type filter buttons, name search, min chaos filter, and sort
- Replica items with multiple link variants are merged into a single card showing all link counts/prices
- Cards link out to poe.ninja item pages
- Load button is disabled for the remainder of the cache TTL after a fetch

**`cache/`** — JSON files written by the server. Each file contains `{ timestamp, items, errors }`. Both server and client enforce the same 1-hour TTL constant.

## Key details

- `EXPERIMENTED_BASE_TYPES` in `server.js` is a hardcoded allowlist of all Experimented base type names — update this when new Experimented items are added to the game.
- The `CurrencyRerollRare.png` is the chaos orb icon served as a static asset.
- Item icons are loaded directly from poe.ninja CDN URLs embedded in the API response.
