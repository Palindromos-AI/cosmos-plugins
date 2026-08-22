# ZSXQ runner contract

## Contents

1. Run lifecycle
2. Coverage record
3. Topic record
4. Extraction states
5. Attachment records
6. Cache reuse
7. Finalization outcomes
8. Browser collector handoff

## 1. Run lifecycle

Create a private temporary parent directory, choose a child path that does not yet exist, and let `init` atomically create that run workspace. Every requested date is an `Asia/Shanghai` (`UTC+08:00`) calendar day from Beijing midnight to Beijing midnight; when no date is explicit, use `currentBeijingDate()` from `scripts/zsxq-time.mjs` rather than deriving “today” from the host, browser, user-location, or publisher timezone. Requires Node.js 22.13 or later, the first 22.x release where the built-in SQLite API used for crash-safe process locking no longer needs an experimental startup flag.

Ordinary runner commands do not load third-party packages. Tiled image analysis alone needs the pinned local Sharp runtime. In the installed `cosmos-sources-tools` plugin, install it once in the installed `zsxq-fetch` directory before the first tile operation (with user approval when network access is required):

```bash
npm install --omit=dev --prefix /absolute/path/to/zsxq-fetch
```

```bash
node zsxq-fetch/scripts/zsxq-runner.mjs init \
  --workspace /absolute/temp-parent/run-unique-id \
  --planet "Exact planet name" \
  --planet-url "https://wx.zsxq.com/group/..." \
  --date YYYY-MM-DD \
  --snapshot-at "2026-08-04T18:00:00+08:00" \
  --output /absolute/project/output/YYYY-MM-DD-planet.md
```

The runner rejects an existing workspace path, including an empty directory or symbolic link. This makes concurrent initialization single-owner and prevents a losing initializer from deleting another process's run. After `init`, create every small JSON input file inside the new workspace so raw transport URLs are removed during cleanup, then submit it through the CLI:

```bash
node zsxq-fetch/scripts/zsxq-runner.mjs record-coverage --workspace RUN --input coverage.json
node zsxq-fetch/scripts/zsxq-runner.mjs record-inventory --workspace RUN --input inventory.json
node zsxq-fetch/scripts/zsxq-runner.mjs record-web-inventory --workspace RUN --input web-inventory.json
node zsxq-fetch/scripts/zsxq-runner.mjs upsert-topic --workspace RUN --input topic-1.json
node zsxq-fetch/scripts/zsxq-runner.mjs status --workspace RUN
node zsxq-fetch/scripts/zsxq-runner.mjs finalize --workspace RUN
```

Record the complete top-level source inventory before extraction begins. The first accepted `record-inventory` call freezes it permanently for that run; start a new run if the top-level inventory itself was wrong. Each webpage starts with an unrecorded child-inventory slot. During the page's single browser visit, enumerate its substantive inline images and directly embedded PDFs, submit `record-web-inventory`, and only then extract/submit the containing topic. Each webpage child inventory is also one-time and immutable; even a verified zero-child page requires a count and end-of-page evidence. When the complete range cannot be proved, freeze an explicit failed/unknown inventory instead of claiming zero. Then submit extracted topics newest first with `source_order` equal to `1..N`. Every topic instant, after conversion to `Asia/Shanghai`, must fall on the requested Beijing calendar date and may not be newer than the preceding topic. All run and topic timestamps must be ISO-8601 date-times with an explicit `Z` or `±HH:MM` offset; locale dates, date-only values, and timezone-less values are rejected. An `upsert-topic` call may append the next topic or replace only the most recently recorded topic. The runner writes `manifest.json` atomically and admits only one writer through an SQLite transaction; the operating system releases that transaction if the process exits abnormally.

Every screenshot, downloaded binary, rendered PDF page, JSON input, or other representation referenced by a record must resolve through its real filesystem path inside the dedicated run workspace; a symbolic link cannot escape that boundary. The output file must resolve outside it.

Use `scripts/zsxq-browser-collector.mjs` from the persistent authenticated
browser-control session before `record-coverage` and `record-inventory`.
`collectZsxqTimelineRangeWithAutoRepair` returns runner-ready `coverage` and an
`inventory` object shaped exactly as `{ "topics": [...] }`, plus separate
session-local records that never enter the runner inventory JSON:

