import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildZsxqRunnerInventory,
  collectZsxqDomDiagnostics,
  collectZsxqDetailWithAutoRepair,
  collectZsxqTimelineRangeWithAutoRepair,
  downloadZsxqTimelinePdfOnTab,
  inspectZsxqDetailPage,
  inspectZsxqTimelinePage,
  timelineCoverageBoundaryReached,
  writeZsxqBrowserRepairHandoff,
  ZSXQ_BROWSER_CONTRACT,
  ZSXQ_BROWSER_CONTRACT_V3,
  ZSXQ_BROWSER_CONTRACT_V4,
  ZSXQ_BROWSER_CONTRACT_V5,
  ZSXQ_REPAIR_NOTIFICATION,
} from "../scripts/zsxq-browser-collector.mjs";
import { normalizeInventory } from "../scripts/run-model.mjs";

const fixture = JSON.parse(await readFile(
  fileURLToPath(new URL("./fixtures/timeline-read-count-v4.json", import.meta.url)),
  "utf8",
));

class FakeElement {
  constructor(options = {}) {
    this.innerText = options.innerText ?? "";
    this.textContent = options.textContent ?? this.innerText;
    this.tagName = options.tagName ?? "DIV";
    this.className = options.className ?? "";
    this.classList = options.classList ?? [];
    this.childNodes = options.childNodes ?? [];
    this.children = options.children ?? [];
    this.childElementCount = this.children.length;
    this.complete = options.complete;
    this.naturalWidth = options.naturalWidth ?? 0;
    this.naturalHeight = options.naturalHeight ?? 0;
    this.currentSrc = options.currentSrc ?? "";
    this.src = options.src ?? "";
    this.href = options.href ?? "";
    this.order = options.order ?? 0;
    this.scrollHeight = options.scrollHeight ?? 100;
    this.clientHeight = options.clientHeight ?? 100;
    this.attributes = options.attributes ?? {};
    this.queries = new Map();
    this.closestSelectors = new Set();
  }

  set(selector, elements) {
    this.queries.set(selector, elements);
    return this;
  }

