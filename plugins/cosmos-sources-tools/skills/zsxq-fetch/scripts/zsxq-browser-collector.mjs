import { randomUUID } from "node:crypto";
import { readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

import {
  extractZsxqTopicBodies,
  waitForZsxqDetailReadyOnTab,
} from "./zsxq-dom-extractor.mjs";
import {
  beijingDateFromTimestamp,
  ZSXQ_UTC_OFFSET,
} from "./zsxq-time.mjs";

export const ZSXQ_BROWSER_CONTRACT_V1 = Object.freeze({
  version: "zsxq-web-angular-v1",
  selectors: Object.freeze({
    planetName: "app-group-info .group-info-container .group-text .name",
    timelineRoot: "app-main-content .main-content-container",
    timelineTopic: "app-main-content .main-content-container app-topic",
    timelineTalk:
      "app-main-content .main-content-container app-topic app-talk-content",
    stickyAncestor: "app-sticky-topic",
    topicHeader: ":scope > .topic-container app-topic-header",
    topicTalk: ":scope > .topic-container app-talk-content",
    author: ".info > .role",
    timestamp: ".info > .date",
    body: ":scope > .talk-content-container > .content",
    expandControl: ":scope > .talk-content-container > .showAll",
    topicExpandControl: "app-talk-content > .talk-content-container > .showAll",
    image: "app-image-gallery img",
    link: "a",
    detailPanel: ".topic-detail-panel",
    detailTopic: ".topic-detail-panel app-talk-content",
    detailHeader: ".topic-detail-panel app-topic-header",
    detailExpandControl:
      ".topic-detail-panel app-talk-content > .talk-content-container > .showAll",
  }),
});

export const ZSXQ_BROWSER_CONTRACT_V2 = Object.freeze({
  version: "zsxq-web-angular-v2",
  selectors: Object.freeze({
    ...ZSXQ_BROWSER_CONTRACT_V1.selectors,
    fileGallery: "app-file-gallery",
    fileItem: "app-file-gallery > .file-gallery-container > .item",
    fileItemWithinGallery: ":scope > .file-gallery-container > .item",
    fileName: ":scope > .file-name",
    filePdfIndicator: ":scope > .file-icon.file-pdf",
  }),
});

export const ZSXQ_BROWSER_CONTRACT_V3 = Object.freeze({
  version: "zsxq-web-angular-v3",
  selectors: Object.freeze({
    ...ZSXQ_BROWSER_CONTRACT_V2.selectors,
    imageGallery: "app-image-gallery",
    imageWithinGallery: ":scope img",
    imageGalleryDescendant: ":scope *",
  }),
});

export const ZSXQ_BROWSER_CONTRACT_V4 = Object.freeze({
  version: "zsxq-web-angular-v4",
  selectors: Object.freeze({
    ...ZSXQ_BROWSER_CONTRACT_V3.selectors,
    timestampReadCount: ":scope > .readed-count",
    timelineEnd: ":scope > .no-more",
  }),
});

export const ZSXQ_BROWSER_CONTRACT_V5 = Object.freeze({
  version: "zsxq-web-angular-v5",
  selectors: Object.freeze({
    ...ZSXQ_BROWSER_CONTRACT_V4.selectors,
    filePreviewRoot: "app-file-preview .file-preview-container",
    filePreviewName: ":scope .file > .file-name",
    fileDownloadControl: ":scope .file > .btn-wrapper > .btn.download",
  }),
});

export const ZSXQ_BROWSER_CONTRACT = Object.freeze({
  version: "zsxq-web-angular-v6",
  timestampReadCountOptional: true,
  selectors: Object.freeze({ ...ZSXQ_BROWSER_CONTRACT_V5.selectors }),
});

export const ZSXQ_REPAIR_NOTIFICATION =
  "知识星球采集检测到页面结构或加载行为与当前适配器不一致。"
  + "我已保存不含正文、签名参数和登录信息的诊断包；"
  + "接下来会自动诊断、修复、验证并从检查点继续，期间不会生成或覆盖最终报告。";

const CHECKPOINT_FILENAME = "browser-collector-checkpoint.json";
const REPAIR_HANDOFF_FILENAME = "browser-repair-handoff.json";
const NAVIGATION_ERROR_PATTERN = /Inspected target navigated or closed|Execution context was destroyed.*navigation/iu;
const DIRECT_BROWSER_ERROR_PATTERN = /permission|denied|unauthori[sz]ed|authenticat|sign.?in|log.?in|disconnect|not connected|connection (?:closed|lost|failed)|(?:browser|extension|target|tab).*(?:closed|unavailable)/iu;
const AUTOMATIC_REPAIR_ERROR_CODES = new Set([
  "BODY_EXTRACTOR_CROSS_CHECK_FAILED",
  "BODY_EXTRACTOR_DOM_CONTRACT_FAILED",
  "BODY_EXTRACTOR_TOPIC_COUNT_CHANGED",
  "COLLECTOR_RUNTIME_REFERENCE_ERROR",
  "CONTROL_INSIDE_BODY",
  "CONTROL_INSIDE_DETAIL_BODY",
  "DETAIL_EXPAND_CONTROL_CLICK_FAILED",
  "DETAIL_EXPAND_CONTROL_MISMATCH",
  "DETAIL_EXPANSION_NOT_STABLE",
  "DETAIL_FILE_ATTACHMENT_MISMATCH",
  "DETAIL_FILE_ATTACHMENT_OVERLAP",
  "DETAIL_FILE_GALLERY_ITEM_MISMATCH",
  "DETAIL_FIELD_MISMATCH",
  "DETAIL_IMAGE_GALLERY_ITEM_MISMATCH",
  "DETAIL_IMAGE_GALLERY_OVERFLOW_UNSUPPORTED",
  "DETAIL_ROOT_MISMATCH",
  "EXPAND_CONTROL_CLICK_FAILED",
  "EXPAND_CONTROL_MISMATCH",
  "EXPAND_INDEX_INVALID",
  "FILE_ATTACHMENT_MISMATCH",
  "FILE_ATTACHMENT_OVERLAP",
  "FILE_GALLERY_ITEM_MISMATCH",
  "IMAGE_GALLERY_ITEM_MISMATCH",
  "IMAGE_GALLERY_OVERFLOW_UNSUPPORTED",
  "TIMELINE_BODY_COUNT_DID_NOT_STABILIZE",
  "TIMELINE_CHRONOLOGY_INCONSISTENT",
  "TIMELINE_END_MARKER_MISMATCH",
  "TIMELINE_EXPANSION_NOT_STABLE",
  "TIMELINE_ROOT_MISMATCH",
  "TIMELINE_SCROLL_CONTROL_FAILED",
  "TIMELINE_SCROLL_CONTROL_UNAVAILABLE",
  "TIMESTAMP_FORMAT_MISMATCH",
  "TOPIC_CONTAINER_MISMATCH",
  "TOPIC_FIELD_MISMATCH",
]);

export class ZsxqBrowserCollectionError extends Error {
  constructor(code, phase, message, diagnostic = {}, options = {}) {
    super(message, options);
    this.name = "ZsxqBrowserCollectionError";
    this.code = code;
    this.phase = phase;
    this.diagnostic = diagnostic;
  }
}

/**
 * Read a strict, self-contained snapshot of the Knowledge Planet timeline.
 * This function is serialized into the authenticated page, so it must not
 * close over module state.
 */
export function inspectZsxqTimelinePage(input) {
  const adapter = input && input.adapter;
  if (!adapter || typeof adapter !== "object" || !adapter.selectors) {
    throw new TypeError("A versioned Knowledge Planet browser adapter is required");
  }

  const selectors = adapter.selectors;
  const fail = (code, selectorCounts, extra = {}) => ({
    ok: false,
    contractVersion: adapter.version,
    failure: { code, selectorCounts, ...extra },
  });
  const exactlyOne = (root, selector) => {
    const elements = [...root.querySelectorAll(selector)];
    return { elements, count: elements.length };
  };
  const text = (element) => typeof element.innerText === "string"
    ? element.innerText
    : "";
  const sourceFor = (element) => {
    if (typeof element.currentSrc === "string" && element.currentSrc) {
      return element.currentSrc;
    }
    return typeof element.src === "string" ? element.src : "";
  };
  const platformIdFor = (element) => {
    for (const attribute of ["data-id", "data-image-id", "data-file-id"]) {
      const value = typeof element.getAttribute === "function"
        ? element.getAttribute(attribute)
        : null;
      if (typeof value === "string" && value) {
        return value;
      }
    }
    return undefined;
  };
  const stablePageIdFor = (href) => {
    try {
      const parsed = new URL(href, location.href);
      const pathMatch = parsed.pathname.match(/\/topic\/(\d+)/u);
      return pathMatch?.[1]
        || parsed.searchParams.get("topic_id")
        || parsed.searchParams.get("topicId")
        || undefined;
    } catch {
      return undefined;
    }
  };
  const classifyLink = (href) => {
    try {
      const parsed = new URL(href, location.href);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return null;
      }
      if (/^\/tags(?:\/|$)/u.test(parsed.pathname)) {
        return null;
      }
      return /\.pdf$/iu.test(parsed.pathname) ? "pdf" : "web";
    } catch {
      return null;
    }
  };
  const follows = (left, right) => {
    if (left === right) {
      return 0;
    }
    if (typeof left.compareDocumentPosition === "function") {
      return left.compareDocumentPosition(right) & 4 ? -1 : 1;
    }
    return 0;
  };

  const planet = exactlyOne(document, selectors.planetName);
  const roots = exactlyOne(document, selectors.timelineRoot);
  const allTopics = [...document.querySelectorAll(selectors.timelineTopic)];
  const topics = allTopics
    .map((topic, domTopicIndex) => ({ topic, domTopicIndex }))
    .filter(
      ({ topic }) => !topic.closest || !topic.closest(selectors.stickyAncestor),
    );
  const baseCounts = {
    planetName: planet.count,
    timelineRoot: roots.count,
    timelineTopic: topics.length,
    excludedStickyTopic: allTopics.length - topics.length,
  };

  if (planet.count !== 1 || roots.count !== 1) {
    return fail("TIMELINE_ROOT_MISMATCH", baseCounts, {
      transient: planet.count === 0 && roots.count === 0,
    });
  }
  if (topics.length === 0) {
    return fail("TIMELINE_NOT_MOUNTED", baseCounts, { transient: true });
  }
  const timelineEndMarkers = typeof selectors.timelineEnd === "string"
    ? [...roots.elements[0].querySelectorAll(selectors.timelineEnd)]
    : [];
  if (
    timelineEndMarkers.length > 1
    || (
      timelineEndMarkers.length === 1
      && text(timelineEndMarkers[0]).trim() !== "没有更多了"
    )
  ) {
    return fail("TIMELINE_END_MARKER_MISMATCH", {
      ...baseCounts,
      timelineEnd: timelineEndMarkers.length,
    });
  }

  const topicSnapshots = [];
  let pendingImageCount = 0;
  let brokenImageCount = 0;
  for (let index = 0; index < topics.length; index += 1) {
    const { topic, domTopicIndex } = topics[index];
    const header = exactlyOne(topic, selectors.topicHeader);
    const talk = exactlyOne(topic, selectors.topicTalk);
    if (header.count !== 1 || talk.count !== 1) {
      return fail("TOPIC_CONTAINER_MISMATCH", {
        ...baseCounts,
        topicIndex: index,
        topicHeader: header.count,
        topicTalk: talk.count,
      });
    }

    const author = exactlyOne(header.elements[0], selectors.author);
    const timestamp = exactlyOne(header.elements[0], selectors.timestamp);
    const body = exactlyOne(talk.elements[0], selectors.body);
    const controls = [...talk.elements[0].querySelectorAll(selectors.expandControl)];
    const timestampReadCounts = typeof selectors.timestampReadCount === "string"
      && timestamp.count === 1
      ? [...timestamp.elements[0].querySelectorAll(selectors.timestampReadCount)]
      : [];
    const timestampText = typeof selectors.timestampReadCount === "string"
      ? [...(timestamp.elements[0]?.childNodes ?? [])]
          .filter((node) => Number(node.nodeType) === 3)
          .map((node) => typeof node.nodeValue === "string" ? node.nodeValue : "")
          .join("")
          .trim()
      : text(timestamp.elements[0]).trim();
    if (
      author.count !== 1
      || timestamp.count !== 1
      || body.count !== 1
      || controls.length > 1
      || (
        typeof selectors.timestampReadCount === "string"
        && (
          timestampReadCounts.length > 1
          || (
            adapter.timestampReadCountOptional !== true
            && timestampReadCounts.length !== 1
          )
        )
      )
      || text(author.elements[0]).trim() === ""
      || timestampText === ""
    ) {
      return fail("TOPIC_FIELD_MISMATCH", {
        ...baseCounts,
        topicIndex: index,
        author: author.count,
        timestamp: timestamp.count,
        ...(typeof selectors.timestampReadCount === "string"
          ? { timestampReadCount: timestampReadCounts.length }
          : {}),
        body: body.count,
        expandControl: controls.length,
      });
    }
    if (body.elements[0].querySelectorAll(":scope .showAll").length !== 0) {
      return fail("CONTROL_INSIDE_BODY", {
        ...baseCounts,
        topicIndex: index,
      });
    }

    const control = controls[0];
    let collapsed = false;
    if (control) {
      const style = window.getComputedStyle(control);
      const visible = style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity || 1) !== 0;
      collapsed = visible
        && Number(body.elements[0].scrollHeight) > Number(body.elements[0].clientHeight) + 1;
    }

    const images = [...talk.elements[0].querySelectorAll(selectors.image)];
    pendingImageCount += images.filter((image) => image.complete !== true).length;
    brokenImageCount += images.filter(
      (image) => image.complete === true
        && (Number(image.naturalWidth) < 1 || Number(image.naturalHeight) < 1),
    ).length;
    const imageGalleries = typeof selectors.imageGallery === "string"
      ? [...talk.elements[0].querySelectorAll(selectors.imageGallery)]
      : [];
    let galleryImageTotal = 0;
    for (
      let galleryIndex = 0;
      galleryIndex < imageGalleries.length;
      galleryIndex += 1
    ) {
      const gallery = imageGalleries[galleryIndex];
      const galleryImages = [
        ...gallery.querySelectorAll(selectors.imageWithinGallery),
      ];
      if (galleryImages.length === 0) {
        return fail("IMAGE_GALLERY_NOT_READY", {
          ...baseCounts,
          topicIndex: index,
          imageGallery: imageGalleries.length,
          galleryIndex,
        }, { transient: true });
      }
      galleryImageTotal += galleryImages.length;
      for (const node of gallery.querySelectorAll(selectors.imageGalleryDescendant)) {
        if (String(node.tagName || "").toUpperCase() === "IMG") {
          continue;
        }
        if (Number(node.childElementCount) !== 0) {
          continue;
        }
        const label = typeof node.innerText === "string"
          ? node.innerText
          : typeof node.textContent === "string"
            ? node.textContent
            : "";
        if (/^\+\s*\d+\s*$/u.test(label.trim())) {
          return fail("IMAGE_GALLERY_OVERFLOW_UNSUPPORTED", {
            ...baseCounts,
            topicIndex: index,
            imageGallery: imageGalleries.length,
            galleryIndex,
          });
        }
      }
    }
    if (
      typeof selectors.imageGallery === "string"
      && galleryImageTotal !== images.length
    ) {
      return fail("IMAGE_GALLERY_ITEM_MISMATCH", {
        ...baseCounts,
        topicIndex: index,
        imageGallery: imageGalleries.length,
        galleryImage: galleryImageTotal,
        timelineImage: images.length,
      });
    }
    const anchorElements = [...talk.elements[0].querySelectorAll(selectors.link)];
    const anchors = anchorElements
      .filter((anchor) => !anchor.querySelector(selectors.image))
      .map((anchor) => ({
        element: anchor,
        href: typeof anchor.href === "string" ? anchor.href : "",
        type: classifyLink(typeof anchor.href === "string" ? anchor.href : ""),
      }))
      .filter((entry) => entry.type !== null);
    const fileGalleries = typeof selectors.fileGallery === "string"
      ? [...talk.elements[0].querySelectorAll(selectors.fileGallery)]
      : [];
    const globalFileItems = typeof selectors.fileItem === "string"
      ? [...talk.elements[0].querySelectorAll(selectors.fileItem)]
      : [];
    const fileItems = [];
    for (let galleryIndex = 0; galleryIndex < fileGalleries.length; galleryIndex += 1) {
      const galleryItems = [
        ...fileGalleries[galleryIndex].querySelectorAll(selectors.fileItemWithinGallery),
      ];
      if (galleryItems.length === 0) {
        return fail("FILE_GALLERY_NOT_READY", {
          ...baseCounts,
          topicIndex: index,
          fileGallery: fileGalleries.length,
          galleryIndex,
          fileItem: globalFileItems.length,
        }, { transient: true });
      }
      fileItems.push(...galleryItems);
    }
    if (
      globalFileItems.length !== fileItems.length
      || new Set(fileItems).size !== fileItems.length
      || fileItems.some((item) => !globalFileItems.includes(item))
    ) {
      return fail("FILE_GALLERY_ITEM_MISMATCH", {
        ...baseCounts,
        topicIndex: index,
        fileGallery: fileGalleries.length,
        globalFileItem: globalFileItems.length,
        scopedFileItem: fileItems.length,
      });
    }
    const fileAnchorOverlapCount = anchorElements.filter((anchor) => fileItems.some(
      (item) => item === anchor
        || (typeof item.contains === "function" && item.contains(anchor))
        || (typeof anchor.contains === "function" && anchor.contains(item)),
    )).length;
    if (fileAnchorOverlapCount !== 0) {
      return fail("FILE_ATTACHMENT_OVERLAP", {
        ...baseCounts,
        topicIndex: index,
        fileItem: fileItems.length,
        fileAnchorOverlap: fileAnchorOverlapCount,
      });
    }
    const files = [];
    for (let fileIndex = 0; fileIndex < fileItems.length; fileIndex += 1) {
      const item = fileItems[fileIndex];
      const names = exactlyOne(item, selectors.fileName);
      const pdfIndicators = exactlyOne(item, selectors.filePdfIndicator);
      const filename = names.count === 1 ? text(names.elements[0]).trim() : "";
      if (
        names.count !== 1
        || pdfIndicators.count !== 1
        || filename === ""
        || !/\.pdf$/iu.test(filename)
      ) {
        return fail("FILE_ATTACHMENT_MISMATCH", {
          ...baseCounts,
          topicIndex: index,
          fileIndex,
          fileName: names.count,
          pdfIndicator: pdfIndicators.count,
        });
      }
      files.push({
        element: item,
        type: "pdf",
        filename,
      });
    }
    const ordered = [
      ...images.map((element, imageIndex) => ({
        element,
        type: "image",
        imageOrdinal: imageIndex + 1,
      })),
      ...anchors,
      ...files,
    ].sort((left, right) => follows(left.element, right.element));

    const attachments = ordered.map((entry, attachmentIndex) => {
      if (entry.type === "image") {
        const platformId = platformIdFor(entry.element);
        const transportUrl = sourceFor(entry.element);
        return {
          type: "image",
          source_ordinal: attachmentIndex + 1,
          image_ordinal: entry.imageOrdinal,
          topic_association_evidence:
            `expanded topic ${index + 1} app-image-gallery slot ${entry.imageOrdinal}`,
          source: {
            ...(platformId ? { platform_id: platformId } : {}),
            ...(transportUrl ? { transport_url: transportUrl } : {}),
          },
          browser_asset: {
            source: transportUrl,
            complete: entry.element.complete === true,
            natural_width: Number(entry.element.naturalWidth) || 0,
            natural_height: Number(entry.element.naturalHeight) || 0,
            rendered_width: Number(entry.element.getBoundingClientRect?.().width) || 0,
            rendered_height: Number(entry.element.getBoundingClientRect?.().height) || 0,
          },
        };
      }

      const stablePageId = stablePageIdFor(entry.href || "");
      let filename = entry.filename;
      if (entry.type === "pdf" && !filename) {
        try {
          filename = decodeURIComponent(new URL(entry.href, location.href).pathname.split("/").pop())
            || "未显示";
        } catch {
          filename = "未显示";
        }
      }
      return {
        type: entry.type,
        source_ordinal: attachmentIndex + 1,
        ...(entry.type === "web"
          ? {
              source: {},
              original_url: entry.href,
              ...(stablePageId ? { stable_page_id: stablePageId } : {}),
            }
          : {
              source: {
                ...(platformIdFor(entry.element)
                  ? { platform_id: platformIdFor(entry.element) }
                  : {}),
                ...(entry.href ? { transport_url: entry.href } : {}),
              },
              filename,
            }),
      };
    });

    const bodyText = text(body.elements[0]);
    topicSnapshots.push({
      dom_index: index,
      dom_topic_index: domTopicIndex,
      author: text(author.elements[0]).trim(),
      displayed_timestamp: timestampText,
      body: bodyText,
      collapsed,
      image_count: images.length,
      image_gallery_count: imageGalleries.length,
      attachments,
    });
  }

  if (pendingImageCount !== 0 || brokenImageCount !== 0) {
    return fail("TIMELINE_IMAGES_NOT_READY", {
      ...baseCounts,
      pendingImage: pendingImageCount,
      brokenImage: brokenImageCount,
    }, { transient: true });
  }

  const scrolling = document.scrollingElement || document.documentElement;
  return {
    ok: true,
    contractVersion: adapter.version,
    pageUrl: `${location.origin}${location.pathname}`,
    planetName: text(planet.elements[0]).trim(),
    topicCount: topicSnapshots.length,
    endReached: timelineEndMarkers.length === 1,
    topics: topicSnapshots,
    collapsedTopicIndices: topicSnapshots
      .filter((topic) => topic.collapsed)
      .map((topic) => topic.dom_index),
    collapsedTopicDomIndices: topicSnapshots
      .filter((topic) => topic.collapsed)
      .map((topic) => topic.dom_topic_index),
    scroll: {
      top: Number(scrolling?.scrollTop) || 0,
      height: Number(scrolling?.scrollHeight) || 0,
      viewport: Number(scrolling?.clientHeight) || 0,
    },
  };
}

