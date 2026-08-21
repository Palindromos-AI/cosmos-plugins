import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  realpath,
  readFile,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:\+codex\.[0-9A-Za-z.-]+)?$/);
  assert.equal(manifest.skills, "./skills/");
  assert.equal(manifest.repository, "https://github.com/Palindromos-AI/cosmos-plugins");
  assert.deepEqual(manifest.interface.defaultPrompt, [
    "Use $fix-report to automatically record and push a sanitized report for a Cosmos marketplace content change.",
  ]);
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

test("fix-report publishes through the bundled deterministic publisher", async () => {
  const skill = await read("plugins/cosmos-fix-tools/skills/fix-report/SKILL.md");
  const readme = await read("README.md");

  assert.match(skill, /<cosmos-workspace-root>\/fix-reports/);
  assert.match(skill, /user-configured|user-provided|user-confirmed/i);
  assert.match(skill, /git repository/i);
  assert.match(readme, /git init [^\n]*<cosmos-workspace-root>\/fix-reports/i);
  assert.match(skill, /never[^\n]*git init[^\n]*<cosmos-workspace-root>(?!\/fix-reports)/i);

  // Readiness is checked before any packaged file changes, without network.
  assert.match(skill, /publish-report\.mjs"? preflight --repo/);
  assert.match(skill, /before modifying any marketplace-distributed file/i);
  assert.match(skill, /local-only|contacts no network/i);

  // The publish workflow is deterministic script behavior, not prose steps.
  assert.match(skill, /publish-report\.mjs"? publish/);
  assert.match(skill, /--report/);
  assert.match(skill, /Cosmos Fix Report <fix-report@cosmos-plugins\.invalid>/);
  assert.match(skill, /`pushed`/);
  assert.match(skill, /`committed-not-pushed`/);
  assert.match(skill, /`remote-ahead`/);
  assert.match(skill, /pull --ff-only/);
  assert.match(skill, /argument-array|argument array|shell-quote/i);
  assert.match(skill, /validate[^\n]*(?:remote|ref)|(?:remote|ref)[^\n]*validate/i);

  assert.match(skill, /report-template\.md/);
  assert.match(skill, /--forbid/);
  assert.match(skill, /delete the rejected report file/i);
  assert.match(skill, /fix-report-runtime\.mjs"? (?:show-config|configure)/);
  assert.match(skill, /automatically|without (?:additional )?(?:approval|confirmation)/i);
  assert.doesNotMatch(skill, /ask the user for one confirmation|confirmation is denied|per-run confirmation/i);
  assert.match(skill, /never force-push/i);
  assert.match(skill, /non-zero exit|fails|failure/i);
  assert.match(skill, /token|cookie|signed URL|private source content/i);
});

test("fix-report writes only confined, non-symlink report paths", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cosmos-fix-report-test-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const canonicalTempRoot = await realpath(tempRoot);
  const reportRepo = path.join(canonicalTempRoot, "fix-reports");
  await mkdir(reportRepo);
  const scriptPath = path.join(
    repoRoot,
    "plugins/cosmos-fix-tools/skills/fix-report/scripts/write-report.mjs",
  );
  const scriptUrl = pathToFileURL(scriptPath).href;
  const { writeReport } = await import(scriptUrl);

  const reserved = await writeReport({
    repo: reportRepo,
    plugin: "cosmos-fix-tools",
    scope: "fix-report",
    timestamp: "2026-08-18T120000Z",
    id: "deadbeef",
    content: "report body\n",
  });
  assert.equal(
    reserved.relativePath,
    "cosmos-fix-tools/fix-report/2026-08-18T120000Z-deadbeef.md",
  );
  assert.equal(await readFile(reserved.absolutePath, "utf8"), "report body\n");
  await assert.rejects(
    writeReport({
      repo: reportRepo,
      plugin: "cosmos-fix-tools",
      scope: "fix-report",
      timestamp: "2026-08-18T120000Z",
      id: "deadbeef",
      content: "replacement\n",
    }),
    /exist|reserved/i,
  );

  for (const invalidComponent of ["../stockdata", "fix/report", "fix report", "$(touch-marker)"]) {
    await assert.rejects(
      writeReport({
        repo: reportRepo,
        plugin: invalidComponent,
        scope: "plugin",
        timestamp: "2026-08-18T120001Z",
        id: "feedface",
        content: "report body\n",
      }),
      /plugin/i,
    );
  }

  const outside = path.join(tempRoot, "outside");
  await mkdir(outside);
  await symlink(outside, path.join(reportRepo, "cosmos-sources-tools"));
  await assert.rejects(
    writeReport({
      repo: reportRepo,
      plugin: "cosmos-sources-tools",
      scope: "plugin",
      timestamp: "2026-08-18T120002Z",
      id: "cafebabe",
      content: "report body\n",
    }),
    /symbolic link|symlink/i,
  );

  for (const invalidArgs of [
    ["--repo", reportRepo, "--plugin", "cosmos-fix-tools", "--scope", "plugin", "--unknown", "value"],
    ["--repo", reportRepo, "--repo", reportRepo, "--plugin", "cosmos-fix-tools", "--scope", "plugin"],
  ]) {
    const result = spawnSync(process.execPath, [scriptPath, ...invalidArgs], {
      encoding: "utf8",
      input: "report body\n",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unknown|duplicate/i);
  }

  // A symbolic-link ancestor (macOS `/tmp` -> `/private/tmp`, synced folders)
  // is accepted and the returned path is canonical; the report repository
  // directory itself may still not be a symbolic link.
  const linkedParent = path.join(canonicalTempRoot, "linked-parent");
  await symlink(canonicalTempRoot, linkedParent, "dir");
  const viaLinkedParent = await writeReport({
    repo: path.join(linkedParent, "fix-reports"),
    plugin: "cosmos-fix-tools",
    scope: "fix-report",
    timestamp: "2026-08-18T120003Z",
    id: "0badf00d",
    content: "report body\n",
  });
  assert.equal(
    viaLinkedParent.absolutePath,
    path.join(reportRepo, "cosmos-fix-tools/fix-report/2026-08-18T120003Z-0badf00d.md"),
  );

  const linkedRepo = path.join(canonicalTempRoot, "linked-repo");
  await symlink(reportRepo, linkedRepo, "dir");
  await assert.rejects(
    writeReport({
      repo: linkedRepo,
      plugin: "cosmos-fix-tools",
      scope: "fix-report",
      timestamp: "2026-08-18T120004Z",
      id: "0badf00e",
      content: "report body\n",
    }),
    /symbolic link/i,
  );
});

test("existing skills scope source-repository authorization separately from fix reports", async () => {
  for (const relativePath of [
    "plugins/cosmos-sources-tools/skills/cls-fetch/SKILL.md",
    "plugins/cosmos-sources-tools/skills/zsxq-fetch/SKILL.md",
    "plugins/cosmos-stockdata-tools/skills/stockdata-fetch/SKILL.md",
  ]) {
    const skill = await read(relativePath);
    const authorizationLines = skill.split("\n").filter(
      (line) => /\b(?:Do not|Never) commit\b/i.test(line),
    );
    assert.ok(authorizationLines.length > 0, `${relativePath} has no source authorization rule`);
    for (const line of authorizationLines) {
      assert.match(line, /commit, merge, (?:or )?push/i);
      assert.match(line, /\bpublish\b/i);
      assert.doesNotMatch(line, /publish marketplace/i);
      assert.match(line, /authorization|authorizes/i);
      assert.match(line, /sole exception/i);
      assert.match(line, /report-only/i);
    }
  }
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
      assert.doesNotMatch(skill, /complete supported set/i);
      assert.match(skill, /unavailable/i);
      assert.match(
        skill,
        /before (?:changing|modifying) any marketplace-distributed file, confirm `?\$fix-report`? is available/i,
      );
      assert.match(skill, /publish-report\.mjs"? preflight/);
      assert.match(skill, /stop before modifying packaged content/i);
      assert.match(skill, /restart (?:the )?(?:ChatGPT desktop|app)/i);
      assert.match(skill, /new (?:Codex )?task/i);
      assert.match(skill, /repeat the repair from the beginning/i);
      assert.match(skill, /do not resume|never resume/i);
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

test("marketplace documents the mandatory fix companion contract", async () => {
  const readme = await read("README.md");
  const architecture = await read("ARCHITECTURE.md");
  const decisions = await read("DECISION.md");
  const changelog = await read("CHANGELOG.md");
  const marketplace = JSON.parse(await read(".agents/plugins/marketplace.json"));
  const knowledgeManifest = JSON.parse(await read(
    "plugins/cosmos-knowledge-tools/.codex-plugin/plugin.json",
  ));
  const expectedPlugins = [
    "cosmos-fix-tools",
    "cosmos-knowledge-tools",
    "cosmos-sources-tools",
    "cosmos-stockdata-tools",
  ];

  for (const document of [readme, architecture, decisions]) {
    assert.match(document, /cosmos-fix-tools[^\n]*(?:required|mandatory)[^\n]*companion/i);
    assert.match(document, /business plugins?[^\n]*(?:independently optional|do not depend on (?:one )?another)/i);
    assert.doesNotMatch(document, /(?:all four plugins|four-plugin)[^\n]*(?:required|supported|installation|deployment)/i);
    assert.doesNotMatch(document, /subset installations? (?:are|is) not supported/i);
  }
  assert.match(changelog, /cosmos-fix-tools[^\n]*mandatory companion/i);
  assert.doesNotMatch(changelog, /complete-installation|full-set|four-plugin/i);
  assert.deepEqual(
    marketplace.plugins.map(({ name }) => name).sort(),
    expectedPlugins,
  );
  assert.match(knowledgeManifest.version, /^\d+\.\d+\.\d+(?:\+codex\.[0-9A-Za-z.-]+)?$/);

  const installCommands = [...readme.matchAll(
    /^codex plugin add (cosmos-[a-z-]+)@cosmos-plugins$/gm,
  )].map((match) => match[1]);
  assert.deepEqual([...new Set(installCommands)].sort(), expectedPlugins);

  const zsxqSkill = await read(
    "plugins/cosmos-sources-tools/skills/zsxq-fetch/SKILL.md",
  );
  const runnerContract = await read(
    "plugins/cosmos-sources-tools/skills/zsxq-fetch/references/runner-contract.md",
  );
  assert.doesNotMatch(zsxqSkill, /independently installed skill/i);
  assert.doesNotMatch(runnerContract, /independently copied skill/i);
});
