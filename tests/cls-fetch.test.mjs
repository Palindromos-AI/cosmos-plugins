import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_PAGE_SIZE,
  buildRequestUrl,
  canonicalizeParams,
  dateWindow,
  fetchDay,
  initialCursor,
  parseArgs,
  signParams,
} from "../plugins/cosmos-sources-tools/skills/cls-fetch/scripts/fetch-cls.mjs";
import {
  batchDigest,
  listCandidates,
} from "../plugins/cosmos-sources-tools/skills/cls-fetch/scripts/list-candidates.mjs";
import { advanceReviewState } from "../plugins/cosmos-sources-tools/skills/cls-fetch/scripts/record-review.mjs";
import {
  parseSelection,
  renderMarkdown,
} from "../plugins/cosmos-sources-tools/skills/cls-fetch/scripts/render-markdown.mjs";

const DATE = "2026-08-19";
const { start: DAY_START, end: DAY_END } = dateWindow(DATE);
const noSleep = () => Promise.resolve();

// In-process fake of the CLS roll endpoint: newest-first items, exclusive
// last_time cursor, rn page size; rn above the real cap returns an empty page.
function fakeCls(items) {
  const sorted = [...items].sort((a, b) => b.ctime - a.ctime || b.id - a.id);
  const requests = [];
  const fetchImpl = async (url) => {
    const cursor = Number(url.searchParams.get("last_time"));
    const rn = Number(url.searchParams.get("rn"));
    requests.push({ cursor, rn });
    const page = rn > MAX_PAGE_SIZE
      ? []
      : sorted.filter((item) => item.ctime < cursor).slice(0, rn);
    return {
      ok: true,
      status: 200,
      json: async () => ({ errno: 0, data: { roll_data: page } }),
    };
  };
  return { fetchImpl, requests };
}

function makeItems(count, { startTime = DAY_START, gapSeconds = 60 } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    id: 1000 + index,
    ctime: startTime + index * gapSeconds,
    title: `Item ${1000 + index}`,
    content: `Body ${1000 + index}`,
  }));
}

function fetchOptions(fetchImpl, overrides = {}) {
  return {
    date: DATE,
    now: new Date((DAY_END + 3600) * 1000),
    fetchImpl,
    sleepImpl: noSleep,
    delayMs: 0,
    ...overrides,
  };
}

test("signing canonicalizes parameters case-insensitively and deterministically", () => {
  const params = { b: 1, A: "x", c: true };
  assert.equal(canonicalizeParams(params), "A=x&b=1&c=true");
  assert.equal(signParams(params), signParams({ c: true, A: "x", b: 1 }));
  const url = buildRequestUrl({ cursor: 123, pageSize: 20 });
  assert.equal(url.searchParams.get("last_time"), "123");
  assert.equal(url.searchParams.get("rn"), "20");
  assert.ok(url.searchParams.get("sign"));
});

test("date window and initial cursor follow the Shanghai calendar", () => {
  assert.equal(DAY_END - DAY_START, 86_400);
  assert.throws(() => dateWindow("2026-02-30"), /Invalid Shanghai calendar date/);
  assert.throws(() => initialCursor("2999-01-01"), /future Shanghai date/);
  const past = initialCursor(DATE, new Date((DAY_END + 999_999) * 1000));
  assert.equal(past, DAY_END);
  const during = new Date((DAY_START + 100) * 1000);
  assert.equal(initialCursor(DATE, during), DAY_START + 101);
});

test("fetchDay collects the complete day across overlapping pages without duplicates", async () => {
  const items = makeItems(60);
  // An older item before midnight proves the start boundary was crossed.
  items.push({ id: 999, ctime: DAY_START - 10, title: "old", content: "old" });
  const { fetchImpl } = fakeCls(items);
  const dataset = await fetchDay(fetchOptions(fetchImpl, { pageSize: 20 }));
  assert.equal(dataset.complete, true);
  assert.equal(dataset.stop_reason, "start-boundary-reached");
  assert.equal(dataset.item_count, 60);
  const ids = dataset.items.map((item) => item.id);
  assert.equal(new Set(ids).size, 60);
  assert.ok(!ids.includes(999));
  // Newest first in the dataset.
  assert.deepEqual(ids.slice(0, 2), [1059, 1058]);
});

test("fetchDay fails closed when the feed ends before the boundary", async () => {
  const items = makeItems(5, { startTime: DAY_START + 1000 });
  const { fetchImpl } = fakeCls(items); // no pre-midnight item: feed just ends
  await assert.rejects(
    fetchDay(fetchOptions(fetchImpl, { pageSize: 20 })),
    /feed ended at cursor=\d+ before the Shanghai start boundary/,
  );
});

test("fetchDay fails closed on an entirely empty page", async () => {
  const { fetchImpl } = fakeCls([]);
  await assert.rejects(
    fetchDay(fetchOptions(fetchImpl, { pageSize: 20 })),
    /empty page at cursor=\d+ before the Shanghai start boundary/,
  );
});

