# ZSXQ collector and runner contract

Two Node.js layers back this skill. The **browser collectors** drive already-authenticated tabs: `scripts/zsxq-browser-collector.mjs` extracts the requested Knowledge Planet timeline, while `scripts/zsxq-linked-page-collector.mjs` reads every linked page, including Knowledge Planet topic links, and preserves its direct file links. The **runner** (`scripts/zsxq-runner.mjs`) renders and safely publishes the reader report from a day JSON the agent assembles.

## Browser collector

Import from `scripts/zsxq-browser-collector.mjs` in the persistent Chrome-control session:

- `collectZsxqTimelineRangeOnTab(tab, { planetName, planetUrl, targetDate, timeoutMs?, pollIntervalMs?, maxScrolls? })` — navigates to the canonical group URL, verifies the displayed planet name and page URL, expands collapsed target-date topics, and scrolls until the timeline crosses strictly below `targetDate` or shows the exact `没有更多了` end marker. Returns `{ status: "complete", contract_version, planet_name, target_date, boundary, topics, file_download_targets, skipped_topics, unproven_sticky_topics, scroll_passes }`. Each topic carries `source_order`, `author`, `timestamp` (ISO-8601 Beijing), `body` (`{status, payload?}`), `image_count`, ordered `attachments` (image/web/pdf/html/word), `browser_assets` (image slots with source URLs and dimensions), and `dom_topic_index`.
- `downloadZsxqTimelineFileOnTab(tab, target)` — official member download for one inventoried PDF, HTML, or Word file card attached to a requested timeline topic. Map the `file_download_targets` entry onto the camelCase inputs: `type` as `expectedType`, `filename` as `expectedFilename`, `file_ordinal` as `fileOrdinal`, `expected_displayed_timestamp` as `expectedDisplayedTimestamp`. The helper requires exactly one card matching the topic's displayed publication time and exact filename, validates the filename extension against the expected file type, requires one visible `下载文件` control whose preview name equals the expected filename, and arms the browser `download` event before clicking. After every preview it opens — successful download or failed attempt — it clicks the preview backdrop outside the content, waits for the preview to disappear, and verifies that the original URL and timeline root remain before returning or throwing. Zero or multiple card matches and an unproved preview dismissal fail that file without guessing.

Collector failures are direct errors carrying a content-free `code` and `phase`. An error from a per-item call — `downloadZsxqTimelineFileOnTab` or a linked-page extraction — fails only that item: the agent records it as `failed` with a reader note in the day JSON and continues. A failed `collectZsxqTimelineRangeOnTab` stops the run — a range cannot publish with a missing day. Timeline topics with a `+N` image-overflow badge are skipped by decision and returned in `skipped_topics`. A pinned topic that may belong to the target date without a proven stream rendering — or whose pinned timestamp cannot be read — does not stop the run: it is returned in `unproven_sticky_topics` as `{ author, displayed_timestamp, reason }` (`sticky-target-date-unmatched` or `sticky-timestamp-unreadable`), observed as the union of every stabilized snapshot's pinned area.

The single active DOM contract is `ZSXQ_BROWSER_CONTRACT` (`zsxq-web-angular-v13`). A live DOM change is a repair: tell the user the confirmed cause and the smallest intended change, and change the contract only after their explicit approval, bumping the version string.

## Linked-page collector

Every link carried by a requested topic follows the same clean-webpage-first flow, including Knowledge Planet topic URLs and short links. There is no dedicated topic-detail collector or detail-file downloader. Linked-page files stay as source links; only files attached directly to requested timeline topics use the official downloader.

Import `collectLinkedPageOnTab`, `mergeLinkedFileLinks`, and `sanitizeReportUrl` from `scripts/zsxq-linked-page-collector.mjs` in the persistent Chrome-control session.

- `collectLinkedPageOnTab(tab, { url, timeoutMs?, pollIntervalMs? })` navigates once and returns the first readable main-content snapshot with a Markdown body, direct `file_links`, and image candidates. It does not compare consecutive snapshots, impose a minimum delay, or require `document.readyState === "complete"`. Only blank, loading-only, or access-challenge pages are retried (default observation timeout 10 seconds, polling 250 ms). Failures carry a short `reader_note` and a specific code: `LINKED_PAGE_EMPTY`, `LINKED_PAGE_LOADING`, `LINKED_PAGE_ACCESS_BLOCKED`, `LINKED_PAGE_READ_ERROR`, or `LINKED_PAGE_NAVIGATION_FAILED`. A navigation error can still recover readable content when the target URL is confirmed.
- Direct PDF, HTML, and Word links are deduplicated in DOM order. Their ordinary public query and fragment stay intact. `sanitizeReportUrl` removes the entire query and fragment only when the URL carries a token, signature, expiry, or another recognized transport-credential key.
- `mergeLinkedFileLinks(bodyMarkdown, fileLinks)` normalizes existing file-link labels to filenames, sanitizes transport URLs in the body, deduplicates inline file links, and appends each missing filename-bearing link once. These linked-page files are source links only: never download them, parse them, or create PDF/HTML/Word `embedded_media` records for them.
- Use the clean-webpage result for the main body when available, but still run this collector to read the page's current links and image candidates. Judge whether the snapshot contains the article, not just navigation. Preserve readable content; only actual unread portions warrant the existing `inventory_note` or item failure. Dynamic changes and unfinished background loading alone never make a page incomplete; if neither route produced a body, record the web attachment as `failed`.

## Day JSON

The agent assembles one JSON object per collected Beijing date and passes it to the runner:

