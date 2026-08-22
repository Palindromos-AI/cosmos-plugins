#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const TIME_ZONE = "Asia/Shanghai";
export const DEFAULT_BASE_URL = "https://www.cls.cn";
export const DEFAULT_PAGE_SIZE = 20;
// The endpoint returns an empty page for rn above 50, which would read as a
// misleading "empty page before the start boundary" failure.
export const MAX_PAGE_SIZE = 50;

const APP_PARAMS = Object.freeze({
  app: "CailianpressWeb",
  os: "web",
  sv: "8.7.9",
});

// Expected operational failures (usage errors, HTTP/application errors,
// fail-closed completeness checks). The CLI prints them without a stack trace;
// anything else is an unexpected defect and keeps the stack.
export class ClsFetchError extends Error {}

function shaHex(algorithm, value) {
  return createHash(algorithm).update(value).digest("hex");
}

export function canonicalizeParams(params) {
  return Object.keys(params)
    .sort((left, right) => {
      const a = String(left).toUpperCase();
      const b = String(right).toUpperCase();
      return a > b ? 1 : a === b ? 0 : -1;
    })
    .map((key) => {
      const value = params[key];
      if (!["string", "number", "boolean"].includes(typeof value)) {
        throw new TypeError(`Unsupported signing value for ${key}`);
      }
      return `${key}=${value}`;
    })
    .join("&");
}

export function signParams(params) {
  return shaHex("md5", shaHex("sha1", canonicalizeParams(params)));
}

export function formatShanghaiDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function dateWindow(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    throw new ClsFetchError(`Invalid date: ${dateString}`);
  }

  const startMs = Date.parse(`${dateString}T00:00:00+08:00`);
  if (!Number.isFinite(startMs) || formatShanghaiDate(new Date(startMs)) !== dateString) {
    throw new ClsFetchError(`Invalid Shanghai calendar date: ${dateString}`);
  }

  const start = Math.floor(startMs / 1000);
  return { start, end: start + 86_400 };
}

export function initialCursor(dateString, now = new Date()) {
  const currentDate = formatShanghaiDate(now);
  if (dateString > currentDate) {
    throw new ClsFetchError(`Cannot fetch future Shanghai date ${dateString}`);
  }

  const { end } = dateWindow(dateString);
  if (dateString < currentDate) {
    return end;
  }
  return Math.min(Math.floor(now.getTime() / 1000) + 1, end);
}

export function buildRequestUrl({
  baseUrl = DEFAULT_BASE_URL,
  cursor,
  pageSize = DEFAULT_PAGE_SIZE,
}) {
  const params = {
    ...APP_PARAMS,
    last_time: cursor,
    refresh_type: 1,
    rn: pageSize,
  };
  const url = new URL("/v1/roll/get_roll_list", baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  url.searchParams.set("sign", signParams(params));
  return url;
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

async function fetchJson(
  url,
  {
    fetchImpl = globalThis.fetch,
    sleepImpl = sleep,
    timeoutMs = 10_000,
    retries = 2,
  } = {},
) {
  if (typeof fetchImpl !== "function") {
    throw new ClsFetchError("This Node.js runtime does not provide fetch()");
  }

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        const body = (await response.text()).slice(0, 500);
        const error = new ClsFetchError(
          `CLS request failed with HTTP ${response.status}${body ? `: ${body}` : ""}`,
        );
        error.status = response.status;
        throw error;
      }

      return await response.json();
    } catch (error) {
      const status = error?.status;
      const retryable = status === 429 || status >= 500 || status === undefined;
      if (!retryable || attempt === retries) {
        throw error;
      }
      await sleepImpl(500 * 2 ** attempt);
    }
  }

  throw new Error("Unreachable retry state");
}

function validatePage(payload) {
  if (!payload || payload.errno !== 0) {
    throw new ClsFetchError(
      `CLS returned an application error: ${JSON.stringify({
        errno: payload?.errno,
        msg: payload?.msg,
      })}`,
    );
  }
  const rollData = payload.data?.roll_data;
  if (!Array.isArray(rollData)) {
    throw new ClsFetchError("CLS response is missing data.roll_data");
  }
  for (const item of rollData) {
    if (!Number.isInteger(item?.id) || !Number.isInteger(item?.ctime)) {
      throw new ClsFetchError(
        "CLS response contains an item without a valid integer id or ctime",
      );
    }
  }
  for (let index = 1; index < rollData.length; index += 1) {
    const previous = rollData[index - 1];
    const current = rollData[index];
    if (current.ctime > previous.ctime) {
      throw new ClsFetchError(
        "CLS response is not ordered newest-first: " +
          `index ${index - 1} ctime=${previous.ctime}, ` +
          `index ${index} ctime=${current.ctime}`,
      );
    }
  }
  return rollData;
}