  querySelectorAll(selector) {
    return this.queries.get(selector) ?? [];
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  closest(selector) {
    return this.closestSelectors.has(selector) ? this : null;
  }

  compareDocumentPosition(other) {
    return this.order < other.order ? 4 : 2;
  }

  contains(other) {
    return this === other;
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  getBoundingClientRect() {
    return { width: 640, height: 480 };
  }
}

class FakeLocator {
  constructor(node) {
    this.node = node;
  }

  nth(index) {
    return new FakeLocator(this.node.nth[index]);
  }

  locator(selector) {
    return new FakeLocator(this.node.locators[selector]);
  }

  async count() {
    return this.node.count;
  }

  async innerText() {
    return this.node.innerText;
  }

  async isVisible() {
    return this.node.visible;
  }

  async click() {
    this.node.clicks += 1;
  }
}

function locatorNode(options = {}) {
  return {
    count: options.count ?? 1,
    innerText: options.innerText ?? "",
    visible: options.visible ?? true,
    clicks: 0,
    nth: options.nth ?? [],
    locators: options.locators ?? {},
  };
}

function installDownloadTab() {
  const selectors = ZSXQ_BROWSER_CONTRACT.selectors;
  const cardName = locatorNode({ innerText: "fixture.pdf" });
  const card = locatorNode({ locators: { [selectors.fileName]: cardName } });
  const gallery = locatorNode({ nth: [card] });
  const talk = locatorNode({ locators: { [selectors.fileItem]: gallery } });
  const topic = locatorNode({ locators: { [selectors.topicTalk]: talk } });
  const timeline = locatorNode({ nth: [topic] });
  const previewName = locatorNode({ innerText: "fixture.pdf" });
  const downloadControl = locatorNode({ innerText: "下载文件" });
  const preview = locatorNode({
    locators: {
      [selectors.filePreviewName]: previewName,
      [selectors.fileDownloadControl]: downloadControl,
    },
  });
  const download = { suggestedFilename: "fixture.pdf" };
  const tab = {
    playwright: {
      evaluate: async () => undefined,
      locator(selector) {
        if (selector === selectors.timelineTopic) return new FakeLocator(timeline);
        if (selector === selectors.filePreviewRoot) return new FakeLocator(preview);
        throw new Error(`Unexpected selector: ${selector}`);
      },
      async waitForEvent(eventName, options) {
        assert.equal(eventName, "download");
        // The collector must pass Playwright's standard `timeout` name and
        // keep the collector-local `timeoutMs` spelling with the same value.
        assert.equal(typeof options?.timeout, "number");
        assert.equal(options.timeout, options.timeoutMs);
        return download;
      },
    },
  };
  return { tab, card, cardName, previewName, downloadControl, download };
}

function timestampElement(topic) {
  const readCount = new FakeElement({
    innerText: topic.read_count,
    tagName: "SPAN",
    className: "readed-count ng-star-inserted",
  });
  return new FakeElement({
    innerText: `${topic.timestamp}\n${topic.read_count}`,
    textContent: ` ${topic.timestamp} ${topic.read_count}`,
    childNodes: [
      { nodeType: 3, nodeValue: ` ${topic.timestamp} ` },
      readCount,
    ],
    children: [readCount],
  }).set(":scope > .readed-count", [readCount]);
}

function emptyTalk(selectors, bodyText) {
  const body = new FakeElement({ innerText: bodyText });
  body.set(":scope .showAll", []);
  return new FakeElement({ innerText: `Interface noise\n${bodyText}` })
    .set(selectors.body, [body])
    .set(selectors.expandControl, [])
    .set(selectors.image, [])
    .set(selectors.imageGallery, [])
    .set(selectors.link, [])
    .set(selectors.fileGallery, [])
    .set(selectors.fileItem, []);
}

function topicElement(topic, selectors) {
  const author = new FakeElement({ innerText: topic.author });
  const timestamp = timestampElement(topic);
  const header = new FakeElement()
    .set(selectors.author, [author])
    .set(selectors.timestamp, [timestamp]);
  const talk = emptyTalk(selectors, topic.body);

  const imageFixture = topic.attachments.find(({ type }) => type === "image");
  const webFixture = topic.attachments.find(({ type }) => type === "web");
  const pdfFixture = topic.attachments.find(({ type }) => type === "pdf");
  if (imageFixture) {
    const image = new FakeElement({
      tagName: "IMG",
      order: imageFixture.order,
      complete: imageFixture.complete,
      naturalWidth: imageFixture.broken ? 0 : 1200,
      naturalHeight: imageFixture.broken ? 0 : 800,
      currentSrc: "https://images.example/image.png?signature=secret",
      attributes: { "data-image-id": "image-1" },
    });
    const descendants = [image];
    if (imageFixture.overflow) {
      descendants.push(new FakeElement({ innerText: "+3" }));
    }
    const gallery = new FakeElement()
      .set(selectors.imageWithinGallery, [image])
      .set(selectors.imageGalleryDescendant, descendants);
    talk.set(selectors.image, [image]).set(selectors.imageGallery, [gallery]);
  }
  if (webFixture) {
    const anchor = new FakeElement({
      tagName: "A",
      order: webFixture.order,
      href: "https://example.com/article",
    });
    anchor.set(selectors.image, []);
    talk.set(selectors.link, [anchor]);
  }
  if (pdfFixture) {
    const name = new FakeElement({ innerText: "fixture.pdf" });
    const icon = new FakeElement();
    const item = new FakeElement({
      order: pdfFixture.order,
      attributes: { "data-file-id": "file-1" },
    }).set(selectors.fileName, [name]).set(selectors.filePdfIndicator, [icon]);
    const gallery = new FakeElement().set(selectors.fileItemWithinGallery, [item]);
    talk.set(selectors.fileGallery, [gallery]).set(selectors.fileItem, [item]);
  }

  const element = new FakeElement()
    .set(selectors.topicHeader, [header])
    .set(selectors.topicTalk, [talk]);
  if (topic.sticky) {
    element.closestSelectors.add(selectors.stickyAncestor);
  }
  return element;
}

function installTimelineFixture({
  imageComplete = true,
  topics: fixtureTopics = fixture.topics,
  endReached = fixture.end_reached,
} = {}) {
  const selectors = ZSXQ_BROWSER_CONTRACT.selectors;
  const topics = fixtureTopics.map((topic) => topicElement({
    ...topic,
    attachments: topic.attachments.map((attachment) => attachment.type === "image"
      ? { ...attachment, complete: imageComplete }
      : attachment),
  }, selectors));
  const planet = new FakeElement({ innerText: fixture.planet_name });
  const timelineEnd = new FakeElement({ innerText: "没有更多了" });
  const timelineRoot = new FakeElement().set(
    selectors.timelineEnd,
    endReached ? [timelineEnd] : [],
  );
  const documentFixture = new FakeElement();
  documentFixture
    .set(selectors.planetName, [planet])
    .set(selectors.timelineRoot, [timelineRoot])
    .set(selectors.timelineTopic, topics)
    .set("*", [new FakeElement({ tagName: "APP-MAIN-CONTENT", innerText: "secret body" })])
    .set("app-main-content, .topic-detail-panel", []);
  documentFixture.scrollingElement = { scrollTop: 0, scrollHeight: 1200, clientHeight: 800 };
  documentFixture.documentElement = documentFixture.scrollingElement;
  globalThis.document = documentFixture;
  globalThis.location = {
    href: "https://wx.zsxq.com/group/fixture?token=supersecret#fragment",
    origin: "https://wx.zsxq.com",
    pathname: "/group/fixture",
  };
  globalThis.window = {
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
    scrollTo: () => {},
  };
  return { documentFixture, topics };
}

function snapshotTab(snapshot) {
  return {
    goto: async () => undefined,
    url: async () => "https://wx.zsxq.com/group/fixture",
    playwright: {
      evaluate: async (operation) => {
        if (operation.name === "prepareZsxqTimelinePage") return undefined;
        if (operation.name === "inspectZsxqTimelinePage") return snapshot;
        if (operation.name === "extractZsxqTopicBodies") {
          return snapshot.topics.map((topic, domIndex) => ({
            dom_index: domIndex,
            body: topic.body,
          }));
        }
        throw new Error(`Unexpected operation: ${operation.name}`);
      },
      locator: () => {
        throw new Error("No locator interaction is expected for a stable fixture");
      },
    },
  };
}

function collectorInput(workspace, overrides = {}) {
  return {
    planetName: fixture.planet_name,
    planetUrl: "https://wx.zsxq.com/group/fixture",
    targetDate: "2026-08-15",
    filtersClearedConfirmed: true,
    topBoundaryConfirmed: true,
    workspace,
    timeoutMs: 100,
    pollIntervalMs: 1,
    maxScrolls: 0,
    ...overrides,
  };
}

test("v4 isolates the owned timestamp text and preserves timeline safety boundaries", () => {
  installTimelineFixture();

  const oldSnapshot = inspectZsxqTimelinePage({ adapter: ZSXQ_BROWSER_CONTRACT_V3 });
  assert.equal(oldSnapshot.topics[0].displayed_timestamp, "2026-08-15 07:30\n阅读人数 1");

  const snapshot = inspectZsxqTimelinePage({ adapter: ZSXQ_BROWSER_CONTRACT_V4 });
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.contractVersion, "zsxq-web-angular-v4");
  assert.equal(snapshot.endReached, true);
  assert.equal(snapshot.topics.length, 2);
  assert.deepEqual(
    snapshot.topics.map(({ author, displayed_timestamp, body }) => ({
      author,
      displayed_timestamp,
      body,
    })),
    [
      {
        author: "Newest Author",
        displayed_timestamp: "2026-08-15 07:30",
        body: "Dedicated newest body",
      },
      {
        author: "Older Author",
        displayed_timestamp: "2026-08-15 07:29",
        body: "Dedicated older body",
      },
    ],
  );
  assert.deepEqual(snapshot.topics[0].attachments.map(({ type }) => type), [
    "web",
    "image",
    "pdf",
  ]);
  assert.equal(snapshot.topics[0].attachments[1].image_ordinal, 1);
});

test("an exact absolute end is a stronger lower boundary than an older topic", () => {
  assert.equal(timelineCoverageBoundaryReached({
    oldestPlatformDate: "2026-08-15",
    targetDate: "2026-08-15",
    endReached: true,
  }), true);
  assert.equal(timelineCoverageBoundaryReached({
    oldestPlatformDate: "2026-08-14",
    targetDate: "2026-08-15",
    endReached: false,
  }), true);
  assert.equal(timelineCoverageBoundaryReached({
    oldestPlatformDate: "2026-08-15",
    targetDate: "2026-08-15",
    endReached: false,
  }), false);
});

test("v4 still fails closed while an inventoried image is loading", () => {
  installTimelineFixture({ imageComplete: false });
  const snapshot = inspectZsxqTimelinePage({ adapter: ZSXQ_BROWSER_CONTRACT });
  assert.equal(snapshot.ok, false);
  assert.equal(snapshot.failure.code, "TIMELINE_IMAGES_NOT_READY");
  assert.equal(snapshot.failure.transient, true);
});

test("v6 accepts an absent direct read-count node without widening timestamp text", () => {
  const { topics } = installTimelineFixture();
  const selectors = ZSXQ_BROWSER_CONTRACT.selectors;
  topics.forEach((topicElementFixture, index) => {
    const header = topicElementFixture.querySelector(selectors.topicHeader);
    const timestamp = header.querySelector(selectors.timestamp);
    timestamp.set(selectors.timestampReadCount, []);
    timestamp.childNodes = [
      { nodeType: 3, nodeValue: ` ${fixture.topics[index].timestamp} ` },
      new FakeElement({ innerText: "Unrelated nested metadata" }),
    ];
    timestamp.innerText = `${fixture.topics[index].timestamp}\nUnrelated nested metadata`;
  });

  const previous = inspectZsxqTimelinePage({ adapter: ZSXQ_BROWSER_CONTRACT_V5 });
  assert.equal(previous.ok, false);
  assert.equal(previous.failure.code, "TOPIC_FIELD_MISMATCH");

  const snapshot = inspectZsxqTimelinePage({ adapter: ZSXQ_BROWSER_CONTRACT });
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.contractVersion, "zsxq-web-angular-v6");
  assert.deepEqual(
    snapshot.topics.map(({ displayed_timestamp }) => displayed_timestamp),
    fixture.topics.filter(({ sticky }) => !sticky).map(({ timestamp }) => timestamp),
  );
});

