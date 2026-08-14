import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.join(repoRoot, "plugins", "cosmos-stockdata-tools");
const skillRoot = path.join(pluginRoot, "skills", "stockdata-fetch");

async function read(relativePath) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(path.join(directory, entry.name), relativePath));
    } else {
      files.push(relativePath);
    }
  }

  return files.sort();
}

test("stockdata-fetch keeps business scripts external and bundles only generic guidance and runtime", async () => {
  const files = await listFiles(skillRoot);
  const skill = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");
  const agent = await readFile(path.join(skillRoot, "agents", "openai.yaml"), "utf8");
  const architectureReference = await readFile(
    path.join(skillRoot, "references", "implementation-architecture.md"),
    "utf8",
  );
  const supermindReference = await readFile(
    path.join(skillRoot, "references", "supermind-api-patterns.md"),
    "utf8",
  );

  assert.deepEqual(files, [
    "SKILL.md",
    path.join("agents", "openai.yaml"),
    path.join("references", "implementation-architecture.md"),
    path.join("references", "supermind-api-patterns.md"),
    "requirements.txt",
    path.join("scripts", "supermind_runtime.py"),
    path.join("tests", "test_supermind_runtime.py"),
  ]);
  assert.match(skill, /^name: stockdata-fetch$/m);
  assert.match(skill, /^description: >-$/m);
  assert.match(skill, /SuperMind[\s\S]*baostock[\s\S]*AKShare/i);
  assert.match(skill, /当前需求|current requirement/i);
  assert.match(skill, /不.*全量|(?:no|without).*full[- ]extraction/i);
  assert.match(skill, /<stockdata-workspace>/i);
  assert.match(skill, /first requirement[\s\S]*<stockdata-workspace>[\s\S]*scripts\//i);
  assert.match(skill, /existing[\s\S]*(workspace|scripts)[\s\S]*(extend|evolve)/i);
  assert.match(skill, /runtime\.json/);
  assert.doesNotMatch(
    skill,
    /cosmos-stockdata-tools\/workspace|legacy binding|migration candidate|旧版绑定|迁移候选/i,
  );
  assert.match(skill, /workspace[\s\S]*token file[\s\S]*micromamba environment/i);
  assert.match(skill, /first use[\s\S]*(?:together|same setup|single setup)/i);
  assert.match(skill, /token (?:content|value)[\s\S]*(?:never|must not)[\s\S]*(?:config|runtime\.json)/i);
  assert.match(skill, /supermind_runtime\.py/);
  assert.match(skill, /micromamba run -n <env>[\s\S]*python/i);
  assert.match(skill, /uv pip install/i);
  assert.match(skill, /reconfigur[\s\S]*(?:explicit|authori)/i);
  assert.doesNotMatch(skill, /use the current project only when/i);
  assert.match(skill, /plugin cache[\s\S]*(read-only|replaceable|disposable)/i);
  assert.match(skill, /marketplace update[\s\S]*(preserve|cannot|must not|does not)/i);
  assert.match(skill, /each user[\s\S]*(own|independent|isolated)/i);
  assert.match(skill, /(upstream|marketplace release)[\s\S]*(all users|shared)/i);
  assert.doesNotMatch(skill, /persistent capability changes only in the canonical/i);
  assert.doesNotMatch(skill, /explicitly require(?:s|d)? AKShare|明确.*AKShare/i);
  assert.doesNotMatch(skill, /extract_daily|run_extract|validate_workbook|九个?工作表|nine expected sheets/i);
  assert.match(agent, /\$stockdata-fetch\b/);

  assert.match(skill, /implementation-architecture\.md/);
  assert.match(skill, /supermind-api-patterns\.md/);
  assert.match(architectureReference, /^## Contents$/m);
  assert.match(supermindReference, /^## Contents$/m);
  assert.match(architectureReference, /contract[\s\S]*adapter[\s\S]*normaliz[\s\S]*validat[\s\S]*deliver/i);
  assert.match(architectureReference, /provenance/i);
  assert.match(architectureReference, /partial[\s-]*(?:result|success)|部分结果/i);
  assert.match(supermindReference, /get_all_trade_days/);
  assert.match(supermindReference, /get_all_securities/);
  assert.match(supermindReference, /get_price/);
  assert.match(supermindReference, /skip_paused=skip_paused/);
  assert.match(supermindReference, /fq=adjustment/);
  assert.match(supermindReference, /get_fundamentals|run_query/);
  assert.match(supermindReference, /reindex/);
  assert.match(supermindReference, /returned_symbols_by_field[\s\S]*reindex/);
  assert.match(supermindReference, /batch|chunk|分批/i);
  assert.match(supermindReference, /unsupported[\s\S]*operational|不支持[\s\S]*运行故障/i);

  const references = `${architectureReference}\n${supermindReference}`;
  assert.doesNotMatch(references, /supermind_full_|extract_daily|run_extract|validate_workbook/i);
  assert.doesNotMatch(references, /九个?工作表|nine expected sheets|MIN_ALL_INDEXES|MIN_QUOTED_INDEXES/i);
  assert.doesNotMatch(references, /get_all_securities\(["']stock|concept_classification|query\(valuation\)/i);
  assert.doesNotMatch(supermindReference, /\n\s*False,\n\s*None,\n\s*0,/);
  assert.doesNotMatch(references, /\/Users\/[A-Za-z0-9._-]+|SUPERMIND_TOKEN\s*=/i);
});

test("stockdata plugin metadata describes incremental source extension", async () => {
  const manifest = JSON.parse(await read(
    "plugins/cosmos-stockdata-tools/.codex-plugin/plugin.json",
  ));
  const readme = await read("README.md");
  const changelog = await read("CHANGELOG.md");

  assert.match(manifest.version, /^0\.2\.2(?:\+codex\.[0-9A-Za-z.-]+)?$/);
  assert.match(manifest.interface.longDescription, /SuperMind[\s\S]*baostock[\s\S]*AKShare/i);
  assert.match(manifest.interface.longDescription, /request|requirement|需求/i);
  assert.match(manifest.interface.longDescription, /external|durable|workspace/i);
  assert.match(manifest.interface.longDescription, /marketplace update|plugin update/i);
  assert.match(manifest.interface.longDescription, /generic SuperMind runtime/i);
  assert.match(manifest.interface.longDescription, /implementation reference|实现参考/i);
  assert.doesNotMatch(JSON.stringify(manifest), /full A-share dataset|notebook|workbook validator/i);
  assert.doesNotMatch(readme, /bundles only a generic SuperMind/i);
  assert.doesNotMatch(changelog, /only generic SuperMind transport remains bundled/i);
});

test("marketplace keeps cosmos-stockdata-tools wired to the local plugin", async () => {
  const marketplace = JSON.parse(await read(".agents/plugins/marketplace.json"));
  const entry = marketplace.plugins.find(({ name }) => name === "cosmos-stockdata-tools");

  assert.deepEqual(entry?.source, {
    source: "local",
    path: "./plugins/cosmos-stockdata-tools",
  });
  assert.deepEqual(entry?.policy, {
    installation: "AVAILABLE",
    authentication: "ON_INSTALL",
  });
  assert.equal(entry?.category, "Productivity");
});