- `browser_assets` — exact image-capture inputs (signed sources, load state,
  dimensions).
- `pdf_download_targets` — one entry per inventoried timeline file-card PDF
  with `topic_source_order`, `source_ordinal`, `file_ordinal`,
  `dom_topic_index`, and `filename`. Pass `dom_topic_index` as `topicDomIndex`
  and `file_ordinal` as `fileOrdinal` to `downloadZsxqTimelinePdfOnTab`; these
  indices are valid for the same browser session, and a stale index fails
  loudly with `PDF_FILE_IDENTITY_MISMATCH`.
- `skipped_topics` — target-date topics excluded by decision because their
  image gallery showed a `+N` overflow badge (author, timestamp, reason). The
  coverage evidence records the skip count; report each entry to the user.
- `checkpoint_discarded` — `true` when a retained schema-2 checkpoint carrying
  another adapter contract version was discarded and the timeline was replayed
  from the top.

Pass the complete returned `inventory` object to `record-inventory`; do not
pass `inventory.topics`. The collector atomically checkpoints the loaded
timeline inside the run workspace.

Pinned topics are archived only through their normal position in the
non-pinned stream: the collector reads the pinned area's authors and
timestamps, and stops with `STICKY_TARGET_DATE_UNSUPPORTED` when a pinned
timestamp belongs to the target date without a matching stream topic, or
cannot be read at all. That code is intentionally outside the automatic-repair
set. Displayed timestamps must parse strictly (`YYYY-MM-DD HH:mm[:ss]`, Beijing)
wherever they can affect the result (the top, every target-date candidate,
everything above the proven crossing); an unreadable timestamp strictly below
the crossing is tolerated.
Image-readiness gating applies only to target-date topics.

The active `zsxq-web-angular-v6` adapter preserves the immutable v1 through v5
contracts for rollback. v2 added exact `app-file-gallery` PDF-card inventory: it
orders those cards together with images and links by their topic-local DOM
position, and a file card is accepted only when it has one direct PDF icon and
one non-empty `.pdf` filename and contains no anchor; an empty, malformed,
unknown, or overlapping file-card structure fails closed. v3 additionally proves
the end of every image set: each `app-image-gallery` must account for every
counted `img` and an empty gallery is a transient loading state. A leaf element
whose text matches a `+N` overflow badge marks that timeline topic as an
explicit `skipped_topics` exclusion instead of silently undercounting
`image_count` (on a detail page the same badge remains the direct
`DETAIL_IMAGE_GALLERY_OVERFLOW_UNSUPPORTED` error). v3 also applies both the
file-card and the image-gallery contracts to Knowledge Planet detail pages:
`collectZsxqDetailWithAutoRepair` returns `files` (each with `type: "pdf"`,
`file_ordinal`, `dom_ordinal`, `filename`, and `platform_id` when exposed)
beside `images` (each with `image_ordinal` and `dom_ordinal`), so a linked
topic's PDF file cards must enter its `record-web-inventory` children in
`dom_ordinal` order rather than being silently omitted.

v4 requires one direct `.readed-count` child under each `.info > .date` and
reads only the date container's owned text node, preventing visible read-count
metadata from contaminating the strict timestamp payload. It also recognizes
one exact direct `.no-more` element with text `没有更多了` as an absolute
timeline-end boundary. An older topic or this exact finite-stream end is
required; absent, duplicate, nested, or text-mismatched end markers are not
coverage evidence.

v5 adds the official member-download path for inventoried timeline PDFs. It
opens the exact topic-local file card, verifies one matching filename in
`app-file-preview`, requires one visible exact `下载文件` control, arms the
browser's download event before clicking, and returns that completed download
to the caller for copying into the private run workspace. A protected inline
viewer is not evidence that downloading is blocked. The caller must resolve the
event's exact artifact instead of guessing a browser filename, and must not use
undocumented private endpoints.

v6 accepts zero or one direct `.readed-count` child under `.info > .date` and
continues to read only the date container's owned text node. Joined planets may
omit the read-count child entirely; duplicate children still fail closed. This
is a page-structure compatibility rule, not a branch based on planet ownership.

