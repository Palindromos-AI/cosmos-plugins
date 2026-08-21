import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDir = path.join(
  repoRoot,
  "plugins/cosmos-fix-tools/skills/fix-report/scripts",
);

const { runPreflight, runPublish, runPush } = await import(
  pathToFileURL(path.join(scriptsDir, "publish-report.mjs")).href
);
const { writeReport } = await import(
  pathToFileURL(path.join(scriptsDir, "write-report.mjs")).href
);
const { configureFixReportRuntime, loadFixReportRuntime } = await import(
  pathToFileURL(path.join(scriptsDir, "fix-report-runtime.mjs")).href
);

function git(cwd, ...args) {
  const result = spawnSync(
    "git",
    ["-C", cwd, "-c", "user.name=test", "-c", "user.email=test@example.invalid", ...args],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

// Reproduce the exact one-time setup the README gives the customer.
async function setupReportRepository(t) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "fix-report-publish-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const remote = path.join(tempRoot, "remote.git");
  await mkdir(remote);
  git(remote, "init", "--bare", "-b", "main", ".");
  const repo = path.join(tempRoot, "fix-reports");
  await mkdir(repo);
  git(repo, "init", ".");
  git(repo, "commit", "--allow-empty", "-m", "Initialize fix reports");
  git(repo, "branch", "-M", "main");
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-u", "origin", "main");
  return { tempRoot, remote, repo };
}

async function writeTestReport(repo, id) {
  return writeReport({
    repo,
    plugin: "cosmos-fix-tools",
    scope: "fix-report",
    timestamp: "2026-08-19T120000Z",
    id,
    content: "# report\n\nA sanitized report body.\n",
  });
}

test("preflight names the missing prerequisite at every setup stage", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "fix-report-preflight-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const repo = path.join(tempRoot, "fix-reports");

  await assert.rejects(runPreflight({ repo }), /does not exist/);

  await mkdir(repo);
  await assert.rejects(runPreflight({ repo }), /not a Git repository/);

  git(repo, "init", ".");
  await assert.rejects(runPreflight({ repo }), /no commits/);

  git(repo, "commit", "--allow-empty", "-m", "Initialize fix reports");
  git(repo, "branch", "-M", "main");
  await assert.rejects(runPreflight({ repo }), /no configured upstream/);

  const remote = path.join(tempRoot, "remote.git");
  await mkdir(remote);
  git(remote, "init", "--bare", "-b", "main", ".");
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-u", "origin", "main");

  await writeFile(path.join(repo, "stray.md"), "leftover\n");
  await assert.rejects(runPreflight({ repo }), /not clean[\s\S]*stray\.md/);
  await rm(path.join(repo, "stray.md"));

  const ready = await runPreflight({ repo });
  assert.equal(ready.status, "ready");
  assert.equal(ready.remote, "origin");
  assert.equal(ready.mergeRef, "refs/heads/main");
  assert.equal(ready.pendingCommits, 0);
});

test("publish commits with the fixed identity and pushes only the report", async (t) => {
  const { remote, repo } = await setupReportRepository(t);
  const report = await writeTestReport(repo, "aaaa1111");

  const result = await runPublish({ repo, report: report.relativePath });
  assert.equal(result.status, "pushed");
  assert.equal(result.pushedCommits, 1);
  assert.equal(git(remote, "rev-parse", "main"), result.commit);
  assert.equal(git(repo, "log", "-1", "--format=%an <%ae>"), "Cosmos Fix Report <fix-report@cosmos-plugins.invalid>");
  assert.equal(
    git(repo, "diff-tree", "--no-commit-id", "--name-only", "-r", result.commit),
    report.relativePath,
  );

  const after = await runPreflight({ repo });
  assert.equal(after.pendingCommits, 0);
});

test("a failed push preserves the commit and the next publish delivers the backlog", async (t) => {
  const { remote, repo } = await setupReportRepository(t);
  const first = await writeTestReport(repo, "aaaa2222");

  git(repo, "remote", "set-url", "origin", path.join(repo, "missing-remote"));
  const failed = await runPublish({ repo, report: first.relativePath });
  assert.equal(failed.status, "committed-not-pushed");
  assert.match(failed.reason, /fetch failed/);
  assert.ok(failed.commit);

  const pending = await runPreflight({ repo });
  assert.equal(pending.status, "ready");
  assert.equal(pending.pendingCommits, 1);

  git(repo, "remote", "set-url", "origin", remote);
  const second = await writeTestReport(repo, "aaaa3333");
  const delivered = await runPublish({ repo, report: second.relativePath });
  assert.equal(delivered.status, "pushed");
  assert.equal(delivered.pushedCommits, 2);
  assert.equal(git(remote, "rev-parse", "main"), git(repo, "rev-parse", "HEAD"));
});

