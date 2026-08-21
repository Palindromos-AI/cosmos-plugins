#!/usr/bin/env node

// Minimal per-user binding for cosmos-fix-tools, so a customer who installed
// only knowledge tools still has a durable <cosmos-workspace-root> for
// fix reports. Follows the same rules as the sibling plugins' bindings:
// schema-1 only, atomic writes, no silent rebinding, no reading another
// plugin's configuration.

import { realpathSync } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const SCHEMA_VERSION = 1;
const PLUGIN_NAME = "cosmos-fix-tools";
const REPORT_DIRECTORY = "fix-reports";
const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PLUGIN_ROOT = path.resolve(MODULE_DIRECTORY, "..", "..", "..");
const DEFAULT_CONFIG_FILE = path.join(homedir(), ".config", PLUGIN_NAME, "runtime.json");
const DEFAULT_TEMPORARY_ROOTS = [tmpdir(), "/tmp", "/private/tmp", "/var/tmp"];

export class FixReportRuntimeError extends Error {
  constructor(message, { code = "FIX_REPORT_RUNTIME_ERROR" } = {}) {
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
    throw new FixReportRuntimeError(`${label} must be an absolute path: ${value}`);
  }
  return path.resolve(value);
}

function isReplaceableDistributionPath(candidate) {
  const normalized = path.resolve(candidate).split(path.sep).join("/");
  return /\/(?:\.codex|\.agents)\/plugins(?:\/|$)/u.test(normalized);
}

async function requireRealDirectory(candidate, label) {
  let metadata;
  try {
    metadata = await lstat(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new FixReportRuntimeError(`${label} directory does not exist: ${candidate}`);
    }
    throw new FixReportRuntimeError(`cannot inspect ${label} ${candidate}: ${error.message}`);
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new FixReportRuntimeError(`${label} must be a real directory: ${candidate}`);
  }
  return realpath(candidate);
}

async function validateWorkspaceRoot(
  workspaceRoot,
  { pluginRoot = DEFAULT_PLUGIN_ROOT, temporaryRoots = DEFAULT_TEMPORARY_ROOTS } = {},
) {
  const requested = requireAbsolute(workspaceRoot, "workspace root");
  const canonical = await requireRealDirectory(requested, "workspace root");
  const canonicalTemporaryRoots = await Promise.all(
    temporaryRoots.map((root) => realpath(root).catch(() => root)),
  );
  if (canonicalTemporaryRoots.some((root) => isInside(canonical, root))) {
    throw new FixReportRuntimeError(
      "workspace root must be durable and outside OS temporary directories",
    );
  }
  if (isInside(canonical, pluginRoot) || isReplaceableDistributionPath(canonical)) {
    throw new FixReportRuntimeError(
      "workspace root must be outside plugin, marketplace, and plugin-cache paths",
    );
  }
  return canonical;
}

function validateConfigLocation(configFile, pluginRoot, workspaceRoot) {
  const config = requireAbsolute(configFile, "config file");
  if (
    isInside(config, pluginRoot)
    || isInside(config, workspaceRoot)
    || isReplaceableDistributionPath(config)
  ) {
    throw new FixReportRuntimeError(
      "runtime config must stay outside the plugin, marketplace, and workspace root",
    );
  }
  return config;
}

