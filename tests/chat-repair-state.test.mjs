import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import * as dingdingRepair from "../plugins/cosmos-sources-tools/skills/dingding-fetch/scripts/repair-state.mjs";
import * as feishuRepair from "../plugins/cosmos-sources-tools/skills/feishu-fetch/scripts/repair-state.mjs";

const execFileAsync = promisify(execFile);

for (const [skillName, repair] of [
  ["dingding-fetch", dingdingRepair],
  ["feishu-fetch", feishuRepair],
]) {
  test(`${skillName} allows exactly one automatic repair per run`, async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), `${skillName}-repair-`));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const statePath = path.join(directory, "repair-state.json");
    const runId = "a1b2c3d4";

    const first = await repair.beginRepair({
      statePath,
      runId,
      failureCode: "UI_CONTRACT_MISMATCH",
      phase: "group-navigation",
    });
    assert.deepEqual(first, {
      status: "automatic-repair-authorized",
      skill: skillName,
      run_id: runId,
      attempts_used: 1,
      max_attempts: 1,
    });

    const second = await repair.beginRepair({
      statePath,
      runId,
      failureCode: "SECOND_UI_CONTRACT_MISMATCH",
      phase: "message-range",
    });
    assert.deepEqual(second, {
      status: "repair-limit-reached",
      skill: skillName,
      run_id: runId,
      attempts_used: 1,
      max_attempts: 1,
    });

    const state = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(state.schema_version, 1);
    assert.equal(state.skill, skillName);
    assert.equal(state.run_id, runId);
    assert.equal(state.attempts_used, 1);
    assert.equal(state.max_attempts, 1);
    assert.equal((await stat(statePath)).mode & 0o777, 0o600);
    assert.deepEqual(state.first_failure, {
      code: "UI_CONTRACT_MISMATCH",
      phase: "group-navigation",
    });
    assert.doesNotMatch(JSON.stringify(state), /SECOND_UI_CONTRACT_MISMATCH/);
  });

  test(`${skillName} fails closed on conflicting or corrupt repair state`, async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), `${skillName}-repair-`));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const statePath = path.join(directory, "repair-state.json");

    await repair.beginRepair({
      statePath,
      runId: "11111111",
      failureCode: "UI_CONTRACT_MISMATCH",
      phase: "group-navigation",
    });
    await assert.rejects(
      repair.beginRepair({
        statePath,
        runId: "22222222",
        failureCode: "UI_CONTRACT_MISMATCH",
        phase: "group-navigation",
      }),
      /belongs to another run/,
    );

    const corruptPath = path.join(directory, "corrupt-repair-state.json");
    await writeFile(corruptPath, "{}\n", { mode: 0o600 });
    await assert.rejects(
      repair.beginRepair({
        statePath: corruptPath,
        runId: "33333333",
        failureCode: "UI_CONTRACT_MISMATCH",
        phase: "group-navigation",
      }),
      /invalid repair state/,
    );

    const malformedRunPath = path.join(directory, "malformed-run-repair-state.json");
    await writeFile(
      malformedRunPath,
      `${JSON.stringify({
        schema_version: 1,
        skill: skillName,
        run_id: "NOT-A-RUN-ID",
        attempts_used: 1,
        max_attempts: 1,
        first_failure: {
          code: "UI_CONTRACT_MISMATCH",
          phase: "group-navigation",
        },
      })}\n`,
      { mode: 0o600 },
    );
    await assert.rejects(
      repair.beginRepair({
        statePath: malformedRunPath,
        runId: "33333333",
        failureCode: "UI_CONTRACT_MISMATCH",
        phase: "group-navigation",
      }),
      /invalid repair state/,
    );
  });

  test(`${skillName} authorizes only one of concurrent repair requests`, async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), `${skillName}-repair-race-`));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const statePath = path.join(directory, "repair-state.json");

    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, index) => repair.beginRepair({
        statePath,
        runId: "a1b2c3d4",
        failureCode: `UI_CONTRACT_MISMATCH_${index}`,
        phase: "group-navigation",
      })),
    );
    const statuses = responses.map(({ status }) => status);
    assert.equal(
      statuses.filter((status) => status === "automatic-repair-authorized").length,
      1,
    );
    assert.equal(
      statuses.filter((status) => status === "repair-limit-reached").length,
      19,
    );
  });
}

for (const skillName of ["dingding-fetch", "feishu-fetch"]) {
  test(`${skillName} CLI enforces the same whole-run repair limit`, async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), `${skillName}-repair-cli-`));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const statePath = path.join(directory, "repair-state.json");
    const scriptPath = path.resolve(
      `plugins/cosmos-sources-tools/skills/${skillName}/scripts/repair-state.mjs`,
    );
    const args = [
      scriptPath,
      "begin",
      statePath,
      "a1b2c3d4",
      "UI_CONTRACT_MISMATCH",
      "group-navigation",
    ];

    const first = JSON.parse((await execFileAsync(process.execPath, args)).stdout);
    assert.equal(first.status, "automatic-repair-authorized");
    assert.equal(first.attempts_used, 1);
    assert.equal(first.max_attempts, 1);

    const second = JSON.parse((await execFileAsync(process.execPath, args)).stdout);
    assert.equal(second.status, "repair-limit-reached");
    assert.equal(second.attempts_used, 1);
    assert.equal(second.max_attempts, 1);
  });
}
