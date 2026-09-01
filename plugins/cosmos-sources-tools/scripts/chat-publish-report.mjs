#!/usr/bin/env node

// Publish chat-source reports into one date directory per Beijing target date
// or one ranges/<start>_to_<end> directory per merged range. The publisher
// appends the hidden identity marker itself. Repeated runs for the same stable
// scope key and group list refresh the same path; different scopes and
// user-owned files are never overwritten.

import { randomUUID } from "node:crypto";
import { lstat, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { withOutputLock } from "./output-lock.mjs";
import {
  isMainEntry,
  requireCalendarDate,
  resolveDatedOutputPath,
  resolveRangeOutputPath,
} from "./workspace-runtime.mjs";

const NAMESPACES = new Set(["dingtalk", "feishu"]);
const MAX_RANGE_DAYS = 31;
// The reserved unfiltered scope: key and display wording are fixed together.
const ALL_SCOPE_KEY = "all";
const ALL_FILTER_TEXT = "全部内容";

function requireNamespace(value) {
  if (!NAMESPACES.has(value)) {
    throw new TypeError(`namespace must be one of: ${[...NAMESPACES].join(", ")}`);
  }
  return value;
}

function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

// A report covers either one Beijing date or a merged YYYY-MM-DD_to_YYYY-MM-DD range.
export function splitDateRange(value) {
  const match = /^(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})$/u.exec(
    typeof value === "string" ? value : "",
  );
  if (!match) return null;
  const start = requireCalendarDate(match[1]);
  const end = requireCalendarDate(match[2]);
  if (start >= end) {
    throw new TypeError("date range start must be strictly earlier than its end");
  }
  const days = Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
  ) + 1;
  if (days > MAX_RANGE_DAYS) {
    throw new TypeError(`date range must span at most ${MAX_RANGE_DAYS} days`);
  }
  return { start, end };
}

function requireDate(value) {
  if (typeof value === "string" && value.includes("_to_")) {
    if (!splitDateRange(value)) {
      throw new TypeError("date range must use YYYY-MM-DD_to_YYYY-MM-DD");
    }
    return value;
  }
  return requireCalendarDate(value);
}

function requireScope(scope) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    throw new TypeError("scope must be an object");
  }
  const key = requireText(scope.key, "scope.key");
  if (!Array.isArray(scope.groups) || scope.groups.length === 0) {
    throw new TypeError("scope.groups must be a non-empty array");
  }
  const groups = scope.groups.map((group, index) =>
    requireText(group, `scope.groups[${index}]`));
  const filter = requireText(scope.filter, "scope.filter");
  if (key === ALL_SCOPE_KEY && filter !== ALL_FILTER_TEXT) {
    throw new TypeError(
      `scope.key "${ALL_SCOPE_KEY}" is reserved for the unfiltered ${ALL_FILTER_TEXT} scope`,
    );
  }
  return { key, groups, filter };
}

function normalizeReport({ namespace, date, snapshotAt, completeness, scope }) {
  const space = requireNamespace(namespace);
  const targetDate = requireDate(date);
  const snapshot = new Date(snapshotAt);
  if (Number.isNaN(snapshot.valueOf())) {
    throw new TypeError("snapshotAt must be a real timestamp");
  }
  if (completeness !== "complete" && completeness !== "incomplete") {
    throw new TypeError("completeness must equal complete or incomplete");
  }
  return {
    namespace: space,
    date: targetDate,
    snapshotAt: snapshot.valueOf(),
    completeness,
    scope: requireScope(scope),
  };
}

function renderMarkerFromReport(report) {
  const encodedScope = Buffer.from(JSON.stringify(report.scope), "utf8")
    .toString("base64url");
  return `<!-- cosmos-chat-fetch | namespace=${report.namespace} | date=${report.date} | snapshot_at=${encodeURIComponent(new Date(report.snapshotAt).toISOString())} | completeness=${report.completeness} | scope=${encodedScope} -->`;
}

