import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
} from "node:path";
import {
  GENERATOR,
  SCHEMA_VERSION,
  assessManifest,
  renderAudit,
  renderReader,
  sha256Utf8,
  validateAudit,
  verifyManifestEvidence,
} from "./run-model.mjs";
import { resolveOutputPath } from "../../../scripts/workspace-runtime.mjs";

const RUN_MARKER = ".zsxq-fetch-run.json";
const MANIFEST = "manifest.json";
const LOCK_DATABASE = ".zsxq-fetch-run.lock.sqlite";
const OUTPUT_LOCK_DIRECTORY = "zsxq-fetch-output-locks-v1";
const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/u;

function sameFileVersion(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs
  );
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
  const result = value.trim();
  if (/\r|\n|[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(result)) {
    throw new Error(`${name} contains characters unsupported by the generated marker`);
  }
  return result;
}

function requiredUrl(value, name) {
  const result = requiredString(value, name);
  let parsed;
  try {
    parsed = new URL(result);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${name} must use http or https`);
  }
  return result;
}

function requiredTimestamp(value, name) {
  const result = requiredString(value, name);
  if (!ISO_TIMESTAMP.test(result) || Number.isNaN(Date.parse(result))) {
    throw new Error(
      `${name} must be an ISO-8601 date-time with an explicit Z or UTC offset`,
    );
  }
  return result;
}

function requiredDate(value) {
  const result = requiredString(value, "date");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(result)) {
    throw new Error("date must use YYYY-MM-DD");
  }
  const parsed = new Date(`${result}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== result) {
    throw new Error("date is not a real calendar date");
  }
  return result;
}

function isInside(child, parent) {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function createWorkspace(workspace) {
  try {
    await mkdir(workspace, { recursive: false });
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(
        `Run workspace path must not already exist; choose a new path: ${workspace}`,
      );
    }
    throw error;
  }
}

async function canonicalOutputPath(path) {
  const requested = resolve(path);
  const parent = dirname(requested);
  await mkdir(parent, { recursive: true });
  return resolve(await realpath(parent), basename(requested));
}

