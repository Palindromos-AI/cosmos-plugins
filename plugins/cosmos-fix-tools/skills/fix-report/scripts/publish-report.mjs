#!/usr/bin/env node

// Deterministic publisher for fix reports. Every Git value is passed as one
// argument-array operand; nothing is interpreted by a shell. `preflight` and
// the commit phase of `publish` are local-only; the network is contacted only
// when pushing, so a failed push never loses the report or its commit.

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pinnedFixReportRepository } from "./fix-report-runtime.mjs";

const REMOTE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MERGE_REF = /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const REPORT_PATH =
  /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*\/\d{4}-\d{2}-\d{2}T\d{6}Z-[0-9a-f]{8}\.md$/;
// Fixed identity so the public report repository never records the customer's
// machine-derived name or hostname.
const COMMIT_IDENTITY = [
  "-c", "user.name=Cosmos Fix Report",
  "-c", "user.email=fix-report@cosmos-plugins.invalid",
  "-c", "commit.gpgsign=false",
];

class PublishError extends Error {
  constructor(message, { exitCode = 1 } = {}) {
    super(message);
    this.exitCode = exitCode;
  }
}

function git(repo, args, { allowFailure = false, identity = false } = {}) {
  const fullArgs = ["-C", repo, ...(identity ? COMMIT_IDENTITY : []), ...args];
  const result = spawnSync("git", fullArgs, { encoding: "utf8" });
  if (result.error) {
    throw new PublishError(`git could not run: ${result.error.message}`);
  }
  if (result.status !== 0 && !allowFailure) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new PublishError(`git ${args[0]} failed: ${detail}`);
  }
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

const out = (result) => result.stdout.trim();

async function requireReportRepository(repoArgument) {
  if (typeof repoArgument !== "string" || !path.isAbsolute(repoArgument)) {
    throw new PublishError("report repository must be an absolute path");
  }
  let stats;
  try {
    stats = await lstat(repoArgument);
  } catch {
    throw new PublishError(
      `report repository does not exist: ${repoArgument}; complete the one-time setup in the marketplace README`,
    );
  }
  if (stats.isSymbolicLink()) {
    throw new PublishError("report repository must not be a symbolic link");
  }
  if (!stats.isDirectory()) {
    throw new PublishError("report repository must be a directory");
  }
  const canonical = await realpath(repoArgument);
  const expected = path.join(
    await realpath(path.dirname(repoArgument)),
    path.basename(repoArgument),
  );
  if (canonical !== expected) {
    throw new PublishError("report repository must not be a symbolic link");
  }
  const toplevel = git(repoArgument, ["rev-parse", "--show-toplevel"], { allowFailure: true });
  if (toplevel.status !== 0) {
    throw new PublishError(
      `report repository is not a Git repository: ${repoArgument}; run the one-time setup in the marketplace README (git init, initial commit, remote, push -u)`,
    );
  }
  const canonicalToplevel = await realpath(out(toplevel));
  if (canonicalToplevel !== canonical) {
    throw new PublishError(
      `report repository must be its own Git top level; git reports ${canonicalToplevel}`,
    );
  }
  return canonical;
}

function resolveUpstream(repo) {
  const headRef = git(repo, ["symbolic-ref", "--quiet", "HEAD"], { allowFailure: true });
  if (headRef.status !== 0) {
    throw new PublishError("report repository HEAD must be an attached branch");
  }
  const branchRef = out(headRef);
  if (!branchRef.startsWith("refs/heads/")) {
    throw new PublishError(`unexpected HEAD reference: ${branchRef}`);
  }
  const branch = branchRef.slice("refs/heads/".length);
  const head = git(repo, ["rev-parse", "--verify", "--quiet", "HEAD"], { allowFailure: true });
  if (head.status !== 0) {
    throw new PublishError(
      "report repository has no commits; complete the one-time setup in the marketplace README (create an initial commit, rename the branch to main, add the remote, git push -u origin main)",
    );
  }
  const remote = out(git(repo, ["config", "--get", `branch.${branch}.remote`], { allowFailure: true }));
  const mergeRef = out(git(repo, ["config", "--get", `branch.${branch}.merge`], { allowFailure: true }));
  if (!remote || !mergeRef) {
    throw new PublishError(
      `branch '${branch}' has no configured upstream; complete the one-time setup in the marketplace README (git remote add origin <url>, git push -u origin ${branch})`,
    );
  }
  if (!REMOTE_NAME.test(remote)) {
    throw new PublishError(`configured remote name is not safe: ${remote}`);
  }
  if (!MERGE_REF.test(mergeRef)) {
    throw new PublishError(`configured merge ref is not a safe branch ref: ${mergeRef}`);
  }
  const refCheck = git(repo, ["check-ref-format", mergeRef], { allowFailure: true });
  if (refCheck.status !== 0) {
    throw new PublishError(`configured merge ref fails check-ref-format: ${mergeRef}`);
  }
  return { branch, remote, mergeRef };
}

