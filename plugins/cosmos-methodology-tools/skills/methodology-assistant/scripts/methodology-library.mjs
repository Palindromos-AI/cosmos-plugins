import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants, realpathSync } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The methodology library is a fixed location, not a per-user binding:
// `<home>/Documents/cosmos-workspace/methodologies`. Everything that made the
// root a choice — the configuration file, its lock, and durable-root
// validation — is gone; every guarantee about the DOCUMENTS is unchanged.
const WORKSPACE_ROOT_SEGMENTS = ["Documents", "cosmos-workspace"];
const WORKSPACE_DIRECTORY = "methodologies";
const DOCUMENT_SECTIONS = [
  "Purpose",
  "Scope",
  "Principles and rules",
  "Workflow",
  "Decision points",
  "Deliverables",
  "Verification",
  "Exceptions and open questions",
  "Change history",
];

function usage() {
  return [
    "usage: methodology-library.mjs show-library",
    "       methodology-library.mjs list",
    "       methodology-library.mjs read --path <relative.md>",
    "       methodology-library.mjs save-new --path <relative.md>   # Markdown on stdin",
    "       methodology-library.mjs save-update --path <relative.md> --expected-sha256 <digest>   # Markdown on stdin",
  ].join("\n");
}

function requireAbsolute(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path: ${value}`);
  }
  return path.resolve(value);
}

// The written paths, before the filesystem is consulted. `homeDir` exists so
// tests can point at a temporary home; production passes nothing. Computed per
// call, never at import, so redirecting HOME in a spawned test moves it.
export function pinnedMethodologyLibrary({ homeDir = os.homedir() } = {}) {
  const home = requireAbsolute(homeDir, "home directory");
  const workspaceRoot = path.join(home, ...WORKSPACE_ROOT_SEGMENTS);
  return { workspaceRoot, methodologyRoot: path.join(workspaceRoot, WORKSPACE_DIRECTORY) };
}

// Create the library if it is missing and return its canonical path. `mkdir`
// follows an existing symbolic link, so the result is re-inspected: a library
// directory swapped for a link fails closed instead of silently relocating
// every confined read and write.
export async function ensureMethodologyLibrary({ libraryRoot } = {}) {
  const requested = libraryRoot === undefined
    ? pinnedMethodologyLibrary().methodologyRoot
    : requireAbsolute(libraryRoot, "methodology library");
  await mkdir(requested, { recursive: true, mode: 0o700 });
  return requireDirectory(requested, "methodology library");
}

async function requireDirectory(directory, label) {
  const info = await lstat(directory);
  if (info.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link`);
  if (!info.isDirectory()) throw new Error(`${label} must be a directory`);
  return realpath(directory);
}