async function writeJsonExclusive(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

export async function createRun(workspacePath, config, { runtimeOptions } = {}) {
  const requestedWorkspace = resolve(workspacePath);
  const requestedOutput = resolve(requiredString(config.output_path, "output_path"));
  if (extname(requestedOutput).toLowerCase() !== ".md") {
    throw new Error("output_path must end in .md");
  }
  await createWorkspace(requestedWorkspace);
  const workspace = await realpath(requestedWorkspace);
  try {
    const confinedOutput = await resolveOutputPath(requestedOutput, runtimeOptions, "zsxq");
    const outputPath = await canonicalOutputPath(confinedOutput);
    if (isInside(outputPath, workspace)) {
      throw new Error("output_path must be outside the temporary run workspace");
    }
    const runId = randomUUID();
    const manifest = {
      schema_version: SCHEMA_VERSION,
      generator: GENERATOR,
      run_id: runId,
      workspace,
      planet: requiredString(config.planet, "planet"),
      planet_url: requiredUrl(config.planet_url, "planet_url"),
      date: requiredDate(config.date),
      retrieved_at: requiredTimestamp(
        config.retrieved_at ?? new Date().toISOString(),
        "retrieved_at",
      ),
      snapshot_at: requiredTimestamp(config.snapshot_at, "snapshot_at"),
      output_path: outputPath,
      coverage: {
        top_established: false,
        pending_new_content_loaded: false,
        crossed_below_target_date: false,
        chronology_consistent: false,
        access_complete: false,
        evidence: "尚未记录时间线覆盖",
        failure_reason: "时间线覆盖尚未完成",
      },
      inventory: { recorded: false, topics: [] },
      topics: [],
    };
    await writeJsonExclusive(resolve(workspace, RUN_MARKER), {
      generator: GENERATOR,
      run_id: runId,
      workspace,
    });
    await writeJsonExclusive(resolve(workspace, MANIFEST), manifest);
    return manifest;
  } catch (error) {
    await rm(workspace, { recursive: true, force: true });
    throw error;
  }
}

async function readJson(path, label) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} is unreadable or invalid JSON: ${error.message}`);
  }
  return parsed;
}

export async function loadRun(workspacePath) {
  const workspace = await realpath(resolve(workspacePath));
  const [marker, manifest] = await Promise.all([
    readJson(resolve(workspace, RUN_MARKER), "Run marker"),
    readJson(resolve(workspace, MANIFEST), "Run manifest"),
  ]);
  if (
    marker.generator !== GENERATOR ||
    marker.workspace !== workspace ||
    manifest.generator !== GENERATOR ||
    manifest.workspace !== workspace ||
    marker.run_id !== manifest.run_id
  ) {
    throw new Error(`Workspace is not an intact ${GENERATOR} run: ${workspace}`);
  }
  return manifest;
}

export async function saveRun(manifest) {
  const current = await loadRun(manifest.workspace);
  if (current.run_id !== manifest.run_id) {
    throw new Error("Run identity changed while saving the manifest");
  }
  const target = resolve(manifest.workspace, MANIFEST);
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  await writeJsonExclusive(temporary, manifest);
  try {
    const before = await stat(target, { bigint: true });
    const latest = await loadRun(manifest.workspace);
    const after = await stat(target, { bigint: true });
    if (latest.run_id !== manifest.run_id || !sameFileVersion(before, after)) {
      throw new Error("Run manifest changed concurrently and was not replaced");
    }
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function assertLockDatabasePath(lockPath) {
  try {
    const metadata = await lstat(lockPath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`Run lock database must be a regular file: ${lockPath}`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

function sqliteIsBusy(error) {
  return error.errcode === 5 || error.message === "database is locked";
}

async function withSqliteWriteLock(
  lockPath,
  action,
  { waitMs = 0, contentionMessage },
) {
  await assertLockDatabasePath(lockPath);
  const deadline = Date.now() + waitMs;
  let database = null;
  while (!database) {
    let candidate;
    try {
      candidate = new DatabaseSync(lockPath);
      candidate.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE");
      database = candidate;
    } catch (error) {
      try {
        candidate?.close();
      } catch {
        // Preserve the acquisition error.
      }
      if (!sqliteIsBusy(error)) {
        throw error;
      }
      if (Date.now() >= deadline) {
        throw new Error(contentionMessage);
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    }
  }
  try {
    return await action();
  } finally {
    try {
      database.exec("ROLLBACK");
    } finally {
      database.close();
    }
  }
}

export async function withRunLock(workspacePath, action) {
  const workspace = await realpath(resolve(workspacePath));
  await loadRun(workspace);
  return withSqliteWriteLock(
    resolve(workspace, LOCK_DATABASE),
    action,
    {
      contentionMessage: `Another ${GENERATOR} process is modifying this run`,
    },
  );
}

async function withOutputLock(targetPath, action) {
  const canonicalTarget = await canonicalOutputPath(targetPath);
  const requestedDirectory = resolve(tmpdir(), OUTPUT_LOCK_DIRECTORY);
  await mkdir(requestedDirectory, { recursive: true, mode: 0o700 });
  const lockDirectory = await realpath(requestedDirectory);
  const lockPath = resolve(lockDirectory, `${sha256Utf8(canonicalTarget)}.sqlite`);
  return withSqliteWriteLock(lockPath, action, {
    waitMs: 10_000,
    contentionMessage: `Timed out waiting to update output: ${canonicalTarget}`,
  });
}

export function incompletePath(canonicalPath) {
  const extension = extname(canonicalPath);
  return `${canonicalPath.slice(0, -extension.length)}.incomplete${extension}`;
}

export function parseGeneratedMarker(markdown) {
  const match = markdown.match(
    /<!-- zsxq-fetch \| planet=([^|]+) \| planet_url=([^|]+) \| date=([^|]+) \| snapshot_at=([^|]+) \| post_count=(\d+) \| completeness=(complete|incomplete) -->\s*$/u,
  );
  if (!match) {
    return null;
  }
  try {
    const marker = {
      planet: decodeURIComponent(match[1].trim()),
      planet_url: decodeURIComponent(match[2].trim()),
      date: match[3].trim(),
      snapshot_at: requiredTimestamp(
        decodeURIComponent(match[4].trim()),
        "Generated marker snapshot_at",
      ),
      post_count: Number(match[5]),
      completeness: match[6],
    };
    return marker;
  } catch {
    return null;
  }
}

function assertMarkerScope(marker, scope, target) {
  if (!marker) {
    throw new Error(`Refusing to overwrite an unmarked file: ${target}`);
  }
  if (
    marker.planet !== scope.planet ||
    marker.planet_url !== scope.planet_url ||
    marker.date !== scope.date
  ) {
    throw new Error(`Refusing to overwrite a different planet or date: ${target}`);
  }
}

async function inspectExisting(path, scope) {
  let handle;
  try {
    handle = await open(path, "r");
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  try {
    const before = await handle.stat({ bigint: true });
    const markdown = await handle.readFile("utf8");
    const after = await handle.stat({ bigint: true });
    if (!sameFileVersion(before, after)) {
      throw new Error(`Output changed while it was inspected: ${path}`);
    }
    const marker = parseGeneratedMarker(markdown);
    assertMarkerScope(marker, scope, path);
    const pathStat = await stat(path, { bigint: true });
    if (!sameFileVersion(after, pathStat)) {
      throw new Error(`Output path changed while it was inspected: ${path}`);
    }
    return { marker, version: after };
  } finally {
    await handle.close();
  }
}

async function writeReaderUnlocked(
  targetPath,
  markdown,
  scope,
  completeness,
  { beforeFinalCheck } = {},
) {
  const target = resolve(targetPath);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  await writeFile(temporary, markdown, { encoding: "utf8", flag: "wx" });
  try {
    const existing = await inspectExisting(target, scope);
    if (!existing) {
      let targetHandle;
      try {
        targetHandle = await open(target, "wx");
      } catch (error) {
        if (error.code === "EEXIST") {
          throw new Error(`Output appeared concurrently and was not replaced: ${target}`);
        }
        throw error;
      }
      try {
        await targetHandle.writeFile(markdown, "utf8");
      } catch (error) {
        await unlink(target).catch(() => {});
        throw error;
      } finally {
        await targetHandle.close();
      }
      await unlink(temporary);
    } else {
      if (Date.parse(existing.marker.snapshot_at) > Date.parse(scope.snapshot_at)) {
        throw new Error(`Refusing to replace a newer generated report: ${target}`);
      }
      if (existing.marker.completeness === "complete" && completeness === "incomplete") {
        throw new Error(`Refusing to replace a complete report with an incomplete report: ${target}`);
      }
      if (beforeFinalCheck) {
        await beforeFinalCheck();
      }
      const latest = await inspectExisting(target, scope);
      if (!sameFileVersion(existing.version, latest.version)) {
        throw new Error(`Output changed concurrently and was not replaced: ${target}`);
      }
      await rename(temporary, target);
    }
    if ((await readFile(target, "utf8")) !== markdown) {
      throw new Error(`Output content changed while writing: ${target}`);
    }
    return target;
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export async function writeReaderSafely(
  targetPath,
  markdown,
  scope,
  completeness,
  options = {},
) {
  return withOutputLock(targetPath, () =>
    writeReaderUnlocked(targetPath, markdown, scope, completeness, options),
  );
}

export async function removeStalePartial(canonicalPath, scope, snapshotAt) {
  const partialPath = incompletePath(canonicalPath);
  let existing;
  try {
    existing = await inspectExisting(partialPath, scope);
  } catch (error) {
    if (error.message.startsWith("Refusing to overwrite")) {
      return { removed: false, reason: error.message, path: partialPath };
    }
    throw error;
  }
  if (!existing) {
    return { removed: false, reason: "missing", path: partialPath };
  }
  if (existing.marker.completeness !== "incomplete") {
    return { removed: false, reason: "not-incomplete", path: partialPath };
  }
  if (Date.parse(existing.marker.snapshot_at) > Date.parse(snapshotAt)) {
    return { removed: false, reason: "newer-snapshot", path: partialPath };
  }
  const latest = await inspectExisting(partialPath, scope);
  if (!sameFileVersion(existing.version, latest.version)) {
    return { removed: false, reason: "changed-concurrently", path: partialPath };
  }
  await unlink(partialPath);
  return { removed: true, path: partialPath };
}

async function assertCanonicalScopeIfPresent(manifest) {
  const existing = await inspectExisting(manifest.output_path, manifest);
  if (
    existing &&
    Date.parse(existing.marker.snapshot_at) > Date.parse(manifest.snapshot_at)
  ) {
    throw new Error(
      `Refusing to write beside a newer generated report: ${manifest.output_path}`,
    );
  }
}

async function assertOutputOutsideWorkspace(manifest) {
  const canonicalOutput = await canonicalOutputPath(manifest.output_path);
  if (
    canonicalOutput !== manifest.output_path ||
    isInside(canonicalOutput, manifest.workspace)
  ) {
    throw new Error("Resolved output path is inside the temporary run workspace");
  }
}

async function cleanupRun(manifest) {
  const marker = await readJson(resolve(manifest.workspace, RUN_MARKER), "Run marker");
  if (
    marker.generator !== GENERATOR ||
    marker.run_id !== manifest.run_id ||
    marker.workspace !== manifest.workspace
  ) {
    throw new Error("Refusing to clean a workspace whose run marker changed");
  }
  await rm(manifest.workspace, { recursive: true });
}

export async function finalizeRun(workspacePath, options = {}) {
  return withRunLock(workspacePath, async () => {
    const manifest = await loadRun(workspacePath);
    const progress = assessManifest(manifest);
    if (!progress.coverage_proven) {
      throw new Error(
        `Timeline coverage is not proven; no report was written: ${manifest.coverage.failure_reason}`,
      );
    }
    const assessment = assessManifest(manifest, { requireInventoryComplete: true });
    await verifyManifestEvidence(manifest);
    await assertOutputOutsideWorkspace(manifest);
    const audit = renderAudit(manifest);
    const auditPath = resolve(manifest.workspace, "extraction-audit.md");
    await writeFile(auditPath, audit, "utf8");
    validateAudit(await readFile(auditPath, "utf8"), manifest);

    const reader = renderReader(manifest);
    const output =
      assessment.completeness === "complete"
        ? manifest.output_path
        : incompletePath(manifest.output_path);
    const { written, stalePartial } = await withOutputLock(
      manifest.output_path,
      async () => {
        await assertCanonicalScopeIfPresent(manifest);
        const lockedWritten = await writeReaderUnlocked(
          output,
          reader,
          manifest,
          assessment.completeness,
          options,
        );
        const lockedStalePartial =
          assessment.completeness === "complete"
            ? await removeStalePartial(
                manifest.output_path,
                manifest,
                manifest.snapshot_at,
              )
            : { removed: false, reason: "not-applicable" };
        return {
          written: lockedWritten,
          stalePartial: lockedStalePartial,
        };
      },
    );
    await unlink(auditPath);
    if (options.cleanup !== false) {
      await cleanupRun(manifest);
    }
    return {
      output: written,
      date: manifest.date,
      planet: manifest.planet,
      post_count: assessment.post_count,
      completeness: assessment.completeness,
      extraction_failure_count: assessment.extraction_failure_count,
      stale_partial_removed: stalePartial.removed,
      stale_partial: stalePartial,
    };
  });
}
