#!/usr/bin/env node

import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";


const SCHEMA_VERSION = 1;
const PLUGIN_NAME = "cosmos-sources-tools";
const WORKSPACE_DIRECTORY = "sources";
const OUTPUT_DIRECTORIES = ["cls", "zsxq", "dingtalk", "feishu"];
const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PLUGIN_ROOT = path.resolve(MODULE_DIRECTORY, "..");
const DEFAULT_CONFIG_FILE = path.join(
  homedir(),
  ".config",
  PLUGIN_NAME,
  "runtime.json",
);
const DEFAULT_TEMPORARY_ROOTS = [tmpdir(), "/tmp", "/private/tmp", "/var/tmp"];


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
      throw new WorkspaceRuntimeError(`${label} directory does not exist: ${candidate}`);
    }
    throw new WorkspaceRuntimeError(`cannot inspect ${label} ${candidate}: ${error.message}`);
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new WorkspaceRuntimeError(`${label} must be a real directory: ${candidate}`);
  }
  return realpath(candidate);
}


async function validateWorkspaceRoot(
  workspaceRoot,
  { pluginRoot = DEFAULT_PLUGIN_ROOT, temporaryRoots = DEFAULT_TEMPORARY_ROOTS } = {},
) {
  const requested = requireAbsolute(workspaceRoot, "workspace root");
  const canonical = await requireRealDirectory(requested, "workspace root");
  // Compare canonical against canonical: on macOS `os.tmpdir()` and `/var/tmp`
  // resolve to `/private/var/...`, so an unresolved temporary root never
  // matches a realpath'd workspace root.
  const canonicalTemporaryRoots = await Promise.all(
    temporaryRoots.map((root) => realpath(root).catch(() => root)),
  );
  if (canonicalTemporaryRoots.some((root) => isInside(canonical, root))) {
    throw new WorkspaceRuntimeError(
      "workspace root must be durable and outside OS temporary directories",
    );
  }
  if (isInside(canonical, pluginRoot) || isReplaceableDistributionPath(canonical)) {
    throw new WorkspaceRuntimeError(
      "workspace root must be outside plugin, marketplace, and plugin-cache paths",
    );
  }
  return canonical;
}


