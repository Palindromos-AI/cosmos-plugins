#!/usr/bin/env node

// Render and publish zsxq-fetch reader reports. The agent collects and
// extracts topics, assembles one day JSON per Beijing date, and this runner
// renders the reader Markdown and writes it safely: identity markers decide
// what an existing file is, the cross-process output lock serializes writers,
// and replacement is atomic. Markers stay byte-compatible with earlier
// releases so existing archives keep refreshing in place.

import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { withOutputLock } from "../../../scripts/output-lock.mjs";
import {
  isMainEntry,
  requireCalendarDate,
  resolveDatedOutputPath,
  resolveRangeOutputPath,
} from "../../../scripts/workspace-runtime.mjs";
import { beijingDisplayFromTimestamp } from "./zsxq-time.mjs";

const GENERATOR = "zsxq-fetch";
const MAX_RANGE_DAYS = 31;
// The reserved unfiltered scope key: an unfiltered day carries `filter: null`
// and its marker has no scope field, so no filtered run may claim `all`.
const ALL_SCOPE_KEY = "all";
const EXTRACTION_STATUSES = new Set(["present", "empty", "failed"]);
// Canonical content-type order for attachments and extraction-scope exclusions.
const CONTENT_TYPE_ORDER = ["image", "web", "pdf", "html", "word"];
const ATTACHMENT_TYPES = new Set(CONTENT_TYPE_ORDER);
const EMBEDDED_TYPES = new Set(["image", "pdf", "html", "word"]);

function fail(label, message) {
  throw new Error(`${label}: ${message}`);
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(label, "must be an object");
  }
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) fail(label, "must be an array");
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(label, "must be a non-empty string");
  }
  return value;
}

// Marker-bound and heading-bound fields must stay on one line.
function requireSingleLine(value, label) {
  requireString(value, label);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    fail(label, "must not contain control characters or line breaks");
  }
  return value;
}

// Like requireSingleLine, but tolerates an empty string for fields the
// collector may not have been able to read (a pinned topic's author or
// displayed timestamp).
function requireSingleLineOrEmpty(value, label) {
  if (typeof value !== "string") fail(label, "must be a string");
  return value === "" ? value : requireSingleLine(value, label);
}

function requireTimestamp(value, label) {
  requireString(value, label);
  try {
    beijingDisplayFromTimestamp(value);
  } catch (error) {
    fail(label, error.message);
  }
  return value;
}

function requirePlanetUrl(value, label) {
  requireSingleLine(value, label);
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(label, "must be an absolute URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    fail(label, "must be an HTTP(S) URL");
  }
  if (url.search || url.hash) {
    fail(label, "must not carry a query or fragment");
  }
  return value;
}

function normalizeExtraction(value, label) {
  const extraction = requireObject(value, label);
  if (!EXTRACTION_STATUSES.has(extraction.status)) {
    fail(label, "status must be present, empty, or failed");
  }
  const normalized = { status: extraction.status };
  if (extraction.status === "present") {
    normalized.payload = requireString(extraction.payload, `${label}.payload`);
  }
  if (extraction.status === "failed") {
    normalized.reader_note = requireSingleLine(
      extraction.reader_note,
      `${label}.reader_note`,
    );
    if (extraction.recovered_payload !== undefined && extraction.recovered_payload !== null) {
      normalized.recovered_payload = requireString(
        extraction.recovered_payload,
        `${label}.recovered_payload`,
      );
    }
  }
  return normalized;
}

