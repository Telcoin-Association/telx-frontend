#!/usr/bin/env node
// Refreshes src/data/backend-pools.json from the backend registry (GET /api/v1/pools).
// Usage: npm run sync:pools (reads TELX_BACKEND_SECRET_KEY and optional TELX_BACKEND_URL from .env.local)

import { writeFile } from "node:fs/promises";

const OUTPUT = new URL("../src/data/backend-pools.json", import.meta.url);

function fail(message) {
  console.error(`sync-backend-pools: ${message}`);
  process.exit(1);
}

async function main() {
  const secret = process.env.TELX_BACKEND_SECRET_KEY;
  if (!secret) {
    fail("TELX_BACKEND_SECRET_KEY is not set");
  }

  const baseUrl = (process.env.TELX_BACKEND_URL ?? "https://api.telx.network").replace(/\/+$/, "");
  const url = `${baseUrl}/api/v1/pools`;

  let response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } });
  } catch (error) {
    fail(`request to ${url} failed: ${error.message}`);
  }

  const text = await response.text();
  if (!response.ok) {
    fail(`${url} returned ${response.status} ${response.statusText}: ${text.slice(0, 200)}`);
  }

  let registry;
  try {
    registry = JSON.parse(text);
  } catch (error) {
    fail(`${url} did not return valid JSON: ${error.message}`);
  }

  if (!Array.isArray(registry?.pools) || typeof registry.sources !== "object" || registry.sources === null) {
    fail(`${url} did not return a registry (expected "sources" and "pools")`);
  }

  await writeFile(OUTPUT, `${JSON.stringify(registry, null, 2)}\n`);
  console.log(`Wrote ${registry.pools.length} pools to src/data/backend-pools.json`);
}

main().catch((error) => fail(error.message));