/** Return to the top without attempting DOM methods unavailable in Chrome evaluation. */
export function prepareZsxqTimelinePage(input) {
  const adapter = input && input.adapter;
  if (!adapter || typeof adapter !== "object" || !adapter.selectors) {
    throw new TypeError("A versioned Knowledge Planet browser adapter is required");
  }
  if (input.scrollToTop === true) {
    window.scrollTo(0, 0);
  }

  const topics = [...document.querySelectorAll(adapter.selectors.timelineTopic)]
    .filter((topic) => !topic.closest || !topic.closest(adapter.selectors.stickyAncestor));
  return { topicCount: topics.length };
}

/** Read scroll metrics after the browser control layer performs a real End key. */
export function advanceZsxqTimelinePage(input) {
  const adapter = input && input.adapter;
  if (!adapter || typeof adapter !== "object" || !adapter.selectors) {
    throw new TypeError("A versioned Knowledge Planet browser adapter is required");
  }
  const scrolling = document.scrollingElement || document.documentElement;
  return {
    top: Number(scrolling?.scrollTop) || 0,
    height: Number(scrolling?.scrollHeight) || 0,
    viewport: Number(scrolling?.clientHeight) || 0,
  };
}

/** Collect content-free DOM evidence for an automatic adapter repair. */
export function collectZsxqDomDiagnostics(input) {
  const adapter = input && input.adapter;
  if (!adapter || typeof adapter !== "object" || !adapter.selectors) {
    throw new TypeError("A versioned Knowledge Planet browser adapter is required");
  }
  const selectorCounts = {};
  for (const [name, selector] of Object.entries(adapter.selectors)) {
    try {
      selectorCounts[name] = document.querySelectorAll(selector).length;
    } catch {
      selectorCounts[name] = "invalid-selector";
    }
  }

  const appTagCounts = {};
  for (const element of document.querySelectorAll("*")) {
    const tag = String(element.tagName || "").toLowerCase();
    if (tag.startsWith("app-")) {
      appTagCounts[tag] = (appTagCounts[tag] || 0) + 1;
    }
  }

  const outline = [...document.querySelectorAll("app-main-content, .topic-detail-panel")]
    .slice(0, 3)
    .map((root) => {
      const nodes = [root, ...root.querySelectorAll(":scope > *")].slice(0, 16);
      return nodes.map((element) => ({
        tag: String(element.tagName || "").toLowerCase(),
        classes: [...(element.classList || [])].slice(0, 8),
        childElementCount: Number(element.childElementCount) || 0,
      }));
    });

  return {
    contractVersion: adapter.version,
    pageUrl: `${location.origin}${location.pathname}`,
    selectorCounts,
    appTagCounts,
    outline,
  };
}