export async function fetchDay({
  date = formatShanghaiDate(),
  now = new Date(),
  baseUrl = DEFAULT_BASE_URL,
  pageSize = DEFAULT_PAGE_SIZE,
  maxPages = 500,
  delayMs = 150,
  timeoutMs = 10_000,
  fetchImpl = globalThis.fetch,
  sleepImpl = sleep,
} = {}) {
  if (!Number.isFinite(now.getTime())) {
    throw new ClsFetchError("now must be a valid Date");
  }
  const { start, end } = dateWindow(date);
  if (pageSize > MAX_PAGE_SIZE) {
    throw new ClsFetchError(`pageSize cannot exceed ${MAX_PAGE_SIZE}`);
  }
  let cursor = initialCursor(date, now);
  let pages = 0;
  let stopReason = null;
  let previousTailTime = null;
  let boostedCursor = null;
  const byId = new Map();

  while (pages < maxPages) {
    const requestSize = boostedCursor === cursor ? MAX_PAGE_SIZE : pageSize;
    const url = buildRequestUrl({ baseUrl, cursor, pageSize: requestSize });
    const payload = await fetchJson(url, {
      fetchImpl,
      sleepImpl,
      timeoutMs,
    });
    const pageItems = validatePage(payload);
    pages += 1;

    if (pageItems.length === 0) {
      throw new ClsFetchError(
        `CLS returned an empty page at cursor=${cursor} before the Shanghai start boundary`,
      );
    }

    if (
      previousTailTime !== null &&
      pageItems[0].ctime > previousTailTime
    ) {
      throw new ClsFetchError(
        "CLS pagination moved forward across pages: " +
          `previous tail=${previousTailTime}, current head=${pageItems[0].ctime}`,
      );
    }
    const outsideCursor = pageItems.find((item) => item.ctime >= cursor);
    if (outsideCursor) {
      throw new ClsFetchError(
        "CLS response violates the exclusive cursor: " +
          `cursor=${cursor}, id=${outsideCursor.id}, ctime=${outsideCursor.ctime}`,
      );
    }

    for (const item of pageItems) {
      if (item.ctime >= start && item.ctime < end && !byId.has(item.id)) {
        byId.set(item.id, item);
      }
    }

    const tailTime = pageItems[pageItems.length - 1].ctime;
    if (tailTime < start) {
      stopReason = "start-boundary-reached";
      break;
    }

    // last_time is exclusive. Add one second so the next page overlaps the
    // boundary second; ID deduplication removes repeats without skipping peers.
    const nextCursor = tailTime + 1;
    if (nextCursor >= cursor) {
      // A short page that cannot advance means the feed holds nothing older:
      // the start boundary cannot be proven, so fail closed.
      if (pageItems.length < requestSize) {
        throw new ClsFetchError(
          `CLS feed ended at cursor=${cursor} before the Shanghai start boundary; completeness cannot be proven`,
        );
      }
      // A full page sharing one ctime second stalls the cursor. Retry the
      // same cursor once at the maximum page size before failing, so a burst
      // of same-second items does not make the day permanently unfetchable.
      if (requestSize < MAX_PAGE_SIZE) {
        boostedCursor = cursor;
        if (delayMs > 0) {
          await sleepImpl(delayMs);
        }
        continue;
      }
      throw new ClsFetchError(
        `Pagination made no progress at cursor=${cursor} even with rn=${MAX_PAGE_SIZE}; ` +
          `at least ${MAX_PAGE_SIZE} items share the second ${tailTime}`,
      );
    }

    previousTailTime = tailTime;
    cursor = nextCursor;
    if (delayMs > 0) {
      await sleepImpl(delayMs);
    }
  }

  if (!stopReason) {
    throw new ClsFetchError(`Pagination exceeded maxPages=${maxPages} before reaching midnight`);
  }

  const items = [...byId.values()].sort(
    (left, right) => right.ctime - left.ctime || right.id - left.id,
  );
  return {
    schema_version: 1,
    source: {
      name: "财联社电报",
      page_url: `${DEFAULT_BASE_URL}/telegraph`,
    },
    date,
    timezone: TIME_ZONE,
    snapshot_at:
      date === formatShanghaiDate(now)
        ? now.toISOString()
        : new Date(end * 1000).toISOString(),
    fetched_at: new Date().toISOString(),
    complete: true,
    stop_reason: stopReason,
    page_count: pages,
    item_count: items.length,
    items,
  };
}

