#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function validateIds(name, ids) {
  if (!Array.isArray(ids) || !ids.every(Number.isInteger)) {
    throw new Error(`${name} must be an array of integer IDs`);
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${name} contains duplicate IDs`);
  }
}

function initialState(dataset) {
  return {
    schema_version: 1,
    source_date: dataset.date,
    source_item_count: dataset.items.length,
    reviewed_ids: [],
    selected_ids: [],
  };
}

function validateExistingState(dataset, state) {
  if (
    state?.schema_version !== 1 ||
    state.source_date !== dataset.date ||
    state.source_item_count !== dataset.items.length
  ) {
    throw new Error("Review state does not match the source dataset");
  }
  validateIds("reviewed_ids", state.reviewed_ids);
  validateIds("selected_ids", state.selected_ids);
  const reviewed = new Set(state.reviewed_ids);
  if (state.selected_ids.some((id) => !reviewed.has(id))) {
    throw new Error("Review state contains selected IDs that were not reviewed");
  }
}

export function advanceReviewState(
  dataset,
  state,
  { offset, limit, selectedIds = [] },
) {
  if (!dataset?.complete || !Array.isArray(dataset.items)) {
    throw new Error("Source dataset is incomplete or malformed");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("offset must be a non-negative integer");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("limit must be an integer from 1 to 50");
  }
  validateIds("selectedIds", selectedIds);

  const nextState = state ? structuredClone(state) : initialState(dataset);
  validateExistingState(dataset, nextState);
  if (offset !== nextState.reviewed_ids.length) {
    throw new Error(
      `Expected offset ${nextState.reviewed_ids.length}, received ${offset}`,
    );
  }

  if (dataset.items.length === 0) {
    if (selectedIds.length > 0) {
      throw new Error("An empty source dataset cannot contain selected IDs");
    }
    return {
      state: nextState,
      progress: {
        reviewed: 0,
        total: 0,
        selected: 0,
        next_offset: null,
        complete: true,
      },
    };
  }

  const batch = dataset.items.slice(offset, offset + limit);
  if (batch.length === 0) {
    throw new Error("No unreviewed source items remain at this offset");
  }
  const batchIds = batch.map((item) => item.id);
  const batchSet = new Set(batchIds);
  const outsideBatch = selectedIds.filter((id) => !batchSet.has(id));
  if (outsideBatch.length > 0) {
    throw new Error(
      `Selected IDs are outside the current batch: ${outsideBatch.join(", ")}`,
    );
  }

  nextState.reviewed_ids.push(...batchIds);
  nextState.selected_ids.push(...selectedIds);
  validateIds("selected_ids", nextState.selected_ids);

  return {
    state: nextState,
    progress: {
      reviewed: nextState.reviewed_ids.length,
      total: dataset.items.length,
      selected: nextState.selected_ids.length,
      next_offset:
        nextState.reviewed_ids.length < dataset.items.length
          ? nextState.reviewed_ids.length
          : null,
      complete: nextState.reviewed_ids.length === dataset.items.length,
    },
  };
}

export async function writeReviewState(outputPath, state) {
  const target = resolve(outputPath);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}`;
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return target;
}

function parseInteger(name, value, { allowZero = false } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < (allowZero ? 0 : 1)) {
    throw new Error(`${name} must be ${allowZero ? "a non-negative" : "a positive"} integer`);
  }
  return number;
}

function parseSelectedIds(value) {
  if (value === undefined || value.trim() === "") {
    return [];
  }
  const ids = value.split(",").map((part) => Number(part.trim()));
  validateIds("--selected", ids);
  return ids;
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
  for (const required of ["source", "state", "offset", "limit"]) {
    if (options[required] === undefined) {
      throw new Error(`--${required} is required`);
    }
  }
  return {
    source: options.source,
    statePath: options.state,
    offset: parseInteger("--offset", options.offset, { allowZero: true }),
    limit: parseInteger("--limit", options.limit),
    selectedIds: parseSelectedIds(options.selected),
  };
}

async function readState(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [dataset, currentState] = await Promise.all([
    readFile(args.source, "utf8").then(JSON.parse),
    readState(args.statePath),
  ]);
  const { state, progress } = advanceReviewState(dataset, currentState, args);
  const output = await writeReviewState(args.statePath, state);
  process.stdout.write(`${JSON.stringify({ state: output, ...progress })}\n`);
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
    process.stderr.write(`cls-fetch review: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
