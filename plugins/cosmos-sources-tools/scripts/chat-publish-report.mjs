#!/usr/bin/env node

// Publish verified chat-source report artifacts without clobbering. Shared by
// dingding-fetch and feishu-fetch; the namespace selects the output directory
// and the draft naming so the two skills cannot drift apart.

import { realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, open, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveOutputPath } from "./workspace-runtime.mjs";

const NAMESPACES = new Set(["dingtalk", "feishu"]);

function requireNamespace(value) {
  if (!NAMESPACES.has(value)) {
    throw new TypeError(`namespace must be one of: ${[...NAMESPACES].join(", ")}`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return path.resolve(value);
}

function requireSha256(value) {
  if (typeof value !== "string" || !/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new TypeError("expectedSha256 must be a 64-character hexadecimal SHA-256");
  }
  return value.toLowerCase();
}

async function readStableRegularFile(draft) {
  const pathStat = await lstat(draft);
  if (!pathStat.isFile() || pathStat.isSymbolicLink()) {
    throw new Error("draft must be a regular file, not a symbolic link");
  }

  const handle = await open(draft, "r");
  try {
    const openedStat = await handle.stat();
    if (!openedStat.isFile()
      || openedStat.dev !== pathStat.dev
      || openedStat.ino !== pathStat.ino) {
      throw new Error("draft changed while it was being opened");
    }
    return { bytes: await handle.readFile(), pathStat };
  } finally {
    await handle.close();
  }
}

export async function publishReport({
  namespace,
  draftPath,
  targetPath,
  expectedSha256,
  runtimeOptions,
}) {
  const space = requireNamespace(namespace);
  const draft = requireString(draftPath, "draftPath");
  const target = await resolveOutputPath(
    requireString(targetPath, "targetPath"),
    runtimeOptions,
    space,
  );
  const expected = requireSha256(expectedSha256);
  if (path.dirname(draft) !== path.dirname(target)) {
    throw new Error("draft and target must be in the same directory");
  }
  const draftPattern = new RegExp(`^\\.${space}-digest-[A-Za-z0-9-]+\\.tmp$`);
  if (!draftPattern.test(path.basename(draft))) {
    throw new Error(`draft must use the .${space}-digest-<id>.tmp name`);
  }
  if (!target.endsWith(".md")) {
    throw new Error("target must be a .md target");
  }

  const { bytes, pathStat } = await readStableRegularFile(draft);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) {
    throw new Error(`draft SHA-256 mismatch: expected ${expected}, received ${actual}`);
  }

  let targetHandle;
  try {
    targetHandle = await open(target, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`target already exists: ${target}`, { cause: error });
    }
    throw error;
  }
  try {
    await targetHandle.writeFile(bytes);
    await targetHandle.sync();
  } catch (error) {
    await unlink(target).catch(() => {});
    throw error;
  } finally {
    await targetHandle.close();
  }

  const currentDraftStat = await lstat(draft);
  if (currentDraftStat.dev !== pathStat.dev || currentDraftStat.ino !== pathStat.ino) {
    throw new Error(`report was published but the draft path changed and was retained: ${draft}`);
  }
  try {
    await unlink(draft);
  } catch (error) {
    throw new Error(`report was published but the draft could not be removed: ${draft}`, {
      cause: error,
    });
  }
  return target;
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
  const [namespace, draftPath, targetPath, expectedSha256] = process.argv.slice(2);
  if (!namespace || !draftPath || !targetPath || !expectedSha256) {
    process.stderr.write(
      "usage: chat-publish-report.mjs <namespace> <draft-path> <target-path> <expected-sha256>\n",
    );
    process.exitCode = 1;
  } else {
    try {
      const publishedPath = await publishReport({
        namespace,
        draftPath,
        targetPath,
        expectedSha256,
      });
      process.stdout.write(`${JSON.stringify({ published_path: publishedPath })}\n`);
    } catch (error) {
      process.stderr.write(`chat-publish-report: ${error.message}\n`);
      process.exitCode = 1;
    }
  }
}
