#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  GENERATOR,
  assessManifest,
  assertTopicMatchesInventory,
  findBinaryCache,
  normalizeCoverage,
  normalizeInventory,
  normalizeTopic,
  recordWebInventory as freezeWebInventory,
  sha256File,
} from "./run-model.mjs";
import {
  createRun,
  finalizeRun,
  loadRun,
  saveRun,
  withRunLock,
} from "./run-store.mjs";

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`Expected --flag value, received ${flag}`);
    }
    const key = flag.slice(2);
    if (options[key] !== undefined) {
      throw new Error(`Duplicate option --${key}`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function requireOptions(options, required, allowed = required) {
  for (const key of required) {
    if (!options[key]) {
      throw new Error(`--${key} is required`);
    }
  }
  for (const key of Object.keys(options)) {
    if (!allowed.includes(key)) {
      throw new Error(`Unsupported option --${key}`);
    }
  }
}

async function workspaceFile(path, workspace) {
  const absolute = await realpath(resolve(path)).catch((error) => {
    throw new Error(`Input file cannot be resolved: ${error.message}`);
  });
  const canonicalWorkspace = await realpath(workspace);
  const rel = relative(canonicalWorkspace, absolute);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Input file must be inside the dedicated run workspace");
  }
  return absolute;
}

async function inputJson(path, workspace) {
  const absolute = await workspaceFile(path, workspace);
  try {
    return JSON.parse(await readFile(absolute, "utf8"));
  } catch (error) {
    throw new Error(`Input JSON is unreadable or invalid: ${error.message}`);
  }
}

async function init(options) {
  requireOptions(
    options,
    ["workspace", "planet", "planet-url", "date", "snapshot-at", "output"],
    [
      "workspace",
      "planet",
      "planet-url",
      "date",
      "snapshot-at",
      "retrieved-at",
      "output",
    ],
  );
  const manifest = await createRun(options.workspace, {
    planet: options.planet,
    planet_url: options["planet-url"],
    date: options.date,
    snapshot_at: options["snapshot-at"],
    retrieved_at: options["retrieved-at"],
    output_path: options.output,
  });
  return {
    workspace: manifest.workspace,
    manifest: `${manifest.workspace}/manifest.json`,
    run_id: manifest.run_id,
  };
}

async function recordCoverage(options) {
  requireOptions(options, ["workspace", "input"]);
  return withRunLock(options.workspace, async () => {
    const manifest = await loadRun(options.workspace);
    manifest.coverage = normalizeCoverage(
      await inputJson(options.input, manifest.workspace),
    );
    await saveRun(manifest);
    return {
      workspace: manifest.workspace,
      coverage_proven: assessManifest(manifest).coverage_proven,
    };
  });
}

async function recordInventory(options) {
  requireOptions(options, ["workspace", "input"]);
  return withRunLock(options.workspace, async () => {
    const manifest = await loadRun(options.workspace);
    if (manifest.inventory?.recorded === true) {
      throw new Error(
        "Source inventory is already frozen; start a new run to replace it",
      );
    }
    if (manifest.topics.length > 0) {
      throw new Error("Source inventory cannot change after topic extraction has started");
    }
    manifest.inventory = normalizeInventory(
      await inputJson(options.input, manifest.workspace),
    );
    assessManifest(manifest);
    await saveRun(manifest);
    return {
      workspace: manifest.workspace,
      inventory_topic_count: manifest.inventory.topics.length,
    };
  });
}

async function recordWebInventory(options) {
  requireOptions(options, ["workspace", "input"]);
  return withRunLock(options.workspace, async () => {
    const manifest = await loadRun(options.workspace);
    const frozen = freezeWebInventory(
      manifest,
      await inputJson(options.input, manifest.workspace),
    );
    assessManifest(manifest);
    await saveRun(manifest);
    return {
      workspace: manifest.workspace,
      embedded_media_count: frozen.count,
      inventory_status: frozen.status,
    };
  });
}

async function upsertTopic(options) {
  requireOptions(options, ["workspace", "input"]);
  return withRunLock(options.workspace, async () => {
    const manifest = await loadRun(options.workspace);
    if (manifest.inventory?.recorded !== true) {
      throw new Error("Record the complete source inventory before extracting topics");
    }
    const rawTopic = await inputJson(options.input, manifest.workspace);
    const sourceOrder = rawTopic?.source_order;
    const next = manifest.topics.length + 1;
    const replaceLast =
      manifest.topics.length > 0 && sourceOrder === manifest.topics.length;
    if (sourceOrder !== next && !replaceLast) {
      throw new Error(
        `Topics must be appended in source order or replace only the latest topic; expected ${next}${
          manifest.topics.length > 0 ? ` or ${manifest.topics.length}` : ""
        }`,
      );
    }
    const base = structuredClone(manifest);
    if (replaceLast) {
      base.topics.pop();
    }
    const topic = await normalizeTopic(base, rawTopic);
    assertTopicMatchesInventory(
      topic,
      base.inventory.topics[topic.source_order - 1],
    );
    base.topics.push(topic);
    await saveRun(base);
    return {
      workspace: base.workspace,
      topic_key: topic.topic_key,
      source_order: topic.source_order,
      attachment_count: topic.attachments.length,
      post_count: base.topics.length,
    };
  });
}

async function status(options) {
  requireOptions(options, ["workspace"]);
  const manifest = await loadRun(options.workspace);
  const assessment = assessManifest(manifest);
  const pendingWebInventories = manifest.inventory.topics.flatMap((topic) =>
    topic.attachments.filter(
      (attachment) =>
        attachment.type === "web" &&
        attachment.embedded_media_inventory.recorded !== true,
    ),
  ).length;
  return {
    workspace: manifest.workspace,
    planet: manifest.planet,
    date: manifest.date,
    snapshot_at: manifest.snapshot_at,
    post_count: assessment.post_count,
    coverage_proven: assessment.coverage_proven,
    ready_to_finalize:
      assessment.coverage_proven && assessment.inventory_complete,
    completeness_if_finalized:
      assessment.coverage_proven && assessment.inventory_complete
        ? assessment.completeness
        : null,
    extraction_failure_count: assessment.extraction_failure_count,
    inventory_recorded: manifest.inventory.recorded,
    inventory_topic_count: assessment.inventory_topic_count,
    inventory_complete: assessment.inventory_complete,
    pending_web_inventory_count: pendingWebInventories,
    next_topic_source_order: manifest.topics.length + 1,
  };
}

async function cacheLookup(options) {
  requireOptions(
    options,
    ["workspace", "kind", "path"],
    ["workspace", "kind", "path"],
  );
  const manifest = await loadRun(options.workspace);
  if (options.kind !== "binary") {
    throw new Error("--kind must be binary");
  }
  const representationSha256 = await sha256File(
    await workspaceFile(options.path, manifest.workspace),
  );
  return {
    representation_sha256: representationSha256,
    ...findBinaryCache(manifest, representationSha256),
  };
}

async function finalize(options) {
  requireOptions(options, ["workspace"]);
  return finalizeRun(options.workspace);
}

export async function runCli(argv) {
  const [command, ...rest] = argv;
  if (!command) {
    throw new Error(
      "Command is required: init, record-coverage, record-inventory, record-web-inventory, upsert-topic, status, cache-lookup, or finalize",
    );
  }
  const options = parseOptions(rest);
  if (command === "init") {
    return init(options);
  }
  if (command === "record-coverage") {
    return recordCoverage(options);
  }
  if (command === "record-inventory") {
    return recordInventory(options);
  }
  if (command === "record-web-inventory") {
    return recordWebInventory(options);
  }
  if (command === "upsert-topic") {
    return upsertTopic(options);
  }
  if (command === "status") {
    return status(options);
  }
  if (command === "cache-lookup") {
    return cacheLookup(options);
  }
  if (command === "finalize") {
    return finalize(options);
  }
  throw new Error(`Unknown command: ${command}`);
}

async function main() {
  const result = await runCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
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
    process.stderr.write(`${GENERATOR} runner: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
