import { randomBytes } from "node:crypto";
import { constants, realpathSync } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  realpath,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{6}Z$/;
const HEX_ID = /^[0-9a-f]{8}$/;
const CLI_ARGUMENTS = new Set(["repo", "plugin", "scope"]);

function requireSafeSlug(value, label) {
  if (typeof value !== "string" || !SAFE_SLUG.test(value)) {
    throw new Error(`${label} must be a lowercase hyphen-separated slug`);
  }
  return value;
}

function utcTimestamp(now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) {
    throw new Error("now must be a valid Date");
  }
  const iso = now.toISOString();
  return `${iso.slice(0, 10)}T${iso.slice(11, 19).replaceAll(":", "")}Z`;
}

// The directory itself must be a real directory (never a symbolic link), but
// symbolic-link ancestors such as macOS `/tmp` -> `/private/tmp` or a synced
// folder are accepted; every later operation uses the canonical path. The
// final comparison re-checks the leaf after `realpath`, so a directory swapped
// for a symbolic link between `lstat` and `realpath` is still rejected.
async function requireCanonicalDirectory(directory, label) {
  const stats = await lstat(directory);
  if (stats.isSymbolicLink()) {
    throw new Error(`${label} must not be a symbolic link`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`${label} must be a directory`);
  }
  const canonical = await realpath(directory);
  const expected = path.join(
    await realpath(path.dirname(directory)),
    path.basename(directory),
  );
  if (canonical !== expected) {
    throw new Error(`${label} must not be a symbolic link`);
  }
  return canonical;
}

async function ensureDirectChildDirectory(parent, name, label) {
  const child = path.join(parent, name);
  try {
    await mkdir(child, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const canonical = await requireCanonicalDirectory(child, label);
  if (path.dirname(canonical) !== parent) {
    throw new Error(`${label} resolves outside the report repository`);
  }
  return canonical;
}

// Mechanical privacy floor: the report must never carry the actual workspace
// root, the home directory, or a caller-supplied business identifier; the
// sanctioned replacement is a placeholder such as `<cosmos-workspace-root>`.
function requireSanitizedContent(content, { repo, canonicalRepo, forbidden }) {
  const text = typeof content === "string"
    ? content
    : Buffer.from(content).toString("utf8");
  const localPaths = new Set(
    [path.dirname(path.resolve(repo)), path.dirname(canonicalRepo), homedir()]
      .filter((candidate) => candidate.length >= 5),
  );
  for (const localPath of localPaths) {
    if (text.includes(localPath)) {
      throw new Error(
        `report content must not contain the local path ${localPath}; replace it with <cosmos-workspace-root> or another placeholder`,
      );
    }
  }
  for (const identifier of forbidden) {
    if (typeof identifier !== "string" || identifier.length === 0) {
      throw new Error("forbidden identifiers must be non-empty strings");
    }
    if (text.includes(identifier)) {
      throw new Error(
        `report content must not contain the forbidden identifier "${identifier}"; replace it with a neutral placeholder`,
      );
    }
  }
}

export async function writeReport({
  repo,
  plugin,
  scope,
  content,
  timestamp = utcTimestamp(),
  id = randomBytes(4).toString("hex"),
  forbidden = [],
}) {
  if (typeof repo !== "string" || !path.isAbsolute(repo)) {
    throw new Error("report repository must be an absolute path");
  }
  const safePlugin = requireSafeSlug(plugin, "plugin");
  const safeScope = requireSafeSlug(scope, "scope");
  if (typeof content !== "string" && !(content instanceof Uint8Array)) {
    throw new Error("report content must be text or bytes");
  }
  if (content.length === 0) {
    throw new Error("report content must not be empty");
  }
  if (typeof timestamp !== "string" || !TIMESTAMP.test(timestamp)) {
    throw new Error("timestamp must use YYYY-MM-DDTHHMMSSZ UTC format");
  }
  if (typeof id !== "string" || !HEX_ID.test(id)) {
    throw new Error("id must contain exactly eight lowercase hexadecimal characters");
  }

  const canonicalRepo = await requireCanonicalDirectory(repo, "report repository");
  requireSanitizedContent(content, { repo, canonicalRepo, forbidden });
  const pluginDirectory = await ensureDirectChildDirectory(
    canonicalRepo,
    safePlugin,
    "plugin report directory",
  );
  const scopeDirectory = await ensureDirectChildDirectory(
    pluginDirectory,
    safeScope,
    "scope report directory",
  );
  const filename = `${timestamp}-${id}.md`;
  const absolutePath = path.join(scopeDirectory, filename);
  const relativePath = path.relative(canonicalRepo, absolutePath);
  if (relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error("report path resolves outside the report repository");
  }

  const flags = constants.O_CREAT
    | constants.O_EXCL
    | constants.O_WRONLY
    | (constants.O_NOFOLLOW ?? 0);
  let handle;
  try {
    handle = await open(absolutePath, flags, 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`report path already exists: ${relativePath}`);
    }
    throw error;
  }
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }

  return { absolutePath, relativePath };
}

export function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error("expected --repo, --plugin, and --scope argument pairs");
    }
    const name = flag.slice(2);
    if (name === "forbid") {
      (values.forbid ??= []).push(value);
      continue;
    }
    if (!CLI_ARGUMENTS.has(name)) {
      throw new Error(`unknown argument: ${flag}`);
    }
    if (Object.hasOwn(values, name)) {
      throw new Error(`duplicate argument: ${flag}`);
    }
    values[name] = value;
  }
  for (const name of CLI_ARGUMENTS) {
    if (!Object.hasOwn(values, name)) {
      throw new Error(`missing argument: --${name}`);
    }
  }
  return values;
}

async function readStandardInput() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const content = await readStandardInput();
  const report = await writeReport({
    repo: args.repo,
    plugin: args.plugin,
    scope: args.scope,
    content,
    forbidden: args.forbid ?? [],
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
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
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