/** Strict detail-page inventory after the dedicated readiness helper succeeds. */
export function inspectZsxqDetailPage(input) {
  const adapter = input && input.adapter;
  if (!adapter || typeof adapter !== "object" || !adapter.selectors) {
    throw new TypeError("A versioned Knowledge Planet browser adapter is required");
  }
  const selectors = adapter.selectors;
  const panels = [...document.querySelectorAll(selectors.detailPanel)];
  const talks = [...document.querySelectorAll(selectors.detailTopic)];
  const headers = [...document.querySelectorAll(selectors.detailHeader)];
  if (panels.length !== 1 || talks.length !== 1 || headers.length !== 1) {
    return {
      ok: false,
      contractVersion: adapter.version,
      failure: {
        code: "DETAIL_ROOT_MISMATCH",
        selectorCounts: {
          detailPanel: panels.length,
          detailTopic: talks.length,
          detailHeader: headers.length,
        },
      },
    };
  }
  const authors = [...headers[0].querySelectorAll(selectors.author)];
  const timestamps = [...headers[0].querySelectorAll(selectors.timestamp)];
  const bodies = [...talks[0].querySelectorAll(selectors.body)];
  const timestampReadCounts = typeof selectors.timestampReadCount === "string"
    && timestamps.length === 1
    ? [...timestamps[0].querySelectorAll(selectors.timestampReadCount)]
    : [];
  const timestampText = typeof selectors.timestampReadCount === "string"
    ? [...(timestamps[0]?.childNodes ?? [])]
        .filter((node) => Number(node.nodeType) === 3)
        .map((node) => typeof node.nodeValue === "string" ? node.nodeValue : "")
        .join("")
        .trim()
    : typeof timestamps[0]?.innerText === "string"
      ? timestamps[0].innerText.trim()
      : "";
  if (
    authors.length !== 1
    || timestamps.length !== 1
    || bodies.length !== 1
    || (
      typeof selectors.timestampReadCount === "string"
      && (
        timestampReadCounts.length > 1
        || (
          adapter.timestampReadCountOptional !== true
          && timestampReadCounts.length !== 1
        )
      )
    )
    || typeof authors[0]?.innerText !== "string"
    || authors[0].innerText.trim() === ""
    || timestampText === ""
  ) {
    return {
      ok: false,
      contractVersion: adapter.version,
      failure: {
        code: "DETAIL_FIELD_MISMATCH",
        selectorCounts: {
          author: authors.length,
          timestamp: timestamps.length,
          ...(typeof selectors.timestampReadCount === "string"
            ? { timestampReadCount: timestampReadCounts.length }
            : {}),
          body: bodies.length,
        },
      },
    };
  }
  if (bodies[0].querySelectorAll(":scope .showAll").length !== 0) {
    return {
      ok: false,
      contractVersion: adapter.version,
      failure: { code: "CONTROL_INSIDE_DETAIL_BODY", selectorCounts: {} },
    };
  }

  const detailFail = (code, selectorCounts, extra = {}) => ({
    ok: false,
    contractVersion: adapter.version,
    failure: { code, selectorCounts, ...extra },
  });
  const detailText = (element) => typeof element.innerText === "string"
    ? element.innerText
    : "";
  const detailPlatformIdFor = (element) => {
    for (const attribute of ["data-id", "data-image-id", "data-file-id"]) {
      const value = typeof element.getAttribute === "function"
        ? element.getAttribute(attribute)
        : null;
      if (typeof value === "string" && value) {
        return value;
      }
    }
    return undefined;
  };
  const detailFollows = (left, right) => {
    if (left === right) {
      return 0;
    }
    if (typeof left.compareDocumentPosition === "function") {
      return left.compareDocumentPosition(right) & 4 ? -1 : 1;
    }
    return 0;
  };

  const imageElements = [...talks[0].querySelectorAll(selectors.image)];
  const imageGalleries = typeof selectors.imageGallery === "string"
    ? [...talks[0].querySelectorAll(selectors.imageGallery)]
    : [];
  let galleryImageTotal = 0;
  for (
    let galleryIndex = 0;
    galleryIndex < imageGalleries.length;
    galleryIndex += 1
  ) {
    const gallery = imageGalleries[galleryIndex];
    const galleryImages = [
      ...gallery.querySelectorAll(selectors.imageWithinGallery),
    ];
    if (galleryImages.length === 0) {
      return detailFail("DETAIL_IMAGE_GALLERY_NOT_READY", {
        imageGallery: imageGalleries.length,
        galleryIndex,
      }, { transient: true });
    }
    galleryImageTotal += galleryImages.length;
    for (const node of gallery.querySelectorAll(selectors.imageGalleryDescendant)) {
      if (String(node.tagName || "").toUpperCase() === "IMG") {
        continue;
      }
      if (Number(node.childElementCount) !== 0) {
        continue;
      }
      const label = typeof node.innerText === "string"
        ? node.innerText
        : typeof node.textContent === "string"
          ? node.textContent
          : "";
      if (/^\+\s*\d+\s*$/u.test(label.trim())) {
        return detailFail("DETAIL_IMAGE_GALLERY_OVERFLOW_UNSUPPORTED", {
          imageGallery: imageGalleries.length,
          galleryIndex,
        });
      }
    }
  }
  if (
    typeof selectors.imageGallery === "string"
    && galleryImageTotal !== imageElements.length
  ) {
    return detailFail("DETAIL_IMAGE_GALLERY_ITEM_MISMATCH", {
      imageGallery: imageGalleries.length,
      galleryImage: galleryImageTotal,
      detailImage: imageElements.length,
    });
  }

  const anchorElements = [...talks[0].querySelectorAll(selectors.link)];
  const fileGalleries = typeof selectors.fileGallery === "string"
    ? [...talks[0].querySelectorAll(selectors.fileGallery)]
    : [];
  const globalFileItems = typeof selectors.fileItem === "string"
    ? [...talks[0].querySelectorAll(selectors.fileItem)]
    : [];
  const fileItems = [];
  for (
    let galleryIndex = 0;
    galleryIndex < fileGalleries.length;
    galleryIndex += 1
  ) {
    const galleryItems = [
      ...fileGalleries[galleryIndex].querySelectorAll(selectors.fileItemWithinGallery),
    ];
    if (galleryItems.length === 0) {
      return detailFail("DETAIL_FILE_GALLERY_NOT_READY", {
        fileGallery: fileGalleries.length,
        galleryIndex,
        fileItem: globalFileItems.length,
      }, { transient: true });
    }
    fileItems.push(...galleryItems);
  }
  if (
    globalFileItems.length !== fileItems.length
    || new Set(fileItems).size !== fileItems.length
    || fileItems.some((item) => !globalFileItems.includes(item))
  ) {
    return detailFail("DETAIL_FILE_GALLERY_ITEM_MISMATCH", {
      fileGallery: fileGalleries.length,
      globalFileItem: globalFileItems.length,
      scopedFileItem: fileItems.length,
    });
  }
  const fileAnchorOverlapCount = anchorElements.filter((anchor) => fileItems.some(
    (item) => item === anchor
      || (typeof item.contains === "function" && item.contains(anchor))
      || (typeof anchor.contains === "function" && anchor.contains(item)),
  )).length;
  if (fileAnchorOverlapCount !== 0) {
    return detailFail("DETAIL_FILE_ATTACHMENT_OVERLAP", {
      fileItem: fileItems.length,
      fileAnchorOverlap: fileAnchorOverlapCount,
    });
  }
  const fileEntries = [];
  for (let fileIndex = 0; fileIndex < fileItems.length; fileIndex += 1) {
    const item = fileItems[fileIndex];
    const names = [...item.querySelectorAll(selectors.fileName)];
    const pdfIndicators = [...item.querySelectorAll(selectors.filePdfIndicator)];
    const filename = names.length === 1 ? detailText(names[0]).trim() : "";
    if (
      names.length !== 1
      || pdfIndicators.length !== 1
      || filename === ""
      || !/\.pdf$/iu.test(filename)
    ) {
      return detailFail("DETAIL_FILE_ATTACHMENT_MISMATCH", {
        fileIndex,
        fileName: names.length,
        pdfIndicator: pdfIndicators.length,
      });
    }
    fileEntries.push({ element: item, filename });
  }

  const orderedMedia = [
    ...imageElements.map((element, index) => ({
      element,
      kind: "image",
      image_ordinal: index + 1,
    })),
    ...fileEntries.map((entry, index) => ({
      element: entry.element,
      kind: "pdf",
      file_ordinal: index + 1,
      filename: entry.filename,
    })),
  ].sort((left, right) => detailFollows(left.element, right.element));

  const images = [];
  const files = [];
  for (let mediaIndex = 0; mediaIndex < orderedMedia.length; mediaIndex += 1) {
    const entry = orderedMedia[mediaIndex];
    if (entry.kind === "image") {
      const image = entry.element;
      images.push({
        image_ordinal: entry.image_ordinal,
        dom_ordinal: mediaIndex + 1,
        source: typeof image.currentSrc === "string" && image.currentSrc
          ? image.currentSrc
          : typeof image.src === "string"
            ? image.src
            : "",
        complete: image.complete === true,
        natural_width: Number(image.naturalWidth) || 0,
        natural_height: Number(image.naturalHeight) || 0,
        rendered_width: Number(image.getBoundingClientRect?.().width) || 0,
        rendered_height: Number(image.getBoundingClientRect?.().height) || 0,
      });
    } else {
      const platformId = detailPlatformIdFor(entry.element);
      files.push({
        type: "pdf",
        file_ordinal: entry.file_ordinal,
        dom_ordinal: mediaIndex + 1,
        filename: entry.filename,
        ...(platformId ? { platform_id: platformId } : {}),
      });
    }
  }
  let topicId;
  try {
    const currentUrl = new URL(location.href);
    topicId = currentUrl.pathname.match(/\/topic\/(\d+)/u)?.[1]
      || currentUrl.searchParams.get("topic_id")
      || currentUrl.searchParams.get("topicId")
      || undefined;
  } catch {
    topicId = undefined;
  }
  const controls = [...talks[0].querySelectorAll(selectors.expandControl)];
  if (controls.length > 1) {
    return {
      ok: false,
      contractVersion: adapter.version,
      failure: {
        code: "DETAIL_EXPAND_CONTROL_MISMATCH",
        selectorCounts: { expandControl: controls.length },
      },
    };
  }
  let collapsed = false;
  if (controls.length === 1) {
    const style = window.getComputedStyle(controls[0]);
    const visible = style.display !== "none"
      && style.visibility !== "hidden"
      && Number(style.opacity || 1) !== 0;
    collapsed = visible
      && Number(bodies[0].scrollHeight) > Number(bodies[0].clientHeight) + 1;
  }
  return {
    ok: true,
    contractVersion: adapter.version,
    pageUrl: `${location.origin}${location.pathname}`,
    topicId,
    author: typeof authors[0].innerText === "string" ? authors[0].innerText.trim() : "",
    displayed_timestamp: timestampText,
    body: typeof bodies[0].innerText === "string" ? bodies[0].innerText : "",
    collapsed,
    image_gallery_count: imageGalleries.length,
    images,
    files,
  };
}