test("publish refuses to push over unseen remote commits", async (t) => {
  const { tempRoot, remote, repo } = await setupReportRepository(t);

  const other = path.join(tempRoot, "other-clone");
  git(tempRoot, "clone", remote, other);
  git(other, "commit", "--allow-empty", "-m", "Remote-side commit");
  git(other, "push", "origin", "main");

  const report = await writeTestReport(repo, "aaaa4444");
  const result = await runPublish({ repo, report: report.relativePath });
  assert.equal(result.status, "remote-ahead");
  assert.match(result.instruction, /pull --ff-only/);
  assert.ok(result.commit);
  assert.equal(git(repo, "rev-parse", "HEAD"), result.commit);
});

test("push refuses backlog commits that touch non-report paths or are merges", async (t) => {
  const { repo } = await setupReportRepository(t);
  await writeFile(path.join(repo, "notes.txt"), "manual file\n");
  git(repo, "add", "notes.txt");
  git(repo, "commit", "-m", "Manual commit");

  const blocked = await runPush({ repo });
  assert.equal(blocked.status, "committed-not-pushed");
  assert.match(blocked.reason, /non-report path notes\.txt/);

  git(repo, "reset", "--hard", "HEAD^");
  git(repo, "checkout", "-b", "side");
  git(repo, "commit", "--allow-empty", "-m", "Side commit");
  git(repo, "checkout", "main");
  git(repo, "commit", "--allow-empty", "-m", "Main commit");
  git(repo, "merge", "--no-ff", "-m", "Merge side", "side");

  const merged = await runPush({ repo });
  assert.equal(merged.status, "committed-not-pushed");
  assert.match(merged.reason, /merge commit/);
});

test("the writer mechanically rejects local paths and forbidden identifiers", async (t) => {
  const { tempRoot, repo } = await setupReportRepository(t);
  const workspaceRoot = tempRoot;

  await assert.rejects(
    writeReport({
      repo,
      plugin: "cosmos-fix-tools",
      scope: "fix-report",
      timestamp: "2026-08-19T130000Z",
      id: "bbbb1111",
      content: `report referencing ${workspaceRoot}/sources\n`,
    }),
    /must not contain the local path/,
  );
  await assert.rejects(
    writeReport({
      repo,
      plugin: "cosmos-fix-tools",
      scope: "fix-report",
      timestamp: "2026-08-19T130000Z",
      id: "bbbb2222",
      content: `report referencing ${os.homedir()}/secret\n`,
    }),
    /must not contain the local path/,
  );
  await assert.rejects(
    writeReport({
      repo,
      plugin: "cosmos-fix-tools",
      scope: "fix-report",
      timestamp: "2026-08-19T130000Z",
      id: "bbbb3333",
      content: "report about the 星球A planet\n",
      forbidden: ["星球A"],
    }),
    /forbidden identifier "星球A"/,
  );

  const clean = await writeReport({
    repo,
    plugin: "cosmos-fix-tools",
    scope: "fix-report",
    timestamp: "2026-08-19T130000Z",
    id: "bbbb4444",
    content: "report using <cosmos-workspace-root> placeholders\n",
    forbidden: ["星球A"],
  });
  assert.match(await readFile(clean.absolutePath, "utf8"), /<cosmos-workspace-root>/);
});

test("the fix-report runtime binds once and refuses silent rebinding", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "fix-report-runtime-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const configFile = path.join(tempRoot, "config", "runtime.json");
  const pluginRoot = path.join(tempRoot, "installed-plugin");
  const validation = { temporaryRoots: [] };

  const rootA = path.join(tempRoot, "root-a");
  const rootB = path.join(tempRoot, "root-b");
  await mkdir(rootA);
  await mkdir(rootB);

  const bound = await configureFixReportRuntime({
    workspaceRoot: rootA, configFile, pluginRoot, validation,
  });
  assert.equal(bound.reportRepository, path.join(await (await import("node:fs/promises")).realpath(rootA), "fix-reports"));

  const loaded = await loadFixReportRuntime({ configFile, pluginRoot, validation });
  assert.equal(loaded.workspaceRoot, bound.workspaceRoot);

  await assert.rejects(
    configureFixReportRuntime({ workspaceRoot: rootB, configFile, pluginRoot, validation }),
    /--reconfigure/,
  );
  const rebound = await configureFixReportRuntime({
    workspaceRoot: rootB, configFile, pluginRoot, reconfigure: true, validation,
  });
  assert.notEqual(rebound.workspaceRoot, bound.workspaceRoot);

  // Default temporary roots are canonicalized, so a tmpdir-based root is rejected.
  await assert.rejects(
    configureFixReportRuntime({ workspaceRoot: rootA, configFile: path.join(tempRoot, "c2", "runtime.json"), pluginRoot }),
    /outside OS temporary directories/,
  );
});