test("v6 still rejects duplicate direct read-count nodes", () => {
  const { topics } = installTimelineFixture();
  const selectors = ZSXQ_BROWSER_CONTRACT.selectors;
  const header = topics[1].querySelector(selectors.topicHeader);
  const timestamp = header.querySelector(selectors.timestamp);
  timestamp.set(selectors.timestampReadCount, [
    new FakeElement({ innerText: "阅读人数 1" }),
    new FakeElement({ innerText: "阅读人数 2" }),
  ]);

  const snapshot = inspectZsxqTimelinePage({ adapter: ZSXQ_BROWSER_CONTRACT });
  assert.equal(snapshot.ok, false);
  assert.equal(snapshot.failure.code, "TOPIC_FIELD_MISMATCH");
  assert.equal(snapshot.failure.selectorCounts.timestampReadCount, 2);
});

test("runner inventory helper uses the top-level topics envelope", () => {
  const inventory = buildZsxqRunnerInventory([{
    source_order: 1,
    source: {},
    author: "Fixture Author",
    timestamp: "2026-08-15T07:30:00+08:00",
    body: { status: "empty" },
    image_count: 0,
    image_count_evidence: "Expanded topic contains no image slots",
    attachments: [],
    browser_assets: [],
    platform_date: "2026-08-15",
    _timestampMilliseconds: Date.parse("2026-08-15T07:30:00+08:00"),
  }]);

  assert.deepEqual(inventory, {
    topics: [{
      source_order: 1,
      source: {},
      author: "Fixture Author",
      timestamp: "2026-08-15T07:30:00+08:00",
      body: { status: "empty" },
      image_count: 0,
      image_count_evidence: "Expanded topic contains no image slots",
      attachments: [],
    }],
  });
  assert.equal(normalizeInventory(inventory).recorded, true);
});

test("repair diagnostics retain structure but redact content and URL secrets", () => {
  installTimelineFixture();
  const diagnostic = collectZsxqDomDiagnostics({ adapter: ZSXQ_BROWSER_CONTRACT });
  const serialized = JSON.stringify(diagnostic);
  assert.equal(diagnostic.pageUrl, "https://wx.zsxq.com/group/fixture");
  assert.equal("timestampReadCountOptional" in diagnostic.selectorCounts, false);
  assert.doesNotMatch(serialized, /supersecret|secret body|Newest Author|Dedicated newest body/);
});

