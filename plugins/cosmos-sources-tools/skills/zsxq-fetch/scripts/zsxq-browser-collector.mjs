import {
  beijingDateFromTimestamp,
  ZSXQ_UTC_OFFSET,
} from "./zsxq-time.mjs";

// The single active DOM contract. A live DOM change is repaired here (with the
// user's approval) by bumping the version string and adjusting the selectors.
export const ZSXQ_BROWSER_CONTRACT = Object.freeze({
  version: "zsxq-web-angular-v12",
  timestampReadCountOptional: true,
  explicitLinkHrefRequired: true,
  ignoreUnsupportedFileCardsOutsideTargetDate: true,
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
    timestampReadCount: ":scope > .readed-count",
    timelineEnd: ":scope > .no-more",
    body: ":scope > .talk-content-container > .content",
    expandControl: ":scope > .talk-content-container > .showAll",
    topicExpandControl: "app-talk-content > .talk-content-container > .showAll",
    image: "app-image-gallery img",
    imageGallery: "app-image-gallery",
    imageWithinGallery: ":scope img",
    imageGalleryDescendant: ":scope *",
    link: "a",
    fileGallery: "app-file-gallery",
    fileItem: "app-file-gallery > .file-gallery-container > .item",
    fileItemWithinGallery: ":scope > .file-gallery-container > .item",
    fileName: ":scope > .file-name",
    fileIcon: ":scope > .file-icon",
    filePdfIndicator: ":scope > .file-icon.file-pdf",
    filePreviewRoot: "app-file-preview .file-preview-container",
    filePreviewContent: ":scope > .content",
    filePreviewName: ":scope .file > .file-name",
    fileDownloadControl: ":scope .file > .btn-wrapper > .btn.download",
    detailPanel: ".topic-detail-panel",
    detailTopic: ".topic-detail-panel app-talk-content",
    detailHeader: ".topic-detail-panel app-topic-header",
    detailExpandControl:
      ".topic-detail-panel app-talk-content > .talk-content-container > .showAll",
  }),
});
const NAVIGATION_ERROR_PATTERN = /Inspected target navigated or closed|Execution context was destroyed.*navigation/iu;
const DIRECT_BROWSER_ERROR_PATTERN = /permission|denied|unauthori[sz]ed|authenticat|sign.?in|log.?in|disconnect|not connected|connection (?:closed|lost|failed)|(?:browser|extension|target|tab).*(?:closed|unavailable)/iu;

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
  const targetDate = typeof input.targetDate === "string" ? input.targetDate : undefined;
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
  const ownedTimestampText = (element) => {
    if (typeof selectors.timestampReadCount === "string") {
      return [...(element?.childNodes ?? [])]
        .filter((node) => Number(node.nodeType) === 3)
        .map((node) => typeof node.nodeValue === "string" ? node.nodeValue : "")
        .join("")
        .trim();
    }
    return element ? text(element).trim() : "";
  };
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
  const explicitLinkHref = (element) => {
    const resolvedHref = typeof element.href === "string" ? element.href : "";
    if (adapter.explicitLinkHrefRequired !== true) {
      return resolvedHref;
    }
    const rawHref = typeof element.getAttribute === "function"
      ? element.getAttribute("href")
      : null;
    if (typeof rawHref !== "string" || rawHref.trim() === "") {
      return "";
    }
    return resolvedHref.trim();
  };
  const classifyLink = (href) => {
    if (
      adapter.explicitLinkHrefRequired === true
      && (typeof href !== "string" || href.trim() === "")
    ) {
      return null;
    }
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

  const stickyTopics = allTopics
    .filter((topic) => topic.closest && topic.closest(selectors.stickyAncestor))
    .map((topic) => {
      const header = exactlyOne(topic, selectors.topicHeader);
      const authors = header.count === 1
        ? exactlyOne(header.elements[0], selectors.author)
        : { elements: [], count: 0 };
      const timestamps = header.count === 1
        ? exactlyOne(header.elements[0], selectors.timestamp)
        : { elements: [], count: 0 };
      return {
        author: authors.count === 1 ? text(authors.elements[0]).trim() : "",
        displayed_timestamp: timestamps.count === 1
          ? ownedTimestampText(timestamps.elements[0])
          : "",
      };
    });

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
    const timestampText = ownedTimestampText(timestamp.elements[0]);
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
    const timestampDate = timestampText.match(
      /^(\d{4}-\d{2}-\d{2})\s+\d{2}:\d{2}(?::\d{2})?$/u,
    )?.[1];
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
    const topicPendingImages = images.filter((image) => image.complete !== true).length;
    const topicBrokenImages = images.filter(
      (image) => image.complete === true
        && (Number(image.naturalWidth) < 1 || Number(image.naturalHeight) < 1),
    ).length;
    const imageGalleries = typeof selectors.imageGallery === "string"
      ? [...talk.elements[0].querySelectorAll(selectors.imageGallery)]
      : [];
    let topicImageOverflow = false;
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
          // A "+N" badge is normal platform UI for a topic whose image set
          // exceeds the timeline preview. The topic is skipped and annotated
          // by the collector instead of failing the whole timeline.
          topicImageOverflow = true;
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
      .map((anchor) => {
        const href = explicitLinkHref(anchor);
        return {
          element: anchor,
          href,
          type: classifyLink(href),
        };
      })
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
      const fileIcons = typeof selectors.fileIcon === "string"
        ? exactlyOne(item, selectors.fileIcon)
        : exactlyOne(item, selectors.filePdfIndicator);
      const pdfIndicators = exactlyOne(item, selectors.filePdfIndicator);
      const filename = names.count === 1 ? text(names.elements[0]).trim() : "";
      const fileType = /\.pdf$/iu.test(filename)
        ? "pdf"
        : /\.html?$/iu.test(filename)
          ? "html"
          : /\.docx?$/iu.test(filename)
            ? "word"
            : null;
      if (
        names.count !== 1
        || fileIcons.count !== 1
        || pdfIndicators.count !== (fileType === "pdf" ? 1 : 0)
        || filename === ""
        || fileType === null
      ) {
        if (
          adapter.ignoreUnsupportedFileCardsOutsideTargetDate === true
          && typeof targetDate === "string"
          && timestampDate !== undefined
          && timestampDate !== targetDate
        ) {
          continue;
        }
        return fail("FILE_ATTACHMENT_MISMATCH", {
          ...baseCounts,
          topicIndex: index,
          fileIndex,
          fileName: names.count,
          fileIcon: fileIcons.count,
          pdfIndicator: pdfIndicators.count,
        });
      }
      files.push({
        element: item,
        type: fileType,
        filename,
        fileOrdinal: fileIndex + 1,
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
      if ((entry.type === "pdf" || entry.type === "html" || entry.type === "word") && !filename) {
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
              source: entry.href ? { transport_url: entry.href } : {},
              filename,
              ...(entry.fileOrdinal === undefined
                ? {}
                : { file_ordinal: entry.fileOrdinal }),
            }),
      };
    });

    if (
      !topicImageOverflow
      && (targetDate === undefined || timestampText.startsWith(`${targetDate} `))
    ) {
      pendingImageCount += topicPendingImages;
      brokenImageCount += topicBrokenImages;
    }

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
      ...(topicImageOverflow ? { image_overflow: true } : {}),
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
    stickyTopics,
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
    const fileIcons = typeof selectors.fileIcon === "string"
      ? [...item.querySelectorAll(selectors.fileIcon)]
      : [...item.querySelectorAll(selectors.filePdfIndicator)];
    const pdfIndicators = [...item.querySelectorAll(selectors.filePdfIndicator)];
    const filename = names.length === 1 ? detailText(names[0]).trim() : "";
    const fileType = /\.pdf$/iu.test(filename)
      ? "pdf"
      : /\.html?$/iu.test(filename)
        ? "html"
        : /\.docx?$/iu.test(filename)
          ? "word"
          : null;
    if (
      names.length !== 1
      || fileIcons.length !== 1
      || pdfIndicators.length !== (fileType === "pdf" ? 1 : 0)
      || filename === ""
      || fileType === null
    ) {
      return detailFail("DETAIL_FILE_ATTACHMENT_MISMATCH", {
        fileIndex,
        fileName: names.length,
        fileIcon: fileIcons.length,
        pdfIndicator: pdfIndicators.length,
      });
    }
    fileEntries.push({ element: item, filename, type: fileType });
  }

  const orderedMedia = [
    ...imageElements.map((element, index) => ({
      element,
      kind: "image",
      image_ordinal: index + 1,
    })),
    ...fileEntries.map((entry, index) => ({
      element: entry.element,
      kind: entry.type,
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
      files.push({
        type: entry.kind,
        file_ordinal: entry.file_ordinal,
        dom_ordinal: mediaIndex + 1,
        filename: entry.filename,
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

function fileTypeForFilename(filename) {
  if (/\.pdf$/iu.test(filename)) return "pdf";
  if (/\.html?$/iu.test(filename)) return "html";
  if (/\.docx?$/iu.test(filename)) return "word";
  return null;
}

function fileDownloadErrorCode(type, suffix) {
  return `${type.toUpperCase()}_${suffix}`;
}

function validateFileDownloadInput(input) {
  if (input === null || typeof input !== "object") {
    throw new TypeError("Pass an inventoried file occurrence");
  }
  const { fileOrdinal, expectedFilename } = input;
  if (!Number.isInteger(fileOrdinal) || fileOrdinal < 1) {
    throw new TypeError("fileOrdinal must be a positive integer");
  }
  if (
    typeof expectedFilename !== "string"
    || expectedFilename.trim() === ""
    || fileTypeForFilename(expectedFilename) === null
  ) {
    throw new TypeError("expectedFilename must be a non-empty PDF, HTML, or Word filename");
  }
  const expectedType = input.expectedType ?? fileTypeForFilename(expectedFilename);
  if (
    !new Set(["pdf", "html", "word"]).has(expectedType)
    || fileTypeForFilename(expectedFilename) !== expectedType
  ) {
    throw new TypeError("expectedType must match the PDF, HTML, or Word filename extension");
  }
  const expectedDisplayedTimestamp = input.expectedDisplayedTimestamp;
  if (
    typeof expectedDisplayedTimestamp !== "string"
    || !/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?$/u.test(expectedDisplayedTimestamp)
  ) {
    throw new TypeError("expectedDisplayedTimestamp must use YYYY-MM-DD HH:mm[:ss]");
  }
  parseDisplayedTimestamp(expectedDisplayedTimestamp);
  return { fileOrdinal, expectedFilename, expectedType, expectedDisplayedTimestamp };
}

async function locateTimelineFileByTimeAndName(tab, input) {
  const selectors = ZSXQ_BROWSER_CONTRACT.selectors;
  const matches = await tab.playwright.evaluate(({ selectors: activeSelectors, expectedDisplayedTimestamp, expectedFilename }) => {
    const ownedTimestampText = (element) => [...(element?.childNodes ?? [])]
      .filter((node) => Number(node.nodeType) === 3)
      .map((node) => typeof node.nodeValue === "string" ? node.nodeValue : "")
      .join("")
      .trim();
    const result = [];
    const topics = [...document.querySelectorAll(activeSelectors.timelineTopic)];
    topics.forEach((topic, topicIndex) => {
      if (topic.closest?.(activeSelectors.stickyAncestor)) return;
      const header = topic.querySelector(activeSelectors.topicHeader);
      const timestamp = header?.querySelector(activeSelectors.timestamp);
      if (ownedTimestampText(timestamp) !== expectedDisplayedTimestamp) return;
      const talk = topic.querySelector(activeSelectors.topicTalk);
      const files = talk
        ? [...talk.querySelectorAll(activeSelectors.fileItem)]
        : [];
      files.forEach((file, fileIndex) => {
        const names = [...file.querySelectorAll(activeSelectors.fileName)];
        if (names.length === 1 && (names[0].innerText ?? "").trim() === expectedFilename) {
          result.push({ topicIndex, fileIndex });
        }
      });
    });
    return result;
  }, {
    selectors,
    expectedDisplayedTimestamp: input.expectedDisplayedTimestamp,
    expectedFilename: input.expectedFilename,
  });
  if (matches.length !== 1) {
    throw new ZsxqBrowserCollectionError(
      fileDownloadErrorCode(input.expectedType, "FILE_IDENTITY_MISMATCH"),
      `${input.expectedType}-download`,
      "The inventoried timeline file is not unique by publication time and filename",
      { matchCount: matches.length },
    );
  }
  const [{ topicIndex, fileIndex }] = matches;
  return {
    fileCard: tab.playwright.locator(selectors.timelineTopic).nth(topicIndex)
      .locator(selectors.topicTalk)
      .locator(selectors.fileItem)
      .nth(fileIndex),
    diagnostic: { publicationTimeMatched: true, filenameMatched: true },
  };
}

async function locateDetailFileByTimeAndName(tab, input) {
  const selectors = ZSXQ_BROWSER_CONTRACT.selectors;
  const matches = await tab.playwright.evaluate(({ selectors: activeSelectors, expectedDisplayedTimestamp, expectedFilename }) => {
    const ownedTimestampText = (element) => [...(element?.childNodes ?? [])]
      .filter((node) => Number(node.nodeType) === 3)
      .map((node) => typeof node.nodeValue === "string" ? node.nodeValue : "")
      .join("")
      .trim();
    const panels = [...document.querySelectorAll(activeSelectors.detailPanel)];
    const result = [];
    panels.forEach((panel, panelIndex) => {
      const header = panel.querySelector("app-topic-header");
      const timestamp = header?.querySelector(activeSelectors.timestamp);
      if (ownedTimestampText(timestamp) !== expectedDisplayedTimestamp) return;
      const talk = panel.querySelector("app-talk-content");
      const files = talk
        ? [...talk.querySelectorAll(activeSelectors.fileItem)]
        : [];
      files.forEach((file, fileIndex) => {
        const names = [...file.querySelectorAll(activeSelectors.fileName)];
        if (names.length === 1 && (names[0].innerText ?? "").trim() === expectedFilename) {
          result.push({ panelIndex, fileIndex });
        }
      });
    });
    return result;
  }, {
    selectors,
    expectedDisplayedTimestamp: input.expectedDisplayedTimestamp,
    expectedFilename: input.expectedFilename,
  });
  if (matches.length !== 1) {
    throw new ZsxqBrowserCollectionError(
      fileDownloadErrorCode(input.expectedType, "FILE_IDENTITY_MISMATCH"),
      `${input.expectedType}-download`,
      "The inventoried detail-page file is not unique by publication time and filename",
      { matchCount: matches.length },
    );
  }
  const [{ panelIndex, fileIndex }] = matches;
  return {
    fileCard: tab.playwright.locator(selectors.detailPanel).nth(panelIndex)
      .locator("app-talk-content")
      .locator(selectors.fileItem)
      .nth(fileIndex),
    diagnostic: { publicationTimeMatched: true, filenameMatched: true },
  };
}

async function downloadZsxqFileCardOnTab(tab, input) {
  const selectors = ZSXQ_BROWSER_CONTRACT.selectors;
  const {
    fileCard,
    fileOrdinal,
    expectedFilename,
    expectedType,
    diagnostic,
    pageRootSelector,
    expectedPageUrl,
  } = input;
  const dismissPreview = async ({ required }) => {
    const preview = tab.playwright.locator(selectors.filePreviewRoot);
    const previewCount = await preview.count();
    if (previewCount === 0 && required !== true) return;
    if (previewCount !== 1) {
      throw new ZsxqBrowserCollectionError(
        fileDownloadErrorCode(expectedType, "PREVIEW_DISMISS_FAILED"),
        `${expectedType}-download`,
        "The official file preview could not be dismissed without leaving the source page",
        { previewCount, pageRootCount: await tab.playwright.locator(pageRootSelector).count() },
      );
    }
    const point = await preview.evaluate((element, contentSelector) => {
      const content = element.querySelector(contentSelector);
      if (!content) return null;
      const outer = element.getBoundingClientRect();
      const inner = content.getBoundingClientRect();
      const candidates = [
        {
          gap: inner.left - outer.left,
          point: [(outer.left + inner.left) / 2, (inner.top + inner.bottom) / 2],
        },
        {
          gap: outer.right - inner.right,
          point: [(inner.right + outer.right) / 2, (inner.top + inner.bottom) / 2],
        },
        {
          gap: inner.top - outer.top,
          point: [(inner.left + inner.right) / 2, (outer.top + inner.top) / 2],
        },
        {
          gap: outer.bottom - inner.bottom,
          point: [(inner.left + inner.right) / 2, (inner.bottom + outer.bottom) / 2],
        },
      ].filter(({ gap }) => Number.isFinite(gap) && gap >= 2)
        .sort((left, right) => right.gap - left.gap);
      if (candidates.length === 0) return null;
      return candidates[0].point.map((value) => Math.max(1, Math.floor(value)));
    }, selectors.filePreviewContent);
    if (!Array.isArray(point) || point.length !== 2) {
      throw new ZsxqBrowserCollectionError(
        fileDownloadErrorCode(expectedType, "PREVIEW_DISMISS_FAILED"),
        `${expectedType}-download`,
        "The official file preview could not be dismissed without leaving the source page",
        { previewCount, dismissPointAvailable: false },
      );
    }
    try {
      await tab.click(point);
    } catch (error) {
      if (directBrowserError(error)) throw error;
      throw new ZsxqBrowserCollectionError(
        fileDownloadErrorCode(expectedType, "PREVIEW_DISMISS_FAILED"),
        `${expectedType}-download`,
        "The official file preview could not be dismissed without leaving the source page",
        { previewCount, dismissPointAvailable: true },
        { cause: error },
      );
    }
    const timeoutMs = input.timeoutMs ?? 8_000;
    const pollIntervalMs = input.pollIntervalMs ?? 150;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      if (await preview.count() === 0) break;
      await delay(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
    }
    const currentUrl = await tab.url();
    const pageRootCount = await tab.playwright.locator(pageRootSelector).count();
    if (
      await preview.count() !== 0
      || currentUrl !== expectedPageUrl
      || pageRootCount !== 1
    ) {
      throw new ZsxqBrowserCollectionError(
        fileDownloadErrorCode(expectedType, "PREVIEW_DISMISS_FAILED"),
        `${expectedType}-download`,
        "The official file preview could not be dismissed without leaving the source page",
        {
          previewDismissed: await preview.count() === 0,
          pageUrlMatched: currentUrl === expectedPageUrl,
          pageRootCount,
        },
      );
    }
  };

  await dismissPreview({ required: false });
  let operationError;
  let result;
  try {
    try {
      await fileCard.click();
    } catch (error) {
      if (directBrowserError(error)) throw error;
      operationError = new ZsxqBrowserCollectionError(
        fileDownloadErrorCode(expectedType, "PREVIEW_OPEN_FAILED"),
        `${expectedType}-download`,
        "The official Knowledge Planet file preview could not be opened",
        { ...diagnostic, fileOrdinal },
        { cause: error },
      );
    }

    if (!operationError) {
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
        operationError = new ZsxqBrowserCollectionError(
          fileDownloadErrorCode(expectedType, "DOWNLOAD_CONTROL_MISMATCH"),
          `${expectedType}-download`,
          "The official file preview did not expose one matching download control",
          {
            ...diagnostic,
            fileOrdinal,
            filenameMatched: previewName === expectedFilename,
          },
        );
      } else {
        const controlText = (await downloadControl.innerText()).trim();
        const controlVisible = typeof downloadControl.isVisible === "function"
          ? await downloadControl.isVisible()
          : false;
        if (controlText !== "下载文件" || controlVisible !== true) {
          operationError = new ZsxqBrowserCollectionError(
            fileDownloadErrorCode(expectedType, "DOWNLOAD_CONTROL_MISMATCH"),
            `${expectedType}-download`,
            "The official file preview download control is not exact and visible",
            {
              ...diagnostic,
              fileOrdinal,
              downloadControlTextMatched: controlText === "下载文件",
              downloadControlVisible: controlVisible,
            },
          );
        } else {
          try {
            // Playwright's standard option name is `timeout`; an unknown option name
            // is silently ignored and would fall back to the 30s default. Pass both
            // names so a tab adapter using this collector's own `timeoutMs` spelling
            // is honored as well; the extra key is harmless either way.
            const downloadPromise = tab.playwright.waitForEvent("download", {
              timeout: timeoutMs,
              timeoutMs,
            });
            const [download] = await Promise.all([downloadPromise, downloadControl.click()]);
            result = {
              download,
              type: expectedType,
              filename: expectedFilename,
              acquisition: "official-ui-download",
              contract_version: ZSXQ_BROWSER_CONTRACT.version,
            };
          } catch (error) {
            if (directBrowserError(error)) throw error;
            operationError = new ZsxqBrowserCollectionError(
              fileDownloadErrorCode(expectedType, "DOWNLOAD_FAILED"),
              `${expectedType}-download`,
              `The official Knowledge Planet ${expectedType.toUpperCase()} download did not complete`,
              { ...diagnostic, fileOrdinal },
              { cause: error },
            );
          }
        }
      }
    }
  } finally {
    await dismissPreview({ required: false });
  }

  if (operationError) throw operationError;
  return result;
}

/** Download one inventoried timeline PDF, HTML, or Word file through the official member UI. */
export async function downloadZsxqTimelineFileOnTab(tab, input) {
  assertTab(tab);
  if (
    typeof tab.playwright.waitForEvent !== "function"
    || typeof tab.click !== "function"
    || typeof tab.url !== "function"
  ) {
    throw new TypeError("The browser tab must support download events, coordinate clicks, and URL reads");
  }
  const {
    fileOrdinal,
    expectedFilename,
    expectedType,
    expectedDisplayedTimestamp,
  } = validateFileDownloadInput(input);
  const { fileCard, diagnostic } = await locateTimelineFileByTimeAndName(tab, {
    expectedDisplayedTimestamp,
    expectedFilename,
    expectedType,
  });
  return downloadZsxqFileCardOnTab(tab, {
    fileCard,
    fileOrdinal,
    expectedFilename,
    expectedType,
    diagnostic,
    pageRootSelector: ZSXQ_BROWSER_CONTRACT.selectors.timelineRoot,
    expectedPageUrl: await tab.url(),
    timeoutMs: input.timeoutMs,
    pollIntervalMs: input.pollIntervalMs,
  });
}

/** Download one inventoried detail-page PDF, HTML, or Word file through the official member UI. */
export async function downloadZsxqDetailFileOnTab(tab, input) {
  assertTab(tab);
  if (
    typeof tab.playwright.waitForEvent !== "function"
    || typeof tab.click !== "function"
  ) {
    throw new TypeError("The browser tab must support download events, coordinate clicks, and URL reads");
  }
  if (typeof tab.url !== "function") {
    throw new TypeError("The browser tab must expose its current URL");
  }
  const {
    fileOrdinal,
    expectedFilename,
    expectedType,
    expectedDisplayedTimestamp,
  } = validateFileDownloadInput(input);
  const { expectedTopicId } = input;
  if (typeof expectedTopicId !== "string" || !/^\d+$/u.test(expectedTopicId)) {
    throw new TypeError("expectedTopicId must be a numeric Knowledge Planet topic ID");
  }
  const observedTopicId = topicIdFromUrl(await tab.url());
  if (observedTopicId !== expectedTopicId) {
    throw new ZsxqBrowserCollectionError(
      fileDownloadErrorCode(expectedType, "FILE_IDENTITY_MISMATCH"),
      `${expectedType}-download`,
      "The active detail page does not match the inventoried file's topic",
      { expectedTopicIdMatched: false, fileOrdinal },
    );
  }

  const { fileCard, diagnostic } = await locateDetailFileByTimeAndName(tab, {
    expectedDisplayedTimestamp,
    expectedFilename,
    expectedType,
  });
  return downloadZsxqFileCardOnTab(tab, {
    fileCard,
    fileOrdinal,
    expectedFilename,
    expectedType,
    diagnostic: { ...diagnostic, expectedTopicId },
    pageRootSelector: ZSXQ_BROWSER_CONTRACT.selectors.detailPanel,
    expectedPageUrl: await tab.url(),
    timeoutMs: input.timeoutMs,
    pollIntervalMs: input.pollIntervalMs,
  });
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
      targetDate: options.targetDate,
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
    snapshot.stickyTopics ?? null,
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
      { adapter: options.adapter, targetDate: options.targetDate },
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

function normalizeTimelineTopics(snapshot, targetDate) {
  const normalized = snapshot.topics.map((topic, index) => {
    let parsedTimestamp;
    let timestampFailure;
    try {
      parsedTimestamp = parseDisplayedTimestamp(topic.displayed_timestamp);
    } catch (error) {
      if (!(error instanceof ZsxqBrowserCollectionError)) {
        throw error;
      }
      timestampFailure = error;
    }
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
      timestamp: parsedTimestamp ? parsedTimestamp.iso : null,
      platform_date: parsedTimestamp ? parsedTimestamp.date : null,
      body: topic.body === ""
        ? { status: "empty" }
        : { status: "present", payload: topic.body },
      image_count: topic.image_count,
      attachments,
      browser_assets: topic.attachments
        .filter((attachment) => attachment.type === "image")
        .map((attachment) => attachment.browser_asset),
      displayed_timestamp: topic.displayed_timestamp,
      dom_topic_index: topic.dom_topic_index,
      image_overflow: topic.image_overflow === true,
      _timestampMilliseconds: parsedTimestamp ? parsedTimestamp.milliseconds : null,
      _timestampFailure: timestampFailure,
    };
  });

  let previousParsedIndex;
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index]._timestampMilliseconds === null) {
      continue;
    }
    if (
      previousParsedIndex !== undefined
      && normalized[index]._timestampMilliseconds
        > normalized[previousParsedIndex]._timestampMilliseconds
    ) {
      throw new ZsxqBrowserCollectionError(
        "TIMELINE_CHRONOLOGY_INCONSISTENT",
        "timeline-validation",
        "Knowledge Planet non-pinned topics are not newest first",
        { previousIndex: previousParsedIndex, currentIndex: index },
      );
    }
    previousParsedIndex = index;
  }
  return normalized;
}

function oldestParsedTopic(topics) {
  for (let index = topics.length - 1; index >= 0; index -= 1) {
    if (topics[index].platform_date !== null) {
      return topics[index];
    }
  }
  return undefined;
}

/**
 * An unreadable displayed timestamp is tolerated only strictly below a parsed
 * topic already older than the target date: from there it can no longer affect
 * target-date membership, the lower boundary, or the proven chronology.
 */
function assertTimestampsDecidable(topics, targetDate) {
  let crossed = false;
  for (const topic of topics) {
    if (topic._timestampFailure && !crossed) {
      throw topic._timestampFailure;
    }
    if (topic.platform_date !== null && topic.platform_date < targetDate) {
      crossed = true;
    }
  }
}

/**
 * A pinned topic whose publication timestamp belongs to the target date should
 * appear in the non-pinned stream (same author and instant). One that cannot
 * be proven there — or whose pinned timestamp cannot be read — is returned as
 * an unproven entry: collection continues and the reader report discloses that
 * the topic may be missing. Whether the platform duplicates same-day pinned
 * topics in the stream stays unverified.
 */
function unprovenStickyTopics(stickyTopics, allTopics, targetDate) {
  const unproven = [];
  for (const sticky of stickyTopics ?? []) {
    let parsed;
    try {
      parsed = parseDisplayedTimestamp(sticky.displayed_timestamp);
    } catch (error) {
      if (!(error instanceof ZsxqBrowserCollectionError)) {
        throw error;
      }
      unproven.push({
        author: sticky.author,
        displayed_timestamp: sticky.displayed_timestamp,
        reason: "sticky-timestamp-unreadable",
      });
      continue;
    }
    if (parsed.date !== targetDate) {
      continue;
    }
    const matched = allTopics.some(
      (topic) => topic.author === sticky.author && topic.timestamp === parsed.iso,
    );
    if (!matched) {
      unproven.push({
        author: sticky.author,
        displayed_timestamp: sticky.displayed_timestamp,
        reason: "sticky-target-date-unmatched",
      });
    }
  }
  return unproven;
}

function publicTopic(topic) {
  const result = { ...topic };
  delete result.platform_date;
  delete result.displayed_timestamp;
  delete result.image_overflow;
  delete result._timestampMilliseconds;
  delete result._timestampFailure;
  return result;
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

  // The pinned area could unmount while the timeline scrolls, so the sticky
  // safety check runs against the union of every stabilized snapshot's pinned
  // topics, never only the final snapshot.
  const observedStickyTopics = new Map();
  const registerStickyTopics = (observed) => {
    for (const sticky of observed.stickyTopics ?? []) {
      observedStickyTopics.set(
        `${sticky.author}\u0000${sticky.displayed_timestamp}`,
        sticky,
      );
    }
  };

  let snapshot = await waitForStableTimeline(tab, {
    adapter,
    targetDate: input.targetDate,
    timeoutMs,
    pollIntervalMs,
    phase: "timeline-top",
  });
  registerStickyTopics(snapshot);
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

  snapshot = await expandTargetDateUntilStable(tab, snapshot, {
    adapter,
    targetDate: input.targetDate,
    timeoutMs,
    pollIntervalMs,
  });
  registerStickyTopics(snapshot);
  let allTopics = normalizeTimelineTopics(snapshot, input.targetDate);
  if (allTopics[0]._timestampFailure) {
    throw allTopics[0]._timestampFailure;
  }

  let scrollPasses = 0;
  const requireOldestParsedTopic = (topics) => {
    const oldest = oldestParsedTopic(topics);
    if (!oldest) {
      throw new ZsxqBrowserCollectionError(
        "TIMESTAMP_FORMAT_MISMATCH",
        "timeline-pagination",
        "No loaded Knowledge Planet topic carries a parseable displayed timestamp",
        { topicCount: topics.length },
      );
    }
    return oldest;
  };
  while (
    !timelineCoverageBoundaryReached({
      oldestPlatformDate: requireOldestParsedTopic(allTopics).platform_date,
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
    const previousTopicCount = allTopics.length;
    await advanceZsxqTimelineOnTab(tab, adapter);
    const nextSnapshot = await waitForStableTimeline(tab, {
      adapter,
      targetDate: input.targetDate,
      timeoutMs,
      pollIntervalMs,
      minimumTopicCount: previousTopicCount + 1,
      phase: "timeline-pagination",
      progressAction: () => advanceZsxqTimelineOnTab(tab, adapter),
      progressRetryMs: Math.min(1_000, Math.max(10, pollIntervalMs * 4)),
    });
    registerStickyTopics(nextSnapshot);
    snapshot = await expandTargetDateUntilStable(tab, nextSnapshot, {
      adapter,
      targetDate: input.targetDate,
      timeoutMs,
      pollIntervalMs,
    });
    registerStickyTopics(snapshot);
    allTopics = normalizeTimelineTopics(snapshot, input.targetDate);
    scrollPasses += 1;
  }

  assertTimestampsDecidable(allTopics, input.targetDate);
  const unprovenStickyTopicRecords = unprovenStickyTopics(
    [...observedStickyTopics.values()],
    allTopics,
    input.targetDate,
  );

  const skippedTopics = allTopics
    .filter((topic) => topic.platform_date === input.targetDate && topic.image_overflow)
    .map((topic) => ({
      author: topic.author,
      timestamp: topic.timestamp,
      reason: "image-gallery-overflow",
    }));
  const matchingTimelineTopics = allTopics
    .filter((topic) => topic.platform_date === input.targetDate && !topic.image_overflow)
    .map((topic, index) => ({ ...topic, source_order: index + 1 }));
  const oldestParsed = oldestParsedTopic(allTopics);

  return {
    status: "complete",
    contract_version: adapter.version,
    planet_name: snapshot.planetName,
    target_date: input.targetDate,
    boundary: snapshot.endReached
      ? `absolute timeline end after ${oldestParsed.timestamp}`
      : `crossed below the target date at ${oldestParsed.timestamp}`,
    topics: matchingTimelineTopics.map(publicTopic),
    file_download_targets: matchingTimelineTopics.flatMap((topic) => topic.attachments
      .filter((attachment) => new Set(["pdf", "html", "word"]).has(attachment.type)
        && Number.isInteger(attachment.file_ordinal))
      .map((attachment) => ({
        type: attachment.type,
        topic_source_order: topic.source_order,
        source_ordinal: attachment.source_ordinal,
        file_ordinal: attachment.file_ordinal,
        dom_topic_index: topic.dom_topic_index,
        filename: attachment.filename,
        expected_displayed_timestamp: topic.displayed_timestamp,
      }))),
    skipped_topics: skippedTopics,
    unproven_sticky_topics: unprovenStickyTopicRecords,
    scroll_passes: scrollPasses,
  };
}

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
  if ((await expandZsxqDetailOnTab(tab, snapshot, ZSXQ_BROWSER_CONTRACT)).expandedCount > 0) {
    const deadline = Date.now() + (input.timeoutMs ?? 5_000);
    while (true) {
      snapshot = await inspectZsxqDetailUntilReady(tab, {
        timeoutMs: Math.max(1, deadline - Date.now()),
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
      if (snapshot.collapsed !== true) {
        break;
      }
      if (Date.now() >= deadline) {
        throw new ZsxqBrowserCollectionError(
          "DETAIL_EXPANSION_NOT_STABLE",
          "detail-expand",
          "The detail body remained geometrically collapsed after the browser click",
        );
      }
      await delay(Math.min(input.pollIntervalMs ?? 250, Math.max(1, deadline - Date.now())));
    }
  }
  return {
    status: "complete",
    contract_version: ZSXQ_BROWSER_CONTRACT.version,
    canonical_url: snapshot.pageUrl,
    author: snapshot.author,
    timestamp: parseDisplayedTimestamp(snapshot.displayed_timestamp).iso,
    body: snapshot.body === "" ? { status: "empty" } : { status: "present", payload: snapshot.body },
    images: snapshot.images,
    files: snapshot.files ?? [],
    file_download_targets: (snapshot.files ?? []).map((file) => ({
      type: file.type,
      topic_id: snapshot.topicId,
      file_ordinal: file.file_ordinal,
      dom_ordinal: file.dom_ordinal,
      filename: file.filename,
      expected_displayed_timestamp: snapshot.displayed_timestamp,
    })),
  };
}