test("fetchDay fails closed when pagination moves forward", async () => {
  const items = makeItems(30);
  items.push({ id: 999, ctime: DAY_START - 10, title: "old", content: "old" });
  const { fetchImpl } = fakeCls(items);
  let calls = 0;
  const tampered = async (url) => {
    const response = await fetchImpl(url);
    calls += 1;
    if (calls === 2) {
      const payload = await response.json();
      // Second page pretends to jump forward past the first page's tail.
      payload.data.roll_data = [{ id: 5000, ctime: DAY_END - 1 }];
      return { ok: true, status: 200, json: async () => payload };
    }
    return response;
  };
  await assert.rejects(
    fetchDay(fetchOptions(tampered, { pageSize: 20 })),
    /exclusive cursor|moved forward/,
  );
});

test("fetchDay retries a same-second burst at the maximum page size", async () => {
  // 25 items share one second: a 20-item page cannot advance the cursor.
  const burst = Array.from({ length: 25 }, (_, index) => ({
    id: 2000 + index,
    ctime: DAY_START + 500,
    title: `burst ${index}`,
    content: `burst ${index}`,
  }));
  burst.push({ id: 999, ctime: DAY_START - 10, title: "old", content: "old" });
  const { fetchImpl, requests } = fakeCls(burst);
  const dataset = await fetchDay(fetchOptions(fetchImpl, { pageSize: 20 }));
  assert.equal(dataset.item_count, 25);
  assert.ok(requests.some((request) => request.rn === MAX_PAGE_SIZE));
});

test("fetchDay reports saturation when one second holds more than the maximum page size", async () => {
  const burst = Array.from({ length: MAX_PAGE_SIZE + 5 }, (_, index) => ({
    id: 3000 + index,
    ctime: DAY_START + 500,
    title: `burst ${index}`,
    content: `burst ${index}`,
  }));
  const { fetchImpl } = fakeCls(burst);
  await assert.rejects(
    fetchDay(fetchOptions(fetchImpl, { pageSize: MAX_PAGE_SIZE })),
    /at least 50 items share the second/,
  );
});

test("fetchDay enforces maxPages and the page-size cap", async () => {
  const items = makeItems(60);
  items.push({ id: 999, ctime: DAY_START - 10, title: "old", content: "old" });
  const { fetchImpl } = fakeCls(items);
  await assert.rejects(
    fetchDay(fetchOptions(fetchImpl, { pageSize: 20, maxPages: 2 })),
    /exceeded maxPages=2/,
  );
  await assert.rejects(
    fetchDay(fetchOptions(fetchImpl, { pageSize: 51 })),
    /pageSize cannot exceed 50/,
  );
  assert.throws(
    () => parseArgs(["--output", "x.json", "--page-size", "51"]),
    /--page-size cannot exceed 50/,
  );
});

test("review flow forces sequential digest-verified coverage into the renderer", async () => {
  const items = makeItems(25);
  items.push({ id: 999, ctime: DAY_START - 10, title: "old", content: "old" });
  const { fetchImpl } = fakeCls(items);
  const dataset = await fetchDay(fetchOptions(fetchImpl, { pageSize: 20 }));

  const firstBatch = listCandidates(dataset, { offset: 0, limit: 10 });
  assert.equal(firstBatch.batch_digest.length, 16);

  // Recording with a different limit than listed is rejected.
  assert.throws(
    () => advanceReviewState(dataset, null, {
      offset: 0, limit: 20, selectedIds: [], listedBatchDigest: firstBatch.batch_digest,
    }),
    /Batch digest does not match/,
  );

  let state = null;
  let offset = 0;
  while (offset !== null) {
    const listing = listCandidates(dataset, { offset, limit: 10 });
    const advanced = advanceReviewState(dataset, state, {
      offset,
      limit: 10,
      selectedIds: listing.items.slice(0, 2).map((item) => item.id),
      listedBatchDigest: listing.batch_digest,
    });
    state = advanced.state;
    offset = advanced.progress.next_offset;
  }
  assert.equal(state.reviewed_ids.length, dataset.item_count);

  // Renderer accepts the complete review and refuses a truncated one.
  const { markdown, selectedCount } = renderMarkdown(dataset, state, "测试筛选");
  assert.equal(selectedCount, state.selected_ids.length);
  assert.match(markdown, /（北京时间）/);
  assert.doesNotMatch(markdown, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);

  const truncated = structuredClone(state);
  truncated.reviewed_ids.pop();
  assert.throws(
    () => parseSelection(truncated, dataset),
    /does not cover every source item in order/,
  );
});

test("batch digests bind date, offset, and exact IDs", () => {
  const digest = batchDigest(DATE, 0, [1, 2, 3]);
  assert.notEqual(digest, batchDigest(DATE, 10, [1, 2, 3]));
  assert.notEqual(digest, batchDigest(DATE, 0, [1, 2, 4]));
  assert.notEqual(digest, batchDigest("2026-08-20", 0, [1, 2, 3]));
});