async function atomicWriteConfig(configFile, payload) {
  const parent = path.dirname(configFile);
  let parentExisted = true;
  try {
    await lstat(parent);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    parentExisted = false;
  }
  await mkdir(parent, { recursive: true, mode: 0o700 });
  if (!parentExisted && process.platform !== "win32") await chmod(parent, 0o700);
  const temporary = path.join(parent, `.${path.basename(configFile)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, configFile);
    if (process.platform !== "win32") await chmod(configFile, 0o600);
  } finally {
    if (handle) await handle.close();
    await rm(temporary, { force: true });
  }
}

export async function loadFixReportRuntime({
  configFile = DEFAULT_CONFIG_FILE,
  pluginRoot = DEFAULT_PLUGIN_ROOT,
  validation = {},
} = {}) {
  const absoluteConfig = requireAbsolute(configFile, "config file");
  let payload;
  try {
    payload = JSON.parse(await readFile(absoluteConfig, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new FixReportRuntimeError(
        `runtime config does not exist: ${absoluteConfig}; run configure first`,
        { code: "CONFIG_NOT_FOUND" },
      );
    }
    throw new FixReportRuntimeError(
      `cannot read runtime config ${absoluteConfig}: ${error.message}`,
    );
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new FixReportRuntimeError("runtime config must contain a JSON object");
  }
  if (payload.schema_version !== SCHEMA_VERSION) {
    throw new FixReportRuntimeError(
      `unsupported runtime schema: ${payload.schema_version}; do not migrate or rewrite it automatically`,
    );
  }
  if (payload.plugin !== PLUGIN_NAME) {
    throw new FixReportRuntimeError(`runtime config plugin must equal ${PLUGIN_NAME}`);
  }
  const workspaceRoot = await validateWorkspaceRoot(payload.workspace_root, {
    pluginRoot,
    ...validation,
  });
  const reportRepository = requireAbsolute(payload.report_repository, "report repository");
  const expected = path.join(workspaceRoot, REPORT_DIRECTORY);
  if (reportRepository !== expected) {
    throw new FixReportRuntimeError(`report repository must equal ${expected}`);
  }
  validateConfigLocation(absoluteConfig, pluginRoot, workspaceRoot);
  return { workspaceRoot, reportRepository };
}

export async function configureFixReportRuntime({
  workspaceRoot,
  configFile = DEFAULT_CONFIG_FILE,
  pluginRoot = DEFAULT_PLUGIN_ROOT,
  reconfigure = false,
  validation = {},
} = {}) {
  const canonicalRoot = await validateWorkspaceRoot(workspaceRoot, {
    pluginRoot,
    ...validation,
  });
  const absoluteConfig = validateConfigLocation(configFile, pluginRoot, canonicalRoot);
  const reportRepository = path.join(canonicalRoot, REPORT_DIRECTORY);

  let existing;
  try {
    existing = await loadFixReportRuntime({ configFile, pluginRoot, validation });
  } catch (error) {
    if (error?.code !== "CONFIG_NOT_FOUND") throw error;
  }
  if (existing && existing.workspaceRoot !== canonicalRoot && !reconfigure) {
    throw new FixReportRuntimeError(
      "runtime binding already exists and differs from the requested root; use --reconfigure only after explicit authorization",
    );
  }
  if (existing && existing.workspaceRoot === canonicalRoot) {
    return existing;
  }

  await atomicWriteConfig(absoluteConfig, {
    schema_version: SCHEMA_VERSION,
    plugin: PLUGIN_NAME,
    workspace_root: canonicalRoot,
    report_repository: reportRepository,
  });
  return { workspaceRoot: canonicalRoot, reportRepository };
}

function usage() {
  return "usage: fix-report-runtime.mjs <show-config|configure> [--workspace-root <absolute-path>] [--reconfigure]";
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === "show-config") {
    if (rest.length > 0) throw new FixReportRuntimeError(usage());
    const runtime = await loadFixReportRuntime();
    process.stdout.write(`${JSON.stringify(runtime)}\n`);
    return;
  }
  if (command === "configure") {
    let workspaceRoot;
    let reconfigure = false;
    for (let index = 0; index < rest.length; index += 1) {
      const flag = rest[index];
      if (flag === "--reconfigure") {
        reconfigure = true;
      } else if (flag === "--workspace-root") {
        workspaceRoot = rest[index + 1];
        if (workspaceRoot === undefined) {
          throw new FixReportRuntimeError("missing value for --workspace-root");
        }
        index += 1;
      } else {
        throw new FixReportRuntimeError(`unknown argument: ${flag}`);
      }
    }
    if (!workspaceRoot) {
      throw new FixReportRuntimeError("missing argument: --workspace-root");
    }
    const runtime = await configureFixReportRuntime({ workspaceRoot, reconfigure });
    process.stdout.write(`${JSON.stringify(runtime)}\n`);
    return;
  }
  throw new FixReportRuntimeError(usage());
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