Collector checkpoints use schema version 2: stored topics keep only query-free
transport URLs, and every checkpoint prefix comparison strips URL queries and
fragments first. A resumed run therefore survives signed-URL rotation between
browser sessions; topic identity remains author, timestamp, body, and the
ordered attachment structure. The live `inventory` and `browser_assets` still
carry the current full transport URLs for acquisition inside the workspace.

The checkpoint is a consistency proof, not a transfer point. A retained
checkpoint whose adapter `contract_version` differs from the active one — the
normal situation right after an automatic repair introduced a new adapter
version — is discarded and the timeline is replayed from the top; the result
reports `checkpoint_discarded: true`. A checkpoint for another planet, date,
or URL, or with an unknown schema, remains a direct
`CHECKPOINT_SCOPE_MISMATCH` error.

Before calling it, visibly clear every search, tag, owner-only, member, and other
timeline filter, then pass `filtersClearedConfirmed: true`. If the flag is absent,
the collector returns `needs-filter-confirmation` and does not navigate or claim
access completeness. Never set it without inspecting the official UI.

If the visible top date is equal to or older than the target, the collector
returns `needs-top-confirmation`; load every pending new-content batch through
the official UI and rerun with `topBoundaryConfirmed: true`. A visible top newer
than the target is already a safe upper bound. If the collector returns
`automatic-repair-required`, notify the user with the returned non-blocking
progress message, retain the workspace, and immediately follow
`browser-repair-playbook.md`. Repair and validate the adapter or collector, then
resume from the retained browser and runner checkpoints without asking for repair
approval. The diagnostic handoff contains no source content or signed URL
parameters and is never copied into the final report. The same automatic repair
path covers internal runtime reference failures; invalid input, permission,
authentication, browser-connection, and external-service errors remain direct
actionable errors.

## 2. Coverage record

Record timeline coverage only from visible browser evidence:

```json
{
  "top_established": true,
  "pending_new_content_loaded": true,
  "crossed_below_target_date": true,
  "chronology_consistent": true,
  "access_complete": true,
  "evidence": "Short description of the visible upper and lower boundaries"
}
```

`crossed_below_target_date` records that the lower boundary is proven: either an older topic was observed or the exact absolute timeline-end marker proved that no older topic exists. If any boolean is false, add a single-line `failure_reason`. Finalization then stops without writing either a canonical or incomplete report. A verified zero-topic day uses all five `true` values and no topic records.

## 3. Topic record

The top-level inventory file uses the same topic-level fields shown below. Its attachment entries contain only `type`, `source_ordinal`, the available `source.platform_id` and `source.transport_url`, plus `image_ordinal` and `topic_association_evidence` for images, `filename` for PDFs, or `stable_page_id` and `original_url` for webpages. Do not include representation paths, extracted attachment content, or webpage children in this first record.

The later extracted topic record must match the inventory's topic identity, author, timestamp, body payload and hash, image total, evidence, attachment types, source order, and available source identities exactly.

```json
{
  "source_order": 1,
  "source": {
    "platform_id": "stable topic ID when visible",
    "permalink": "https://... when visible"
  },
  "author": "Exact displayed author",
  "timestamp": "ISO-8601 platform timestamp",
  "body": { "status": "present", "payload": "Unchanged body" },
  "image_count": 1,
  "image_count_evidence": "Viewer counter 1/1",
  "attachments": []
}
```

`source.platform_id` and `source.permalink` are individually optional, but include every value the UI exposes. The runner derives `topic_key`; never provide a key or hash yourself.

Attachments must appear exactly once in global `source_ordinal` order `1..N`. Top-level images additionally require a separate `image_ordinal` sequence exactly equal to `1..image_count`.

Before extracting a webpage body or its children, freeze that occurrence's independent child inventory:

```json
{
  "topic_source_order": 1,
  "attachment_source_ordinal": 2,
  "embedded_media_count": 2,
  "embedded_media_count_evidence": "Scanned the complete main content through the page end",
  "embedded_media": [
    {
      "type": "image",
      "source_ordinal": 1,
      "source": { "platform_id": "inline-image-id-when-visible" }
    },
    {
      "type": "pdf",
      "source_ordinal": 2,
      "source": { "transport_url": "temporary URL when required" },
      "filename": "document.pdf or 未显示"
    }
  ]
}
```