```json
{
  "planet": "星球名（可变显示元数据）",
  "planet_url": "https://wx.zsxq.com/group/<id>",
  "date": "YYYY-MM-DD",
  "snapshot_at": "ISO-8601 timestamp with explicit offset",
  "filter": { "scope_key": "stable-key", "requirement": "用户原始要求" },
  "excluded_topic_count": 0,
  "extraction_scope": { "scope_key": "stable-key", "requirement": "用户原始提取要求", "excluded_content_types": ["image", "pdf"] },
  "unproven_sticky_topics": [
    { "author": "置顶作者", "displayed_timestamp": "YYYY-MM-DD HH:mm", "reader_note": "读者可读的缺失说明" }
  ],
  "topics": [
    {
      "timestamp": "ISO-8601 with explicit offset",
      "author": "显示作者",
      "body": { "status": "present | empty | failed", "payload": "原文", "recovered_payload": "可靠恢复的片段", "reader_note": "读者可读的失败原因" },
      "attachments": [
        { "type": "image", "extraction": { "status": "...", "payload": "图片实质内容" } },
        { "type": "pdf", "filename": "x.pdf", "pages": [{ "page_number": 1, "extraction": { } }] },
        { "type": "pdf", "filename": "y.pdf", "document_failure": { "status": "failed", "reader_note": "..." } },
        { "type": "html", "filename": "x.html", "body": { } },
        { "type": "word", "filename": "x.docx", "body": { } },
        { "type": "web", "title": "页面标题", "original_url": "https://...", "author": "可选", "publication_time": "可选", "body": { "status": "present", "payload": "正文及页面内 PDF/HTML/Word 的文件名与源链接" }, "embedded_media": [ { "type": "image", "extraction": { } } ], "inventory_note": "可选：实际无法读取的页面链接或图片的读者说明" }
      ]
    }
  ]
}
```

- `filter` is `null` (or absent) on an unfiltered run; `scope_key` `"all"` is reserved and refused. `excluded_topic_count` must be `0` without a filter.
- `extraction_scope` is optional (`null` or absent means full extraction): `scope_key` is a stable semantic key (`"all"` is reserved and refused), `requirement` records the user's original wording, and the optional `excluded_content_types` is a non-empty, non-repeating subset of `image`, `web`, `pdf`, `html`, `word` normalized to that canonical order — a declared type must not appear as an attachment or embedded medium (the runner refuses the contradiction). Judgment-based parts of the requirement (e.g. keeping one version of a multi-version document) are the agent's responsibility. The `scope_key` enters the marker (`extract=`) and the replacement identity; full-extraction markers are byte-unchanged. Content omitted by an extraction scope is not a failure, does not affect completeness, and is not disclosed in the report.
- `unproven_sticky_topics` is optional (default empty): copy each collector entry and add a single-line `reader_note` saying the pinned topic may be missing; `author` and `displayed_timestamp` may be empty when unreadable.
- Extraction statuses: `present` requires `payload`; `failed` requires a single-line `reader_note` and may carry `recovered_payload`. Failure text never enters `payload`.
- A `web` attachment always needs a non-empty single-line `title`; when the page could not be opened, use the topic's visible link text, falling back to the URL itself.
- In newly collected linked pages, only substantive images use `embedded_media`. Direct PDF, HTML, and Word files stay as filename-bearing Markdown links in the web body's payload and are never downloaded. The runner still accepts the older non-image embedded shapes so an existing transient input can render, but the current collection procedure does not create them.
- Topics are listed newest first; filter-excluded topics are simply not included and are counted in `excluded_topic_count`.

## Runner

```bash
node scripts/zsxq-runner.mjs publish --input <day.json> --output <sources-workspace>/output/zsxq/YYYY-MM-DD/<planet>.md
node scripts/zsxq-runner.mjs publish-range --input <day1.json> --input <day2.json> ... --start YYYY-MM-DD --end YYYY-MM-DD --output <sources-workspace>/output/zsxq/ranges/<start>_to_<end>/<planet>.md
```

- The runner renders the reader report in its own fixed format — `## 主题 N｜<Beijing time>｜<author>` per topic, `### 图片 N`, `### 链接内容 N｜[title](url)`, `### PDF N｜<filename>` (with `#### 第 N 页`), `### HTML N｜<filename>`, and `### Word N｜<filename>` per attachment, and one level deeper for media inside a linked page (`#### 页面内图片 N` and so on); a reader-facing `[reader_note：…]` stands in for content that could not be read (a range report merges days newest first with continuous topic numbering and the title `<start> 至 <end>`), appends the hidden `zsxq-fetch` identity marker, and derives `completeness` from the extraction statuses: any `failed` item, `inventory_note`, or `unproven_sticky_topics` entry makes the report `incomplete` and adds a `## 未能完整读取的内容` section.
- `publish-range` requires one identical `planet_url`, filter scope, and extraction scope across the supplied days, no duplicate dates, every date inside the range, and a span of at most 31 days.
- **Safe replacement**: `--output` always names the canonical `.md` target. The runner resolves it through the pinned sources workspace (a path outside the exact date or range directory is refused), takes the cross-process output lock, and atomically replaces only a generated report whose marker carries the same canonical planet URL, date key, filter scope, and extraction scope. It refuses unmarked or user-owned files and never replaces a newer snapshot. An incomplete result is written to the `.incomplete.md` sibling instead and never replaces a complete archive; a later complete refresh removes only a matching stale sibling.
- The CLI prints the render result as JSON, including the `output`, `date`, `planet`, `extraction_scope`, `post_count`, `excluded_topic_count`, `completeness`, and `extraction_failure_count` the final response needs.
