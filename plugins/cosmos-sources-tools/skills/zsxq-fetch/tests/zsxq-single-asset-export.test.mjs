import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { exportSingleAsset } from "../scripts/zsxq-single-asset-export.mjs";

function fakeFetch(bytes, contentType = "image/png") {
  return async () => ({
    ok: true,
    status: 200,
    headers: {
      get(name) {
        if (name === "content-type") return contentType;
        if (name === "content-length") return String(bytes.length);
        return null;
      },
    },
    body: {
      getReader() {
        let delivered = false;
        return {
          async read() {
            if (delivered) return { done: true, value: undefined };
            delivered = true;
            return { done: false, value: new Uint8Array(bytes) };
          },
          async cancel() {},
        };
      },
      async cancel() {},
    },
  });
}

test("single-asset export writes the output exclusively without staging files", async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "zsxq-asset-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const bytes = Buffer.from("png-bytes");
  const outputPath = path.join(workspace, "asset.png");

  const result = await exportSingleAsset({
    workspace,
    sourceUrl: "https://images.example/a.png?sig=abc",
    outputPath,
    fetchImpl: fakeFetch(bytes),
  });

  assert.equal(result.output_path, outputPath);
  assert.equal(result.byte_length, bytes.length);
  assert.deepEqual(await readFile(outputPath), bytes);
  assert.deepEqual(await readdir(workspace), ["asset.png"]);
  if (process.platform !== "win32") {
    assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
  }
});

test("single-asset export refuses an output created during the fetch", async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "zsxq-asset-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const outputPath = path.join(workspace, "asset.png");
  // The output does not exist at the pre-check; it appears while the response
  // is being fetched, so only the exclusive create can catch it.
  const plantThenRespond = async (...args) => {
    await writeFile(outputPath, "planted");
    return fakeFetch(Buffer.from("png-bytes"))(...args);
  };

  await assert.rejects(
    exportSingleAsset({
      workspace,
      sourceUrl: "https://images.example/a.png?sig=abc",
      outputPath,
      fetchImpl: plantThenRespond,
    }),
    /outputPath must not already exist/,
  );

  assert.equal(await readFile(outputPath, "utf8"), "planted");
  assert.deepEqual(await readdir(workspace), ["asset.png"]);
});

test("single-asset export refuses an existing output and keeps it", async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "zsxq-asset-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const outputPath = path.join(workspace, "asset.png");
  await writeFile(outputPath, "existing");

  await assert.rejects(
    exportSingleAsset({
      workspace,
      sourceUrl: "https://images.example/a.png?sig=abc",
      outputPath,
      fetchImpl: fakeFetch(Buffer.from("png-bytes")),
    }),
    /outputPath must not already exist/,
  );

  assert.equal(await readFile(outputPath, "utf8"), "existing");
  assert.deepEqual(await readdir(workspace), ["asset.png"]);
});