function isInside(candidate, directory) {
  const relative = path.relative(path.resolve(directory), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2
    && ((trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function frontmatterFromMarkdown(content) {
  const metadata = {};
  const normalized = content.replaceAll("\r\n", "\n");
  if (normalized.startsWith("---\n")) {
    const end = normalized.indexOf("\n---\n", 4);
    if (end !== -1) {
      for (const line of normalized.slice(4, end).split("\n")) {
        const match = line.match(/^([a-z_][a-z0-9_]*):\s*(.*?)\s*$/i);
        if (match) metadata[match[1]] = unquote(match[2]);
      }
    }
  }
  return metadata;
}

function metadataFromMarkdown(content, relativePath) {
  const metadata = frontmatterFromMarkdown(content);
  const normalized = content.replaceAll("\r\n", "\n");
  const heading = normalized.match(/^#\s+(.+?)\s*$/m)?.[1] ?? path.basename(relativePath, ".md");
  const managed = documentContractErrors(content).length === 0;
  return {
    path: relativePath,
    title: metadata.title || heading,
    status: managed ? metadata.status : metadata.type === "methodology" ? "invalid" : "unmanaged",
    version: metadata.version || null,
    methodologyId: metadata.methodology_id || null,
    updatedAt: metadata.updated_at || null,
  };
}

async function readRegularFileNoFollow(absolute, label) {
  let handle;
  try {
    handle = await open(absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    if (error.code === "ELOOP") throw new Error(`${label} must not be a symbolic link`);
    throw error;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error(`${label} must be a regular file`);
    return { content: await handle.readFile("utf8"), info };
  } finally {
    await handle.close();
  }
}

async function inventoryDirectory(root, directory = root) {
  const results = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (entry.isSymbolicLink()) {
      throw new Error(`methodology library entry must not be a symbolic link: ${relative}`);
    }
    if (entry.isDirectory()) {
      results.push(...await inventoryDirectory(root, absolute));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      const { content } = await readRegularFileNoFollow(absolute, `methodology ${relative}`);
      results.push(metadataFromMarkdown(content, relative));
    }
  }
  return results;
}

export async function listMethodologies({ libraryRoot } = {}) {
  const methodologyRoot = await ensureMethodologyLibrary({ libraryRoot });
  const methodologies = await inventoryDirectory(methodologyRoot);
  methodologies.sort((left, right) => left.path.localeCompare(right.path, "en"));
  const idCounts = new Map();
  for (const methodology of methodologies) {
    if (methodology.methodologyId) {
      idCounts.set(methodology.methodologyId, (idCounts.get(methodology.methodologyId) ?? 0) + 1);
    }
  }
  for (const methodology of methodologies) {
    if (methodology.methodologyId && idCounts.get(methodology.methodologyId) > 1) {
      methodology.status = "invalid";
    }
  }
  return {
    methodologyRoot: methodologyRoot,
    methodologies,
  };
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function requireRelativeMarkdownPath(relativePath) {
  if (
    typeof relativePath !== "string"
    || relativePath === ""
    || path.isAbsolute(relativePath)
    || relativePath.includes("\\")
  ) {
    throw new Error("methodology path must be a relative POSIX Markdown path");
  }
  const normalized = path.posix.normalize(relativePath);
  if (
    normalized === "."
    || normalized === ".."
    || normalized.startsWith("../")
    || path.posix.extname(normalized).toLowerCase() !== ".md"
  ) {
    throw new Error("methodology path must stay inside the library and end in .md");
  }
  return normalized;
}

function documentContractErrors(content) {
  const metadata = frontmatterFromMarkdown(content);
  const errors = [];
  if (metadata.type !== "methodology") errors.push("type must equal methodology");
  for (const field of [
    "methodology_id",
    "title",
    "status",
    "version",
    "created_at",
    "updated_at",
  ]) {
    if (!metadata[field]) errors.push(`missing frontmatter field: ${field}`);
  }
  if (metadata.methodology_id && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.methodology_id)) {
    errors.push("methodology_id must be lowercase hyphen-separated text");
  }
  if (metadata.version && !/^\d+\.\d+\.\d+$/.test(metadata.version)) {
    errors.push("methodology version must use semantic versioning");
  }
  for (const field of ["created_at", "updated_at"]) {
    if (metadata[field] && !/^\d{4}-\d{2}-\d{2}$/.test(metadata[field])) {
      errors.push(`${field} must use YYYY-MM-DD`);
    }
  }
  if (!content.replaceAll("\r\n", "\n").match(/^#\s+.+$/m)) {
    errors.push("must contain a level-one title");
  }
  const normalized = content.replaceAll("\r\n", "\n");
  for (const section of DOCUMENT_SECTIONS) {
    if (!normalized.split("\n").includes(`## ${section}`)) {
      errors.push(`missing top-level section: ${section}`);
    }
  }
  return errors;
}

function requireManagedDocument(content) {
  const errors = documentContractErrors(content);
  if (errors.length > 0) throw new Error(`confirmed methodology violates the document contract: ${errors[0]}`);
  const metadata = frontmatterFromMarkdown(content);
  return metadata;
}

async function resolveExistingMethodology(relativePath, options = {}) {
  const normalized = requireRelativeMarkdownPath(relativePath);
  const methodologyRoot = await ensureMethodologyLibrary(options);
  const absolute = path.join(methodologyRoot, ...normalized.split("/"));
  const info = await lstat(absolute);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error(`methodology must be a regular non-symbolic-link file: ${normalized}`);
  }
  const canonical = await realpath(absolute);
  if (!isInside(canonical, methodologyRoot)) {
    throw new Error(`methodology path escapes the library: ${normalized}`);
  }
  return { methodologyRoot, normalized, absolute };
}

export async function readMethodology({ relativePath, libraryRoot }) {
  const resolved = await resolveExistingMethodology(relativePath, { libraryRoot });
  const { content } = await readRegularFileNoFollow(
    resolved.absolute,
    `methodology ${resolved.normalized}`,
  );
  return { path: resolved.normalized, sha256: sha256(content), content };
}

export async function saveNewMethodology({
  relativePath,
  content,
  libraryRoot,
}) {
  const normalized = requireRelativeMarkdownPath(relativePath);
  const metadata = requireManagedDocument(content);
  if (normalized !== `${metadata.methodology_id}.md`) {
    throw new Error("a new methodology path must equal <methodology_id>.md at the library root");
  }
  const inventory = await listMethodologies({ libraryRoot });
  const identityLock = path.join(inventory.methodologyRoot, ".methodology-library.identity-lock");
  return withOwnedFileLock(identityLock, async () => {
      const currentInventory = await listMethodologies({ libraryRoot });
      if (currentInventory.methodologies.some(
        ({ methodologyId }) => methodologyId === metadata.methodology_id,
      )) {
        throw new Error(`methodology_id already exists: ${metadata.methodology_id}`);
      }
      const absolute = path.join(inventory.methodologyRoot, normalized);
      const temporary = path.join(
        inventory.methodologyRoot,
        `.${normalized}.${randomUUID()}.tmp`,
      );
      let handle;
      try {
        handle = await open(temporary, "wx", 0o600);
        await handle.writeFile(content, "utf8");
        await handle.sync();
        await handle.close();
        handle = undefined;
        await link(temporary, absolute);
      } finally {
        if (handle) await handle.close();
        await rm(temporary, { force: true });
      }
      if (await readFile(absolute, "utf8") !== content) {
        throw new Error("saved methodology bytes do not match the confirmed draft; inspect the path manually");
      }
      return { path: normalized, sha256: sha256(content), methodologyId: metadata.methodology_id };
  });
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    return true;
  }
}

async function clearStaleLock(lockPath) {
  let handle;
  try {
    handle = await open(lockPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    if (error.code === "ENOENT") return true;
    if (error.code === "ELOOP") {
      throw new Error(`methodology update lock must not be a symbolic link: ${lockPath}`);
    }
    throw error;
  }
  const owned = await handle.stat();
  let payload;
  try {
    payload = JSON.parse(await handle.readFile("utf8"));
  } catch {
    await handle.close();
    throw new Error(
      `methodology update lock is invalid; after confirming no update process is running, remove: ${lockPath}`,
    );
  }
  await handle.close();
  if (
    !payload
    || typeof payload !== "object"
    || Array.isArray(payload)
    || !Number.isSafeInteger(payload.pid)
    || payload.pid <= 0
    || typeof payload.token !== "string"
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      payload.token,
    )
  ) {
    throw new Error(
      `methodology update lock is invalid; after confirming no update process is running, remove: ${lockPath}`,
    );
  }
  if (processIsAlive(payload.pid)) return false;
  const current = await lstat(lockPath).catch(() => null);
  if (current && current.dev === owned.dev && current.ino === owned.ino) {
    await rm(lockPath, { force: true });
    return true;
  }
  return false;
}

async function acquireOwnedFileLock(lockPath) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const temporary = path.join(
      path.dirname(lockPath),
      `.${path.basename(lockPath)}.${randomUUID()}.tmp`,
    );
    let handle;
    try {
      handle = await open(temporary, "wx", 0o600);
      const payload = `${JSON.stringify({ pid: process.pid, token: randomUUID() })}\n`;
      await handle.writeFile(payload, "utf8");
      await handle.sync();
      const owned = await handle.stat();
      await handle.close();
      handle = undefined;
      await link(temporary, lockPath);
      await rm(temporary, { force: true });
      return { owned };
    } catch (error) {
      if (handle) await handle.close();
      await rm(temporary, { force: true });
      if (error.code === "EEXIST") {
        if (attempt === 0 && await clearStaleLock(lockPath)) continue;
        throw new Error("another methodology update is in progress; retry after it finishes");
      }
      throw error;
    }
  }
  throw new Error("could not acquire methodology update lock");
}

async function withOwnedFileLock(lockPath, action) {
  const lock = await acquireOwnedFileLock(lockPath);
  try {
    return await action();
  } finally {
    const current = await lstat(lockPath).catch(() => null);
    if (current && current.dev === lock.owned.dev && current.ino === lock.owned.ino) {
      await rm(lockPath, { force: true });
    } else {
      throw new Error("methodology update lock ownership changed; inspect the target before retrying");
    }
  }
}

export async function saveUpdatedMethodology({
  relativePath,
  expectedSha256,
  content,
  libraryRoot,
}) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256 ?? "")) {
    throw new Error("expected-sha256 must be a lowercase 64-character digest");
  }
  const nextMetadata = requireManagedDocument(content);
  const resolved = await resolveExistingMethodology(relativePath, { libraryRoot });
  const lockPath = path.join(
      path.dirname(resolved.absolute),
      `.${path.basename(resolved.absolute)}.methodology-lock`,
    );
    const identityLock = path.join(
      resolved.methodologyRoot,
      ".methodology-library.identity-lock",
    );
    return withOwnedFileLock(identityLock, () => withOwnedFileLock(lockPath, async () => {
    const current = await readRegularFileNoFollow(
      resolved.absolute,
      `methodology ${resolved.normalized}`,
    );
    const currentInfo = current.info;
    const currentContent = current.content;
    if (sha256(currentContent) !== expectedSha256) {
      throw new Error("methodology changed since it was read; reconcile the concurrent edit");
    }
    const currentMetadata = frontmatterFromMarkdown(currentContent);
    const currentIsManaged = documentContractErrors(currentContent).length === 0;
    if (currentIsManaged) {
      if (currentMetadata.methodology_id !== nextMetadata.methodology_id) {
        throw new Error("an update must preserve methodology_id");
      }
      if (currentMetadata.created_at !== nextMetadata.created_at) {
        throw new Error("an update must preserve created_at");
      }
    }
    const inventory = await listMethodologies({ libraryRoot });
    if (inventory.methodologies.some(
      ({ path: inventoriedPath, methodologyId }) => (
        inventoriedPath !== resolved.normalized
        && methodologyId === nextMetadata.methodology_id
      ),
    )) {
      throw new Error(`methodology_id already exists: ${nextMetadata.methodology_id}`);
    }

    const temporary = path.join(
      path.dirname(resolved.absolute),
      `.${path.basename(resolved.absolute)}.${randomUUID()}.tmp`,
    );
    let handle;
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(content, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await chmod(temporary, currentInfo.mode & 0o7777);
      const immediatelyBeforeReplace = await readRegularFileNoFollow(
        resolved.absolute,
        `methodology ${resolved.normalized}`,
      );
      if (
        immediatelyBeforeReplace.info.dev !== currentInfo.dev
        || immediatelyBeforeReplace.info.ino !== currentInfo.ino
        || sha256(immediatelyBeforeReplace.content) !== expectedSha256
      ) {
        throw new Error("methodology changed during the update; reconcile the concurrent edit");
      }
      await rename(temporary, resolved.absolute);
      if (await readFile(resolved.absolute, "utf8") !== content) {
        throw new Error("saved methodology bytes do not match the confirmed draft");
      }
    } finally {
      if (handle) await handle.close();
      await rm(temporary, { force: true });
    }
    return {
      path: resolved.normalized,
      sha256: sha256(content),
      methodologyId: nextMetadata.methodology_id,
    };
    }));
}

