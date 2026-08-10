import assert from "node:assert/strict";
import test from "node:test";

import {
  assessManifest,
  GENERATOR,
  normalizeInventory,
  normalizeTopic,
  SCHEMA_VERSION,
} from "../scripts/run-model.mjs";
import {
  beijingDateFromTimestamp,
  currentBeijingDate,
  ZSXQ_TIME_ZONE,
  ZSXQ_UTC_OFFSET,
} from "../scripts/zsxq-time.mjs";

test("exposes the fixed ZSXQ timezone contract", () => {
  assert.equal(ZSXQ_TIME_ZONE, "Asia/Shanghai");
  assert.equal(ZSXQ_UTC_OFFSET, "+08:00");
});

test("converts UTC instants on both sides of Beijing midnight", () => {
  assert.equal(
    beijingDateFromTimestamp("2026-08-03T15:59:59.999999999Z"),
    "2026-08-03",
  );
  assert.equal(
    beijingDateFromTimestamp("2026-08-03T16:00:00Z"),
    "2026-08-04",
  );
});

test("converts explicit Beijing and non-Beijing offsets by instant", () => {
  assert.equal(
    beijingDateFromTimestamp("2026-08-04T00:00:00+08:00"),
    "2026-08-04",
  );
  assert.equal(
    beijingDateFromTimestamp("2026-08-04T01:00:00+09:00"),
    "2026-08-04",
  );
  assert.equal(
    beijingDateFromTimestamp("2026-08-03T23:00:00-02:00"),
    "2026-08-04",
  );
});

test("accepts real leap days and rejects nonexistent calendar dates", () => {
  for (const timestamp of [
    "2000-02-29T12:00:00Z",
    "2024-02-29T12:00:00Z",
    "2400-02-29T12:00:00Z",
  ]) {
    assert.equal(beijingDateFromTimestamp(timestamp), timestamp.slice(0, 10));
  }
  for (const timestamp of [
    "1900-02-29T00:00:00Z",
    "2100-02-29T00:00:00Z",
    "2023-02-29T00:00:00Z",
    "2026-02-30T00:00:00Z",
    "2026-00-01T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-08-00T00:00:00Z",
  ]) {
    assert.throws(
      () => beijingDateFromTimestamp(timestamp),
      /real ISO-8601 instant/,
    );
  }
});

test("rejects invalid time and offset fields", () => {
  for (const timestamp of [
    "2026-08-04T24:00:00Z",
    "2026-08-04T00:60:00Z",
    "2026-08-04T00:00:60Z",
    "2026-08-04T00:00:00+24:00",
    "2026-08-04T00:00:00+08:60",
  ]) {
    assert.throws(
      () => beijingDateFromTimestamp(timestamp),
      /real ISO-8601 instant/,
    );
  }
});

test("accepts maximum numeric offsets without using the host timezone", () => {
  assert.equal(
    beijingDateFromTimestamp("2026-08-04T23:59:59+23:59"),
    "2026-08-04",
  );
  assert.equal(
    beijingDateFromTimestamp("2026-08-03T00:00:00-23:59"),
    "2026-08-04",
  );
});

test("preserves the four-digit YYYY-MM-DD output contract", () => {
  assert.equal(
    beijingDateFromTimestamp("0000-01-01T00:00:00Z"),
    "0000-01-01",
  );
  assert.equal(
    beijingDateFromTimestamp("9999-12-31T00:00:00Z"),
    "9999-12-31",
  );
  assert.throws(
    () => beijingDateFromTimestamp("0000-01-01T00:00:00+23:59"),
    /four-digit Beijing calendar year/,
  );
  assert.throws(
    () => beijingDateFromTimestamp("9999-12-31T23:59:59-23:59"),
    /four-digit Beijing calendar year/,
  );
  assert.throws(
    () => currentBeijingDate(Date.parse("9999-12-31T23:59:59Z")),
    /four-digit Beijing calendar year/,
  );
});

test("rejects date-only, timezone-less, malformed, and non-string inputs", () => {
  for (const timestamp of [
    "2026-08-04",
    "2026-08-04T00:00:00",
    "not-a-date",
    1_786_469_200_000,
    null,
  ]) {
    assert.throws(
      () => beijingDateFromTimestamp(timestamp),
      /explicit Z or UTC offset/,
    );
  }
});

test("resolves currentBeijingDate at the Beijing midnight boundary", () => {
  assert.equal(
    currentBeijingDate(Date.parse("2026-08-03T15:59:59.999Z")),
    "2026-08-03",
  );
  assert.equal(
    currentBeijingDate(Date.parse("2026-08-03T16:00:00Z")),
    "2026-08-04",
  );
  assert.throws(() => currentBeijingDate(Number.NaN), /finite number/);
  assert.throws(() => currentBeijingDate(Number.POSITIVE_INFINITY), /finite number/);
  assert.throws(
    () => currentBeijingDate(Number.MAX_VALUE),
    /representable number/,
  );
});

test("runner topic validation uses the converted Beijing date", async () => {
  const manifest = {
    date: "2026-08-04",
    topics: [],
    workspace: process.cwd(),
  };
  const baseTopic = {
    source_order: 1,
    source: {},
    author: "Tester",
    body: { status: "empty" },
    image_count: 0,
    image_count_evidence: "expanded topic has no image slots",
    attachments: [],
  };
  for (const timestamp of [
    "2026-08-03T16:00:00Z",
    "2026-08-04T01:00:00+09:00",
    "2026-08-03T23:00:00-02:00",
  ]) {
    const topic = await normalizeTopic(manifest, { ...baseTopic, timestamp });
    assert.equal(topic.timestamp, timestamp);
  }
  for (const timestamp of [
    "2026-08-03T15:59:59.999Z",
    "2026-08-04T16:00:00Z",
  ]) {
    await assert.rejects(
      () => normalizeTopic(manifest, { ...baseTopic, timestamp }),
      /platform date 2026-08-04.*Beijing time/,
    );
  }
  await assert.rejects(
    () => normalizeTopic(manifest, {
      ...baseTopic,
      timestamp: "2026-02-30T00:00:00Z",
    }),
    /real ISO-8601 instant/,
  );
});

test("manifest assessment rejects normalized nonexistent inventory dates", () => {
  const inventoryTopic = {
    source_order: 1,
    source: {},
    author: "Tester",
    body: { status: "empty" },
    image_count: 0,
    image_count_evidence: "expanded topic has no image slots",
    attachments: [],
  };
  const manifest = {
    schema_version: SCHEMA_VERSION,
    generator: GENERATOR,
    date: "2026-08-04",
    coverage: {},
    topics: [],
    inventory: normalizeInventory({
      topics: [{ ...inventoryTopic, timestamp: "2026-08-03T16:00:00Z" }],
    }),
  };
  assert.equal(assessManifest(manifest).inventory_topic_count, 1);

  const invalidManifest = {
    ...manifest,
    date: "2026-03-02",
    inventory: normalizeInventory({
      topics: [{ ...inventoryTopic, timestamp: "2026-02-30T00:00:00Z" }],
    }),
  };
  assert.throws(
    () => assessManifest(invalidManifest),
    /real ISO-8601 instant/,
  );
});