function normalizePdf(value, label) {
  const pdf = requireObject(value, label);
  const normalized = {
    type: "pdf",
    filename: requireSingleLine(pdf.filename, `${label}.filename`),
  };
  if (pdf.document_failure !== undefined && pdf.document_failure !== null) {
    normalized.document_failure = normalizeExtraction(
      pdf.document_failure,
      `${label}.document_failure`,
    );
    if (normalized.document_failure.status !== "failed") {
      fail(`${label}.document_failure`, "must have status failed");
    }
    return normalized;
  }
  normalized.pages = requireArray(pdf.pages, `${label}.pages`).map((page, index) => {
    const pageLabel = `${label}.pages[${index}]`;
    const record = requireObject(page, pageLabel);
    if (!Number.isInteger(record.page_number) || record.page_number < 1) {
      fail(pageLabel, "page_number must be a positive integer");
    }
    return {
      page_number: record.page_number,
      extraction: normalizeExtraction(record.extraction, `${pageLabel}.extraction`),
    };
  });
  return normalized;
}

function normalizeEmbedded(value, label) {
  const child = requireObject(value, label);
  if (!EMBEDDED_TYPES.has(child.type)) {
    fail(label, "type must be image, pdf, html, or word");
  }
  if (child.type === "image") {
    return { type: "image", extraction: normalizeExtraction(child.extraction, `${label}.extraction`) };
  }
  if (child.type === "pdf") {
    return normalizePdf(child, label);
  }
  // html and word share the filename-plus-body document shape.
  return {
    type: child.type,
    filename: requireSingleLine(child.filename, `${label}.filename`),
    body: normalizeExtraction(child.body, `${label}.body`),
  };
}

function normalizeAttachment(value, label) {
  const attachment = requireObject(value, label);
  if (!ATTACHMENT_TYPES.has(attachment.type)) {
    fail(label, "type must be image, web, pdf, html, or word");
  }
  if (attachment.type === "image") {
    return { type: "image", extraction: normalizeExtraction(attachment.extraction, `${label}.extraction`) };
  }
  if (attachment.type === "pdf") {
    return normalizePdf(attachment, label);
  }
  if (attachment.type === "html" || attachment.type === "word") {
    return {
      type: attachment.type,
      filename: requireSingleLine(attachment.filename, `${label}.filename`),
      body: normalizeExtraction(attachment.body, `${label}.body`),
    };
  }
  const normalized = {
    type: "web",
    title: requireSingleLine(attachment.title, `${label}.title`),
    original_url: requireSingleLine(attachment.original_url, `${label}.original_url`),
    body: normalizeExtraction(attachment.body, `${label}.body`),
    embedded_media: requireArray(attachment.embedded_media ?? [], `${label}.embedded_media`)
      .map((child, index) => normalizeEmbedded(child, `${label}.embedded_media[${index}]`)),
  };
  for (const field of ["author", "publication_time"]) {
    if (attachment[field] !== undefined && attachment[field] !== null) {
      normalized[field] = requireSingleLine(attachment[field], `${label}.${field}`);
    }
  }
  if (attachment.inventory_note !== undefined && attachment.inventory_note !== null) {
    // A page whose embedded media could not be fully inventoried stays
    // visible as incomplete through this reader note.
    normalized.inventory_note = requireSingleLine(
      attachment.inventory_note,
      `${label}.inventory_note`,
    );
  }
  return normalized;
}

