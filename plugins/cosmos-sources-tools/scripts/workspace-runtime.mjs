#!/usr/bin/env node

// The sources workspace is a fixed location, not a per-user binding: every
// report lives under `<home>/Documents/cosmos-workspace/sources`. This module
// owns that constant, creates the tree on demand, and confines every final
// writer to its exact source/date or source/range directory.

import { lstat, mkdir, realpath } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";


// The pinned location. `Documents` is capitalized exactly as the directory is
// named: containment compares resolved paths as strings, and a case-insensitive
// filesystem would otherwise accept a lowercase spelling that never matches.
const WORKSPACE_ROOT_SEGMENTS = ["Documents", "cosmos-workspace"];
const WORKSPACE_DIRECTORY = "sources";
const OUTPUT_DIRECTORIES = ["cls", "zsxq", "dingtalk", "feishu"];
const DIRECTORY_MODE = 0o700;


export class WorkspaceRuntimeError extends Error {
  constructor(message, { code = "WORKSPACE_RUNTIME_ERROR" } = {}) {
    super(message);
    this.code = code;
  }
}


function isInside(candidate, directory) {
  const relative = path.relative(path.resolve(directory), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}


function requireAbsolute(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new WorkspaceRuntimeError(`${label} must be an absolute path: ${value}`);
  }
  return path.resolve(value);
}


// The pinned paths as written, before the filesystem is consulted. Use this to
// display or derive the location; never as a containment anchor, because a
// symbolic-link ancestor makes the written form differ from the resolved one.
export function pinnedSourcesWorkspace({ homeDir = homedir() } = {}) {
  const home = requireAbsolute(homeDir, "home directory");
  const workspaceRoot = path.join(home, ...WORKSPACE_ROOT_SEGMENTS);
  return { workspaceRoot, workspace: path.join(workspaceRoot, WORKSPACE_DIRECTORY) };
}


async function requireRealDirectory(candidate, label) {
  let metadata;
  try {
    metadata = await lstat(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new WorkspaceRuntimeError(`${label} directory does not exist: ${candidate}`);
    }
    throw new WorkspaceRuntimeError(`cannot inspect ${label} ${candidate}: ${error.message}`);
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new WorkspaceRuntimeError(`${label} must be a real directory: ${candidate}`);
  }
  return realpath(candidate);
}


// Create the workspace tree if it is missing and return its canonical path.
// `mkdir` follows an existing symbolic link, so every created directory is
// re-inspected with `lstat`: a swapped workspace, output root, or namespace
// directory fails closed instead of silently redirecting confined writes.
export async function ensureSourcesWorkspace({ workspace } = {}) {
  const requested = workspace === undefined
    ? pinnedSourcesWorkspace().workspace
    : requireAbsolute(workspace, "sources workspace");
  try {
    await mkdir(requested, { recursive: true, mode: DIRECTORY_MODE });
  } catch (error) {
    throw new WorkspaceRuntimeError(
      `cannot create sources workspace ${requested}: ${error.message}`,
    );
  }
  const canonical = await requireRealDirectory(requested, "sources workspace");
  const output = path.join(canonical, "output");
  await mkdir(output, { recursive: true, mode: DIRECTORY_MODE });
  await requireRealDirectory(output, "sources output directory");
  for (const name of OUTPUT_DIRECTORIES) {
    const directory = path.join(output, name);
    await mkdir(directory, { recursive: true, mode: DIRECTORY_MODE });
    await requireRealDirectory(directory, `${name} output directory`);
  }
  return canonical;
}


async function canonicalFuturePath(requested) {
  let ancestor = requested;
  const suffix = [];
  while (true) {
    try {
      await lstat(ancestor);
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw new WorkspaceRuntimeError(`cannot inspect output path ${requested}: ${error.message}`);
      }
      const parent = path.dirname(ancestor);
      if (parent === ancestor) {
        throw new WorkspaceRuntimeError(`cannot resolve an existing output ancestor: ${requested}`);
      }
      suffix.unshift(path.basename(ancestor));
      ancestor = parent;
    }
  }
  const canonicalAncestor = await realpath(ancestor);
  return path.resolve(canonicalAncestor, ...suffix);
}