export async function writeDataset(outputPath, dataset) {
  const target = resolve(outputPath);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}`;
  try {
    await writeFile(temporary, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return target;
}

// Network failures from fetch() are expected too: undici signals them as a
// TypeError carrying a `cause`, and AbortSignal.timeout() as a TimeoutError
// or AbortError.
function expectedNetworkError(error) {
  if (error === null || typeof error !== "object") {
    return false;
  }
  if (error.name === "AbortError" || error.name === "TimeoutError") {
    return true;
  }
  return error instanceof TypeError && error.cause !== undefined;
}

export function formatCliError(error) {
  const expected = error instanceof ClsFetchError || expectedNetworkError(error);
  const primary = expected
    ? error.message
    : error?.stack ?? error?.message ?? String(error);
  const cause = error?.cause;
  if (!cause) {
    return primary;
  }

  const details = [
    ["code", cause.code],
    ["syscall", cause.syscall],
    ["hostname", cause.hostname],
    ["message", cause.message],
  ]
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .map(([name, value]) => `${name}=${value}`);

  return details.length > 0
    ? `${primary}\nCaused by: ${details.join(", ")}`
    : primary;
}

function parseIntegerFlag(name, value, { allowZero = false } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < (allowZero ? 0 : 1)) {
    throw new ClsFetchError(`${name} must be ${allowZero ? "a non-negative" : "a positive"} integer`);
  }
  return number;
}

function parsePageSize(value) {
  const number = parseIntegerFlag("--page-size", value);
  if (number > MAX_PAGE_SIZE) {
    throw new ClsFetchError(`--page-size cannot exceed ${MAX_PAGE_SIZE}; the endpoint returns an empty page above it`);
  }
  return number;
}

export function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag.startsWith("--") || value === undefined) {
      throw new ClsFetchError(`Expected --flag value, received ${flag}`);
    }
    options[flag.slice(2)] = value;
    index += 1;
  }

  if (!options.output) {
    throw new ClsFetchError("--output is required");
  }
  return {
    output: options.output,
    date: options.date,
    now: options.now ? new Date(options.now) : new Date(),
    baseUrl: options["base-url"] ?? DEFAULT_BASE_URL,
    pageSize: options["page-size"]
      ? parsePageSize(options["page-size"])
      : DEFAULT_PAGE_SIZE,
    maxPages: options["max-pages"]
      ? parseIntegerFlag("--max-pages", options["max-pages"])
      : 500,
    delayMs: options["delay-ms"]
      ? parseIntegerFlag("--delay-ms", options["delay-ms"], { allowZero: true })
      : 150,
    timeoutMs: options["timeout-ms"]
      ? parseIntegerFlag("--timeout-ms", options["timeout-ms"])
      : 10_000,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const date = args.date ?? formatShanghaiDate(args.now);
  const dataset = await fetchDay({ ...args, date });
  const output = await writeDataset(args.output, dataset);
  process.stdout.write(
    `${JSON.stringify({
      output,
      date: dataset.date,
      timezone: dataset.timezone,
      pages: dataset.page_count,
      items: dataset.item_count,
      complete: dataset.complete,
    })}\n`,
  );
}

// Resolve the invoked path before comparing: Node resolves `import.meta.url`
// through symbolic links but leaves `process.argv[1]` as typed.
function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  let resolved = entry;
  try {
    resolved = realpathSync(entry);
  } catch {
    // keep the unresolved path; the comparison below still decides
  }
  return import.meta.url === pathToFileURL(entry).href
    || import.meta.url === pathToFileURL(resolved).href;
}

if (isMainModule()) {
  main().catch((error) => {
    process.stderr.write(`cls-fetch: ${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}
