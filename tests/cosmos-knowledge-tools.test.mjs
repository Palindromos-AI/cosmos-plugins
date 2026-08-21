import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.join(repoRoot, "plugins/cosmos-knowledge-tools");

async function read(relativePath) {
  return readFile(path.join(pluginRoot, relativePath), "utf8");
}

const EXPECTED_SKILLS = [
  "defuddle",
  "json-canvas",
  "llm-wiki",
  "obsidian-bases",
  "obsidian-cli",
  "obsidian-markdown",
  "raw-to-markdown",
];

test("cosmos-knowledge-tools packages all seven skills with UI metadata", async () => {
  const manifest = JSON.parse(await read(".codex-plugin/plugin.json"));
  assert.equal(manifest.name, "cosmos-knowledge-tools");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.skills, "./skills/");

  const entries = await readdir(path.join(pluginRoot, "skills"), { withFileTypes: true });
  const skillDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  assert.deepEqual(skillDirs, EXPECTED_SKILLS);

  for (const skill of EXPECTED_SKILLS) {
    const skillDoc = await read(`skills/${skill}/SKILL.md`);
    assert.match(skillDoc, new RegExp(`^name: ${skill}$`, "m"), `${skill}: frontmatter name`);
    assert.match(skillDoc, /^description: /m, `${skill}: frontmatter description`);
    const agent = await read(`skills/${skill}/agents/openai.yaml`);
    assert.match(agent, /display_name: /, `${skill}: display_name`);
    assert.match(agent, /short_description: /, `${skill}: short_description`);
  }
});

test("raw-to-markdown requires explicit invocation and a fully pinned engine", async () => {
  const agent = await read("skills/raw-to-markdown/agents/openai.yaml");
  assert.match(agent, /allow_implicit_invocation: false/);

  const requirements = await read("skills/raw-to-markdown/requirements.txt");
  assert.match(requirements, /^markitdown(?:\[[^\]]*\])?==[\w.]+$/m);
  assert.match(requirements, /^pdfplumber==[\w.]+$/m);
  // Transitive dependencies are locked too; a two-line pin list is not enough.
  const pinned = requirements.split("\n").filter((line) => /^[a-z0-9-]+(?:\[[^\]]*\])?==/i.test(line.trim()));
  assert.ok(pinned.length >= 20, `expected a locked dependency set, found ${pinned.length} pins`);

  const script = await read("skills/raw-to-markdown/scripts/raw_to_markdown.py");
  assert.doesNotMatch(script, /PINNED_ENGINE_VERSION\s*=/);
  assert.match(script, /requirements\.txt/);
});