export function normalizeDay(value, label = "day") {
  const day = requireObject(value, label);
  const normalized = {
    planet: requireSingleLine(day.planet, `${label}.planet`),
    planet_url: requirePlanetUrl(day.planet_url, `${label}.planet_url`),
    date: requireCalendarDate(day.date),
    snapshot_at: requireTimestamp(day.snapshot_at, `${label}.snapshot_at`),
    filter: null,
    excluded_topic_count: 0,
    topics: requireArray(day.topics, `${label}.topics`).map((topic, index) => {
      const topicLabel = `${label}.topics[${index}]`;
      const record = requireObject(topic, topicLabel);
      return {
        timestamp: requireTimestamp(record.timestamp, `${topicLabel}.timestamp`),
        author: requireSingleLine(record.author, `${topicLabel}.author`),
        body: normalizeExtraction(record.body, `${topicLabel}.body`),
        attachments: requireArray(record.attachments ?? [], `${topicLabel}.attachments`)
          .map((attachment, attachmentIndex) =>
            normalizeAttachment(attachment, `${topicLabel}.attachments[${attachmentIndex}]`)),
      };
    }),
  };
  if (day.filter !== undefined && day.filter !== null) {
    const filter = requireObject(day.filter, `${label}.filter`);
    const scopeKey = requireSingleLine(filter.scope_key, `${label}.filter.scope_key`);
    if (scopeKey === ALL_SCOPE_KEY) {
      fail(`${label}.filter.scope_key`, `"${ALL_SCOPE_KEY}" is reserved for unfiltered runs`);
    }
    normalized.filter = {
      scope_key: scopeKey,
      requirement: requireString(filter.requirement, `${label}.filter.requirement`),
    };
  }
  if (day.excluded_topic_count !== undefined) {
    if (!Number.isInteger(day.excluded_topic_count) || day.excluded_topic_count < 0) {
      fail(`${label}.excluded_topic_count`, "must be a non-negative integer");
    }
    normalized.excluded_topic_count = day.excluded_topic_count;
  }
  if (normalized.filter === null && normalized.excluded_topic_count !== 0) {
    fail(`${label}.excluded_topic_count`, "must be 0 on an unfiltered run");
  }
  normalized.extraction_scope = null;
  if (day.extraction_scope !== undefined && day.extraction_scope !== null) {
    const scope = requireObject(day.extraction_scope, `${label}.extraction_scope`);
    const scopeKey = requireSingleLine(scope.scope_key, `${label}.extraction_scope.scope_key`);
    if (scopeKey === ALL_SCOPE_KEY) {
      fail(
        `${label}.extraction_scope.scope_key`,
        `"${ALL_SCOPE_KEY}" is reserved for full extraction`,
      );
    }
    normalized.extraction_scope = {
      scope_key: scopeKey,
      requirement: requireString(scope.requirement, `${label}.extraction_scope.requirement`),
      excluded_content_types: null,
    };
    if (scope.excluded_content_types !== undefined && scope.excluded_content_types !== null) {
      const excludedLabel = `${label}.extraction_scope.excluded_content_types`;
      const requested = requireArray(scope.excluded_content_types, excludedLabel);
      if (requested.length === 0) {
        fail(excludedLabel, "must name at least one content type");
      }
      for (const type of requested) {
        if (!ATTACHMENT_TYPES.has(type)) {
          fail(excludedLabel, "values must be image, web, pdf, html, or word");
        }
      }
      if (new Set(requested).size !== requested.length) {
        fail(excludedLabel, "must not repeat a content type");
      }
      normalized.extraction_scope.excluded_content_types = CONTENT_TYPE_ORDER.filter(
        (type) => requested.includes(type),
      );
      // The declared type exclusions and the assembled topics must agree: an
      // excluded type never appears as an attachment or an embedded medium.
      // Judgment-based parts of the requirement stay the agent's responsibility.
      const excluded = new Set(normalized.extraction_scope.excluded_content_types);
      normalized.topics.forEach((topic, topicIndex) => {
        topic.attachments.forEach((attachment, attachmentIndex) => {
          const attachmentLabel = `${label}.topics[${topicIndex}].attachments[${attachmentIndex}]`;
          if (excluded.has(attachment.type)) {
            fail(attachmentLabel, `type ${attachment.type} is excluded by the day's extraction scope`);
          }
          if (attachment.type === "web") {
            attachment.embedded_media.forEach((child, childIndex) => {
              if (excluded.has(child.type)) {
                fail(
                  `${attachmentLabel}.embedded_media[${childIndex}]`,
                  `type ${child.type} is excluded by the day's extraction scope`,
                );
              }
            });
          }
        });
      });
    }
  }
  normalized.unproven_sticky_topics = [];
  if (day.unproven_sticky_topics !== undefined && day.unproven_sticky_topics !== null) {
    normalized.unproven_sticky_topics = requireArray(
      day.unproven_sticky_topics,
      `${label}.unproven_sticky_topics`,
    ).map((entry, index) => {
      const entryLabel = `${label}.unproven_sticky_topics[${index}]`;
      const record = requireObject(entry, entryLabel);
      return {
        author: requireSingleLineOrEmpty(record.author ?? "", `${entryLabel}.author`),
        displayed_timestamp: requireSingleLineOrEmpty(
          record.displayed_timestamp ?? "",
          `${entryLabel}.displayed_timestamp`,
        ),
        reader_note: requireSingleLine(record.reader_note, `${entryLabel}.reader_note`),
      };
    });
  }
  return normalized;
}

