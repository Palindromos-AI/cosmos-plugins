import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  configureRuntime,
  loadRuntime,
  resolveOutputPath,
} from "../plugins/cosmos-sources-tools/scripts/workspace-runtime.mjs";
import { writeMarkdown } from "../plugins/cosmos-sources-tools/skills/cls-fetch/scripts/render-markdown.mjs";
import { createRun } from "../plugins/cosmos-sources-tools/skills/zsxq-fetch/scripts/run-store.mjs";


async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "sources-workspace-runtime-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    root,
    configFile: path.join(root, "config", "runtime.json"),
    pluginRoot: path.join(root, "installed-plugin"),
    validation: { temporaryRoots: [] },
  };
}


test("sources runtime stores a versioned external root and derives sources workspace", async (t) => {
  const context = await fixture(t);
  const workspaceRoot = path.join(context.root, "cosmos-workspace");
  await mkdir(workspaceRoot);

  const binding = await configureRuntime({ workspaceRoot, ...context });
  const payload = JSON.parse(await readFile(context.configFile, "utf8"));
  const canonicalRoot = await realpath(workspaceRoot);

  assert.deepEqual(payload, {
    schema_version: 1,
    plugin: "cosmos-sources-tools",
    workspace_root: canonicalRoot,
    workspace: path.join(canonicalRoot, "sources"),
  });
  assert.equal(binding.workspace, payload.workspace);
  assert.ok((await stat(binding.workspace)).isDirectory());
  for (const source of ["cls", "zsxq", "dingtalk", "feishu"]) {
    assert.ok((await stat(path.join(binding.workspace, "output", source))).isDirectory());
  }
  if (process.platform !== "win32") {
    assert.equal((await stat(context.configFile)).mode & 0o777, 0o600);
  }
});


test("sources runtime refuses silent rebinding and preserves the old workspace", async (t) => {
  const context = await fixture(t);
  const firstRoot = path.join(context.root, "first");
  const secondRoot = path.join(context.root, "second");
  await mkdir(firstRoot);
  await mkdir(secondRoot);

  const first = await configureRuntime({ workspaceRoot: firstRoot, ...context });
  const marker = path.join(first.workspace, "user-data.txt");
  await writeFile(marker, "preserve me\n");

  await assert.rejects(
    configureRuntime({ workspaceRoot: secondRoot, ...context }),
    /--reconfigure/,
  );
  assert.equal(await readFile(marker, "utf8"), "preserve me\n");

  const second = await configureRuntime({
    workspaceRoot: secondRoot,
    allowReconfigure: true,
    ...context,
  });
  assert.equal(second.workspace, path.join(await realpath(secondRoot), "sources"));
  assert.equal(await readFile(marker, "utf8"), "preserve me\n");
});


test("sources runtime preserves existing config when its bound workspace is missing", async (t) => {
  const context = await fixture(t);
  const firstRoot = path.join(context.root, "first");
  const secondRoot = path.join(context.root, "second");
  await mkdir(firstRoot);
  await mkdir(secondRoot);
  await configureRuntime({ workspaceRoot: firstRoot, ...context });
  const original = await readFile(context.configFile, "utf8");
  await rm(firstRoot, { recursive: true });

  await assert.rejects(
    configureRuntime({ workspaceRoot: secondRoot, ...context }),
    /--reconfigure/,
  );
  assert.equal(await readFile(context.configFile, "utf8"), original);
  await assert.rejects(stat(path.join(secondRoot, "sources")), /ENOENT/);
});


test("sources runtime rejects changed or unsupported metadata without rewriting it", async (t) => {
  const context = await fixture(t);
  await mkdir(path.dirname(context.configFile), { recursive: true });
  const unsupported = '{"schema_version":99,"plugin":"cosmos-sources-tools"}\n';
  await writeFile(context.configFile, unsupported);

  await assert.rejects(loadRuntime(context), /unsupported runtime schema/);
  await assert.rejects(
    configureRuntime({ workspaceRoot: context.root, ...context }),
    /--reconfigure/,
  );
  assert.equal(await readFile(context.configFile, "utf8"), unsupported);
});