test("successful collector result is accepted directly by the runner inventory contract", async (t) => {
  installTimelineFixture();
  const snapshot = inspectZsxqTimelinePage({ adapter: ZSXQ_BROWSER_CONTRACT });
  assert.equal(snapshot.ok, true);
  const workspace = await mkdtemp(path.join(os.tmpdir(), "zsxq-collector-success-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));

  const tab = {
    goto: async () => undefined,
    url: async () => "https://wx.zsxq.com/group/fixture",
    playwright: {
      evaluate: async (operation) => {
        if (operation.name === "prepareZsxqTimelinePage") return undefined;
        if (operation.name === "inspectZsxqTimelinePage") return snapshot;
        if (operation.name === "extractZsxqTopicBodies") {
          return snapshot.topics.map((topic, domIndex) => ({
            dom_index: domIndex,
            body: topic.body,
          }));
        }
        throw new Error(`Unexpected operation: ${operation.name}`);
      },
      locator: () => {
        throw new Error("No locator should be needed for a stable absolute-end fixture");
      },
    },
  };

  const result = await collectZsxqTimelineRangeWithAutoRepair(tab, {
    planetName: fixture.planet_name,
    planetUrl: "https://wx.zsxq.com/group/fixture",
    targetDate: "2026-08-15",
    filtersClearedConfirmed: true,
    topBoundaryConfirmed: true,
    workspace,
    timeoutMs: 100,
    pollIntervalMs: 1,
    maxScrolls: 0,
  });

  assert.equal(result.status, "complete");
  assert.equal(result.contract_version, "zsxq-web-angular-v6");
  assert.equal(normalizeInventory(result.inventory).recorded, true);
  assert.equal(result.inventory.topics.length, 2);
  assert.equal(result.checkpoint_discarded, false);
  assert.deepEqual(result.skipped_topics, []);
  assert.deepEqual(result.pdf_download_targets, [{
    topic_source_order: 1,
    source_ordinal: 3,
    file_ordinal: 1,
    dom_topic_index: 1,
    filename: "fixture.pdf",
  }]);

  // Pin the exact checkpoint topic byte shape: prefix comparison against
  // checkpoints written by earlier releases relies on identical JSON key sets
  // and insertion order, so any drift must fail here instead of in the field.
  const checkpoint = JSON.parse(await readFile(
    path.join(workspace, "browser-collector-checkpoint.json"),
    "utf8",
  ));
  assert.equal(checkpoint.schema_version, 2);
  assert.equal(JSON.stringify(checkpoint.topics[0]), JSON.stringify({
    source_order: 1,
    source: {},
    author: "Newest Author",
    timestamp: "2026-08-15T07:30:00+08:00",
    body: { status: "present", payload: "Dedicated newest body" },
    image_count: 1,
    image_count_evidence:
      "1 img slot(s) across 1 app-image-gallery gallery(ies) verified "
      + "without an overflow indicator in the expanded topic container",
    attachments: [
      {
        type: "web",
        source_ordinal: 1,
        source: {},
        original_url: "https://example.com/article",
      },
      {
        type: "image",
        source_ordinal: 2,
        image_ordinal: 1,
        topic_association_evidence: "expanded topic 1 app-image-gallery slot 1",
        source: {
          platform_id: "image-1",
          transport_url: "https://images.example/image.png",
        },
      },
      {
        type: "pdf",
        source_ordinal: 3,
        source: { platform_id: "file-1" },
        filename: "fixture.pdf",
      },
    ],
  }));
});

test("repair handoff requires automatic repair without user approval", async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "zsxq-auto-repair-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));

  const { payload } = await writeZsxqBrowserRepairHandoff(workspace, {
    phase: "timeline-inventory",
    code: "TIMELINE_DOM_CONTRACT_FAILED",
    pageUrl: "https://wx.zsxq.com/group/fixture?token=secret#fragment",
    diagnostic: {
      pageUrl: "https://wx.zsxq.com/group/fixture?token=secret#fragment",
      selectorCounts: { topic: 0 },
    },
  });

  assert.equal(payload.schema_version, 2);
  assert.equal(payload.status, "automatic-repair-required");
  assert.deepEqual(payload.repair_policy, {
    mode: "automatic",
    user_approval_required: false,
    required_actions: [
      "read the sanitized diagnostic",
      "follow the browser repair playbook",
      "repair and validate the adapter or collector",
      "resume from retained checkpoints",
    ],
    forbidden_actions: [
      "commit repair changes without separate authorization",
      "merge repair changes without separate authorization",
      "push repair changes without separate authorization",
      "publish repair changes without separate authorization",
      "install dependencies without separate authorization",
      "bypass access controls",
      "expand the collection scope",
      "change unrelated files",
    ],
  });
  assert.equal(payload.user_notification, ZSXQ_REPAIR_NOTIFICATION);
  assert.match(payload.user_notification, /自动诊断、修复、验证并从检查点继续/);
  assert.doesNotMatch(
    JSON.stringify(payload),
    /awaiting-user-approval|approval_phrase|请明确回复|要我修复/u,
  );
});

test("automatic repair routing is limited to DOM contracts and collector defects", async (t) => {
  const workspaces = [];
  t.after(() => Promise.all(workspaces.map(
    (workspace) => rm(workspace, { recursive: true, force: true }),
  )));
  const createWorkspace = async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "zsxq-repair-route-"));
    workspaces.push(workspace);
    return workspace;
  };
  const inputFor = (workspace, overrides = {}) => ({
    planetName: "Fixture Planet",
    planetUrl: "https://wx.zsxq.com/group/fixture",
    targetDate: "2026-08-15",
    filtersClearedConfirmed: true,
    workspace,
    timeoutMs: 0,
    pollIntervalMs: 1,
    ...overrides,
  });
  const tabFor = (evaluate, url = undefined) => ({
    ...(url ? { url: async () => url } : {}),
    playwright: {
      evaluate,
      locator: () => ({}),
    },
  });

  await t.test("DOM contract failure returns automatic repair", async () => {
    const workspace = await createWorkspace();
    const tab = tabFor(async (operation) => {
      if (operation.name === "prepareZsxqTimelinePage") return undefined;
      if (operation.name === "inspectZsxqTimelinePage") {
        return {
          ok: false,
          failure: {
            code: "TOPIC_FIELD_MISMATCH",
            transient: false,
            selectorCounts: { topic: 1 },
          },
        };
      }
      if (operation.name === "collectZsxqDomDiagnostics") {
        return { pageUrl: "https://wx.zsxq.com/group/fixture" };
      }
      throw new Error(`Unexpected operation: ${operation.name}`);
    });

    const result = await collectZsxqTimelineRangeWithAutoRepair(
      tab,
      inputFor(workspace),
    );
    assert.equal(result.status, "automatic-repair-required");
    assert.equal(result.code, "TOPIC_FIELD_MISMATCH");
    assert.equal(result.phase, "timeline-top");
    const handoff = JSON.parse(await readFile(
      path.join(workspace, "browser-repair-handoff.json"),
      "utf8",
    ));
    assert.deepEqual(handoff.failure.evidence, {
      code: "TOPIC_FIELD_MISMATCH",
      transient: false,
      selectorCounts: { topic: 1 },
    });
  });

  await t.test("collector ReferenceError returns automatic repair", async () => {
    const workspace = await createWorkspace();
    const tab = tabFor(async () => {
      throw new ReferenceError("permissionResolver is not defined");
    });

    const result = await collectZsxqTimelineRangeWithAutoRepair(
      tab,
      inputFor(workspace),
    );
    assert.equal(result.status, "automatic-repair-required");
  });

  await t.test("evaluate-transported ReferenceError message returns automatic repair", async () => {
    const workspace = await createWorkspace();
    // Page evaluation returns thrown errors as plain Errors that only keep
    // the "ReferenceError: ..." message prefix, not the original type.
    const tab = tabFor(async () => {
      throw new Error("ReferenceError: permissionResolver is not defined");
    });

    const result = await collectZsxqTimelineRangeWithAutoRepair(
      tab,
      inputFor(workspace),
    );
    assert.equal(result.status, "automatic-repair-required");
    assert.equal(result.code, "COLLECTOR_RUNTIME_REFERENCE_ERROR");
  });

  await t.test("invalid input remains a direct error", async () => {
    const workspace = await createWorkspace();
    const tab = tabFor(async () => undefined);
    await assert.rejects(
      collectZsxqTimelineRangeWithAutoRepair(tab, inputFor(workspace, {
        planetName: "",
      })),
      /planetName must be a non-empty exact name/,
    );
  });

  await t.test("authentication failure remains a direct error", async () => {
    const workspace = await createWorkspace();
    const tab = tabFor(
      async () => undefined,
      "https://wx.zsxq.com/signin",
    );
    await assert.rejects(
      collectZsxqTimelineRangeWithAutoRepair(tab, inputFor(workspace)),
      /authentication or group access is required/,
    );
  });

  await t.test("browser permission failure remains a direct error", async () => {
    const workspace = await createWorkspace();
    const tab = tabFor(async () => {
      throw new Error("Permission denied by browser control");
    });
    await assert.rejects(
      collectZsxqTimelineRangeWithAutoRepair(tab, inputFor(workspace)),
      /Permission denied by browser control/,
    );
  });

  await t.test("browser disconnection remains a direct error", async () => {
    const workspace = await createWorkspace();
    const tab = tabFor(async () => {
      throw new ReferenceError("Browser disconnected from the control session");
    });
    await assert.rejects(
      collectZsxqTimelineRangeWithAutoRepair(tab, inputFor(workspace)),
      /Browser disconnected from the control session/,
    );
  });

  await t.test("external loading timeout remains a direct error", async () => {
    const workspace = await createWorkspace();
    const tab = tabFor(async (operation) => {
      if (operation.name === "prepareZsxqTimelinePage") return undefined;
      if (operation.name === "inspectZsxqTimelinePage") {
        return {
          ok: false,
          failure: {
            code: "TIMELINE_NOT_MOUNTED",
            transient: true,
            selectorCounts: { timeline: 0 },
          },
        };
      }
      throw new Error(`Unexpected operation: ${operation.name}`);
    });
    await assert.rejects(
      collectZsxqTimelineRangeWithAutoRepair(tab, inputFor(workspace)),
      (error) => error.code === "TIMELINE_DID_NOT_STABILIZE",
    );
  });

  await t.test("checkpoint scope conflict remains a direct error", async () => {
    const workspace = await createWorkspace();
    await writeFile(
      path.join(workspace, "browser-collector-checkpoint.json"),
      "{}\n",
      "utf8",
    );
    const tab = tabFor(async () => undefined);
    await assert.rejects(
      collectZsxqTimelineRangeWithAutoRepair(tab, inputFor(workspace)),
      (error) => error.code === "CHECKPOINT_SCOPE_MISMATCH",
    );
  });

  await t.test("detail attachment DOM contract returns automatic repair", async () => {
    const workspace = await createWorkspace();
    const tab = tabFor(async (operation) => {
      if (operation.name === "waitForZsxqDetailReady") return {};
      if (operation.name === "inspectZsxqDetailPage") {
        return {
          ok: false,
          failure: {
            code: "DETAIL_FILE_ATTACHMENT_MISMATCH",
            transient: false,
            selectorCounts: { fileItem: 1 },
          },
        };
      }
      if (operation.name === "collectZsxqDomDiagnostics") {
        return { pageUrl: "https://wx.zsxq.com/topic/123" };
      }
      throw new Error(`Unexpected operation: ${operation.name}`);
    });

    const result = await collectZsxqDetailWithAutoRepair(tab, {
      url: "https://wx.zsxq.com/topic/123",
      workspace,
      timeoutMs: 10,
      pollIntervalMs: 1,
    });
    assert.equal(result.status, "automatic-repair-required");
  });

  await t.test("detail authentication failure remains a direct error", async () => {
    const workspace = await createWorkspace();
    const tab = tabFor(
      async () => undefined,
      "https://wx.zsxq.com/signin",
    );
    await assert.rejects(
      collectZsxqDetailWithAutoRepair(tab, {
        url: "https://wx.zsxq.com/topic/123",
        workspace,
      }),
      /authentication or topic access is required/,
    );
  });

  await t.test("detail loading timeout remains a direct error", async () => {
    const workspace = await createWorkspace();
    const tab = tabFor(async (operation) => {
      if (operation.name === "waitForZsxqDetailReady") {
        throw new Error(
          "Knowledge Planet detail page did not become ready within 10ms",
        );
      }
      throw new Error(`Unexpected operation: ${operation.name}`);
    });
    await assert.rejects(
      collectZsxqDetailWithAutoRepair(tab, {
        url: "https://wx.zsxq.com/topic/123",
        workspace,
        timeoutMs: 10,
        pollIntervalMs: 1,
      }),
      (error) => error.code === "DETAIL_DID_NOT_STABILIZE",
    );
  });
});