function markerValue(value) {
  return encodeURIComponent(value);
}

export function buildReaderMarker({
  planet,
  planet_url: planetUrl,
  date,
  snapshot_at: snapshotAt,
  post_count: postCount,
  completeness,
  scope_key: scopeKey = null,
  extract_key: extractKey = null,
}) {
  const scope = scopeKey === null ? "" : ` | scope=${markerValue(scopeKey)}`;
  const extract = extractKey === null ? "" : ` | extract=${markerValue(extractKey)}`;
  return `<!-- ${GENERATOR} | planet=${markerValue(planet)} | planet_url=${markerValue(planetUrl)} | date=${date} | snapshot_at=${markerValue(snapshotAt)} | post_count=${postCount} | completeness=${completeness}${scope}${extract} -->`;
}

export function parseGeneratedMarker(markdown) {
  const match = markdown.match(
    /<!-- zsxq-fetch \| planet=([^|]+) \| planet_url=([^|]+) \| date=([^|]+) \| snapshot_at=([^|]+) \| post_count=(\d+) \| completeness=(complete|incomplete)(?: \| scope=([^|]+?))?(?: \| extract=([^|]+?))? -->\s*$/u,
  );
  if (!match) return null;
  try {
    return {
      planet: decodeURIComponent(match[1].trim()),
      planet_url: decodeURIComponent(match[2].trim()),
      date: match[3].trim(),
      snapshot_at: requireTimestamp(
        decodeURIComponent(match[4].trim()),
        "marker snapshot_at",
      ),
      post_count: Number(match[5]),
      completeness: match[6],
      // Absent scope means an unfiltered archive, including every pre-filter file.
      scope_key: match[7] === undefined ? null : decodeURIComponent(match[7].trim()),
      // Absent extract means a full-extraction archive, including every
      // pre-extraction-scope file.
      extract_key: match[8] === undefined ? null : decodeURIComponent(match[8].trim()),
    };
  } catch {
    return null;
  }
}

function extractionReaderPayload(extraction, emptySentinel) {
  if (extraction.status === "present") {
    return extraction.payload;
  }
  if (extraction.status === "empty") {
    return emptySentinel;
  }
  const parts = [];
  if (extraction.recovered_payload) {
    parts.push(extraction.recovered_payload);
  }
  parts.push(`[${extraction.reader_note}]`);
  return parts.join("\n\n");
}

function markdownLink(title, url) {
  return `[${title.replaceAll("[", "\\[").replaceAll("]", "\\]")}](<${url.replaceAll(">", "%3E")}>)`;
}

function noteFailure(failures, location, extraction) {
  if (extraction.status === "failed") {
    failures.push({ location, reader_note: extraction.reader_note });
  }
}

// A pinned topic the collector could not prove in the timeline stream is
// disclosed to the reader and makes the report incomplete.
function appendUnprovenStickyFailures(failures, day) {
  for (const sticky of day.unproven_sticky_topics) {
    failures.push({
      location: `置顶主题｜${sticky.displayed_timestamp || "时间未知"}｜${sticky.author || "作者未知"}`,
      reader_note: sticky.reader_note,
    });
  }
}

