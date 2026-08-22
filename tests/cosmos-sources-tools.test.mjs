import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { publishReport } from "../plugins/cosmos-sources-tools/scripts/chat-publish-report.mjs";
import { configureRuntime } from "../plugins/cosmos-sources-tools/scripts/workspace-runtime.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.join(repoRoot, "plugins", "cosmos-sources-tools");

async function read(relativePath) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

test("all source skills use the external sources workspace binding", async () => {
  const workspaceReference = await readFile(
    path.join(pluginRoot, "references", "workspace-runtime.md"),
    "utf8",
  );
  const workspaceRuntime = await readFile(
    path.join(pluginRoot, "scripts", "workspace-runtime.mjs"),
    "utf8",
  );

  assert.match(workspaceReference, /~\/\.config\/cosmos-sources-tools\/runtime\.json/);
  assert.match(workspaceReference, /<cosmos-workspace-root>\/sources/);
  assert.match(workspaceReference, /marketplace[\s\S]*plugin[\s\S]*Skill[\s\S]*(?:must not|never)/i);
  assert.match(workspaceRuntime, /WORKSPACE_DIRECTORY = "sources"/);

  for (const skillName of ["cls-fetch", "zsxq-fetch", "dingding-fetch", "feishu-fetch"]) {
    const skill = await readFile(path.join(pluginRoot, "skills", skillName, "SKILL.md"), "utf8");
    assert.match(skill, /workspace-runtime\.md/);
    assert.match(skill, /workspace-runtime\.mjs show-config/);
    assert.match(skill, /<sources-workspace>/);
    assert.doesNotMatch(skill, /<current-project>|<workspace-root>/);
  }
});

test("cosmos-sources-tools packages the two group-chat fetch skills", async () => {
  for (const skillName of ["dingding-fetch", "feishu-fetch"]) {
    const skillRoot = path.join(pluginRoot, "skills", skillName);
    const skill = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");
    const agent = await readFile(path.join(skillRoot, "agents", "openai.yaml"), "utf8");
    const reference = await readFile(
      path.join(skillRoot, "references", "image-extraction.md"),
      "utf8",
    );

    assert.match(skill, new RegExp(`^name: ${skillName}$`, "m"));
    assert.match(agent, new RegExp(`\\$${skillName}\\b`));
    assert.match(reference, /Verify and fail visibly/);
    for (const binding of [
      "<sources-workspace>",
      "<app-target>",
      "<node-executable>",
      "<plugin-dir>",
    ]) {
      assert.ok(skill.includes(binding), `${skillName} is missing ${binding}`);
    }
    // Timezone is fixed to Beijing by deployment decision, never resolved.
    assert.ok(!skill.includes("<display-timezone>"), `${skillName} still resolves a display timezone`);
    assert.match(skill, /Asia\/Shanghai/);
    assert.doesNotMatch(
      skill,
      /\/Users\/|\/Applications\/|com\.[a-z0-9.-]+|<current-project>|\bMac(?:\/app)?\b/,
    );
  }
});

test("group-chat skills use one-attempt automatic repair contracts", async () => {
  for (const skillName of ["dingding-fetch", "feishu-fetch"]) {
    const skillRoot = path.join(pluginRoot, "skills", skillName);
    const skill = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");
    const playbook = await readFile(
      path.join(skillRoot, "references", "repair-playbook.md"),
      "utf8",
    );
    const combined = `${skill}\n${playbook}`;

    assert.match(skill, /automatic-repair-authorized/);
    assert.match(skill, /repair-limit-reached/);
    assert.match(skill, /repair-state\.mjs begin/);
    assert.match(skill, /Do not pause or ask the user for repair approval\./);
    assert.match(playbook, /exactly one automatic repair attempt per run/i);
    assert.match(playbook, /do not reset|never reset/i);
    assert.doesNotMatch(
      combined,
      /unlimited repair|retry until|repair until|无限修复|反复修复/iu,
    );
  }
});