function assertTab(tab) {
  if (
    tab === null
    || typeof tab !== "object"
    || tab.playwright === null
    || typeof tab.playwright !== "object"
    || typeof tab.playwright.evaluate !== "function"
    || typeof tab.playwright.locator !== "function"
  ) {
    throw new TypeError(
      "Pass an authenticated browser tab with playwright.evaluate and playwright.locator",
    );
  }
}

/** Download one inventoried timeline PDF through the official member UI. */
export async function downloadZsxqTimelinePdfOnTab(tab, input) {
  assertTab(tab);
  if (typeof tab.playwright.waitForEvent !== "function") {
    throw new TypeError("The browser tab must support download events");
  }
  if (input === null || typeof input !== "object") {
    throw new TypeError("Pass an inventoried timeline PDF occurrence");
  }
  const { topicDomIndex, fileOrdinal, expectedFilename } = input;
  if (!Number.isInteger(topicDomIndex) || topicDomIndex < 0) {
    throw new TypeError("topicDomIndex must be a non-negative integer");
  }
  if (!Number.isInteger(fileOrdinal) || fileOrdinal < 1) {
    throw new TypeError("fileOrdinal must be a positive integer");
  }
  if (
    typeof expectedFilename !== "string"
    || expectedFilename.trim() === ""
    || !/\.pdf$/iu.test(expectedFilename)
  ) {
    throw new TypeError("expectedFilename must be a non-empty PDF filename");
  }

  const adapter = ZSXQ_BROWSER_CONTRACT;
  const selectors = adapter.selectors;
  const topic = tab.playwright.locator(selectors.timelineTopic).nth(topicDomIndex);
  const talk = topic.locator(selectors.topicTalk);
  const fileItems = talk.locator(selectors.fileItem);
  const fileCount = await fileItems.count();
  if (fileOrdinal > fileCount) {
    throw new ZsxqBrowserCollectionError(
      "PDF_FILE_OCCURRENCE_MISMATCH",
      "pdf-download",
      "The inventoried timeline PDF occurrence is no longer present",
      { topicDomIndex, fileOrdinal, fileCount },
    );
  }
  const fileCard = fileItems.nth(fileOrdinal - 1);
  const cardNames = fileCard.locator(selectors.fileName);
  const cardNameCount = await cardNames.count();
  const observedCardName = cardNameCount === 1
    ? (await cardNames.innerText()).trim()
    : "";
  if (cardNameCount !== 1 || observedCardName !== expectedFilename) {
    throw new ZsxqBrowserCollectionError(
      "PDF_FILE_IDENTITY_MISMATCH",
      "pdf-download",
      "The selected timeline file card does not match the inventoried PDF",
      {
        topicDomIndex,
        fileOrdinal,
        fileNameCount: cardNameCount,
        filenameMatched: observedCardName === expectedFilename,
      },
    );
  }

  try {
    await fileCard.click();
  } catch (error) {
    if (directBrowserError(error)) throw error;
    throw new ZsxqBrowserCollectionError(
      "PDF_PREVIEW_OPEN_FAILED",
      "pdf-download",
      "The official Knowledge Planet file preview could not be opened",
      { topicDomIndex, fileOrdinal },
      { cause: error },
    );
  }

  const timeoutMs = input.timeoutMs ?? 8_000;
  const pollIntervalMs = input.pollIntervalMs ?? 150;
  const deadline = Date.now() + timeoutMs;
  let preview;
  let previewName;
  let downloadControl;
  while (Date.now() <= deadline) {
    preview = tab.playwright.locator(selectors.filePreviewRoot);
    if (await preview.count() === 1) {
      const names = preview.locator(selectors.filePreviewName);
      const controls = preview.locator(selectors.fileDownloadControl);
      if (await names.count() === 1 && await controls.count() === 1) {
        previewName = (await names.innerText()).trim();
        downloadControl = controls;
        break;
      }
    }
    await delay(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
  }
  if (!downloadControl || previewName !== expectedFilename) {
    throw new ZsxqBrowserCollectionError(
      "PDF_DOWNLOAD_CONTROL_MISMATCH",
      "pdf-download",
      "The official file preview did not expose one matching download control",
      {
        topicDomIndex,
        fileOrdinal,
        filenameMatched: previewName === expectedFilename,
      },
    );
  }
  const controlText = (await downloadControl.innerText()).trim();
  const controlVisible = typeof downloadControl.isVisible === "function"
    ? await downloadControl.isVisible()
    : false;
  if (controlText !== "下载文件" || controlVisible !== true) {
    throw new ZsxqBrowserCollectionError(
      "PDF_DOWNLOAD_CONTROL_MISMATCH",
      "pdf-download",
      "The official file preview download control is not exact and visible",
      {
        topicDomIndex,
        fileOrdinal,
        downloadControlTextMatched: controlText === "下载文件",
        downloadControlVisible: controlVisible,
      },
    );
  }

  try {
    const downloadPromise = tab.playwright.waitForEvent("download", { timeoutMs });
    const [download] = await Promise.all([downloadPromise, downloadControl.click()]);
    return {
      download,
      filename: expectedFilename,
      acquisition: "official-ui-download",
      contract_version: adapter.version,
    };
  } catch (error) {
    if (directBrowserError(error)) throw error;
    throw new ZsxqBrowserCollectionError(
      "PDF_DOWNLOAD_FAILED",
      "pdf-download",
      "The official Knowledge Planet PDF download did not complete",
      { topicDomIndex, fileOrdinal },
      { cause: error },
    );
  }
}

function assertCollectorInput(input) {
  if (input === null || typeof input !== "object") {
    throw new TypeError("Pass Knowledge Planet collector options");
  }
  if (typeof input.planetName !== "string" || input.planetName.trim() === "") {
    throw new TypeError("planetName must be a non-empty exact name");
  }
  if (typeof input.planetUrl !== "string") {
    throw new TypeError("planetUrl must be a Knowledge Planet group URL");
  }
  const planetUrl = new URL(input.planetUrl);
  if (planetUrl.protocol !== "https:" || planetUrl.hostname !== "wx.zsxq.com") {
    throw new TypeError("planetUrl must use https://wx.zsxq.com");
  }
  if (!/^\/group\/[^/]+\/?$/u.test(planetUrl.pathname)) {
    throw new TypeError("planetUrl must be a canonical Knowledge Planet group URL");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.targetDate)) {
    throw new TypeError("targetDate must use YYYY-MM-DD");
  }
  const [year, month, day] = input.targetDate.split("-").map(Number);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (
    parsedDate.getUTCFullYear() !== year
    || parsedDate.getUTCMonth() !== month - 1
    || parsedDate.getUTCDate() !== day
  ) {
    throw new TypeError("targetDate must be a real calendar date");
  }
  if (
    input.filtersClearedConfirmed !== undefined
    && typeof input.filtersClearedConfirmed !== "boolean"
  ) {
    throw new TypeError("filtersClearedConfirmed must be a boolean when supplied");
  }
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

function thrownMessage(error) {
  if (
    error !== null
    && typeof error === "object"
    && !Array.isArray(error)
    && typeof error.message === "string"
  ) {
    return error.message;
  }
  return String(error);
}

function directBrowserError(error) {
  const name = error !== null
    && typeof error === "object"
    && !Array.isArray(error)
    && typeof error.name === "string"
    ? error.name
    : "";
  return DIRECT_BROWSER_ERROR_PATTERN.test(`${name} ${thrownMessage(error)}`);
}

async function assertTabReachable(tab, navigationError) {
  if (typeof tab.url !== "function") {
    return;
  }
  let currentUrl;
  try {
    currentUrl = await tab.url();
  } catch (error) {
    throw error;
  }
  if (typeof currentUrl !== "string" || currentUrl === "") {
    throw navigationError;
  }
}

async function assertTimelinePageAccess(tab, expectedUrl) {
  if (typeof tab.url !== "function") {
    return;
  }
  const currentUrl = await tab.url();
  if (
    typeof currentUrl !== "string"
    || sanitizedUrl(currentUrl) !== sanitizedUrl(expectedUrl)
  ) {
    throw new Error(
      "Knowledge Planet authentication or group access is required in the connected Chrome tab",
    );
  }
}

async function assertDetailPageAccess(tab) {
  if (typeof tab.url !== "function") {
    return;
  }
  const currentUrl = await tab.url();
  let parsed;
  try {
    parsed = new URL(currentUrl);
  } catch {
    parsed = undefined;
  }
  if (
    !parsed
    || parsed.protocol !== "https:"
    || parsed.hostname !== "wx.zsxq.com"
    || !topicIdFromUrl(currentUrl)
  ) {
    throw new Error(
      "Knowledge Planet authentication or topic access is required in the connected Chrome tab",
    );
  }
}

async function evaluateWithNavigationRecovery(tab, pageFunction, input, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const pollIntervalMs = options.pollIntervalMs ?? 150;
  const deadline = Date.now() + timeoutMs;
  let lastNavigationError;
  while (true) {
    try {
      return await tab.playwright.evaluate(pageFunction, input);
    } catch (error) {
      const message = thrownMessage(error);
      if (!NAVIGATION_ERROR_PATTERN.test(message)) {
        throw error;
      }
      await assertTabReachable(tab, error);
      lastNavigationError = error;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new ZsxqBrowserCollectionError(
        "NAVIGATION_DID_NOT_STABILIZE",
        options.phase ?? "navigation",
        `Knowledge Planet navigation did not stabilize within ${timeoutMs}ms`,
        { navigationRetriesExhausted: true },
        { cause: lastNavigationError },
      );
    }
    await delay(Math.min(pollIntervalMs, remaining));
  }
}

export async function expandZsxqTimelineTopicsOnTab(
  tab,
  snapshot,
  adapter = ZSXQ_BROWSER_CONTRACT,
  targetDate,
) {
  assertTab(tab);
  if (
    snapshot === null
    || typeof snapshot !== "object"
    || !Array.isArray(snapshot.collapsedTopicDomIndices)
    || !Array.isArray(snapshot.topics)
  ) {
    throw new TypeError("Pass a strict timeline snapshot with collapsed topic indices");
  }
  if (targetDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/u.test(targetDate)) {
    throw new TypeError("targetDate must use YYYY-MM-DD when supplied");
  }
  const collapsedTopicDomIndices = targetDate === undefined
    ? snapshot.collapsedTopicDomIndices
    : snapshot.topics
        .filter(
          (topic) => topic.collapsed === true
            && topic.displayed_timestamp.startsWith(`${targetDate} `),
        )
        .map((topic) => topic.dom_topic_index);
  let expandedCount = 0;
  for (const domTopicIndex of collapsedTopicDomIndices) {
    if (!Number.isInteger(domTopicIndex) || domTopicIndex < 0) {
      throw new ZsxqBrowserCollectionError(
        "EXPAND_INDEX_INVALID",
        "timeline-expand",
        "The timeline snapshot contains an invalid expand-control index",
      );
    }
    const control = tab.playwright
      .locator(adapter.selectors.timelineTopic)
      .nth(domTopicIndex)
      .locator(adapter.selectors.topicExpandControl);
    const count = await control.count();
    if (count !== 1) {
      throw new ZsxqBrowserCollectionError(
        "EXPAND_CONTROL_MISMATCH",
        "timeline-expand",
        "A geometrically collapsed topic does not have exactly one browser control",
        { domTopicIndex, expandControlCount: count },
      );
    }
    try {
      await control.click();
    } catch (error) {
      if (directBrowserError(error)) {
        throw error;
      }
      throw new ZsxqBrowserCollectionError(
        "EXPAND_CONTROL_CLICK_FAILED",
        "timeline-expand",
        "The browser control layer could not expand a collapsed topic",
        { domTopicIndex, expandControlCount: count },
        { cause: error },
      );
    }
    expandedCount += 1;
  }
  return { expandedCount };
}

export async function advanceZsxqTimelineOnTab(
  tab,
  adapter = ZSXQ_BROWSER_CONTRACT,
) {
  assertTab(tab);
  const body = tab.playwright.locator("body");
  const count = await body.count();
  if (count !== 1 || typeof body.press !== "function") {
    throw new ZsxqBrowserCollectionError(
      "TIMELINE_SCROLL_CONTROL_UNAVAILABLE",
      "timeline-pagination",
      "The browser control layer cannot send a real End key to the page",
      { bodyCount: count, pressAvailable: typeof body.press === "function" },
    );
  }
  try {
    await body.press("End");
  } catch (error) {
    if (directBrowserError(error)) {
      throw error;
    }
    throw new ZsxqBrowserCollectionError(
      "TIMELINE_SCROLL_CONTROL_FAILED",
      "timeline-pagination",
      "The browser control layer could not scroll the timeline",
      { bodyCount: count },
      { cause: error },
    );
  }
  return evaluateWithNavigationRecovery(
    tab,
    advanceZsxqTimelinePage,
    { adapter },
    { phase: "timeline-pagination" },
  );
}

function collapsedTopicCountForDate(snapshot, targetDate) {
  return snapshot.topics.filter(
    (topic) => topic.collapsed === true
      && topic.displayed_timestamp.startsWith(`${targetDate} `),
  ).length;
}

async function expandTargetDateUntilStable(tab, snapshot, options) {
  let current = snapshot;
  const maxExpansionRounds = options.maxExpansionRounds ?? 10;
  for (let round = 0; round < maxExpansionRounds; round += 1) {
    const collapsedCount = collapsedTopicCountForDate(current, options.targetDate);
    if (collapsedCount === 0) {
      return current;
    }
    await expandZsxqTimelineTopicsOnTab(
      tab,
      current,
      options.adapter,
      options.targetDate,
    );
    current = await waitForStableTimeline(tab, {
      adapter: options.adapter,
      timeoutMs: options.timeoutMs,
      pollIntervalMs: options.pollIntervalMs,
      phase: "timeline-expand",
    });
  }
  throw new ZsxqBrowserCollectionError(
    "TIMELINE_EXPANSION_NOT_STABLE",
    "timeline-expand",
    "One or more target-date topic bodies remained collapsed after bounded browser clicks",
    {
      collapsedTopicCount: collapsedTopicCountForDate(current, options.targetDate),
      maxExpansionRounds,
    },
  );
}

async function expandZsxqDetailOnTab(tab, snapshot, adapter) {
  if (snapshot.collapsed !== true) {
    return { expandedCount: 0 };
  }
  const control = tab.playwright.locator(adapter.selectors.detailExpandControl);
  const count = await control.count();
  if (count !== 1) {
    throw new ZsxqBrowserCollectionError(
      "DETAIL_EXPAND_CONTROL_MISMATCH",
      "detail-expand",
      "A geometrically collapsed detail body does not have exactly one browser control",
      { expandControlCount: count },
    );
  }
  try {
    await control.click();
  } catch (error) {
    if (directBrowserError(error)) {
      throw error;
    }
    throw new ZsxqBrowserCollectionError(
      "DETAIL_EXPAND_CONTROL_CLICK_FAILED",
      "detail-expand",
      "The browser control layer could not expand the detail body",
      { expandControlCount: count },
      { cause: error },
    );
  }
  return { expandedCount: 1 };
}

function snapshotSignature(snapshot) {
  return JSON.stringify([
    snapshot.contractVersion,
    snapshot.pageUrl,
    snapshot.planetName,
    snapshot.endReached,
    snapshot.topics,
    snapshot.scroll.height,
  ]);
}

async function waitForStableTimeline(tab, options = {}) {
  const timeoutMs = options.timeoutMs ?? 8_000;
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const stableSamples = options.stableSamples ?? 2;
  const deadline = Date.now() + timeoutMs;
  let previousSignature;
  let consecutiveStable = 0;
  let lastFailure;
  let lastSnapshot;
  let nextProgressRetryAt = Date.now() + (options.progressRetryMs ?? 1_000);
  let progressRetryCount = 0;

  while (true) {
    const snapshot = await evaluateWithNavigationRecovery(
      tab,
      inspectZsxqTimelinePage,
      { adapter: options.adapter },
      { timeoutMs: Math.max(1, deadline - Date.now()), phase: options.phase },
    );
    if (!snapshot.ok) {
      lastFailure = snapshot.failure;
      if (snapshot.failure.transient !== true) {
        throw new ZsxqBrowserCollectionError(
          snapshot.failure.code,
          options.phase,
          "Knowledge Planet DOM does not match the active browser contract",
          snapshot.failure,
        );
      }
      consecutiveStable = 0;
      previousSignature = undefined;
    } else {
      lastSnapshot = snapshot;
      if (
        options.minimumTopicCount === undefined
        || snapshot.topicCount >= options.minimumTopicCount
        || snapshot.endReached === true
      ) {
        const signature = snapshotSignature(snapshot);
        consecutiveStable = signature === previousSignature ? consecutiveStable + 1 : 1;
        previousSignature = signature;
        if (consecutiveStable >= stableSamples) {
          return snapshot;
        }
      } else {
        consecutiveStable = 0;
        previousSignature = undefined;
      }
    }

    if (
      typeof options.progressAction === "function"
      && options.minimumTopicCount !== undefined
      && (lastSnapshot?.topicCount ?? 0) < options.minimumTopicCount
      && lastSnapshot?.endReached !== true
      && Date.now() >= nextProgressRetryAt
    ) {
      await options.progressAction();
      progressRetryCount += 1;
      nextProgressRetryAt = Date.now() + (options.progressRetryMs ?? 1_000);
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new ZsxqBrowserCollectionError(
        "TIMELINE_DID_NOT_STABILIZE",
        options.phase,
        `Knowledge Planet timeline did not stabilize within ${timeoutMs}ms`,
        {
          ...(lastFailure ? { lastFailure } : {}),
          lastTopicCount: lastSnapshot?.topicCount ?? 0,
          minimumTopicCount: options.minimumTopicCount,
          progressRetryCount,
        },
      );
    }
    await delay(Math.min(pollIntervalMs, remaining));
  }
}

function parseDisplayedTimestamp(displayedTimestamp) {
  const match = displayedTimestamp.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/u,
  );
  if (!match) {
    throw new ZsxqBrowserCollectionError(
      "TIMESTAMP_FORMAT_MISMATCH",
      "timeline-validation",
      "Knowledge Planet displayed timestamp format is unsupported",
      { expectedFormat: "YYYY-MM-DD HH:mm[:ss]" },
    );
  }
  const [, year, month, day, hour, minute, second = "00"] = match;
  const numeric = [year, month, day, hour, minute, second].map(Number);
  const calendarValue = new Date(Date.UTC(
    numeric[0],
    numeric[1] - 1,
    numeric[2],
    numeric[3],
    numeric[4],
    numeric[5],
  ));
  if (
    calendarValue.getUTCFullYear() !== numeric[0]
    || calendarValue.getUTCMonth() !== numeric[1] - 1
    || calendarValue.getUTCDate() !== numeric[2]
    || calendarValue.getUTCHours() !== numeric[3]
    || calendarValue.getUTCMinutes() !== numeric[4]
    || calendarValue.getUTCSeconds() !== numeric[5]
  ) {
    throw new ZsxqBrowserCollectionError(
      "TIMESTAMP_VALUE_INVALID",
      "timeline-validation",
      "Knowledge Planet displayed timestamp is invalid",
    );
  }
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}${ZSXQ_UTC_OFFSET}`;
  const milliseconds = Date.parse(iso);
  if (!Number.isFinite(milliseconds)) {
    throw new ZsxqBrowserCollectionError(
      "TIMESTAMP_VALUE_INVALID",
      "timeline-validation",
      "Knowledge Planet displayed timestamp is invalid",
    );
  }
  return { iso, date: beijingDateFromTimestamp(iso), milliseconds };
}

export function timelineCoverageBoundaryReached({
  oldestPlatformDate,
  targetDate,
  endReached,
}) {
  return endReached === true || oldestPlatformDate < targetDate;
}

function normalizeTimelineTopics(snapshot) {
  const normalized = snapshot.topics.map((topic, index) => {
    const parsedTimestamp = parseDisplayedTimestamp(topic.displayed_timestamp);
    const attachments = topic.attachments.map((attachment) => {
      if (attachment.type !== "image") {
        return attachment;
      }
      const inventoryAttachment = { ...attachment };
      delete inventoryAttachment.browser_asset;
      return inventoryAttachment;
    });
    return {
      source_order: index + 1,
      source: {},
      author: topic.author,
      timestamp: parsedTimestamp.iso,
      platform_date: parsedTimestamp.date,
      body: topic.body === ""
        ? { status: "empty" }
        : { status: "present", payload: topic.body },
      image_count: topic.image_count,
      image_count_evidence:
        `${topic.image_count} img slot(s) across ${topic.image_gallery_count ?? 0} `
        + "app-image-gallery gallery(ies) verified without an overflow indicator "
        + "in the expanded topic container",
      attachments,
      browser_assets: topic.attachments
        .filter((attachment) => attachment.type === "image")
        .map((attachment) => attachment.browser_asset),
      _timestampMilliseconds: parsedTimestamp.milliseconds,
    };
  });

  for (let index = 1; index < normalized.length; index += 1) {
    if (
      normalized[index]._timestampMilliseconds
      > normalized[index - 1]._timestampMilliseconds
    ) {
      throw new ZsxqBrowserCollectionError(
        "TIMELINE_CHRONOLOGY_INCONSISTENT",
        "timeline-validation",
        "Knowledge Planet non-pinned topics are not newest first",
        { previousIndex: index - 1, currentIndex: index },
      );
    }
  }
  return normalized;
}

function publicTopic(topic) {
  const result = { ...topic };
  delete result.platform_date;
  delete result._timestampMilliseconds;
  return result;
}

function inventoryTopic(topic) {
  const result = publicTopic(topic);
  delete result.browser_assets;
  return result;
}

export function buildZsxqRunnerInventory(topics) {
  return { topics: topics.map(inventoryTopic) };
}

/**
 * Project a normalized topic onto the fields that stay stable across page
 * reloads. Signed transport URLs rotate their query parameters between
 * sessions, so checkpoint storage and every prefix comparison strip queries
 * and fragments; topic identity remains author, timestamp, body, and the
 * ordered attachment structure.
 */
function checkpointComparableTopic(topic) {
  const result = inventoryTopic(topic);
  return {
    ...result,
    attachments: result.attachments.map((attachment) => {
      if (
        attachment.source === null
        || typeof attachment.source !== "object"
        || typeof attachment.source.transport_url !== "string"
      ) {
        return attachment;
      }
      return {
        ...attachment,
        source: {
          ...attachment.source,
          transport_url: sanitizedUrl(attachment.source.transport_url),
        },
      };
    }),
  };
}

function exactTopicPrefix(previousTopics, currentTopics) {
  if (currentTopics.length < previousTopics.length) {
    return false;
  }
  for (let index = 0; index < previousTopics.length; index += 1) {
    if (JSON.stringify(previousTopics[index]) !== JSON.stringify(currentTopics[index])) {
      return false;
    }
  }
  return true;
}

function exactCommonTopicPrefix(leftTopics, rightTopics) {
  const commonLength = Math.min(leftTopics.length, rightTopics.length);
  for (let index = 0; index < commonLength; index += 1) {
    if (JSON.stringify(leftTopics[index]) !== JSON.stringify(rightTopics[index])) {
      return false;
    }
  }
  return true;
}

async function verifyBodyExtractor(tab, topics, timeoutMs, options = {}) {
  let bodies;
  try {
    bodies = await evaluateWithNavigationRecovery(
      tab,
      extractZsxqTopicBodies,
      {
        expectedTopicCount: topics.length,
        ...(options.topicRootSelector
          ? { topicRootSelector: options.topicRootSelector }
          : {}),
        ...(options.excludedAncestorSelector
          ? { excludedAncestorSelector: options.excludedAncestorSelector }
          : {}),
      },
      { timeoutMs, phase: options.phase ?? "timeline-body-cross-check" },
    );
  } catch (error) {
    if (error instanceof ZsxqBrowserCollectionError) {
      throw error;
    }
    const message = thrownMessage(error);
    const countMismatch = message.match(
      /^Knowledge Planet topic root count (\d+) does not match independently observed count (\d+)$/u,
    );
    if (countMismatch) {
      throw new ZsxqBrowserCollectionError(
        "BODY_EXTRACTOR_TOPIC_COUNT_CHANGED",
        options.phase ?? "timeline-body-cross-check",
        "The timeline topic count changed between metadata and body inspection",
        {
          observedTopicCount: Number(countMismatch[1]),
          expectedTopicCount: topics.length,
        },
        { cause: error },
      );
    }
    if (/^Knowledge Planet topic /u.test(message)) {
      throw new ZsxqBrowserCollectionError(
        "BODY_EXTRACTOR_DOM_CONTRACT_FAILED",
        options.phase ?? "timeline-body-cross-check",
        "The dedicated Knowledge Planet body extractor rejected the current DOM",
        {},
        { cause: error },
      );
    }
    throw error;
  }
  if (
    bodies.length !== topics.length
    || bodies.some((body, index) => body.dom_index !== index || body.body !== topics[index].body)
  ) {
    throw new ZsxqBrowserCollectionError(
      "BODY_EXTRACTOR_CROSS_CHECK_FAILED",
      options.phase ?? "timeline-body-cross-check",
      "Dedicated body extraction disagrees with the browser collector",
      { expectedTopicCount: topics.length, observedBodyCount: bodies.length },
    );
  }
}

async function stabilizeTimelineBodies(tab, snapshot, options) {
  const deadline = Date.now() + options.timeoutMs;
  const maxTopicCountRetries = options.maxTopicCountRetries ?? 3;
  let current = snapshot;
  let topicCountRetries = 0;

  while (true) {
    current = await expandTargetDateUntilStable(tab, current, {
      ...options,
      timeoutMs: Math.max(1, deadline - Date.now()),
    });
    try {
      await verifyBodyExtractor(tab, current.topics, Math.max(1, deadline - Date.now()), {
        phase: options.phase,
        topicRootSelector: options.adapter.selectors.timelineTalk,
        excludedAncestorSelector: options.adapter.selectors.stickyAncestor,
      });
      return current;
    } catch (error) {
      if (
        !(error instanceof ZsxqBrowserCollectionError)
        || error.code !== "BODY_EXTRACTOR_TOPIC_COUNT_CHANGED"
      ) {
        throw error;
      }
      topicCountRetries += 1;
      const remaining = deadline - Date.now();
      if (remaining <= 0 || topicCountRetries > maxTopicCountRetries) {
        throw new ZsxqBrowserCollectionError(
          "TIMELINE_BODY_COUNT_DID_NOT_STABILIZE",
          options.phase,
          "Knowledge Planet timeline metadata and body counts did not stabilize together",
          {
            metadataTopicCount: current.topicCount,
            observedBodyCount: error.diagnostic.observedTopicCount,
            topicCountRetries,
          },
          { cause: error },
        );
      }
      current = await waitForStableTimeline(tab, {
        adapter: options.adapter,
        timeoutMs: remaining,
        pollIntervalMs: options.pollIntervalMs,
        phase: options.phase,
        minimumTopicCount: Math.max(
          current.topicCount,
          error.diagnostic.observedTopicCount,
        ),
      });
    }
  }
}

async function canonicalWorkspace(workspace) {
  if (typeof workspace !== "string" || workspace === "") {
    throw new TypeError("workspace must be an existing runner workspace path");
  }
  return realpath(resolve(workspace));
}

async function writeWorkspaceJson(workspace, filename, value) {
  const canonical = await canonicalWorkspace(workspace);
  const target = resolve(canonical, filename);
  if (!target.startsWith(`${canonical}${sep}`)) {
    throw new Error("Browser collector file must stay inside the runner workspace");
  }
  const temporary = `${target}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return target;
}