function renderPdf(lines, failures, pdf, heading, pageHeadingLevel, location) {
  lines.push(`${heading}｜${pdf.filename}`, "");
  if (pdf.document_failure) {
    lines.push(extractionReaderPayload(pdf.document_failure, "未检测到可读文字"), "");
    noteFailure(failures, location, pdf.document_failure);
    return;
  }
  for (const page of pdf.pages) {
    lines.push(`${pageHeadingLevel} 第 ${page.page_number} 页`, "");
    lines.push(extractionReaderPayload(page.extraction, "未检测到可读文字"), "");
    noteFailure(failures, `${location} 第 ${page.page_number} 页`, page.extraction);
  }
}

// Render every topic of one day, appending failures with reader-facing
// locations numbered by the report's own sequential topic numbers.
function renderTopicSections(lines, failures, day, indexOffset) {
  let rendered = 0;
  for (const topic of day.topics) {
    rendered += 1;
    const topicNumber = indexOffset + rendered;
    lines.push(
      `## 主题 ${topicNumber}｜${beijingDisplayFromTimestamp(topic.timestamp)}｜${topic.author}`,
      "",
    );
    lines.push(extractionReaderPayload(topic.body, "无正文"), "");
    noteFailure(failures, `主题 ${topicNumber} 正文`, topic.body);
    const counts = { image: 0, web: 0, pdf: 0, html: 0, word: 0 };
    for (const attachment of topic.attachments) {
      counts[attachment.type] += 1;
      if (attachment.type === "image") {
        lines.push(`### 图片 ${counts.image}`, "");
        lines.push(extractionReaderPayload(attachment.extraction, "未检测到可读文字"), "");
        noteFailure(failures, `主题 ${topicNumber} 图片 ${counts.image}`, attachment.extraction);
      } else if (attachment.type === "pdf") {
        renderPdf(
          lines,
          failures,
          attachment,
          `### PDF ${counts.pdf}`,
          "####",
          `主题 ${topicNumber} PDF ${counts.pdf}`,
        );
      } else if (attachment.type === "html") {
        lines.push(`### HTML ${counts.html}｜${attachment.filename}`, "");
        lines.push(extractionReaderPayload(attachment.body, "未检测到正文"), "");
        noteFailure(failures, `主题 ${topicNumber} HTML ${counts.html}`, attachment.body);
      } else if (attachment.type === "word") {
        lines.push(`### Word ${counts.word}｜${attachment.filename}`, "");
        lines.push(extractionReaderPayload(attachment.body, "未检测到正文"), "");
        noteFailure(failures, `主题 ${topicNumber} Word ${counts.word}`, attachment.body);
      } else {
        lines.push(
          `### 链接内容 ${counts.web}｜${markdownLink(attachment.title, attachment.original_url)}`,
          "",
        );
        const metadata = [attachment.author, attachment.publication_time]
          .filter(Boolean)
          .join("｜");
        if (metadata) {
          lines.push(metadata, "");
        }
        lines.push(extractionReaderPayload(attachment.body, "未检测到正文"), "");
        noteFailure(failures, `主题 ${topicNumber} 链接内容 ${counts.web}`, attachment.body);
        const childCounts = { image: 0, pdf: 0, html: 0, word: 0 };
        for (const child of attachment.embedded_media) {
          childCounts[child.type] += 1;
          if (child.type === "image") {
            lines.push(`#### 页面内图片 ${childCounts.image}`, "");
            lines.push(extractionReaderPayload(child.extraction, "未检测到可读文字"), "");
            noteFailure(
              failures,
              `主题 ${topicNumber} 链接内容 ${counts.web} 页面内图片 ${childCounts.image}`,
              child.extraction,
            );
          } else if (child.type === "pdf") {
            renderPdf(
              lines,
              failures,
              child,
              `#### 页面内 PDF ${childCounts.pdf}`,
              "#####",
              `主题 ${topicNumber} 链接内容 ${counts.web} 页面内 PDF ${childCounts.pdf}`,
            );
          } else if (child.type === "html") {
            lines.push(`#### 页面内 HTML ${childCounts.html}｜${child.filename}`, "");
            lines.push(extractionReaderPayload(child.body, "未检测到正文"), "");
            noteFailure(
              failures,
              `主题 ${topicNumber} 链接内容 ${counts.web} 页面内 HTML ${childCounts.html}`,
              child.body,
            );
          } else {
            lines.push(`#### 页面内 Word ${childCounts.word}｜${child.filename}`, "");
            lines.push(extractionReaderPayload(child.body, "未检测到正文"), "");
            noteFailure(
              failures,
              `主题 ${topicNumber} 链接内容 ${counts.web} 页面内 Word ${childCounts.word}`,
              child.body,
            );
          }
        }
        if (attachment.inventory_note) {
          lines.push(`[${attachment.inventory_note}]`, "");
          failures.push({
            location: `主题 ${topicNumber} 链接内容 ${counts.web}`,
            reader_note: attachment.inventory_note,
          });
        }
      }
    }
  }
  return rendered;
}