async function ensureWorkspace(workspace) {
  try {
    await mkdir(workspace, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw new WorkspaceRuntimeError(`cannot create sources workspace ${workspace}: ${error.message}`);
    }
  }
  const canonical = await requireRealDirectory(workspace, "sources workspace");
  const output = path.join(canonical, "output");
  await mkdir(output, { recursive: true, mode: 0o700 });
  await requireRealDirectory(output, "sources output directory");
  for (const name of OUTPUT_DIRECTORIES) {
    const directory = path.join(output, name);
    await mkdir(directory, { mode: 0o700, recursive: true });
    await requireRealDirectory(directory, `${name} output directory`);
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
    throw new WorkspaceRuntimeError(
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


function sameBinding(left, right) {
  return left.workspaceRoot === right.workspaceRoot && left.workspace === right.workspace;
}


export async function loadRuntime({
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
      throw new WorkspaceRuntimeError(
        `runtime config does not exist: ${absoluteConfig}; run configure first`,
        { code: "CONFIG_NOT_FOUND" },
      );
    }
    throw new WorkspaceRuntimeError(`cannot read runtime config ${absoluteConfig}: ${error.message}`);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new WorkspaceRuntimeError("runtime config must contain a JSON object");
  }
  if (payload.schema_version !== SCHEMA_VERSION) {
    throw new WorkspaceRuntimeError(
      `unsupported runtime schema: ${payload.schema_version}; do not migrate or rewrite it automatically`,
    );
  }
  if (payload.plugin !== PLUGIN_NAME) {
    throw new WorkspaceRuntimeError(`runtime config plugin must equal ${PLUGIN_NAME}`);
  }
  const workspaceRoot = await validateWorkspaceRoot(payload.workspace_root, {
    pluginRoot,
    ...validation,
  });
  const workspace = requireAbsolute(payload.workspace, "sources workspace");
  const expectedWorkspace = path.join(workspaceRoot, WORKSPACE_DIRECTORY);
  if (workspace !== expectedWorkspace) {
    throw new WorkspaceRuntimeError(
      `sources workspace must equal ${expectedWorkspace}`,
    );
  }
  await requireRealDirectory(workspace, "sources workspace");
  validateConfigLocation(absoluteConfig, pluginRoot, workspaceRoot);
  return { workspaceRoot, workspace };
}


export async function configureRuntime({
  workspaceRoot,
  configFile = DEFAULT_CONFIG_FILE,
  pluginRoot = DEFAULT_PLUGIN_ROOT,
  validation = {},
  allowReconfigure = false,
} = {}) {
  const canonicalRoot = await validateWorkspaceRoot(workspaceRoot, {
    pluginRoot,
    ...validation,
  });
  const absoluteConfig = validateConfigLocation(configFile, pluginRoot, canonicalRoot);
  const requested = {
    workspaceRoot: canonicalRoot,
    workspace: path.join(canonicalRoot, WORKSPACE_DIRECTORY),
  };

  try {
    const existing = await loadRuntime({ configFile: absoluteConfig, pluginRoot, validation });
    if (sameBinding(existing, requested)) return existing;
    if (!allowReconfigure) {
      throw new WorkspaceRuntimeError(
        "runtime binding already exists and differs; use --reconfigure only after explicit authorization",
      );
    }
  } catch (error) {
    if (!(error instanceof WorkspaceRuntimeError)) throw error;
    if (error.code !== "CONFIG_NOT_FOUND" && !allowReconfigure) {
      if (error.message.includes("--reconfigure")) throw error;
      throw new WorkspaceRuntimeError(
        `existing runtime config is invalid; inspect it and use --reconfigure only after explicit authorization: ${error.message}`,
      );
    }
  }

  requested.workspace = await ensureWorkspace(requested.workspace);
  await atomicWriteConfig(absoluteConfig, {
    schema_version: SCHEMA_VERSION,
    plugin: PLUGIN_NAME,
    workspace_root: requested.workspaceRoot,
    workspace: requested.workspace,
  });
  return requested;
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


export async function resolveOutputPath(outputPath, runtimeOptions = {}, namespace) {
  if (!OUTPUT_DIRECTORIES.includes(namespace)) {
    throw new WorkspaceRuntimeError(
      `output namespace must be one of: ${OUTPUT_DIRECTORIES.join(", ")}`,
    );
  }
  const requested = requireAbsolute(outputPath, "output path");
  const binding = await loadRuntime(runtimeOptions);
  const canonical = await canonicalFuturePath(requested);
  const outputRoot = path.join(binding.workspace, "output", namespace);
  if (!isInside(canonical, outputRoot) || canonical === outputRoot) {
    throw new WorkspaceRuntimeError(
      `output path must remain inside the configured ${namespace} output namespace: ${outputRoot}`,
    );
  }
  return canonical;
}


function usage() {
  return [
    "Usage:",
    "  workspace-runtime.mjs configure --workspace-root <absolute-path> [--reconfigure]",
    "  workspace-runtime.mjs show-config",
  ].join("\n");
}


async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      "workspace-root": { type: "string" },
      reconfigure: { type: "boolean", default: false },
    },
  });
  if (positionals.length !== 1) throw new WorkspaceRuntimeError(usage());
  const [command] = positionals;
  if (command === "configure") {
    if (!values["workspace-root"]) throw new WorkspaceRuntimeError(usage());
    const binding = await configureRuntime({
      workspaceRoot: values["workspace-root"],
      allowReconfigure: values.reconfigure,
    });
    process.stdout.write(`${JSON.stringify(binding, null, 2)}\n`);
    return;
  }
  if (command === "show-config" && !values["workspace-root"] && !values.reconfigure) {
    const binding = await loadRuntime();
    process.stdout.write(`${JSON.stringify(binding, null, 2)}\n`);
    return;
  }
  throw new WorkspaceRuntimeError(usage());
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
    process.stderr.write(`error: ${error.message}\n`);
    process.exitCode = 1;
  });
}