test("v4 isolates the same owned timestamp text on detail pages", () => {
  const selectors = ZSXQ_BROWSER_CONTRACT_V4.selectors;
  const topic = fixture.topics[1];
  const timestamp = timestampElement(topic);
  const author = new FakeElement({ innerText: topic.author });
  const header = new FakeElement()
    .set(selectors.author, [author])
    .set(selectors.timestamp, [timestamp]);
  const talk = emptyTalk(selectors, topic.body);
  const panel = new FakeElement();
  const documentFixture = new FakeElement()
    .set(selectors.detailPanel, [panel])
    .set(selectors.detailTopic, [talk])
    .set(selectors.detailHeader, [header]);
  globalThis.document = documentFixture;
  globalThis.location = {
    href: "https://wx.zsxq.com/topic/123456789",
    origin: "https://wx.zsxq.com",
    pathname: "/topic/123456789",
  };
  globalThis.window = {
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
  };

  const snapshot = inspectZsxqDetailPage({ adapter: ZSXQ_BROWSER_CONTRACT_V4 });
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.author, "Newest Author");
  assert.equal(snapshot.displayed_timestamp, "2026-08-15 07:30");
  assert.equal(snapshot.body, "Dedicated newest body");
});

test("v6 accepts an absent direct read-count node on detail pages", () => {
  const selectors = ZSXQ_BROWSER_CONTRACT.selectors;
  const topic = fixture.topics[1];
  const timestamp = timestampElement(topic);
  timestamp.set(selectors.timestampReadCount, []);
  timestamp.childNodes = [
    { nodeType: 3, nodeValue: ` ${topic.timestamp} ` },
    new FakeElement({ innerText: "Unrelated nested metadata" }),
  ];
  timestamp.innerText = `${topic.timestamp}\nUnrelated nested metadata`;
  const author = new FakeElement({ innerText: topic.author });
  const header = new FakeElement()
    .set(selectors.author, [author])
    .set(selectors.timestamp, [timestamp]);
  const talk = emptyTalk(selectors, topic.body);
  const panel = new FakeElement();
  globalThis.document = new FakeElement()
    .set(selectors.detailPanel, [panel])
    .set(selectors.detailTopic, [talk])
    .set(selectors.detailHeader, [header]);
  globalThis.location = {
    href: "https://wx.zsxq.com/topic/123456789",
    origin: "https://wx.zsxq.com",
    pathname: "/topic/123456789",
  };
  globalThis.window = {
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
  };

  const snapshot = inspectZsxqDetailPage({ adapter: ZSXQ_BROWSER_CONTRACT });
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.displayed_timestamp, topic.timestamp);
});