function renderFailureSection(lines, failures) {
  lines.push("## 未能完整读取的内容", "");
  for (const failure of failures) {
    lines.push(`- ${failure.location}：${failure.reader_note}`);
  }
  lines.push("");
}

export function renderDayReport(day) {
  const lines = [`# ${day.planet}｜${day.date}`, ""];
  const failures = [];
  const postCount = renderTopicSections(lines, failures, day, 0);
  appendUnprovenStickyFailures(failures, day);
  const completeness = failures.length === 0 ? "complete" : "incomplete";
  if (completeness === "incomplete") {
    renderFailureSection(lines, failures);
  }
  lines.push(buildReaderMarker({
    planet: day.planet,
    planet_url: day.planet_url,
    date: day.date,
    snapshot_at: day.snapshot_at,
    post_count: postCount,
    completeness,
    scope_key: day.filter?.scope_key ?? null,
    extract_key: day.extraction_scope?.scope_key ?? null,
  }));
  return {
    markdown: `${lines.join("\n").trimEnd()}\n`,
    date: day.date,
    planet: day.planet,
    planet_url: day.planet_url,
    snapshot_at: day.snapshot_at,
    scope_key: day.filter?.scope_key ?? null,
    extraction_scope: day.extraction_scope,
    post_count: postCount,
    excluded_topic_count: day.excluded_topic_count,
    completeness,
    extraction_failure_count: failures.length,
  };
}