function statusEntries(repo) {
  // --untracked-files=all lists individual files instead of collapsing a new
  // directory to `?? <dir>/`, so a fresh plugin/scope directory still yields
  // exactly one `?? <report-path>` entry.
  const status = out(git(repo, ["status", "--porcelain", "--untracked-files=all"]));
  return status === "" ? [] : status.split("\n");
}

function requireCleanTree(repo) {
  const entries = statusEntries(repo);
  if (entries.length > 0) {
    throw new PublishError(
      `report repository is not clean:\n${entries.join("\n")}\nRemove leftover files (delete a previously rejected report; never reuse its path) before continuing`,
    );
  }
}

function pendingCommits(repo, { remote, branch }) {
  const tracking = git(
    repo,
    ["rev-parse", "--verify", "--quiet", `refs/remotes/${remote}/${branch}`],
    { allowFailure: true },
  );
  if (tracking.status !== 0) return 0;
  return Number(out(git(repo, ["rev-list", "--count", `${out(tracking)}..HEAD`])));
}

async function preflight(repoArgument) {
  const repo = await requireReportRepository(repoArgument);
  const upstream = resolveUpstream(repo);
  requireCleanTree(repo);
  return {
    status: "ready",
    repo,
    branch: upstream.branch,
    remote: upstream.remote,
    mergeRef: upstream.mergeRef,
    pendingCommits: pendingCommits(repo, upstream),
  };
}

async function validateReport(repo, reportRelativePath) {
  if (typeof reportRelativePath !== "string" || !REPORT_PATH.test(reportRelativePath)) {
    throw new PublishError(
      "report path must be <plugin-slug>/<scope-slug>/<utc-timestamp>-<id>.md relative to the report repository",
    );
  }
  const absolute = path.join(repo, reportRelativePath);
  let stats;
  try {
    stats = await lstat(absolute);
  } catch {
    throw new PublishError(`report file does not exist: ${reportRelativePath}`);
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new PublishError("report must be a regular non-symbolic-link file");
  }
  if (stats.size === 0) {
    throw new PublishError("report must not be empty");
  }
  return reportRelativePath;
}