test("v6 still rejects duplicate direct read-count nodes on detail pages", () => {
  const selectors = ZSXQ_BROWSER_CONTRACT.selectors;
  const topic = fixture.topics[1];
  const timestamp = timestampElement(topic);
  timestamp.set(selectors.timestampReadCount, [
    new FakeElement({ innerText: "阅读人数 1" }),
    new FakeElement({ innerText: "阅读人数 2" }),
  ]);
  const author = new FakeElement({ innerText: topic.author });
  const header = new FakeElement()
    .set(selectors.author, [author])
    .set(selectors.timestamp, [timestamp]);
  const talk = emptyTalk(selectors, topic.body);
  const panel = new FakeElement();
  globalThis.document = new FakeElement()
    .set(selectors.detailPanel, [panel])
    .set(selectors.detailTopic, [talk])
    .set(selectors.detailHeader, [header]);
  globalThis.location = {
    href: "https://wx.zsxq.com/topic/123456789",
    origin: "https://wx.zsxq.com",
    pathname: "/topic/123456789",
  };
  globalThis.window = {
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
  };

  const snapshot = inspectZsxqDetailPage({ adapter: ZSXQ_BROWSER_CONTRACT });
  assert.equal(snapshot.ok, false);
  assert.equal(snapshot.failure.code, "DETAIL_FIELD_MISMATCH");
  assert.equal(snapshot.failure.selectorCounts.timestampReadCount, 2);
});

test("v6 preserves the v5 official PDF download path", async () => {
  const { tab, card, downloadControl, download } = installDownloadTab();

  const result = await downloadZsxqTimelinePdfOnTab(tab, {
    topicDomIndex: 0,
    fileOrdinal: 1,
    expectedFilename: "fixture.pdf",
  });

  assert.equal(ZSXQ_BROWSER_CONTRACT.version, "zsxq-web-angular-v6");
  assert.equal(card.clicks, 1);
  assert.equal(downloadControl.clicks, 1);
  assert.equal(result.download, download);
  assert.equal(result.filename, "fixture.pdf");
  assert.equal(result.acquisition, "official-ui-download");
});

test("v5 refuses a timeline file occurrence whose filename changed", async () => {
  const { tab, card, cardName, downloadControl } = installDownloadTab();
  cardName.innerText = "different.pdf";

  await assert.rejects(
    downloadZsxqTimelinePdfOnTab(tab, {
      topicDomIndex: 0,
      fileOrdinal: 1,
      expectedFilename: "fixture.pdf",
    }),
    (error) => error.code === "PDF_FILE_IDENTITY_MISMATCH",
  );
  assert.equal(card.clicks, 0);
  assert.equal(downloadControl.clicks, 0);
});

test("v5 refuses a hidden official download control", async () => {
  const { tab, downloadControl } = installDownloadTab();
  downloadControl.visible = false;

  await assert.rejects(
    downloadZsxqTimelinePdfOnTab(tab, {
      topicDomIndex: 0,
      fileOrdinal: 1,
      expectedFilename: "fixture.pdf",
    }),
    (error) => error.code === "PDF_DOWNLOAD_CONTROL_MISMATCH",
  );
  assert.equal(downloadControl.clicks, 0);
});