// Merge single-day records into one reader report covering the contiguous
// Beijing range [startDate, endDate], newest day first. Identity must agree
// across the days; day-set completeness is the agent's responsibility.
export function renderRangeReport(days, { startDate, endDate }) {
  requireCalendarDate(startDate);
  requireCalendarDate(endDate);
  if (startDate >= endDate) {
    fail("range", "start date must be strictly earlier than the end date");
  }
  const spanDays = Math.round(
    (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000,
  ) + 1;
  if (spanDays > MAX_RANGE_DAYS) {
    fail("range", `must span at most ${MAX_RANGE_DAYS} days`);
  }
  if (!Array.isArray(days) || days.length === 0) {
    fail("range", "requires at least one day record");
  }
  const referenceScope = days[0].filter?.scope_key ?? null;
  // Key plus mechanical exclusion set: normalized scopes have a fixed key
  // order, so the JSON form is a stable signature.
  const extractionSignature = (record) => JSON.stringify(record.extraction_scope === null
    ? null
    : {
      scope_key: record.extraction_scope.scope_key,
      excluded_content_types: record.extraction_scope.excluded_content_types,
    });
  const referenceExtraction = extractionSignature(days[0]);
  const seen = new Set();
  for (const day of days) {
    if (day.date < startDate || day.date > endDate) {
      fail(`day ${day.date}`, `is outside the requested range ${startDate}..${endDate}`);
    }
    if (day.planet_url !== days[0].planet_url) {
      fail(`day ${day.date}`, "canonical planet URL differs across the range");
    }
    if ((day.filter?.scope_key ?? null) !== referenceScope) {
      fail(`day ${day.date}`, "filter scope differs across the range");
    }
    if (extractionSignature(day) !== referenceExtraction) {
      fail(`day ${day.date}`, "extraction scope differs across the range");
    }
    if (seen.has(day.date)) {
      fail(`day ${day.date}`, "appears more than once in the range");
    }
    seen.add(day.date);
  }

  const ordered = [...days].sort((left, right) => (left.date < right.date ? 1 : -1));
  const planet = ordered[0].planet;
  const snapshotAt = days
    .map((day) => day.snapshot_at)
    .reduce((left, right) => (Date.parse(right) > Date.parse(left) ? right : left));
  const lines = [`# ${planet}｜${startDate} 至 ${endDate}`, ""];
  const failures = [];
  let postCount = 0;
  let excludedCount = 0;
  for (const day of ordered) {
    postCount += renderTopicSections(lines, failures, day, postCount);
    appendUnprovenStickyFailures(failures, day);
    excludedCount += day.excluded_topic_count;
  }
  const completeness = failures.length === 0 ? "complete" : "incomplete";
  if (completeness === "incomplete") {
    renderFailureSection(lines, failures);
  }
  lines.push(buildReaderMarker({
    planet,
    planet_url: days[0].planet_url,
    date: `${startDate}_to_${endDate}`,
    snapshot_at: snapshotAt,
    post_count: postCount,
    completeness,
    scope_key: referenceScope,
    extract_key: days[0].extraction_scope?.scope_key ?? null,
  }));
  return {
    markdown: `${lines.join("\n").trimEnd()}\n`,
    date: `${startDate}_to_${endDate}`,
    planet,
    planet_url: days[0].planet_url,
    snapshot_at: snapshotAt,
    scope_key: referenceScope,
    extraction_scope: days[0].extraction_scope,
    post_count: postCount,
    excluded_topic_count: excludedCount,
    completeness,
    extraction_failure_count: failures.length,
  };
}

export function incompletePath(canonicalPath) {
  return canonicalPath.replace(/\.md$/u, ".incomplete.md");
}

function assertMarkerScope(marker, identity, target) {
  if (!marker) {
    throw new Error(`Refusing to overwrite an unmarked file: ${target}`);
  }
  if (
    marker.planet_url !== identity.planet_url
    || marker.date !== identity.date
    || (marker.scope_key ?? null) !== (identity.scope_key ?? null)
    || (marker.extract_key ?? null) !== (identity.extraction_scope?.scope_key ?? null)
  ) {
    throw new Error(
      `Refusing to overwrite a different canonical planet URL, date, filter scope, or extraction scope: ${target}`,
    );
  }
}

async function readExisting(target) {
  try {
    return await readFile(target, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeTarget(target, markdown, hasExisting) {
  if (!hasExisting) {
    try {
      await writeFile(target, markdown, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if (error.code === "EEXIST") {
        throw new Error(`Output appeared concurrently and was not replaced: ${target}`);
      }
      throw error;
    }
    return;
  }
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, markdown, { encoding: "utf8", flag: "wx" });
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

// Write one rendered report: the canonical path for a complete report, the
// `.incomplete.md` sibling otherwise, so an incomplete result never replaces
// a complete archive. A complete refresh removes only a matching stale
// incomplete sibling.
async function publishRendered(rendered, canonical) {
  if (canonical.endsWith(".incomplete.md")) {
    throw new Error("output must name the canonical .md target, not the .incomplete.md sibling");
  }
  if (!canonical.endsWith(".md")) {
    throw new Error("output must be a .md target");
  }
  const identity = rendered;
  const partial = incompletePath(canonical);
  const target = rendered.completeness === "incomplete" ? partial : canonical;
  await withOutputLock(canonical, async () => {
    const existingCanonical = await readExisting(canonical);
    if (existingCanonical !== null) {
      const marker = parseGeneratedMarker(existingCanonical);
      assertMarkerScope(marker, identity, canonical);
      if (Date.parse(marker.snapshot_at) > Date.parse(identity.snapshot_at)) {
        throw new Error(`Refusing to replace a newer generated report: ${canonical}`);
      }
    }
    let existingPartial = null;
    if (target === partial || rendered.completeness === "complete") {
      existingPartial = await readExisting(partial);
    }
    let partialMarker = null;
    if (existingPartial !== null) {
      partialMarker = parseGeneratedMarker(existingPartial);
      if (target === partial) {
        assertMarkerScope(partialMarker, identity, partial);
        if (Date.parse(partialMarker.snapshot_at) > Date.parse(identity.snapshot_at)) {
          throw new Error(`Refusing to replace a newer generated report: ${partial}`);
        }
      }
    }

    await writeTarget(
      target,
      rendered.markdown,
      target === canonical ? existingCanonical !== null : existingPartial !== null,
    );

    if (rendered.completeness === "complete" && existingPartial !== null && partialMarker) {
      // Remove only a stale sibling with the same identity; a foreign or
      // unmarked sibling is retained untouched.
      const sameScope = partialMarker.planet_url === identity.planet_url
        && partialMarker.date === identity.date
        && (partialMarker.scope_key ?? null) === (identity.scope_key ?? null)
        && (partialMarker.extract_key ?? null)
          === (identity.extraction_scope?.scope_key ?? null);
      if (sameScope && Date.parse(partialMarker.snapshot_at) <= Date.parse(identity.snapshot_at)) {
        await unlink(partial);
      }
    }
  });
  return target;
}

export async function publishDay({ day, outputPath, workspace }) {
  const rendered = renderDayReport(normalizeDay(day));
  const canonical = await resolveDatedOutputPath(
    resolve(outputPath),
    { workspace },
    "zsxq",
    rendered.date,
  );
  const output = await publishRendered(rendered, canonical);
  return { ...rendered, markdown: undefined, output };
}

export async function publishRange({ days, startDate, endDate, outputPath, workspace }) {
  const rendered = renderRangeReport(
    days.map((day, index) => normalizeDay(day, `day[${index}]`)),
    { startDate, endDate },
  );
  const canonical = await resolveRangeOutputPath(
    resolve(outputPath),
    { workspace },
    "zsxq",
    startDate,
    endDate,
  );
  const output = await publishRendered(rendered, canonical);
  return { ...rendered, markdown: undefined, output };
}

const USAGE = [
  "usage:",
  "  zsxq-runner.mjs publish --input <day.json> --output <.../output/zsxq/YYYY-MM-DD/planet.md>",
  "  zsxq-runner.mjs publish-range --input <day.json> [--input <day.json> ...] --start <YYYY-MM-DD> --end <YYYY-MM-DD> --output <.../output/zsxq/ranges/<start>_to_<end>/planet.md>",
].join("\n");

function parseCliArgs(argv) {
  const [command, ...rest] = argv;
  const options = { inputs: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag.startsWith("--") || value === undefined) {
      throw new Error(`Expected --flag value, received ${flag}`);
    }
    if (flag === "--input") {
      options.inputs.push(value);
    } else {
      options[flag.slice(2)] = value;
    }
    index += 1;
  }
  return { command, options };
}

async function readDayInput(inputPath) {
  return JSON.parse(await readFile(inputPath, "utf8"));
}

async function main() {
  const { command, options } = parseCliArgs(process.argv.slice(2));
  if (command === "publish") {
    if (options.inputs.length !== 1 || !options.output) {
      throw new Error(USAGE);
    }
    const result = await publishDay({
      day: await readDayInput(options.inputs[0]),
      outputPath: options.output,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (command === "publish-range") {
    if (options.inputs.length === 0 || !options.output || !options.start || !options.end) {
      throw new Error(USAGE);
    }
    const result = await publishRange({
      days: await Promise.all(options.inputs.map(readDayInput)),
      startDate: options.start,
      endDate: options.end,
      outputPath: options.output,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  throw new Error(USAGE);
}

if (isMainEntry(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`zsxq-runner: ${error.message}\n`);
    process.exitCode = 1;
  });
}