async function readCheckpoint(workspace) {
  if (!workspace) {
    return undefined;
  }
  const canonical = await canonicalWorkspace(workspace);
  try {
    return JSON.parse(await readFile(resolve(canonical, CHECKPOINT_FILENAME), "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function saveCheckpoint(workspace, value) {
  if (!workspace) {
    return undefined;
  }
  return writeWorkspaceJson(workspace, CHECKPOINT_FILENAME, {
    schema_version: 2,
    contract_version: ZSXQ_BROWSER_CONTRACT.version,
    ...value,
  });
}

function validateCheckpoint(checkpoint, input) {
  if (!checkpoint) {
    return;
  }
  if (
    checkpoint.schema_version !== 2
    || checkpoint.contract_version !== ZSXQ_BROWSER_CONTRACT.version
    || checkpoint.planet_name !== input.planetName
    || checkpoint.planet_url !== new URL(input.planetUrl).origin
      + new URL(input.planetUrl).pathname
    || checkpoint.target_date !== input.targetDate
    || !Array.isArray(checkpoint.topics)
  ) {
    throw new ZsxqBrowserCollectionError(
      "CHECKPOINT_SCOPE_MISMATCH",
      "resume",
      "Existing browser collector checkpoint belongs to another contract or run scope",
    );
  }
}

function sanitizedUrl(value) {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "unavailable";
  }
}

function topicIdFromUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.pathname.match(/\/topic\/(\d+)/u)?.[1]
      || parsed.searchParams.get("topic_id")
      || parsed.searchParams.get("topicId")
      || undefined;
  } catch {
    return undefined;
  }
}

