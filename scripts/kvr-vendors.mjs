#!/usr/bin/env node
// Builds src/data/vendor-suggestions.json from a saved copy of
// https://www.kvraudio.com/plugin-ranks.php?show=50 as Markdown (Firecrawl).
// Run once by hand; the app itself never fetches anything.
//
//   node scripts/kvr-vendors.mjs ranks50.md > src/data/vendor-suggestions.json

import fs from "node:fs";

const SOURCE = "https://www.kvraudio.com/plugin-ranks.php?show=50";
const CHARTS = [
  "Commercial Instruments",
  "Free Instruments",
  "Commercial Effects",
  "Free Effects",
];

const lines = fs.readFileSync(process.argv[2], "utf8").split("\n");
const header = /^\*\*([A-Z][^*]*)\*\*$/;

const best = new Map();
let chart = null;
let rank = 0;
for (const line of lines) {
  const h = line.match(header);
  if (h) {
    chart = CHARTS.includes(h[1]) ? h[1] : null;
    continue;
  }
  const r = line.match(/^\*\*(\d+)\*\*$/);
  if (r) rank = Number(r[1]);
  if (!chart || !line.includes(" by [")) continue;
  const byPart = line.slice(line.indexOf(" by ["));
  for (const m of byPart.matchAll(/\[([^\]]+)\]\(https:\/\/www\.kvraudio\.com\/developer\//g)) {
    const name = m[1].replace(/\s+/g, " ").trim();
    if (!name) continue;
    if (!best.has(name) || rank < best.get(name)) best.set(name, rank);
  }
}

const vendors = [...best]
  .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
  .map(([name]) => name);

process.stdout.write(
  JSON.stringify(
    {
      source: [SOURCE],
      charts: CHARTS,
      fetchedAt: new Date().toISOString().slice(0, 10),
      vendors,
    },
    null,
    2,
  ) + "\n",
);