`embedded_media` must contain exactly `1..embedded_media_count` in page order. For zero children, submit `0`, a specific full-page/end-of-main-content evidence string, and an empty array. The runner rejects a second record or a record submitted after that topic was checkpointed. `upsert-topic` compares the extracted child count, type, ordinal, available platform ID/transport URL, and PDF filename with this frozen set. A repeated linked page is a new occurrence: revisit it and freeze its own child inventory.

If the browser cannot prove the complete child range, omit `embedded_media_count` and submit a failed inventory. `embedded_media` may contain the known recovered prefix in contiguous page order; the total remains unknown:

```json
{
  "topic_source_order": 1,
  "attachment_source_ordinal": 2,
  "embedded_media_count_evidence": "Access-control page appeared before the main-content end",
  "embedded_media": [],
  "inventory_failure": {
    "failure_reason": "The complete main-content range was not accessible",
    "reader_note": "链接页受访问控制，内嵌媒体范围无法确认"
  }
}
```

Providing both `embedded_media_count` and `inventory_failure` is invalid. A failed child inventory is auditable and resumable, but it always makes the page incomplete.

## 4. Extraction states

Use the same object for topic bodies, image text, webpage bodies, and PDF pages.

Complete non-empty content:

```json
{ "status": "present", "payload": "Exact extracted source payload" }
```

Verified absence of substantive content:

```json
{ "status": "empty" }
```

Known extraction failure:

```json
{
  "status": "failed",
  "recovered_payload": "Optional reliable source fragment",
  "failure_reason": "Specific internal reason",
  "reader_note": "Short reader-facing explanation"
}
```

Do not mix a failure explanation into `payload` or `recovered_payload`. The runner derives all UTF-8 hashes. Omit `recovered_payload` when no fragment is reliable.

Topic-body extraction rules:

- Copy only the exact body carried by the collector's frozen inventory; the collector already cross-checked it against its dedicated extractor. Never "clean" a frozen body, re-extract it by hand, or let the runner infer whether a phrase is UI. The `展开全部`/`收起` control text is structurally excluded by the collector; identical text inside the body is legitimate source content.
- Copy all visible text without summarizing, translating, correcting, or stylistically rewriting it. Preserve headings, paragraphs, lists, quotations, and link targets when the source exposes them. Mark source text that is genuinely unreadable as `[无法辨认]`; never guess.
- Set `body_status: present` only after the complete displayed body has been captured. A truncated, partially hidden, or uncertain body is `failed` regardless of how much text was recovered.

## 5. Attachment records

### Common source object

Images, webpages, and PDFs use:

```json
{
  "platform_id": "optional stable attachment ID",
  "transport_url": "optional full temporary URL",
  "binary_path": "/absolute/path/inside/run/workspace"
}
```

All fields are optional individually. Supply every available value so the runner can enforce identity priority: platform ID, then the SHA-256 of the sanitized (query- and fragment-free) transport URL, then binary hash, then no source identity. Manifest schema 2 derives identity and performs every inventory transport-URL comparison over the sanitized form, so signed-URL rotation between sessions never breaks a resumed run; schema-1 manifests are rejected, never migrated. The raw transport URL remains only in the temporary manifest; the runner emits at most a query-free URL into the temporary audit ledger and emits no image/PDF resource URL into the reader report.

### Image

```json
{
  "type": "image",
  "source_ordinal": 1,
  "image_ordinal": 1,
  "topic_association_evidence": "Topic detail attachment slot 1",
  "source": {},
  "representation_path": "/absolute/path/inside/run/image.png",
  "width": 1200,
  "height": 800,
  "representation_type": "rendered-preview",
  "tile_manifest_path": "/absolute/path/inside/run/image-tiles/tiles.json",
  "tile_verifications": [
    { "tile_index": 1, "status": "verified", "note": "Verified top-left tile" },
    { "tile_index": 2, "status": "verified", "note": "Verified top-right tile" }
  ],
  "source_account": "Visible account or 未显示",
  "extraction": { "status": "present", "payload": "Semantic image content" },
  "verification": { "status": "verified", "note": "Exact visual comparison result" }
}
```