function safeDiagnosticToken(value, pattern, fallback) {
  return typeof value === "string" && pattern.test(value) ? value : fallback;
}

function safeDiagnosticCounts(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const result = {};
  for (const [key, count] of Object.entries(value)) {
    const safeKey = safeDiagnosticToken(
      key,
      /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/u,
      undefined,
    );
    if (!safeKey) {
      continue;
    }
    if (Number.isInteger(count) && count >= 0 && count <= 1_000_000) {
      result[safeKey] = count;
    } else if (count === "invalid-selector") {
      result[safeKey] = count;
    }
  }
  return result;
}

function safeDiagnosticOutline(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.slice(0, 3).map((branch) => {
    if (!Array.isArray(branch)) {
      return [];
    }
    return branch.slice(0, 16).flatMap((node) => {
      if (node === null || typeof node !== "object" || Array.isArray(node)) {
        return [];
      }
      const tag = safeDiagnosticToken(
        node.tag,
        /^[a-z][a-z0-9-]{0,79}$/u,
        "unknown",
      );
      const classes = Array.isArray(node.classes)
        ? node.classes
            .filter(
              (className) => typeof className === "string"
                && /^[A-Za-z0-9_-]{1,80}$/u.test(className),
            )
            .slice(0, 8)
        : [];
      const childElementCount = Number.isInteger(node.childElementCount)
        && node.childElementCount >= 0
        && node.childElementCount <= 1_000_000
        ? node.childElementCount
        : 0;
      return [{ tag, classes, childElementCount }];
    });
  });
}

