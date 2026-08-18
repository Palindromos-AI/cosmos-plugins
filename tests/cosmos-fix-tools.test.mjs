import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function read(relativePath) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

test("cosmos-fix-tools packages the fix-report skill", async () => {
  const manifest = JSON.parse(await read(
    "plugins/cosmos-fix-tools/.codex-plugin/plugin.json",
  ));
  const skill = await read("plugins/cosmos-fix-tools/skills/fix-report/SKILL.md");
  const agent = await read(
    "plugins/cosmos-fix-tools/skills/fix-report/agents/openai.yaml",
  );

  assert.equal(manifest.name, "cosmos-fix-tools");
  assert.equal(manifest.version, "0.1.0");
  assert.equal(manifest.skills, "./skills/");
  assert.equal(manifest.repository, "https://github.com/Palindromos-AI/cosmos-plugins");
  assert.match(skill, /^name: fix-report$/m);
  assert.match(skill, /^description: /m);
  assert.match(skill, /marketplace/i);
  assert.match(skill, /distributed|packaged/i);
  assert.match(agent, /\$fix-report\b/);
});

test("fix-report includes only marketplace content changes", async () => {
  const skill = await read("plugins/cosmos-fix-tools/skills/fix-report/SKILL.md");

  for (const packagedContent of [
    "SKILL.md",
    "scripts",
    "references",
    "assets",
    "tests",
    "lockfiles",
    "plugin.json",
    "marketplace.json",
  ]) {
    assert.match(skill, new RegExp(packagedContent.replace(".", "\\."), "i"));
  }

  for (const excludedContent of [
    "external workspace",
    "runtime configuration",
    "retrieved data",
    "generated output",
    "business scripts",
    "credentials",
  ]) {
    assert.match(skill, new RegExp(excludedContent, "i"));
  }
  assert.match(skill, /do not|never|exclude/i);
  assert.match(skill, /must not trigger|do not invoke|out of scope/i);
});

test("fix-report writes to a dedicated report repository and pushes", async () => {
  const skill = await read("plugins/cosmos-fix-tools/skills/fix-report/SKILL.md");
  const readme = await read("README.md");

  assert.match(skill, /<cosmos-workspace-root>\/fix-reports/);
  assert.match(skill, /user-configured|user-provided|user-confirmed/i);
  assert.match(skill, /git repository/i);
  assert.match(readme, /git init [^\n]*<cosmos-workspace-root>\/fix-reports/i);
  assert.match(skill, /never[^\n]*git init[^\n]*<cosmos-workspace-root>(?!\/fix-reports)/i);
  for (const command of [
    "rev-parse --show-toplevel",
    "status --porcelain",
    "add -- <report-relative-path>",
    "commit -m",
    "push <upstream-remote>",
  ]) {
    assert.match(
      skill,
      new RegExp(`git -C [^\\n]*fix-reports[^\\n]*${command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
  }
  assert.match(skill, /configured upstream|configured remote/i);
  assert.match(skill, /git -C [^\n]*fix-reports[^\n]*rev-list --left-right --count HEAD\.\.\.\@\{upstream\}/);
  assert.match(skill, /require exactly `0 0`/i);
  assert.match(skill, /automatically|without (?:additional )?(?:approval|confirmation)/i);
  assert.doesNotMatch(skill, /ask the user for one confirmation|confirmation is denied|per-run confirmation/i);
  assert.match(skill, /git -C [^\n]*fix-reports[^\n]*hash-object -- <report-relative-path>/);
  assert.match(skill, /git -C [^\n]*fix-reports[^\n]*rev-list --count <base-commit>\.\.HEAD/);
  assert.match(skill, /git -C [^\n]*fix-reports[^\n]*rev-parse HEAD\^/);
  assert.match(skill, /git -C [^\n]*fix-reports[^\n]*diff-tree --no-commit-id --name-only/);
  assert.match(skill, /git -C [^\n]*fix-reports[^\n]*rev-parse <report-commit>:<report-relative-path>/);
  assert.match(skill, /git -C [^\n]*fix-reports[^\n]*push <upstream-remote> <report-commit>:<upstream-merge-ref>/);
  assert.doesNotMatch(skill, /git -C [^\n]*fix-reports[^\n]*push <upstream-remote> HEAD:/);
  assert.match(skill, /non-zero exit|fails|failure/i);
  assert.match(skill, /token|cookie|signed URL|private source content/i);
});

test("every existing marketplace skill requires fix-report for packaged changes", async () => {
  const marketplace = JSON.parse(await read(".agents/plugins/marketplace.json"));
  const pluginEntries = marketplace.plugins.filter(
    ({ name }) => name !== "cosmos-fix-tools",
  );

  for (const pluginEntry of pluginEntries) {
    assert.equal(pluginEntry.source.source, "local");
    const pluginRoot = path.resolve(repoRoot, pluginEntry.source.path);
    const manifest = JSON.parse(await readFile(
      path.join(pluginRoot, ".codex-plugin", "plugin.json"),
      "utf8",
    ));
    const skillsRoot = path.resolve(pluginRoot, manifest.skills);
    const entries = await readdir(skillsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skill = await readFile(
        path.join(skillsRoot, entry.name, "SKILL.md"),
        "utf8",
      );
      assert.match(
        skill,
        /\$fix-report/,
        `${pluginEntry.name}/${entry.name} does not invoke $fix-report`,
      );
      assert.match(skill, /distributed|packaged/i);
      assert.match(skill, /external workspace/i);
      assert.match(skill, /cosmos-fix-tools@cosmos-plugins/);
      assert.match(skill, /unavailable/i);
      assert.match(skill, /automatic/i);
      assert.match(skill, /without additional (?:approval|confirmation)/i);
    }
  }
});

test("marketplace exposes cosmos-fix-tools as a local plugin", async () => {
  const marketplace = JSON.parse(await read(".agents/plugins/marketplace.json"));
  const entry = marketplace.plugins.find(({ name }) => name === "cosmos-fix-tools");

  assert.deepEqual(entry?.source, {
    source: "local",
    path: "./plugins/cosmos-fix-tools",
  });
  assert.deepEqual(entry?.policy, {
    installation: "AVAILABLE",
    authentication: "ON_INSTALL",
  });
  assert.equal(entry?.category, "Productivity");
});