export function renderGeneratedMarker(input) {
  return renderMarkerFromReport(normalizeReport(input));
}

function parseGeneratedMarker(markdown) {
  const match = markdown.match(
    /<!-- cosmos-chat-fetch \| namespace=(dingtalk|feishu) \| date=(\d{4}-\d{2}-\d{2}(?:_to_\d{4}-\d{2}-\d{2})?) \| snapshot_at=([^|]+) \| completeness=(complete|incomplete) \| scope=([A-Za-z0-9_-]+) -->\s*$/u,
  );
  if (!match) {
    throw new Error("generated report must end with a valid cosmos-chat-fetch marker");
  }
  let scope;
  try {
    scope = requireScope(JSON.parse(Buffer.from(match[5], "base64url").toString("utf8")));
  } catch {
    throw new Error("generated report marker contains an invalid structured scope");
  }
  const snapshotAt = Date.parse(decodeURIComponent(match[3].trim()));
  if (Number.isNaN(snapshotAt)) {
    throw new Error("generated report marker snapshot_at is invalid");
  }
  return {
    namespace: match[1],
    date: requireDate(match[2]),
    snapshotAt,
    completeness: match[4],
    scope,
  };
}

function sameScope(left, right) {
  return (
    left.namespace === right.namespace
    && left.date === right.date
    && left.scope.key === right.scope.key
    && left.scope.groups.length === right.scope.groups.length
    && left.scope.groups.every((group, index) => group === right.scope.groups[index])
  );
}

function incompletePath(canonicalPath) {
  return canonicalPath.replace(/\.md$/u, ".incomplete.md");
}

function canonicalPathFor(target, completeness) {
  if (completeness === "complete") {
    if (target.endsWith(".incomplete.md")) {
      throw new Error("complete report target must not use .incomplete.md");
    }
    return target;
  }
  if (!target.endsWith(".incomplete.md")) {
    throw new Error("incomplete report target must use .incomplete.md");
  }
  return target.slice(0, -".incomplete.md".length) + ".md";
}

function assertCompatible(existing, current, target) {
  if (!sameScope(existing.metadata, current)) {
    throw new Error(`refusing to overwrite a different collection scope: ${target}`);
  }
  if (existing.metadata.snapshotAt > current.snapshotAt) {
    throw new Error(`refusing to replace a newer generated report: ${target}`);
  }
}