export async function writeZsxqBrowserRepairHandoff(workspace, input) {
  const diagnostic = input.diagnostic && typeof input.diagnostic === "object"
    ? input.diagnostic
    : {};
  const checkpointRetained = await readCheckpoint(workspace) !== undefined;
  const payload = {
    schema_version: 2,
    status: "automatic-repair-required",
    contract_version: ZSXQ_BROWSER_CONTRACT.version,
    phase: safeDiagnosticToken(
      input.phase,
      /^[a-z][a-z0-9-]{0,79}$/u,
      "unknown",
    ),
    failure: {
      code: safeDiagnosticToken(
        input.code,
        /^[A-Z][A-Z0-9_]{0,79}$/u,
        "UNKNOWN_BROWSER_CONTRACT_FAILURE",
      ),
      message: "The authenticated browser collector stopped because its strict contract was not proven.",
    },
    page: {
      url: sanitizedUrl(diagnostic.pageUrl || input.pageUrl || ""),
      selector_counts: safeDiagnosticCounts(
        diagnostic.selectorCounts || input.selectorCounts,
      ),
      app_tag_counts: safeDiagnosticCounts(diagnostic.appTagCounts),
      shallow_outline: safeDiagnosticOutline(diagnostic.outline),
    },
    checkpoint: {
      retained: checkpointRetained,
      ...(checkpointRetained ? { file: CHECKPOINT_FILENAME } : {}),
    },
    repair_policy: {
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
    },
    user_notification: ZSXQ_REPAIR_NOTIFICATION,
  };
  const path = await writeWorkspaceJson(workspace, REPAIR_HANDOFF_FILENAME, payload);
  return { path, payload };
}

async function collectRepairDiagnostics(tab, error) {
  try {
    const diagnostic = await evaluateWithNavigationRecovery(
      tab,
      collectZsxqDomDiagnostics,
      { adapter: ZSXQ_BROWSER_CONTRACT },
      { timeoutMs: 2_000, phase: "diagnostic" },
    );
    return { ...diagnostic, failureEvidence: error.diagnostic };
  } catch {
    return { failureEvidence: error.diagnostic };
  }
}

function repairableCollectorError(error) {
  const isReferenceError = error instanceof ReferenceError
    || (
      error !== null
      && typeof error === "object"
      && !Array.isArray(error)
      && error.name === "ReferenceError"
    );
  if (isReferenceError) {
    const message = thrownMessage(error);
    const isInternalMissingReference = /\bis not defined\b|cannot access .+ before initialization|can't find variable:/iu.test(
      message,
    );
    if (!isInternalMissingReference && directBrowserError(error)) {
      return undefined;
    }
    return new ZsxqBrowserCollectionError(
      "COLLECTOR_RUNTIME_REFERENCE_ERROR",
      "collector-runtime",
      "The browser collector encountered an internal runtime reference failure",
      { runtimeErrorType: error.name },
      { cause: error },
    );
  }
  if (directBrowserError(error)) {
    return undefined;
  }
  if (
    error instanceof ZsxqBrowserCollectionError
    && AUTOMATIC_REPAIR_ERROR_CODES.has(error.code)
  ) {
    return error;
  }
  return undefined;
}

async function automaticRepairHandoffResult(tab, input, error, pageUrl) {
  const repairError = repairableCollectorError(error);
  if (!repairError || !input?.workspace) {
    throw error;
  }
  const diagnostic = await collectRepairDiagnostics(tab, repairError);
  const handoff = await writeZsxqBrowserRepairHandoff(input.workspace, {
    phase: repairError.phase,
    code: repairError.code,
    pageUrl,
    diagnostic,
  });
  return {
    status: "automatic-repair-required",
    notification: ZSXQ_REPAIR_NOTIFICATION,
    diagnostic_path: handoff.path,
    checkpoint_retained: handoff.payload.checkpoint.retained,
  };
}

async function inspectZsxqDetailUntilReady(tab, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  let lastFailure;
  while (true) {
    const snapshot = await evaluateWithNavigationRecovery(
      tab,
      inspectZsxqDetailPage,
      { adapter: ZSXQ_BROWSER_CONTRACT },
      { timeoutMs: Math.max(1, deadline - Date.now()), phase: "detail-inventory" },
    );
    if (snapshot.ok) {
      return snapshot;
    }
    lastFailure = snapshot.failure;
    if (snapshot.failure.transient !== true) {
      throw new ZsxqBrowserCollectionError(
        snapshot.failure.code,
        "detail-inventory",
        "Knowledge Planet detail DOM does not match the active browser contract",
        snapshot.failure,
      );
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new ZsxqBrowserCollectionError(
        "DETAIL_INVENTORY_DID_NOT_STABILIZE",
        "detail-inventory",
        `Knowledge Planet detail inventory did not stabilize within ${timeoutMs}ms`,
        { ...(lastFailure ? { lastFailure } : {}) },
      );
    }
    await delay(Math.min(pollIntervalMs, remaining));
  }
}

async function waitForDetailOrContractError(tab, input) {
  try {
    return await waitForZsxqDetailReadyOnTab(tab, input);
  } catch (error) {
    const message = thrownMessage(error);
    if (/^Knowledge Planet detail (?:page|navigation) did not/iu.test(message)) {
      throw new ZsxqBrowserCollectionError(
        "DETAIL_DID_NOT_STABILIZE",
        "detail-readiness",
        "Knowledge Planet detail page did not satisfy the stable DOM contract",
      );
    }
    throw error;
  }
}

