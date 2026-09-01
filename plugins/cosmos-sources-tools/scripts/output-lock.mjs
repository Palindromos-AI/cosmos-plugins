import { createHash } from "node:crypto";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const OUTPUT_LOCK_DIRECTORY = "cosmos-sources-output-locks-v1";

function sqliteIsBusy(error) {
  return error?.errcode === 5 || error?.message === "database is locked";
}

export async function withOutputLock(canonicalTarget, action) {
  const requestedDirectory = path.resolve(tmpdir(), OUTPUT_LOCK_DIRECTORY);
  await mkdir(requestedDirectory, { recursive: true, mode: 0o700 });
  const lockDirectory = await realpath(requestedDirectory);
  const lockName = createHash("sha256")
    .update(path.resolve(canonicalTarget))
    .digest("hex");
  const lockPath = path.resolve(lockDirectory, `${lockName}.sqlite`);
  try {
    const metadata = await lstat(lockPath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`output lock database must be a regular file: ${lockPath}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const deadline = Date.now() + 10_000;
  let database;
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
      if (!sqliteIsBusy(error)) throw error;
      if (Date.now() >= deadline) {
        throw new Error(`timed out waiting to update output: ${canonicalTarget}`);
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