function commitReport(repo, reportRelativePath) {
  const entries = statusEntries(repo);
  const expectedEntry = `?? ${reportRelativePath}`;
  if (entries.length !== 1 || entries[0] !== expectedEntry) {
    throw new PublishError(
      `the report must be the repository's only change; current status:\n${entries.join("\n") || "(clean)"}`,
    );
  }
  const base = out(git(repo, ["rev-parse", "HEAD"]));
  const expectedBlob = out(git(repo, ["hash-object", "--", reportRelativePath]));
  git(repo, ["add", "--", reportRelativePath]);
  const staged = out(git(repo, ["diff", "--cached", "--name-only"]));
  if (staged !== reportRelativePath) {
    throw new PublishError(`staged paths must contain only the report; staged:\n${staged}`);
  }
  if (out(git(repo, ["rev-parse", `:${reportRelativePath}`])) !== expectedBlob) {
    throw new PublishError("staged report blob does not match the written report");
  }
  const [plugin, scope] = reportRelativePath.split("/");
  git(repo, ["commit", "-m", `Add ${plugin} ${scope} fix report`], { identity: true });
  const commit = out(git(repo, ["rev-parse", "HEAD"]));
  if (out(git(repo, ["rev-list", "--count", `${base}..HEAD`])) !== "1") {
    throw new PublishError("commit created more than one new commit; a hook advanced HEAD");
  }
  if (out(git(repo, ["rev-parse", "HEAD^"])) !== base) {
    throw new PublishError("commit parent does not match the pre-commit HEAD");
  }
  const committedPaths = out(
    git(repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", commit]),
  );
  if (committedPaths !== reportRelativePath) {
    throw new PublishError(`commit must contain only the report; it contains:\n${committedPaths}`);
  }
  if (out(git(repo, ["rev-parse", `${commit}:${reportRelativePath}`])) !== expectedBlob) {
    throw new PublishError("committed report blob does not match the written report");
  }
  requireCleanTree(repo);
  return commit;
}

function verifyReportOnlyCommits(repo, fromExclusive) {
  const listing = out(
    git(repo, ["rev-list", "--parents", "--reverse", `${fromExclusive}..HEAD`]),
  );
  for (const line of listing === "" ? [] : listing.split("\n")) {
    const [commit, ...parents] = line.split(" ");
    // `diff-tree -r` prints nothing for a merge commit, so a merge could
    // smuggle foreign content past the path check; refuse merges outright.
    if (parents.length > 1) {
      throw new PublishError(
        `unpushed commit ${commit} is a merge commit; the report repository must contain only fix-report commits — resolve this manually before pushing`,
      );
    }
    const paths = out(
      git(repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", commit]),
    );
    for (const changed of paths === "" ? [] : paths.split("\n")) {
      if (!REPORT_PATH.test(changed)) {
        throw new PublishError(
          `unpushed commit ${commit} touches non-report path ${changed}; the report repository must contain only fix reports — resolve this manually before pushing`,
        );
      }
    }
  }
}

function pushReports(repo, { remote, mergeRef }) {
  const fetch = git(repo, ["fetch", remote, mergeRef], { allowFailure: true });
  if (fetch.status !== 0) {
    return {
      status: "committed-not-pushed",
      reason: `git fetch failed: ${fetch.stderr.trim()}`,
    };
  }
  const remoteTip = out(git(repo, ["rev-parse", "FETCH_HEAD"]));
  const behind = Number(out(git(repo, ["rev-list", "--count", `HEAD..${remoteTip}`])));
  const ahead = Number(out(git(repo, ["rev-list", "--count", `${remoteTip}..HEAD`])));
  if (behind > 0) {
    return {
      status: "remote-ahead",
      behind,
      instruction: `git -C "${repo}" pull --ff-only ${remote}`,
    };
  }
  if (ahead === 0) {
    return { status: "up-to-date" };
  }
  // A failed backlog verification happens after the report commit exists, so
  // report it as committed-not-pushed with the manual resolution in `reason`
  // instead of throwing away the JSON result.
  try {
    verifyReportOnlyCommits(repo, remoteTip);
  } catch (error) {
    return { status: "committed-not-pushed", reason: error.message };
  }
  const head = out(git(repo, ["rev-parse", "HEAD"]));
  const push = git(repo, ["push", remote, `HEAD:${mergeRef}`], { allowFailure: true });
  if (push.status !== 0) {
    return {
      status: "committed-not-pushed",
      reason: `git push failed: ${push.stderr.trim()}`,
    };
  }
  const listed = out(git(repo, ["ls-remote", remote, mergeRef]));
  if (listed.split(/\s+/)[0] !== head) {
    return {
      status: "committed-not-pushed",
      reason: "push verification failed: the remote merge ref does not equal the local head",
    };
  }
  return { status: "pushed", commit: head, pushedCommits: ahead };
}

export async function runPreflight({ repo = pinnedFixReportRepository().reportRepository } = {}) {
  return preflight(repo);
}

export async function runPush({ repo = pinnedFixReportRepository().reportRepository } = {}) {
  const canonical = await requireReportRepository(repo);
  const upstream = resolveUpstream(canonical);
  requireCleanTree(canonical);
  return { repo: canonical, ...pushReports(canonical, upstream) };
}

export async function runPublish({ repo = pinnedFixReportRepository().reportRepository, report } = {}) {
  const canonical = await requireReportRepository(repo);
  const upstream = resolveUpstream(canonical);
  const reportRelativePath = await validateReport(canonical, report);
  const commit = commitReport(canonical, reportRelativePath);
  const pushResult = pushReports(canonical, upstream);
  return {
    repo: canonical,
    report: reportRelativePath,
    commit,
    ...pushResult,
  };
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const commands = new Set(["preflight", "publish", "push"]);
  if (!commands.has(command)) {
    throw new PublishError(
      "usage: publish-report.mjs <preflight|publish|push> [--repo <absolute-path>] [--report <relative-path>]",
    );
  }
  const values = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (flag !== "--repo" && flag !== "--report") {
      throw new PublishError(`unknown argument: ${flag}`);
    }
    if (value === undefined) {
      throw new PublishError(`missing value for ${flag}`);
    }
    const name = flag.slice(2);
    if (Object.hasOwn(values, name)) {
      throw new PublishError(`duplicate argument: ${flag}`);
    }
    values[name] = value;
  }
  if (command === "publish" && !values.report) {
    throw new PublishError("missing argument: --report");
  }
  if (command !== "publish" && values.report) {
    throw new PublishError(`--report is only valid with publish`);
  }
  return { command, values };
}

async function main() {
  const { command, values } = parseArguments(process.argv.slice(2));
  const handlers = { preflight: runPreflight, publish: runPublish, push: runPush };
  const result = await handlers[command](values);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status === "committed-not-pushed" || result.status === "remote-ahead") {
    process.exitCode = 2;
  }
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
    process.exitCode = error instanceof PublishError ? error.exitCode : 1;
  });
}
