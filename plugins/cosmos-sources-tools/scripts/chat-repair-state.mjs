#!/usr/bin/env node

// One-attempt automatic repair budget shared by dingding-fetch and
// feishu-fetch. The skill name is a parameter so both skills use one
// implementation and cannot drift apart.

import { realpathSync } from "node:fs";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS = new Set(["dingding-fetch", "feishu-fetch"]);
const MAX_ATTEMPTS = 1;
const RUN_ID = /^[a-f0-9]{8}$/u;
const FAILURE_CODE = /^[A-Z][A-Z0-9_]{0,79}$/u;
const PHASE = /^[a-z][a-z0-9-]{0,79}$/u;

function requireSkill(value) {
  if (!SKILLS.has(value)) {
    throw new TypeError(`skill must be one of: ${[...SKILLS].join(", ")}`);
  }
  return value;
}

function requiredMatch(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new TypeError(`${label} has an invalid format`);
  }
  return value;
}

function requiredStatePath(value) {
  if (typeof value !== "string" || value === "") {
    throw new TypeError("statePath must be a non-empty path");
  }
  return path.resolve(value);
}

function validateState(value, skill, statePath) {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || value.schema_version !== 1
    || value.skill !== skill
    || !RUN_ID.test(value.run_id)
    || value.max_attempts !== MAX_ATTEMPTS
    || value.attempts_used !== MAX_ATTEMPTS
    || value.first_failure === null
    || typeof value.first_failure !== "object"
    || Array.isArray(value.first_failure)
    || !FAILURE_CODE.test(value.first_failure.code)
    || !PHASE.test(value.first_failure.phase)
  ) {
    throw new Error(`invalid repair state: ${statePath}`);
  }
  return value;
}

async function readState(statePath, skill) {
  const fileStat = await lstat(statePath);
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    throw new Error(`invalid repair state: ${statePath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    throw new Error(`invalid repair state: ${statePath}`, { cause: error });
  }
  return validateState(parsed, skill, statePath);
}

function result(status, skill, runId) {
  return {
    status,
    skill,
    run_id: runId,
    attempts_used: MAX_ATTEMPTS,
    max_attempts: MAX_ATTEMPTS,
  };
}

export async function beginRepair(options) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("repair options must be an object");
  }
  const skill = requireSkill(options.skill);
  const statePath = requiredStatePath(options.statePath);
  const runId = requiredMatch(options.runId, RUN_ID, "runId");
  const failureCode = requiredMatch(
    options.failureCode,
    FAILURE_CODE,
    "failureCode",
  );
  const phase = requiredMatch(options.phase, PHASE, "phase");
  const state = {
    schema_version: 1,
    skill,
    run_id: runId,
    attempts_used: MAX_ATTEMPTS,
    max_attempts: MAX_ATTEMPTS,
    first_failure: { code: failureCode, phase },
  };

  try {
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    return result("automatic-repair-authorized", skill, runId);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }

  const existing = await readState(statePath, skill);
  if (existing.run_id !== runId) {
    throw new Error(`repair state belongs to another run: ${statePath}`);
  }
  return result("repair-limit-reached", skill, runId);
}

// Resolve the invoked path before comparing: Node resolves `import.meta.url`
// through symbolic links but leaves `process.argv[1]` as typed.
function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  let resolved = path.resolve(entry);
  try {
    resolved = realpathSync(resolved);
  } catch {
    // keep the unresolved path; the comparison below still decides
  }
  const self = fileURLToPath(import.meta.url);
  return path.resolve(entry) === self || resolved === self;
}

if (isMainModule()) {
  const [command, skill, statePath, runId, failureCode, phase] = process.argv.slice(2);
  try {
    if (command !== "begin") {
      throw new Error("command must be begin");
    }
    const response = await beginRepair({
      skill,
      statePath,
      runId,
      failureCode,
      phase,
    });
    process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    process.stderr.write(`chat-repair-state: ${error.message}\n`);
    process.exitCode = 1;
  }
}