async function readStandardInput(stream = process.stdin) {
  if (stream.isTTY) throw new Error("pipe the confirmed methodology via standard input");
  let content = "";
  for await (const chunk of stream) content += chunk;
  if (content.length === 0) throw new Error("confirmed methodology input must not be empty");
  return content;
}

export function isMainModule(argv1 = process.argv[1], moduleUrl = import.meta.url) {
  if (!argv1) return false;
  if (pathToFileURL(path.resolve(argv1)).href === moduleUrl) return true;
  try {
    return pathToFileURL(realpathSync(argv1)).href === moduleUrl;
  } catch {
    return false;
  }
}

async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  let result;
  if (command === "show-library" && args.length === 0) {
    // Both fields come from the resolved library, so the printed pair cannot
    // disagree in form when an ancestor is a symbolic link.
    const methodologyRoot = await ensureMethodologyLibrary();
    result = { workspaceRoot: path.dirname(methodologyRoot), methodologyRoot };
  } else if (command === "list" && args.length === 0) {
    result = await listMethodologies();
  } else if (command === "read" && args.length === 2 && args[0] === "--path") {
    result = await readMethodology({ relativePath: args[1] });
  } else if (command === "save-new" && args.length === 2 && args[0] === "--path") {
    result = await saveNewMethodology({
      relativePath: args[1],
      content: await readStandardInput(),
    });
  } else if (command === "save-update") {
    let relativePath = null;
    let expectedSha256 = null;
    for (let index = 0; index < args.length; index += 1) {
      if (args[index] === "--path" && relativePath === null && index + 1 < args.length) {
        relativePath = args[index + 1];
        index += 1;
      } else if (
        args[index] === "--expected-sha256"
        && expectedSha256 === null
        && index + 1 < args.length
      ) {
        expectedSha256 = args[index + 1];
        index += 1;
      } else {
        throw new Error(usage());
      }
    }
    if (relativePath === null || expectedSha256 === null) throw new Error(usage());
    result = await saveUpdatedMethodology({
      relativePath,
      expectedSha256,
      content: await readStandardInput(),
    });
  } else {
    throw new Error(usage());
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (isMainModule()) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