test("sources runtime rejects noncanonical workspace fields", async (t) => {
  const context = await fixture(t);
  const workspaceRoot = path.join(context.root, "cosmos-workspace");
  await mkdir(workspaceRoot);
  await mkdir(path.dirname(context.configFile), { recursive: true });
  await writeFile(
    context.configFile,
    JSON.stringify({
      schema_version: 1,
      plugin: "cosmos-sources-tools",
      workspace_root: workspaceRoot,
      workspace: path.join(workspaceRoot, "different"),
    }),
  );

  await assert.rejects(loadRuntime(context), /must equal.*sources/);
});


test("sources runtime rejects replaceable plugin-cache roots", async (t) => {
  const context = await fixture(t);
  const workspaceRoot = path.join(
    context.root,
    ".codex",
    "plugins",
    "cache",
    "snapshot",
  );
  await mkdir(workspaceRoot, { recursive: true });

  await assert.rejects(
    configureRuntime({ workspaceRoot, ...context }),
    /plugin, marketplace, and plugin-cache/,
  );
});


test("sources runtime rejects the replaceable plugin directory itself", async (t) => {
  const context = await fixture(t);
  const workspaceRoot = path.join(context.root, ".codex", "plugins");
  await mkdir(workspaceRoot, { recursive: true });

  await assert.rejects(
    configureRuntime({ workspaceRoot, ...context }),
    /plugin, marketplace, and plugin-cache/,
  );
});


test("output resolver rejects traversal, external paths, and symlink escapes", async (t) => {
  const context = await fixture(t);
  const workspaceRoot = path.join(context.root, "cosmos-workspace");
  const external = path.join(context.root, "external");
  await mkdir(workspaceRoot);
  await mkdir(external);
  const binding = await configureRuntime({ workspaceRoot, ...context });

  const valid = path.join(binding.workspace, "output", "cls", "report.md");
  assert.equal(await resolveOutputPath(valid, context, "cls"), valid);
  await assert.rejects(
    resolveOutputPath(path.join(external, "report.md"), context, "cls"),
    /namespace/,
  );
  await assert.rejects(
    resolveOutputPath(path.join(binding.workspace, "..", "escaped.md"), context, "cls"),
    /namespace/,
  );

  await assert.rejects(
    resolveOutputPath(path.join(binding.workspace, "report.md"), context, "cls"),
    /namespace/,
  );
  await assert.rejects(
    resolveOutputPath(
      path.join(binding.workspace, "output", "zsxq", "wrong-source.md"),
      context,
      "cls",
    ),
    /namespace/,
  );

  const linkPath = path.join(binding.workspace, "output", "escape-link");
  const { symlink } = await import("node:fs/promises");
  await symlink(external, linkPath);
  await assert.rejects(
    resolveOutputPath(path.join(linkPath, "report.md"), context, "cls"),
    /namespace/,
  );
});


test("CLS and ZSXQ writers enforce the configured sources workspace", async (t) => {
  const context = await fixture(t);
  const workspaceRoot = path.join(context.root, "cosmos-workspace");
  const external = path.join(context.root, "external");
  await mkdir(workspaceRoot);
  await mkdir(external);
  await configureRuntime({ workspaceRoot, ...context });

  await assert.rejects(
    writeMarkdown(path.join(external, "cls.md"), "content\n", {
      runtimeOptions: context,
    }),
    /output namespace/,
  );

  const runWorkspace = path.join(context.root, "zsxq-run");
  await assert.rejects(
    createRun(
      runWorkspace,
      {
        planet: "Test Planet",
        planet_url: "https://wx.zsxq.com/group/test",
        date: "2026-08-16",
        snapshot_at: "2026-08-16T00:00:00Z",
        output_path: path.join(external, "zsxq.md"),
      },
      { runtimeOptions: context },
    ),
    /output namespace/,
  );
  await assert.rejects(stat(runWorkspace), /ENOENT/);
});
