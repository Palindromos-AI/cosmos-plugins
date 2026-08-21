import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// dingding-fetch and feishu-fetch are deliberate near-copies sharing the
// plugin-level scripts. After normalizing product names, their SKILL.md files
// must differ only in the whitelisted Feishu-specific capabilities below, so a
// fix applied to one cannot silently miss the other. Word boundaries matter:
// an unanchored `bot`/`refresh` would excuse lines containing "bottom" or
// "refreshing" and mask real drift.
const ALLOWED_DIVERGENCE = /\b(?:threads?|bots?|refresh(?:es|ed)?)\b|话题|机器人|刷新/i;

function normalize(text, replacements) {
  let result = text;
  for (const [from, to] of replacements) {
    result = result.replaceAll(from, to);
  }
  return result.split("\n");
}

test("dingding and feishu SKILL.md stay in sync outside whitelisted capabilities", async () => {
  const dingding = await readFile(
    path.join(repoRoot, "plugins/cosmos-sources-tools/skills/dingding-fetch/SKILL.md"),
    "utf8",
  );
  const feishu = await readFile(
    path.join(repoRoot, "plugins/cosmos-sources-tools/skills/feishu-fetch/SKILL.md"),
    "utf8",
  );

  const left = normalize(dingding, [
    ["dingding-fetch", "chat-fetch"],
    ["Dingding", "TheApp"],
    ["DingTalk", "TheApp"],
    ["dingtalk", "theapp"],
    ["钉钉", "该应用"],
  ]);
  const right = normalize(feishu, [
    ["feishu-fetch", "chat-fetch"],
    ["Feishu", "TheApp"],
    ["feishu", "theapp"],
    ["飞书", "该应用"],
  ]);

  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const leftOnly = left.filter((line) => line.trim() !== "" && !rightSet.has(line));
  const rightOnly = right.filter((line) => line.trim() !== "" && !leftSet.has(line));

  // A paired line (same long prefix on the other side) is explained only when
  // the DIFFERING segment is whitelisted — testing the whole line would let a
  // whitelisted word elsewhere in the sentence excuse an unrelated edit. A
  // standalone line is explained only when the line itself is whitelisted.
  const commonPrefix = (a, b) => {
    let index = 0;
    while (index < a.length && index < b.length && a[index] === b[index]) index += 1;
    return index;
  };
  const differingSegments = (a, b) => {
    const start = commonPrefix(a, b);
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
      endA -= 1;
      endB -= 1;
    }
    return [a.slice(start, endA), b.slice(start, endB)];
  };
  const explained = (line, otherOnly) => {
    const counterpart = otherOnly.find((other) => commonPrefix(line, other) >= 30);
    if (counterpart) {
      const [segment, counterSegment] = differingSegments(line, counterpart);
      return ALLOWED_DIVERGENCE.test(segment) || ALLOWED_DIVERGENCE.test(counterSegment);
    }
    return ALLOWED_DIVERGENCE.test(line);
  };

  const unexplained = [
    ...leftOnly.filter((line) => !explained(line, rightOnly)),
    ...rightOnly.filter((line) => !explained(line, leftOnly)),
  ];
  assert.deepEqual(
    unexplained,
    [],
    "the two chat SKILL.md files drifted outside the whitelisted Feishu capabilities",
  );
});

test("the chat skills have no per-skill scripts left to drift", async () => {
  const { readdir } = await import("node:fs/promises");
  for (const skill of ["dingding-fetch", "feishu-fetch"]) {
    const entries = await readdir(
      path.join(repoRoot, "plugins/cosmos-sources-tools/skills", skill),
    );
    assert.ok(!entries.includes("scripts"), `${skill} must use the plugin-level scripts`);
  }
});