Embedded images omit `image_ordinal` and `topic_association_evidence`. Allowed representation types are `rendered-preview`, `locator-screenshot`, `viewer-screenshot`, `single-asset-export`, and `page-screenshot`; the runner rejects any other value.

Omit `tile_manifest_path` and `tile_verifications` when the whole image can be verified reliably. For native-pixel small or dense text, create a unique nonexistent tile directory inside the run workspace:

```bash
node zsxq-fetch/scripts/zsxq-image-tiles.mjs \
  --workspace RUN \
  --source /absolute/path/inside/run/image.jpg \
  --output-directory /absolute/path/inside/run/image-tiles
```

The default grid uses lossless PNG crops with a maximum size of `512×768` and `96px` overlap. Custom maxima may be smaller but never larger, custom overlap must be at least `1px` and smaller than both dimensions, and a plan above 512 tiles is rejected before the grid is allocated or the output directory is created. The script normalizes EXIF orientation but never resizes or enhances pixels. Copy the returned `manifest_path` into the image record and add exactly one ordered verification for every returned tile. The runner requires the manifest source to equal `representation_path` byte-for-byte, recomputes the deterministic grid, checks every PNG's physical dimensions and SHA-256 value, and re-hashes the manifest, normalized source, and tiles during finalization. A complete image requires every tile verification to be `verified`; a missing, duplicate, reordered, failed, changed, escaped, or geometrically inconsistent tile fails closed. Cache-reused images must omit both tile fields because their extraction evidence comes from the earlier binary-identical occurrence.

An image with `extraction.status: failed` must use `verification.status: failed`; a present or empty image must be verified. When the platform never yields any image representation, omit `representation_path`, dimensions, and `representation_type`, and record failed extraction plus failed verification. This preserves the known attachment as an explicit incomplete item instead of making it impossible to record.

Image extraction and verification rules:

- Use any representation available through the platform's official UI that makes all substantive image content readable — preview, thumbnail, transformed image, browser-rendered image, or page screenshot. Prefer a clearer representation only when the current one leaves content unreadable or uncertain; do not spend time retrieving the publisher's original binary when the complete content can already be verified. The recorded pixel dimensions, SHA-256, and `representation_type` identify evidence and never grade quality or completeness.
- Extract the image's semantic content text in natural reading order: text a downstream reader needs to understand what the author intended to share. Exclude unrelated interface chrome (status bars, viewer controls, follow/share buttons, navigation labels, comment placeholders, standalone interaction counts); keep interface text only when it is itself material evidence (a discussed setting, an error message, a transaction value, a tutorial step). When uncertain, include rather than delete potentially substantive text. Keep a displayed account name or watermark as `source_account` metadata (`未显示` when absent), never inside the OCR payload. Preserve visible paragraph, list, and table structure. Write `未检测到可读文字` for an image with no readable text, and record a specific extraction failure instead of silently omitting an inaccessible image.
- Perform a separate visual verification pass against the same representation used for extraction: confirm every content region is captured, structure preserved, `source_account` separated, and interface chrome absent. If the representation is too degraded, cropped, or obstructed to prove this, obtain a clearer representation; when the obstacle is small or dense text over sufficient native pixels, run the mandatory tile analysis before failing.
- Set `verification.status: verified` only when that comparison succeeds, regardless of representation quality or transport form; otherwise set it `failed` with the exact missing or uncertain content. `extraction.status: present` requires a complete OCR payload; `empty` requires visually verified absence; partial OCR is `failed`.

### Linked webpage

```json
{
  "type": "web",
  "source_ordinal": 2,
  "source": {},
  "title": "Displayed page title",
  "original_url": "https://shared.example/article?source=zsxq",
  "canonical_url": "https://shared.example/article",
  "stable_page_id": "optional stable page ID",
  "author": "optional author",
  "publication_time": "optional displayed time",
  "body": { "status": "present", "payload": "Complete main body" },
  "embedded_media": []
}
```

