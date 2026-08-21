import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Every packaged CLI entry point. Each must behave identically whether it is
// invoked through its real path or through a symbolic-link ancestor (Codex
// plugin caches and user checkouts may be symlinked).
const CLI_SCRIPTS = [
  "plugins/cosmos-fix-tools/skills/fix-report/scripts/write-report.mjs",
  "plugins/cosmos-fix-tools/skills/fix-report/scripts/publish-report.mjs",
  "plugins/cosmos-fix-tools/skills/fix-report/scripts/fix-report-runtime.mjs",
  "plugins/cosmos-sources-tools/scripts/workspace-runtime.mjs",
  "plugins/cosmos-sources-tools/skills/cls-fetch/scripts/fetch-cls.mjs",
  "plugins/cosmos-sources-tools/skills/cls-fetch/scripts/list-candidates.mjs",
  "plugins/cosmos-sources-tools/skills/cls-fetch/scripts/record-review.mjs",
  "plugins/cosmos-sources-tools/skills/cls-fetch/scripts/render-markdown.mjs",
  "plugins/cosmos-sources-tools/scripts/chat-publish-report.mjs",
  "plugins/cosmos-sources-tools/scripts/chat-repair-state.mjs",
  "plugins/cosmos-sources-tools/skills/zsxq-fetch/scripts/zsxq-runner.mjs",
  "plugins/cosmos-sources-tools/skills/zsxq-fetch/scripts/zsxq-image-tiles.mjs",
  "plugins/cosmos-sources-tools/skills/zsxq-fetch/scripts/zsxq-single-asset-export.mjs",
];

function run(scriptPath) {
  return spawnSync(process.execPath, [scriptPath, "--help"], {
    encoding: "utf8",
    input: "",
  });
}

test("every CLI entry point runs when invoked through a symlinked path", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cosmos-cli-symlink-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const linkedPlugins = path.join(tempRoot, "plugins");
  await symlink(path.join(repoRoot, "plugins"), linkedPlugins, "dir");

  for (const relativePath of CLI_SCRIPTS) {
    const direct = run(path.join(repoRoot, relativePath));
    const linked = run(path.join(tempRoot, relativePath));

    // `--help` is not a supported flag anywhere; every CLI must reject it
    // loudly. The point is that the symlinked invocation must not silently
    // exit 0 with no output because the entry guard failed to recognize itself.
    assert.notEqual(direct.status, 0, `${relativePath}: direct run should fail on --help`);
    assert.ok(direct.stderr.trim().length > 0, `${relativePath}: direct run should explain`);
    assert.equal(linked.status, direct.status, `${relativePath}: symlinked exit status differs`);
    assert.ok(
      linked.stderr.trim().length > 0,
      `${relativePath}: symlinked invocation produced no output`,
    );
  }
});