async function readRegularFile(target) {
  let metadata;
  try {
    metadata = await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${target} must be a regular file, not a symbolic link`);
  }
  return readFile(target);
}

// An existing target is replaceable only when it carries a generated marker.
async function readGeneratedReport(target) {
  const bytes = await readRegularFile(target);
  if (bytes === null) return null;
  return { bytes, metadata: parseGeneratedMarker(bytes.toString("utf8")) };
}

async function writeExclusive(target, bytes) {
  const handle = await open(target, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    await unlink(target).catch(() => {});
    throw error;
  } finally {
    await handle.close();
  }
}

async function writeTarget(target, bytes, hasExisting) {
  if (!hasExisting) {
    try {
      await writeExclusive(target, bytes);
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new Error(`output appeared concurrently and was not replaced: ${target}`);
      }
      throw error;
    }
    return;
  }
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  try {
    await writeExclusive(temporary, bytes);
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export async function publishReport({
  namespace,
  draftPath,
  targetPath,
  date,
  snapshotAt,
  completeness,
  scope,
  workspace,
}) {
  const report = normalizeReport({ namespace, date, snapshotAt, completeness, scope });
  const marker = renderMarkerFromReport(report);
  const draft = path.resolve(requireText(draftPath, "draftPath"));
  const requestedTarget = path.resolve(requireText(targetPath, "targetPath"));
  if (!requestedTarget.endsWith(".md")) {
    throw new Error("target must be a .md target");
  }

  const reportRange = splitDateRange(report.date);
  const target = reportRange
    ? await resolveRangeOutputPath(
      requestedTarget,
      { workspace },
      report.namespace,
      reportRange.start,
      reportRange.end,
    )
    : await resolveDatedOutputPath(
      requestedTarget,
      { workspace },
      report.namespace,
      report.date,
    );
  if (path.dirname(draft) !== path.dirname(target)) {
    throw new Error("draft and target must be in the same output directory");
  }
  const canonical = canonicalPathFor(target, report.completeness);
  const partial = incompletePath(canonical);

  const draftBytes = await readRegularFile(draft);
  if (draftBytes === null) {
    throw new Error(`draft does not exist: ${draft}`);
  }
  let draftText;
  try {
    draftText = new TextDecoder("utf-8", { fatal: true }).decode(draftBytes);
  } catch {
    throw new Error("draft must be valid UTF-8");
  }
  if (draftText.includes("cosmos-chat-fetch")) {
    throw new Error("draft must not already contain a cosmos-chat-fetch marker; the publisher appends it");
  }
  const published = Buffer.from(
    `${draftText}${draftText.endsWith("\n") ? "" : "\n"}${marker}\n`,
    "utf8",
  );

  await withOutputLock(canonical, async () => {
    const existingCanonical = await readGeneratedReport(canonical);
    let existingPartial = null;
    if (report.completeness === "incomplete") {
      existingPartial = await readGeneratedReport(partial);
    } else {
      // A complete refresh ignores (and retains) a foreign or user-owned sibling.
      try {
        existingPartial = await readGeneratedReport(partial);
      } catch {
        existingPartial = null;
      }
    }
    if (existingCanonical) assertCompatible(existingCanonical, report, canonical);
    if (existingPartial) {
      if (sameScope(existingPartial.metadata, report)) {
        assertCompatible(existingPartial, report, partial);
      } else if (report.completeness === "incomplete") {
        throw new Error(`refusing to overwrite a different collection scope: ${partial}`);
      } else {
        existingPartial = null;
      }
    }

    const existingTarget = target === canonical ? existingCanonical : existingPartial;
    await writeTarget(target, published, Boolean(existingTarget));

    if (report.completeness === "complete" && existingPartial) {
      await unlink(partial);
    }
  });

  try {
    await unlink(draft);
  } catch (error) {
    throw new Error(`report was published but the draft could not be removed: ${draft}`, {
      cause: error,
    });
  }
  return target;
}

const USAGE = "usage: chat-publish-report.mjs <namespace> <draft-path> <target-path> --scope-json <path> --date <YYYY-MM-DD | start_to_end> --snapshot-at <timestamp> --completeness <complete|incomplete>\n";

if (isMainEntry(import.meta.url)) {
  let parsed;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      strict: true,
      options: {
        "scope-json": { type: "string" },
        date: { type: "string" },
        "snapshot-at": { type: "string" },
        completeness: { type: "string" },
      },
    });
  } catch {
    parsed = null;
  }
  const positionals = parsed?.positionals ?? [];
  const values = parsed?.values ?? {};
  if (
    !parsed
    || positionals.length !== 3
    || !values["scope-json"]
    || !values.date
    || !values["snapshot-at"]
    || !values.completeness
  ) {
    process.stderr.write(USAGE);
    process.exitCode = 1;
  } else {
    try {
      const scope = JSON.parse(await readFile(values["scope-json"], "utf8"));
      const publishedPath = await publishReport({
        namespace: positionals[0],
        draftPath: positionals[1],
        targetPath: positionals[2],
        date: values.date,
        snapshotAt: values["snapshot-at"],
        completeness: values.completeness,
        scope,
      });
      process.stdout.write(`${JSON.stringify({ published_path: publishedPath })}\n`);
    } catch (error) {
      process.stderr.write(`chat-publish-report: ${error.message}\n`);
      process.exitCode = 1;
    }
  }
}
