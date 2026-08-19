#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const TIME_ZONE = "Asia/Shanghai";

function parsePositiveInteger(name, value, { allowZero = false } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < (allowZero ? 0 : 1)) {
    throw new Error(`${name} must be ${allowZero ? "a non-negative" : "a positive"} integer`);
  }
  return number;
}

export function originalText(item) {
  if (typeof item.content === "string" && item.content.length > 0) {
    return item.content;
  }
  if (typeof item.brief === "string" && item.brief.length > 0) {
    return item.brief;
  }
  return "";
}

export function candidateView(item) {
  return {
    id: item.id,
    time: new Intl.DateTimeFormat("zh-CN", {
      timeZone: TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(item.ctime * 1000)),
    title: typeof item.title === "string" ? item.title : "",
    original_text: originalText(item),
    subjects: Array.isArray(item.subjects)
      ? item.subjects
          .map((subject) => subject?.subject_name)
          .filter((name) => typeof name === "string")
      : [],
    stocks: Array.isArray(item.stock_list)
      ? item.stock_list
          .map((stock) => stock?.name)
          .filter((name) => typeof name === "string")
      : [],
  };
}

export function listCandidates(dataset, { offset = 0, limit = 10 } = {}) {
  if (!dataset?.complete || !Array.isArray(dataset.items)) {
    throw new Error("Source dataset is incomplete or malformed");
  }
  if (offset > dataset.items.length) {
    throw new Error(`Offset ${offset} exceeds item count ${dataset.items.length}`);
  }
  const end = Math.min(offset + limit, dataset.items.length);
  return {
    date: dataset.date,
    timezone: dataset.timezone,
    total: dataset.items.length,
    offset,
    limit: end - offset,
    next_offset: end < dataset.items.length ? end : null,
    items: dataset.items.slice(offset, end).map(candidateView),
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag.startsWith("--") || value === undefined) {
      throw new Error(`Expected --flag value, received ${flag}`);
    }
    options[flag.slice(2)] = value;
    index += 1;
  }
  if (!options.source) {
    throw new Error("--source is required");
  }
  const offset = options.offset
    ? parsePositiveInteger("--offset", options.offset, { allowZero: true })
    : 0;
  const limit = options.limit ? parsePositiveInteger("--limit", options.limit) : 10;
  if (limit > 50) {
    throw new Error("--limit cannot exceed 50");
  }
  return { source: options.source, offset, limit };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataset = JSON.parse(await readFile(args.source, "utf8"));
  process.stdout.write(`${JSON.stringify(listCandidates(dataset, args), null, 2)}\n`);
}

// Resolve the invoked path before comparing: Node resolves `import.meta.url`
// through symbolic links but leaves `process.argv[1]` as typed.
function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  let resolved = entry;
  try {
    resolved = realpathSync(entry);
  } catch {
    // keep the unresolved path; the comparison below still decides
  }
  return import.meta.url === pathToFileURL(entry).href
    || import.meta.url === pathToFileURL(resolved).href;
}

if (isMainModule()) {
  main().catch((error) => {
    process.stderr.write(`cls-fetch candidates: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