for (const { label, outputName, draftName } of [
  {
    label: "dingding-fetch",
    outputName: "dingtalk",
    draftName: ".dingtalk-digest-test.tmp",
  },
  {
    label: "feishu-fetch",
    outputName: "feishu",
    draftName: ".feishu-digest-test.tmp",
  },
]) {
  test(`${label} publishes only verified bytes without clobbering`, async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), `${label}-`));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const workspaceRoot = path.join(directory, "cosmos-workspace");
    await mkdir(workspaceRoot);
    const runtimeOptions = {
      configFile: path.join(directory, "config", "runtime.json"),
      pluginRoot: path.join(directory, "installed-plugin"),
      validation: { temporaryRoots: [] },
    };
    const binding = await configureRuntime({ workspaceRoot, ...runtimeOptions });
    const outputDirectory = path.join(binding.workspace, "output", outputName);

    const draftPath = path.join(outputDirectory, draftName);
    const targetPath = path.join(outputDirectory, "report.md");
    const bytes = Buffer.from("verified report\n");
    const expectedSha256 = createHash("sha256").update(bytes).digest("hex");
    await writeFile(draftPath, bytes);

    await publishReport({ namespace: outputName, draftPath, targetPath, expectedSha256, runtimeOptions });
    assert.deepEqual(await readFile(targetPath), bytes);
    assert.deepEqual(await readdir(outputDirectory), ["report.md"]);

    const secondDraft = path.join(outputDirectory, draftName.replace("test", "second"));
    await writeFile(secondDraft, bytes);
    await assert.rejects(
      publishReport({ namespace: outputName, draftPath: secondDraft, targetPath, expectedSha256, runtimeOptions }),
      /target already exists/,
    );
    assert.deepEqual(await readFile(targetPath), bytes);
    assert.deepEqual(
      (await readdir(outputDirectory)).sort(),
      [path.basename(secondDraft), "report.md"].sort(),
    );

    const changedDraft = path.join(outputDirectory, draftName.replace("test", "changed"));
    await writeFile(changedDraft, "changed report\n");
    await assert.rejects(
      publishReport({ namespace: outputName,
        draftPath: changedDraft,
        targetPath: path.join(outputDirectory, "changed.md"),
        expectedSha256,
        runtimeOptions,
      }),
      /SHA-256 mismatch/,
    );

    const externalDraft = path.join(directory, draftName.replace("test", "external"));
    await writeFile(externalDraft, bytes);
    await assert.rejects(
      publishReport({ namespace: outputName,
        draftPath: externalDraft,
        targetPath: path.join(directory, "external.md"),
        expectedSha256,
        runtimeOptions,
      }),
      /output namespace/,
    );
  });
}

test("plugin discovery metadata describes all four packaged source skills", async () => {
  const manifest = JSON.parse(await read(
    "plugins/cosmos-sources-tools/.codex-plugin/plugin.json",
  ));
  const readme = await read("README.md");

  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:\+codex\.[0-9A-Za-z.-]+)?$/);
  for (const label of ["CLS", "Knowledge Planet", "DingTalk", "Feishu"]) {
    assert.match(manifest.interface.longDescription, new RegExp(label));
  }
  for (const skillName of ["cls-fetch", "zsxq-fetch", "dingding-fetch", "feishu-fetch"]) {
    assert.match(readme, new RegExp("`" + skillName + "`"));
  }
  assert.ok(manifest.interface.defaultPrompt.length <= 3);
});

test("zsxq-fetch repairs browser collector defects automatically", async () => {
  const skill = await read(
    "plugins/cosmos-sources-tools/skills/zsxq-fetch/SKILL.md",
  );
  const playbook = await read(
    "plugins/cosmos-sources-tools/skills/zsxq-fetch/references/browser-repair-playbook.md",
  );
  const runnerContract = await read(
    "plugins/cosmos-sources-tools/skills/zsxq-fetch/references/runner-contract.md",
  );
  const combined = `${skill}\n${playbook}\n${runnerContract}`;

  assert.match(skill, /automatic-repair-required/);
  assert.match(playbook, /automatic repair/i);
  assert.match(runnerContract, /automatic-repair-required/);
  assert.doesNotMatch(
    combined,
    /awaiting-user-approval|explicit(?:ly)? repl(?:y|ies)|明确回复[“"]修复|receiving the explicit reply/u,
  );
});

test("marketplace keeps cosmos-sources-tools wired to the local plugin", async () => {
  const marketplace = JSON.parse(await read(".agents/plugins/marketplace.json"));
  const entry = marketplace.plugins.find(({ name }) => name === "cosmos-sources-tools");

  assert.deepEqual(entry?.source, {
    source: "local",
    path: "./plugins/cosmos-sources-tools",
  });
  assert.deepEqual(entry?.policy, {
    installation: "AVAILABLE",
    authentication: "ON_INSTALL",
  });
  assert.equal(entry?.category, "Productivity");
});