export async function collectZsxqTimelineRangeOnTab(tab, input) {
  assertTab(tab);
  assertCollectorInput(input);
  const timeoutMs = input.timeoutMs ?? 8_000;
  const pollIntervalMs = input.pollIntervalMs ?? 250;
  const maxScrolls = input.maxScrolls ?? 100;
  if (!Number.isInteger(maxScrolls) || maxScrolls < 0 || maxScrolls > 1_000) {
    throw new TypeError("maxScrolls must be an integer from 0 through 1000");
  }

  const adapter = ZSXQ_BROWSER_CONTRACT;
  if (input.filtersClearedConfirmed !== true) {
    return {
      status: "needs-filter-confirmation",
      reason:
        "Confirm that search, tag, owner-only, member, and other topic filters are cleared.",
      contract_version: adapter.version,
    };
  }
  const checkpoint = await readCheckpoint(input.workspace);
  validateCheckpoint(checkpoint, input);
  if (typeof tab.goto === "function") {
    await tab.goto(input.planetUrl);
  }
  await assertTimelinePageAccess(tab, input.planetUrl);
  await evaluateWithNavigationRecovery(
    tab,
    prepareZsxqTimelinePage,
    { adapter, scrollToTop: true },
    { timeoutMs, phase: "timeline-top" },
  );

  let snapshot = await waitForStableTimeline(tab, {
    adapter,
    timeoutMs,
    pollIntervalMs,
    phase: "timeline-top",
  });
  if (snapshot.planetName !== input.planetName) {
    throw new ZsxqBrowserCollectionError(
      "PLANET_NAME_MISMATCH",
      "timeline-top",
      "The displayed Knowledge Planet name does not exactly match the requested planet",
      { displayedNameMatched: false },
    );
  }
  const expectedPageUrl = sanitizedUrl(input.planetUrl);
  if (snapshot.pageUrl !== expectedPageUrl) {
    throw new ZsxqBrowserCollectionError(
      "PLANET_URL_MISMATCH",
      "timeline-top",
      "The authenticated page is not the requested canonical Knowledge Planet group",
      { expectedPageUrl, observedPageUrl: snapshot.pageUrl },
    );
  }

  const mountedTopics = normalizeTimelineTopics(snapshot);
  if (
    checkpoint
    && !exactCommonTopicPrefix(
      checkpoint.topics,
      mountedTopics.map(checkpointComparableTopic),
    )
  ) {
    throw new ZsxqBrowserCollectionError(
      "CHECKPOINT_PREFIX_CHANGED",
      "resume",
      "Previously checkpointed timeline topics no longer match the current snapshot",
      {
        checkpointTopicCount: checkpoint.topics.length,
        currentTopicCount: mountedTopics.length,
      },
    );
  }
  if (!checkpoint || mountedTopics.length >= checkpoint.topics.length) {
    await saveCheckpoint(input.workspace, {
      phase: "timeline-mounted",
      planet_name: input.planetName,
      planet_url: expectedPageUrl,
      target_date: input.targetDate,
      scroll_passes: 0,
      topics: mountedTopics.map(checkpointComparableTopic),
    });
  }
  snapshot = await stabilizeTimelineBodies(tab, snapshot, {
    adapter,
    targetDate: input.targetDate,
    timeoutMs,
    pollIntervalMs,
    phase: "timeline-body-cross-check",
  });
  let allTopics = normalizeTimelineTopics(snapshot);
  if (
    checkpoint
    && !exactCommonTopicPrefix(
      checkpoint.topics,
      allTopics.map(checkpointComparableTopic),
    )
  ) {
    throw new ZsxqBrowserCollectionError(
      "CHECKPOINT_PREFIX_CHANGED",
      "resume",
      "Re-stabilized timeline topics no longer match the retained checkpoint",
      {
        checkpointTopicCount: checkpoint.topics.length,
        currentTopicCount: allTopics.length,
      },
    );
  }
  if (!exactTopicPrefix(
    mountedTopics.map(checkpointComparableTopic),
    allTopics.map(checkpointComparableTopic),
  )) {
    throw new ZsxqBrowserCollectionError(
      "TIMELINE_PREFIX_CHANGED_DURING_EXPANSION",
      "timeline-expand",
      "The timeline prefix changed while target-date topics were expanded",
      { mountedTopicCount: mountedTopics.length, currentTopicCount: allTopics.length },
    );
  }

  const topDate = allTopics[0].platform_date;
  if (topDate <= input.targetDate && input.topBoundaryConfirmed !== true) {
    if (!checkpoint || allTopics.length >= checkpoint.topics.length) {
      await saveCheckpoint(input.workspace, {
        phase: "awaiting-top-confirmation",
        planet_name: input.planetName,
        planet_url: expectedPageUrl,
        target_date: input.targetDate,
        scroll_passes: 0,
        topics: allTopics.map(checkpointComparableTopic),
      });
    }
    return {
      status: "needs-top-confirmation",
      reason:
        "The visible top is not newer than the target date; confirm no pending new-content batch remains.",
      contract_version: adapter.version,
      topic_count_observed: allTopics.length,
    };
  }

  let scrollPasses = 0;
  const checkpointTopicCount = checkpoint?.topics.length ?? 0;
  while (
    allTopics.length < checkpointTopicCount
    || !timelineCoverageBoundaryReached({
      oldestPlatformDate: allTopics.at(-1).platform_date,
      targetDate: input.targetDate,
      endReached: snapshot.endReached,
    })
  ) {
    if (scrollPasses >= maxScrolls) {
      throw new ZsxqBrowserCollectionError(
        "TIMELINE_SCROLL_LIMIT_REACHED",
        "timeline-pagination",
        "Knowledge Planet timeline did not cross below the target date within the scroll limit",
        { maxScrolls, topicCount: allTopics.length },
      );
    }
    const previousTopics = allTopics;
    await advanceZsxqTimelineOnTab(tab, adapter);
    const nextSnapshot = await waitForStableTimeline(tab, {
      adapter,
      timeoutMs,
      pollIntervalMs,
      minimumTopicCount: previousTopics.length + 1,
      phase: "timeline-pagination",
      progressAction: () => advanceZsxqTimelineOnTab(tab, adapter),
      progressRetryMs: Math.min(1_000, Math.max(10, pollIntervalMs * 4)),
    });
    snapshot = await stabilizeTimelineBodies(tab, nextSnapshot, {
      adapter,
      targetDate: input.targetDate,
      timeoutMs,
      pollIntervalMs,
      phase: "timeline-body-cross-check",
    });
    allTopics = normalizeTimelineTopics(snapshot);
    if (!exactTopicPrefix(
      previousTopics.map(checkpointComparableTopic),
      allTopics.map(checkpointComparableTopic),
    )) {
      throw new ZsxqBrowserCollectionError(
        "TIMELINE_PREFIX_CHANGED",
        "timeline-pagination",
        "Loaded Knowledge Planet topics are not an append-only chronological prefix",
        { previousTopicCount: previousTopics.length, currentTopicCount: allTopics.length },
      );
    }
    if (
      checkpoint
      && !exactCommonTopicPrefix(
      checkpoint.topics,
      allTopics.map(checkpointComparableTopic),
    )
    ) {
      throw new ZsxqBrowserCollectionError(
        "CHECKPOINT_PREFIX_CHANGED",
        "resume",
        "Replayed timeline topics no longer match the retained checkpoint",
        {
          checkpointTopicCount: checkpoint.topics.length,
          currentTopicCount: allTopics.length,
        },
      );
    }
    scrollPasses += 1;
    if (!checkpoint || allTopics.length >= checkpoint.topics.length) {
      await saveCheckpoint(input.workspace, {
        phase: "timeline-pagination",
        planet_name: input.planetName,
        planet_url: expectedPageUrl,
        target_date: input.targetDate,
        scroll_passes: scrollPasses,
        topics: allTopics.map(checkpointComparableTopic),
      });
    }
  }

  const matchingTopics = allTopics
    .filter((topic) => topic.platform_date === input.targetDate)
    .map(publicTopic)
    .map((topic, index) => ({ ...topic, source_order: index + 1 }));
  const coverage = {
    top_established: true,
    pending_new_content_loaded: true,
    crossed_below_target_date: true,
    chronology_consistent: true,
    access_complete: true,
    evidence:
      `Contract ${adapter.version}; visible top ${allTopics[0].timestamp}; `
      + (snapshot.endReached
        ? `absolute timeline end after ${allTopics.at(-1).timestamp}; `
        : `visible lower boundary ${allTopics.at(-1).timestamp}; `)
      + `${scrollPasses} scroll pass(es)`,
  };
  const checkpointPath = await saveCheckpoint(input.workspace, {
    phase: "timeline-complete",
    planet_name: input.planetName,
    planet_url: expectedPageUrl,
    target_date: input.targetDate,
    scroll_passes: scrollPasses,
    topics: allTopics.map(checkpointComparableTopic),
  });

  return {
    status: "complete",
    contract_version: adapter.version,
    coverage,
    inventory: buildZsxqRunnerInventory(matchingTopics),
    browser_assets: matchingTopics.flatMap((topic) => topic.browser_assets.map(
      (asset, index) => ({
        topic_source_order: topic.source_order,
        image_ordinal: index + 1,
        ...asset,
      }),
    )),
    scroll_passes: scrollPasses,
    checkpoint_path: checkpointPath,
  };
}

export async function collectZsxqTimelineRangeWithAutoRepair(tab, input) {
  try {
    return await collectZsxqTimelineRangeOnTab(tab, input);
  } catch (error) {
    return automaticRepairHandoffResult(tab, input, error, input?.planetUrl);
  }
}

export const collectZsxqTimelineRangeWithRepairGate =
  collectZsxqTimelineRangeWithAutoRepair;

export async function collectZsxqDetailOnTab(tab, input) {
  assertTab(tab);
  if (input === null || typeof input !== "object" || typeof input.url !== "string") {
    throw new TypeError("Pass a Knowledge Planet detail URL");
  }
  const url = new URL(input.url);
  if (url.protocol !== "https:" || url.hostname !== "wx.zsxq.com") {
    throw new TypeError("Detail URL must use https://wx.zsxq.com");
  }
  const expectedTopicId = topicIdFromUrl(input.url);
  if (!expectedTopicId) {
    throw new TypeError("Detail URL must expose a stable Knowledge Planet topic ID");
  }
  if (typeof tab.goto === "function") {
    await tab.goto(input.url);
  }
  await assertDetailPageAccess(tab);
  await waitForDetailOrContractError(tab, {
    expectedTopicCount: 1,
    ...(input.expectedImageCount === undefined
      ? {}
      : { expectedImageCount: input.expectedImageCount }),
    timeoutMs: input.timeoutMs ?? 5_000,
    pollIntervalMs: input.pollIntervalMs ?? 250,
  });
  let snapshot = await inspectZsxqDetailUntilReady(tab, {
    timeoutMs: input.timeoutMs ?? 5_000,
    pollIntervalMs: input.pollIntervalMs ?? 250,
  });
  if (snapshot.topicId !== expectedTopicId) {
    throw new ZsxqBrowserCollectionError(
      "DETAIL_TOPIC_ID_MISMATCH",
      "detail-inventory",
      "The final Knowledge Planet detail topic does not match the requested link",
      { topicIdMatched: false },
    );
  }
  await expandZsxqDetailOnTab(tab, snapshot, ZSXQ_BROWSER_CONTRACT);
  await waitForDetailOrContractError(tab, {
    expectedTopicCount: 1,
    ...(input.expectedImageCount === undefined
      ? {}
      : { expectedImageCount: input.expectedImageCount }),
    timeoutMs: input.timeoutMs ?? 5_000,
    pollIntervalMs: input.pollIntervalMs ?? 250,
  });
  snapshot = await inspectZsxqDetailUntilReady(tab, {
    timeoutMs: input.timeoutMs ?? 5_000,
    pollIntervalMs: input.pollIntervalMs ?? 250,
  });
  if (snapshot.topicId !== expectedTopicId) {
    throw new ZsxqBrowserCollectionError(
      "DETAIL_TOPIC_ID_MISMATCH",
      "detail-inventory",
      "The final Knowledge Planet detail topic does not match the requested link",
      { topicIdMatched: false },
    );
  }
  if (snapshot.collapsed === true) {
    throw new ZsxqBrowserCollectionError(
      "DETAIL_EXPANSION_NOT_STABLE",
      "detail-expand",
      "The detail body remained geometrically collapsed after the browser click",
    );
  }
  await verifyBodyExtractor(
    tab,
    [{ body: snapshot.body }],
    input.timeoutMs ?? 5_000,
    {
      phase: "detail-body-cross-check",
      topicRootSelector: ZSXQ_BROWSER_CONTRACT.selectors.detailTopic,
    },
  );
  return {
    status: "complete",
    contract_version: ZSXQ_BROWSER_CONTRACT.version,
    canonical_url: snapshot.pageUrl,
    author: snapshot.author,
    timestamp: parseDisplayedTimestamp(snapshot.displayed_timestamp).iso,
    body: snapshot.body === "" ? { status: "empty" } : { status: "present", payload: snapshot.body },
    images: snapshot.images,
    files: snapshot.files ?? [],
  };
}

export async function collectZsxqDetailWithAutoRepair(tab, input) {
  try {
    return await collectZsxqDetailOnTab(tab, input);
  } catch (error) {
    return automaticRepairHandoffResult(tab, input, error, input?.url);
  }
}

export const collectZsxqDetailWithRepairGate = collectZsxqDetailWithAutoRepair;