function requireNamespace(namespace) {
  if (!OUTPUT_DIRECTORIES.includes(namespace)) {
    throw new WorkspaceRuntimeError(
      `output namespace must be one of: ${OUTPUT_DIRECTORIES.join(", ")}`,
    );
  }
  return namespace;
}


export function requireCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new WorkspaceRuntimeError("output date must use YYYY-MM-DD");
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new WorkspaceRuntimeError(`output date is not a real calendar date: ${value}`);
  }
  return value;
}


// Confine one final report to `<workspace>/output/<namespace>/<leaf>/<file>`
// and create that directory. Every argument is validated before the workspace
// is touched, so a rejected call creates nothing; both the requested path and
// the expected directory are then canonicalized, so the comparison is always
// resolved-against-resolved even when an ancestor is a symbolic link.
async function resolveConfinedOutputPath(outputPath, options, namespace, leafSegments) {
  requireNamespace(namespace);
  const requested = requireAbsolute(outputPath, "output path");

  const workspace = await ensureSourcesWorkspace(options);
  const outputRoot = await realpath(path.join(workspace, "output", namespace));
  const target = await canonicalFuturePath(requested);
  if (!isInside(target, outputRoot) || target === outputRoot) {
    throw new WorkspaceRuntimeError(
      `output path must remain inside the pinned ${namespace} output namespace: ${outputRoot}`,
    );
  }
  const directory = await canonicalFuturePath(path.join(outputRoot, ...leafSegments));
  if (path.dirname(target) !== directory) {
    return { target, directory, contained: false };
  }
  await mkdir(directory, { recursive: true, mode: DIRECTORY_MODE });
  return { target, directory, contained: true };
}


export async function resolveDatedOutputPath(outputPath, options = {}, namespace, date) {
  const targetDate = requireCalendarDate(date);
  const { target, directory, contained } = await resolveConfinedOutputPath(
    outputPath,
    options,
    namespace,
    [targetDate],
  );
  if (!contained) {
    throw new WorkspaceRuntimeError(
      `output path must be a direct file in the ${targetDate} daily output directory: ${directory}`,
    );
  }
  return target;
}


export async function resolveRangeOutputPath(
  outputPath,
  options = {},
  namespace,
  startDate,
  endDate,
) {
  const start = requireCalendarDate(startDate);
  const end = requireCalendarDate(endDate);
  if (start >= end) {
    throw new WorkspaceRuntimeError(
      "range start date must be strictly earlier than the end date; single days use the daily output directory",
    );
  }
  const { target, directory, contained } = await resolveConfinedOutputPath(
    outputPath,
    options,
    namespace,
    ["ranges", `${start}_to_${end}`],
  );
  if (!contained) {
    throw new WorkspaceRuntimeError(
      `output path must be a direct file in the ${start}_to_${end} range output directory: ${directory}`,
    );
  }
  return target;
}


function usage() {
  return [
    "Usage:",
    "  workspace-runtime.mjs show-workspace",
  ].join("\n");
}


async function main(argv) {
  const { positionals } = parseArgs({ args: argv, allowPositionals: true, strict: true, options: {} });
  if (positionals.length !== 1 || positionals[0] !== "show-workspace") {
    throw new WorkspaceRuntimeError(usage());
  }
  // Both fields come from the resolved workspace, so the printed pair cannot
  // disagree in form when an ancestor is a symbolic link.
  const workspace = await ensureSourcesWorkspace();
  const workspaceRoot = path.dirname(workspace);
  process.stdout.write(`${JSON.stringify({ workspaceRoot, workspace }, null, 2)}\n`);
}


// Resolve the invoked path before comparing: Node resolves `import.meta.url`
// through symbolic links but leaves `process.argv[1]` as typed.
export function isMainEntry(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  let resolved = path.resolve(entry);
  try {
    resolved = realpathSync(resolved);
  } catch {
    // keep the unresolved path; the comparison below still decides
  }
  const self = fileURLToPath(moduleUrl);
  return path.resolve(entry) === self || resolved === self;
}

if (isMainEntry(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`error: ${error.message}\n`);
    process.exitCode = 1;
  });
}