Include exactly the children already frozen through `record-web-inventory` in `embedded_media`, ordered by `source_ordinal` `1..N`. Do not include decorative media and do not follow newly discovered hyperlinks. `canonical_url` and `stable_page_id` are optional descriptive metadata; they carry no cache implications.

Webpage extraction rules:

- Prefer the available clean-webpage extraction skill for public HTML pages; use the authenticated browser only when the page requires its existing session or interactive rendering. Any accessible rendering is acceptable (clean-page extraction, browser rendering, reader view, screenshot/OCR); never substitute a search snippet or another publisher.
- Extract the article title, original linked URL, canonical URL when available, visible author/publication metadata, and main body. Remove navigation, advertisements, cookie banners, recommendations, and unrelated comments; preserve the page's semantic heading, paragraph, list, quotation, and table order.
- Extract the frozen child inventory's inline images and embedded PDFs with the image and PDF rules in this document, keeping their payloads and evidence separate from the page body; complete body and children in the same browser visit whenever the UI exposes them together, reusing the in-run binary cache for identical binaries.
- `web_body_status` follows the same `present`/`empty`/`failed` rules as image text: `present` only for the complete substantive body and structure; clipped, paginated-but-unloaded, or paywalled bodies are `failed`. The page's aggregate `extraction_status` is `present` only when the body is `present` or `empty` and every inventoried child is complete and verified; otherwise the page is `failed`.

### PDF

```json
{
  "type": "pdf",
  "source_ordinal": 3,
  "source": {},
  "filename": "document.pdf or 未显示",
  "representation_path": "/absolute/path/inside/run/document.pdf",
  "page_count": 2,
  "page_count_evidence": "Parser metadata reports 2 pages",
  "pages": [
    { "page_number": 1, "extraction": { "status": "present", "payload": "Page 1" } },
    { "page_number": 2, "extraction": { "status": "empty" } }
  ]
}
```

Use `representation_paths` instead of `representation_path` when the accessible representation consists of multiple rendered page files. Pages must appear exactly once in order `1..page_count`. Embedded PDFs use the same object inside a webpage's `embedded_media`.

PDF extraction rules:

- Use whichever accessible representation yields complete page contents (text layer, rendered pages, screenshots, OCR); prefer the text layer, then visually check any page whose extraction is missing, incomplete, or corrupt. Establish the total `page_count` independently (parser, metadata, viewer total, or another reliable end signal) with `page_count_evidence`; an unprovable or disputed total makes the PDF failed.
- Preserve page boundaries as `#### 第 N 页` (top-level) or `##### 第 N 页` (embedded) in reading order and record unreadable pages explicitly; a missing, duplicate, out-of-order, or out-of-range page makes the PDF failed. If no page representation is acquirable, record one `document_failure` and retain `page_count_evidence`.

When the document cannot be accessed at all, omit `pages` and add a whole-document failure:

```json
{
  "type": "pdf",
  "source_ordinal": 3,
  "source": {},
  "filename": "document.pdf or 未显示",
  "page_count": 2,
  "page_count_evidence": "Viewer reports 2 pages, but no page loads",
  "document_failure": {
    "status": "failed",
    "failure_reason": "No page representation could be acquired",
    "reader_note": "PDF 无法读取"
  }
}
```

`page_count` is optional only for a whole-document failure; `page_count_evidence` remains required and must explain either the known total or why the total is unknown. A whole-document failure cannot include page entries and may omit the representation path.

## 6. Cache reuse

`cache-lookup` supports only `--kind binary`. There is no page cache: a repeated linked page is revisited and extracted as a new occurrence.

After capturing a local image or single-file PDF representation, let the runner hash it and query:

```bash
node zsxq-fetch/scripts/zsxq-runner.mjs cache-lookup \
  --workspace RUN --kind binary --path /absolute/path/inside/run/representation
```

On a matching complete result, use `reuse_extraction_from` and omit the copied extraction fields. Keep the new occurrence's source, ordinals, representation path, and image acquisition evidence. The runner independently hashes the new representation and rejects a mismatch.

## 7. Finalization outcomes

