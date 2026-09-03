#!/usr/bin/env node

// Shared Beijing calendar-window resolver for dingding-fetch and feishu-fetch.

import { parseArgs } from "node:util";
import { MAX_RANGE_DAYS, isMainEntry } from "./workspace-runtime.mjs";

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ERROR = "date must be a real YYYY-MM-DD Beijing date not later than today";

function beijingDate(instant) {
  return new Date(instant.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

function beijingIso(instantMs) {
  return `${new Date(instantMs + BEIJING_OFFSET_MS).toISOString().slice(0, -1)}+08:00`;
}

function parseDate(value) {
  const match = DATE_PATTERN.exec(value);
  if (!match) throw new TypeError(DATE_ERROR);
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const utcMidnight = new Date(Date.UTC(year, month - 1, day));
  if (
    utcMidnight.getUTCFullYear() !== year
    || utcMidnight.getUTCMonth() !== month - 1
    || utcMidnight.getUTCDate() !== day
  ) {
    throw new TypeError(DATE_ERROR);
  }
  return utcMidnight.getTime() - BEIJING_OFFSET_MS;
}

export function resolveChatDateWindow({ date, endDate, now = new Date() } = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError("now must be a valid Date");
  }
  if (endDate !== undefined && date === undefined) {
    throw new TypeError("an end date requires an explicit start date");
  }
  const today = beijingDate(now);
  const startDate = date ?? today;
  const finalDate = endDate ?? startDate;
  const startMs = parseDate(startDate);
  const endMs = parseDate(finalDate);
  if (startDate > today || finalDate > today) throw new TypeError(DATE_ERROR);
  if (startDate > finalDate) {
    throw new TypeError("start date must not be later than the end date");
  }
  const dayCount = Math.round((endMs - startMs) / ONE_DAY_MS) + 1;
  if (dayCount > MAX_RANGE_DAYS) {
    throw new TypeError(`date range must span at most ${MAX_RANGE_DAYS} days`);
  }

  const range = startDate < finalDate;
  const historical = finalDate < today;
  const dates = [];
  for (let dayMs = startMs; dayMs <= endMs; dayMs += ONE_DAY_MS) {
    dates.push(beijingDate(new Date(dayMs)));
  }

  return {
    schemaVersion: 2,
    timezone: "Asia/Shanghai",
    targetDate: range ? null : startDate,
    startDate,
    endDate: finalDate,
    dates,
    mode: range
      ? (historical ? "historical-range" : "current-range")
      : (historical ? "historical-day" : "current-day"),
    runCutoff: now.toISOString(),
    runCutoffBeijing: beijingIso(now.getTime()),
    startInclusive: new Date(startMs).toISOString(),
    startInclusiveBeijing: beijingIso(startMs),
    cutoffInclusive: historical ? null : now.toISOString(),
    cutoffInclusiveBeijing: historical ? null : beijingIso(now.getTime()),
    endExclusive: historical ? new Date(endMs + ONE_DAY_MS).toISOString() : null,
    endExclusiveBeijing: historical ? beijingIso(endMs + ONE_DAY_MS) : null,
  };
}

if (isMainEntry(import.meta.url)) {
  try {
    const { positionals: args } = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      strict: true,
      options: {},
    });
    if (args.length > 2) {
      throw new TypeError("usage: chat-date-window.mjs [YYYY-MM-DD [YYYY-MM-DD]]");
    }
    const response = resolveChatDateWindow({ date: args[0], endDate: args[1] });
    process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    process.stderr.write(`chat-date-window: ${error.message}\n`);
    process.exitCode = 1;
  }
}
