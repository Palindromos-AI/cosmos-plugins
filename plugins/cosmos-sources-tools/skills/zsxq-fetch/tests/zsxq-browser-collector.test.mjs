import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
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
  ZSXQ_REPAIR_NOTIFICATION,
} from "../scripts/zsxq-browser-collector.mjs";

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
      async waitForEvent(eventName) {
        assert.equal(eventName, "download");
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
      naturalWidth: 1200,
      naturalHeight: 800,
      currentSrc: "https://images.example/image.png?signature=secret",
      attributes: { "data-image-id": "image-1" },
    });
    const gallery = new FakeElement()
      .set(selectors.imageWithinGallery, [image])
      .set(selectors.imageGalleryDescendant, [image]);
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

function installTimelineFixture({ imageComplete = true } = {}) {
  const selectors = ZSXQ_BROWSER_CONTRACT.selectors;
  const topics = fixture.topics.map((topic) => topicElement({
    ...topic,
    attachments: topic.attachments.map((attachment) => attachment.type === "image"
      ? { ...attachment, complete: imageComplete }
      : attachment),
  }, selectors));
  const planet = new FakeElement({ innerText: fixture.planet_name });
  const timelineEnd = new FakeElement({ innerText: "没有更多了" });
  const timelineRoot = new FakeElement().set(
    selectors.timelineEnd,
    fixture.end_reached ? [timelineEnd] : [],
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
  };
  return { documentFixture, topics };
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

test("repair diagnostics retain structure but redact content and URL secrets", () => {
  installTimelineFixture();
  const diagnostic = collectZsxqDomDiagnostics({ adapter: ZSXQ_BROWSER_CONTRACT });
  const serialized = JSON.stringify(diagnostic);
  assert.equal(diagnostic.pageUrl, "https://wx.zsxq.com/group/fixture");
  assert.doesNotMatch(serialized, /supersecret|secret body|Newest Author|Dedicated newest body/);
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

test("v5 downloads an exact timeline PDF through the official file preview", async () => {
  const { tab, card, downloadControl, download } = installDownloadTab();

  const result = await downloadZsxqTimelinePdfOnTab(tab, {
    topicDomIndex: 0,
    fileOrdinal: 1,
    expectedFilename: "fixture.pdf",
  });

  assert.equal(ZSXQ_BROWSER_CONTRACT.version, "zsxq-web-angular-v5");
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
