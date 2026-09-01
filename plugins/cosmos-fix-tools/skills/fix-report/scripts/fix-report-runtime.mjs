#!/usr/bin/env node

// The report repository is a fixed location, not a per-user binding:
// `<home>/Documents/cosmos-workspace/fix-reports`. This module owns that
// constant and nothing else. It deliberately never creates the directory —
// the repository is a Git repository the user sets up once, and
// `publish-report.mjs` reports a missing one as a setup prerequisite rather
// than silently producing an empty directory that is not a repository.

import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORKSPACE_ROOT_SEGMENTS = ["Documents", "cosmos-workspace"];
const REPORT_DIRECTORY = "fix-reports";

export class FixReportRuntimeError extends Error {
  constructor(message, { code = "FIX_REPORT_RUNTIME_ERROR" } = {}) {
    super(message);
    this.code = code;
  }
}

function requireAbsolute(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new FixReportRuntimeError(`${label} must be an absolute path: ${value}`);
  }
  return path.resolve(value);
}

// `homeDir` exists so tests can point at a temporary home; production passes
// nothing. The path is computed per call, never at import, so redirecting
// `HOME` in a spawned test actually moves it.
export function pinnedFixReportRepository({ homeDir = homedir() } = {}) {
  const home = requireAbsolute(homeDir, "home directory");
  const workspaceRoot = path.join(home, ...WORKSPACE_ROOT_SEGMENTS);
  return { workspaceRoot, reportRepository: path.join(workspaceRoot, REPORT_DIRECTORY) };
}

function usage() {
  return "usage: fix-report-runtime.mjs show-repository";
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (command !== "show-repository" || rest.length > 0) {
    throw new FixReportRuntimeError(usage());
  }
  process.stdout.write(`${JSON.stringify(pinnedFixReportRepository())}\n`);
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
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