`finalize` always validates the manifest, renders the temporary audit ledger and validates its disk round-trip — including sanitized-URL checks on the runner-owned structured fields — then renders the content-only reader report and applies the safe-write rules. Those checks never scan rendered payload text for label-like lines: source payload text is never rejected merely because it contains comment syntax or words that resemble audit labels. A second SQLite transaction keyed by the canonical output path serializes different run workspaces targeting the same archive. A waiting writer re-checks the canonical snapshot after acquiring that lock, so an older run cannot overwrite or leave stale sibling state beside a newer run. The lock databases live under the operating system's temporary directory, not beside the reader report.

Before rendering, it resolves and re-hashes every checkpointed source binary and image/PDF representation, including embedded media and cache-source occurrences. A missing, redirected, or changed file stops finalization without output and retains the workspace for diagnosis.

- Proven coverage with no failed source fragment produces the canonical `.md` report.
- Proven coverage with one or more known failures produces the sibling `.incomplete.md` report and never replaces a complete canonical report.
- Unproven coverage writes nothing and retains the workspace for diagnosis or resumption.
- Successful finalization removes the audit ledger, cache state, raw transport URLs, and the entire marked run workspace.

Reader-report topic headings render each topic's timestamp converted to
Beijing time as `YYYY-MM-DD HH:mm:ss`, matching the deployment-wide Beijing
policy; the audit ledger and the hidden marker keep the original ISO instants.

The runner refuses unmarked outputs, cross-planet or cross-date replacement, any write beside or over a newer canonical snapshot, concurrent edits, missing image slots, invalid PDF page sequences, duplicate keys, and content paths outside the dedicated workspace.

Same-path rerun rules enforced by the safe writer:

- Replace a file only when its hidden marker contains `zsxq-fetch` and its
  `planet`, `planet_url`, and `date` exactly match the current run. Never
  replace a canonical `complete` file with an `incomplete` result, and refuse
  to overwrite an unmarked file.
- Refuse to replace a generated report whose `snapshot_at` is later than the
  current run, and refuse the entire write (canonical or `.incomplete.md`)
  when an existing canonical report has a later `snapshot_at`: an older
  resumed run must not overwrite or shadow newer collected content.
- If the default path already belongs to a same-named planet with a different
  `planet_url`, or any other scope field differs, refuse replacement and ask
  the user for an explicit output path instead of adding a suffix.
- The writer records the existing target's identity, size, and nanosecond
  modification time, writes the full replacement to a uniquely named sibling
  temporary file, re-verifies the target immediately before an atomic rename,
  and holds one canonical-output-path transaction from the snapshot check
  through stale-partial cleanup, so concurrent runs targeting the same archive
  serialize. After a `complete` canonical write, a sibling `.incomplete.md` is
  removed only when its marker matches the same scope, its `snapshot_at` is
  not newer, and it is unchanged at the moment of removal; the result reports
  whether a stale partial was removed.
- If validation or rename fails, only the exact sibling temporary file created
  for the attempt is removed; it is retained solely when needed for diagnosis.

## 8. Browser collector handoff

The browser collector (`scripts/zsxq-browser-collector.mjs`) owns every timeline and detail proof obligation: the versioned DOM adapter, mounting and readiness checks, collapsed-body expansion, sequential scrolling, exact author/time/body/attachment association, the independent dedicated-body cross-check, per-topic `image_count` with overflow-badge detection, chronology and date-boundary proof, pinned-topic safety checks, automatic repair handoff, and the resumable `browser-collector-checkpoint.json`. Section 1 describes the calling sequence, the strict-timestamp and pinned-topic gating, and the session-local records the collector returns.

Every occurrence key is runner-derived as `<topic_key>:<type>:<source_ordinal>:<source_identity>`, even when the same platform ID, URL, or binary appears in another topic; counts or arbitrary keys alone are never coverage proof.

PDF download handshake: when the official file preview exposes exactly one visible `下载文件` control for the inventoried filename, call `downloadZsxqTimelinePdfOnTab` with the matching `pdf_download_targets` indices and expected filename from section 1 — never guess or re-derive them from the page. Arm the browser download event before clicking, resolve the exact completed download rather than guessing from its filename, and copy it into the private runner workspace before parsing. On `PDF_FILE_IDENTITY_MISMATCH`, re-collect instead of guessing.
