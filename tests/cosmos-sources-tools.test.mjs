import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { publishReport as publishDingdingReport } from "../plugins/cosmos-sources-tools/skills/dingding-fetch/scripts/publish-report.mjs";
import { publishReport as publishFeishuReport } from "../plugins/cosmos-sources-tools/skills/feishu-fetch/scripts/publish-report.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.join(repoRoot, "plugins", "cosmos-sources-tools");

async function read(relativePath) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

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
      "<workspace-root>",
      "<app-target>",
      "<display-timezone>",
      "<node-executable>",
    ]) {
      assert.ok(skill.includes(binding), `${skillName} is missing ${binding}`);
    }
    assert.doesNotMatch(
      skill,
      /\/Users\/|\/Applications\/|com\.[a-z0-9.-]+|<current-project>|\bMac(?:\/app)?\b/,
    );
  }
});

for (const { label, draftName, publishReport } of [
  {
    label: "dingding-fetch",
    draftName: ".dingtalk-digest-test.tmp",
    publishReport: publishDingdingReport,
  },
  {
    label: "feishu-fetch",
    draftName: ".feishu-digest-test.tmp",
    publishReport: publishFeishuReport,
  },
]) {
  test(`${label} publishes only verified bytes without clobbering`, async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), `${label}-`));
    t.after(() => rm(directory, { recursive: true, force: true }));

    const draftPath = path.join(directory, draftName);
    const targetPath = path.join(directory, "report.md");
    const bytes = Buffer.from("verified report\n");
    const expectedSha256 = createHash("sha256").update(bytes).digest("hex");
    await writeFile(draftPath, bytes);

    await publishReport({ draftPath, targetPath, expectedSha256 });
    assert.deepEqual(await readFile(targetPath), bytes);

    const secondDraft = path.join(directory, draftName.replace("test", "second"));
    await writeFile(secondDraft, bytes);
    await assert.rejects(
      publishReport({ draftPath: secondDraft, targetPath, expectedSha256 }),
      /target already exists/,
    );

    const changedDraft = path.join(directory, draftName.replace("test", "changed"));
    await writeFile(changedDraft, "changed report\n");
    await assert.rejects(
      publishReport({
        draftPath: changedDraft,
        targetPath: path.join(directory, "changed.md"),
        expectedSha256,
      }),
      /SHA-256 mismatch/,
    );
  });
}

test("plugin discovery metadata describes all four packaged source skills", async () => {
  const manifest = JSON.parse(await read(
    "plugins/cosmos-sources-tools/.codex-plugin/plugin.json",
  ));
  const readme = await read("README.md");

  assert.match(manifest.version, /^0\.3\.0(?:\+codex\.[0-9A-Za-z.-]+)?$/);
  for (const label of ["CLS", "Knowledge Planet", "DingTalk", "Feishu"]) {
    assert.match(manifest.interface.longDescription, new RegExp(label));
  }
  for (const skillName of ["cls-fetch", "zsxq-fetch", "dingding-fetch", "feishu-fetch"]) {
    assert.match(readme, new RegExp("`" + skillName + "`"));
  }
  assert.ok(manifest.interface.defaultPrompt.length <= 3);
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