test("a same-day sticky topic missing from the stream fails explicitly without repair", async (t) => {
  const topics = structuredClone(fixture.topics);
  topics[0].timestamp = "2026-08-15 06:00";
  installTimelineFixture({ topics });
  const snapshot = inspectZsxqTimelinePage({ adapter: ZSXQ_BROWSER_CONTRACT });
  assert.equal(snapshot.ok, true);
  assert.deepEqual(snapshot.stickyTopics, [
    { author: "Pinned Author", displayed_timestamp: "2026-08-15 06:00" },
  ]);

  const workspace = await mkdtemp(path.join(os.tmpdir(), "zsxq-sticky-unmatched-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  await assert.rejects(
    collectZsxqTimelineRangeWithAutoRepair(snapshotTab(snapshot), collectorInput(workspace)),
    (error) => error.code === "STICKY_TARGET_DATE_UNSUPPORTED",
  );
  await assert.rejects(readFile(path.join(workspace, "browser-repair-handoff.json")));
});

test("a same-day sticky topic proven present in the stream keeps the run complete", async (t) => {
  const topics = structuredClone(fixture.topics);
  topics[0].timestamp = "2026-08-15 06:00";
  topics.push({
    author: "Pinned Author",
    timestamp: "2026-08-15 06:00",
    read_count: "阅读人数 99",
    body: "Pinned body rendered in the stream",
    sticky: false,
    attachments: [],
  });
  installTimelineFixture({ topics });
  const snapshot = inspectZsxqTimelinePage({ adapter: ZSXQ_BROWSER_CONTRACT });
  assert.equal(snapshot.ok, true);

  const workspace = await mkdtemp(path.join(os.tmpdir(), "zsxq-sticky-matched-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const result = await collectZsxqTimelineRangeWithAutoRepair(
    snapshotTab(snapshot),
    collectorInput(workspace),
  );
  assert.equal(result.status, "complete");
  assert.equal(result.inventory.topics.length, 3);
});

test("an unreadable sticky timestamp fails explicitly without repair", async (t) => {
  const topics = structuredClone(fixture.topics);
  topics[0].timestamp = "置顶";
  installTimelineFixture({ topics });
  const snapshot = inspectZsxqTimelinePage({ adapter: ZSXQ_BROWSER_CONTRACT });
  assert.equal(snapshot.ok, true);

  const workspace = await mkdtemp(path.join(os.tmpdir(), "zsxq-sticky-unreadable-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  await assert.rejects(
    collectZsxqTimelineRangeWithAutoRepair(snapshotTab(snapshot), collectorInput(workspace)),
    (error) => error.code === "STICKY_TARGET_DATE_UNSUPPORTED",
  );
});

test("a checkpoint from another contract version is discarded and replayed", async (t) => {
  installTimelineFixture();
  const snapshot = inspectZsxqTimelinePage({ adapter: ZSXQ_BROWSER_CONTRACT });
  assert.equal(snapshot.ok, true);

  const workspace = await mkdtemp(path.join(os.tmpdir(), "zsxq-checkpoint-discard-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const checkpointPath = path.join(workspace, "browser-collector-checkpoint.json");
  await writeFile(checkpointPath, `${JSON.stringify({
    schema_version: 2,
    contract_version: "zsxq-web-angular-v5",
    phase: "timeline-complete",
    planet_name: fixture.planet_name,
    planet_url: "https://wx.zsxq.com/group/fixture",
    target_date: "2026-08-15",
    scroll_passes: 0,
    topics: [{ bogus: true }],
  })}\n`, "utf8");

  const result = await collectZsxqTimelineRangeWithAutoRepair(
    snapshotTab(snapshot),
    collectorInput(workspace),
  );
  assert.equal(result.status, "complete");
  assert.equal(result.checkpoint_discarded, true);
  const saved = JSON.parse(await readFile(checkpointPath, "utf8"));
  assert.equal(saved.contract_version, "zsxq-web-angular-v6");
  assert.equal(saved.phase, "timeline-complete");
});

test("a same-version checkpoint with another scope remains a direct error", async (t) => {
  installTimelineFixture();
  const snapshot = inspectZsxqTimelinePage({ adapter: ZSXQ_BROWSER_CONTRACT });

  const workspace = await mkdtemp(path.join(os.tmpdir(), "zsxq-checkpoint-scope-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  await writeFile(path.join(workspace, "browser-collector-checkpoint.json"), `${JSON.stringify({
    schema_version: 2,
    contract_version: "zsxq-web-angular-v6",
    phase: "timeline-complete",
    planet_name: fixture.planet_name,
    planet_url: "https://wx.zsxq.com/group/fixture",
    target_date: "2026-08-14",
    scroll_passes: 0,
    topics: [],
  })}\n`, "utf8");

  await assert.rejects(
    collectZsxqTimelineRangeWithAutoRepair(snapshotTab(snapshot), collectorInput(workspace)),
    (error) => error.code === "CHECKPOINT_SCOPE_MISMATCH",
  );
});

test("an image-gallery overflow topic is skipped with an annotation instead of failing", async (t) => {
  const topics = structuredClone(fixture.topics);
  topics[1].attachments = [{ type: "image", order: 20, complete: true, overflow: true }];
  installTimelineFixture({ topics });
  const snapshot = inspectZsxqTimelinePage({
    adapter: ZSXQ_BROWSER_CONTRACT,
    targetDate: "2026-08-15",
  });
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.topics[0].image_overflow, true);
  assert.equal(snapshot.topics[1].image_overflow, undefined);

  const workspace = await mkdtemp(path.join(os.tmpdir(), "zsxq-overflow-skip-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const result = await collectZsxqTimelineRangeWithAutoRepair(
    snapshotTab(snapshot),
    collectorInput(workspace),
  );
  assert.equal(result.status, "complete");
  assert.equal(result.inventory.topics.length, 1);
  assert.equal(result.inventory.topics[0].author, "Older Author");
  assert.deepEqual(result.skipped_topics, [{
    author: "Newest Author",
    timestamp: "2026-08-15T07:30:00+08:00",
    reason: "image-gallery-overflow",
  }]);
  assert.match(result.coverage.evidence, /skipped 1 target-date topic/);
});

test("a broken image outside the target date no longer blocks readiness", async () => {
  const topics = [
    {
      author: "Newest Author",
      timestamp: "2026-08-15 07:30",
      read_count: "阅读人数 1",
      body: "Dedicated newest body",
      sticky: false,
      attachments: [],
    },
    {
      author: "Older Author",
      timestamp: "2026-08-14 20:00",
      read_count: "阅读人数 2",
      body: "Older day body",
      sticky: false,
      attachments: [{ type: "image", order: 20, complete: true, broken: true }],
    },
  ];
  installTimelineFixture({ topics, endReached: false });

  const unscoped = inspectZsxqTimelinePage({ adapter: ZSXQ_BROWSER_CONTRACT });
  assert.equal(unscoped.ok, false);
  assert.equal(unscoped.failure.code, "TIMELINE_IMAGES_NOT_READY");

  const snapshot = inspectZsxqTimelinePage({
    adapter: ZSXQ_BROWSER_CONTRACT,
    targetDate: "2026-08-15",
  });
  assert.equal(snapshot.ok, true);
});

test("a broken image inside the target date still fails readiness", () => {
  const topics = [
    {
      author: "Newest Author",
      timestamp: "2026-08-15 07:30",
      read_count: "阅读人数 1",
      body: "Dedicated newest body",
      sticky: false,
      attachments: [{ type: "image", order: 20, complete: true, broken: true }],
    },
  ];
  installTimelineFixture({ topics, endReached: true });

  const snapshot = inspectZsxqTimelinePage({
    adapter: ZSXQ_BROWSER_CONTRACT,
    targetDate: "2026-08-15",
  });
  assert.equal(snapshot.ok, false);
  assert.equal(snapshot.failure.code, "TIMELINE_IMAGES_NOT_READY");
});

test("an unreadable timestamp below the proven crossing point is tolerated", async (t) => {
  const topics = [
    {
      author: "Newest Author",
      timestamp: "2026-08-15 07:30",
      read_count: "阅读人数 1",
      body: "Dedicated newest body",
      sticky: false,
      attachments: [],
    },
    {
      author: "Older Author",
      timestamp: "2026-08-14 20:00",
      read_count: "阅读人数 2",
      body: "Older day body",
      sticky: false,
      attachments: [],
    },
    {
      author: "Relative Author",
      timestamp: "3小时前",
      read_count: "阅读人数 3",
      body: "Relative stamp body",
      sticky: false,
      attachments: [],
    },
  ];
  installTimelineFixture({ topics, endReached: false });
  const snapshot = inspectZsxqTimelinePage({
    adapter: ZSXQ_BROWSER_CONTRACT,
    targetDate: "2026-08-15",
  });
  assert.equal(snapshot.ok, true);

  const workspace = await mkdtemp(path.join(os.tmpdir(), "zsxq-relative-below-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const result = await collectZsxqTimelineRangeWithAutoRepair(
    snapshotTab(snapshot),
    collectorInput(workspace),
  );
  assert.equal(result.status, "complete");
  assert.equal(result.inventory.topics.length, 1);
  assert.equal(result.inventory.topics[0].author, "Newest Author");
});

test("an unreadable timestamp above the crossing point still requires repair", async (t) => {
  const topics = [
    {
      author: "Newest Author",
      timestamp: "2026-08-15 07:30",
      read_count: "阅读人数 1",
      body: "Dedicated newest body",
      sticky: false,
      attachments: [],
    },
    {
      author: "Relative Author",
      timestamp: "3小时前",
      read_count: "阅读人数 2",
      body: "Relative stamp body",
      sticky: false,
      attachments: [],
    },
    {
      author: "Older Author",
      timestamp: "2026-08-14 20:00",
      read_count: "阅读人数 3",
      body: "Older day body",
      sticky: false,
      attachments: [],
    },
  ];
  installTimelineFixture({ topics, endReached: false });
  const snapshot = inspectZsxqTimelinePage({
    adapter: ZSXQ_BROWSER_CONTRACT,
    targetDate: "2026-08-15",
  });
  assert.equal(snapshot.ok, true);

  const workspace = await mkdtemp(path.join(os.tmpdir(), "zsxq-relative-above-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const result = await collectZsxqTimelineRangeWithAutoRepair(
    snapshotTab(snapshot),
    collectorInput(workspace),
  );
  assert.equal(result.status, "automatic-repair-required");
  assert.equal(result.code, "TIMESTAMP_FORMAT_MISMATCH");
});

test("an unreadable top timestamp still requires repair", async (t) => {
  const topics = [
    {
      author: "Relative Author",
      timestamp: "刚刚",
      read_count: "阅读人数 1",
      body: "Relative stamp body",
      sticky: false,
      attachments: [],
    },
    {
      author: "Older Author",
      timestamp: "2026-08-14 20:00",
      read_count: "阅读人数 2",
      body: "Older day body",
      sticky: false,
      attachments: [],
    },
  ];
  installTimelineFixture({ topics, endReached: false });
  const snapshot = inspectZsxqTimelinePage({
    adapter: ZSXQ_BROWSER_CONTRACT,
    targetDate: "2026-08-15",
  });
  assert.equal(snapshot.ok, true);

  const workspace = await mkdtemp(path.join(os.tmpdir(), "zsxq-relative-top-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const result = await collectZsxqTimelineRangeWithAutoRepair(
    snapshotTab(snapshot),
    collectorInput(workspace),
  );
  assert.equal(result.status, "automatic-repair-required");
  assert.equal(result.code, "TIMESTAMP_FORMAT_MISMATCH");
});

test("a pinned topic seen in an earlier snapshot still fails after the pinned area unmounts", async (t) => {
  const stickyTopic = {
    author: "Pinned Author",
    timestamp: "2026-08-15 06:00",
    read_count: "阅读人数 99",
    body: "Pinned body must be excluded",
    sticky: true,
    attachments: [],
  };
  const newestTopic = {
    author: "Newest Author",
    timestamp: "2026-08-15 07:30",
    read_count: "阅读人数 1",
    body: "Dedicated newest body",
    sticky: false,
    attachments: [],
  };
  const olderSameDayTopic = {
    author: "Older Author",
    timestamp: "2026-08-15 07:29",
    read_count: "阅读人数 2",
    body: "Dedicated older body",
    sticky: false,
    attachments: [],
  };
  const olderDayTopic = {
    author: "Older Day Author",
    timestamp: "2026-08-14 20:00",
    read_count: "阅读人数 3",
    body: "Older day body",
    sticky: false,
    attachments: [],
  };

  installTimelineFixture({
    topics: [stickyTopic, newestTopic, olderSameDayTopic],
    endReached: false,
  });
  const firstSnapshot = inspectZsxqTimelinePage({
    adapter: ZSXQ_BROWSER_CONTRACT,
    targetDate: "2026-08-15",
  });
  assert.equal(firstSnapshot.ok, true);
  assert.equal(firstSnapshot.stickyTopics.length, 1);

  installTimelineFixture({
    topics: [newestTopic, olderSameDayTopic, olderDayTopic],
    endReached: true,
  });
  const secondSnapshot = inspectZsxqTimelinePage({
    adapter: ZSXQ_BROWSER_CONTRACT,
    targetDate: "2026-08-15",
  });
  assert.equal(secondSnapshot.ok, true);
  assert.deepEqual(secondSnapshot.stickyTopics, []);

  let current = firstSnapshot;
  const tab = {
    goto: async () => undefined,
    url: async () => "https://wx.zsxq.com/group/fixture",
    playwright: {
      evaluate: async (operation) => {
        if (operation.name === "prepareZsxqTimelinePage") return undefined;
        if (operation.name === "advanceZsxqTimelinePage") {
          current = secondSnapshot;
          return { top: 0, height: 2400, viewport: 800 };
        }
        if (operation.name === "inspectZsxqTimelinePage") return current;
        if (operation.name === "extractZsxqTopicBodies") {
          return current.topics.map((topic, domIndex) => ({
            dom_index: domIndex,
            body: topic.body,
          }));
        }
        throw new Error(`Unexpected operation: ${operation.name}`);
      },
      locator: (selector) => {
        if (selector !== "body") {
          throw new Error(`Unexpected locator: ${selector}`);
        }
        return { count: async () => 1, press: async () => {} };
      },
    },
  };

  const workspace = await mkdtemp(path.join(os.tmpdir(), "zsxq-sticky-unmounted-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  await assert.rejects(
    collectZsxqTimelineRangeWithAutoRepair(
      tab,
      collectorInput(workspace, { maxScrolls: 1 }),
    ),
    (error) => error.code === "STICKY_TARGET_DATE_UNSUPPORTED",
  );
});

test("a detail image-gallery overflow is a direct error rather than a repair target", async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "zsxq-detail-overflow-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const tab = {
    playwright: {
      evaluate: async (operation) => {
        if (operation.name === "waitForZsxqDetailReady") return {};
        if (operation.name === "inspectZsxqDetailPage") {
          return {
            ok: false,
            failure: {
              code: "DETAIL_IMAGE_GALLERY_OVERFLOW_UNSUPPORTED",
              transient: false,
              selectorCounts: { imageGallery: 1 },
            },
          };
        }
        throw new Error(`Unexpected operation: ${operation.name}`);
      },
      locator: () => ({}),
    },
    url: async () => "https://wx.zsxq.com/topic/123",
  };

  await assert.rejects(
    collectZsxqDetailWithAutoRepair(tab, {
      url: "https://wx.zsxq.com/topic/123",
      workspace,
      timeoutMs: 10,
      pollIntervalMs: 1,
    }),
    (error) => error.code === "DETAIL_IMAGE_GALLERY_OVERFLOW_UNSUPPORTED",
  );
  await assert.rejects(readFile(path.join(workspace, "browser-repair-handoff.json")));
});
