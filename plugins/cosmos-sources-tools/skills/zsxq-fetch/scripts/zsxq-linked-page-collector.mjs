const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 250;

const SIGNED_QUERY_KEY = /^(?:token|access_token|auth|authorization|signature|sig|expires|expiry|x-amz-.+|x-goog-.+|ossaccesskeyid|security-token)$/iu;

function requireHttpUrl(value, label = "url") {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty HTTP(S) URL`);
  }
  const parsed = new URL(value);
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
    throw new TypeError(`${label} must be a non-empty HTTP(S) URL`);
  }
  return parsed;
}

export function sanitizeReportUrl(value) {
  const parsed = requireHttpUrl(value);
  const signed = [...parsed.searchParams.keys()].some((key) => SIGNED_QUERY_KEY.test(key));
  if (signed) {
    parsed.search = "";
    parsed.hash = "";
  }
  return parsed.href;
}

function escapeMarkdownLabel(value) {
  return value.replace(/([\\\[\]])/gu, "\\$1").replace(/\s+/gu, " ").trim();
}

function markdownFileLink(file) {
  return `[${escapeMarkdownLabel(file.filename)}](<${file.url}>)`;
}

export function mergeLinkedFileLinks(bodyMarkdown, fileLinks) {
  if (typeof bodyMarkdown !== "string") {
    throw new TypeError("bodyMarkdown must be a string");
  }
  if (!Array.isArray(fileLinks)) {
    throw new TypeError("fileLinks must be an array");
  }
  // Sanitize transport URLs independently of Markdown syntax, including
  // autolinks and ordinary URLs with balanced parentheses in their path.
  bodyMarkdown = bodyMarkdown.replace(/https?:\/\/[^\s<>"]+/gu, (raw) => {
    let target = raw;
    let suffix = "";
    while (/[.,;!\]]$/u.test(target)
      || (target.endsWith(")") && (target.match(/\)/gu)?.length ?? 0) > (target.match(/\(/gu)?.length ?? 0))) {
      suffix = target.slice(-1) + suffix;
      target = target.slice(0, -1);
    }
    try { return sanitizeReportUrl(target) + suffix; } catch { return raw; }
  });
  const seen = new Set();
  const missing = [];
  for (const candidate of fileLinks) {
    if (!candidate || typeof candidate !== "object") {
      throw new TypeError("every file link must be an object");
    }
    const url = sanitizeReportUrl(candidate.url);
    if (seen.has(url)) continue;
    seen.add(url);
    let replaced = false;
    bodyMarkdown = bodyMarkdown.replace(/(?<!!)\[((?:\\.|[^\]\\])*)\]\(\s*(?:<([^>]+)>|((?:[^\s()]|\([^)]*\))+))(?:\s+"[^"]*")?\s*\)/gu,
      (match, label, angleUrl, plainUrl) => {
        let target;
        try { target = sanitizeReportUrl(angleUrl ?? plainUrl); } catch { return match; }
        if (target !== url) return match;
        if (replaced) return label;
        replaced = true;
        return markdownFileLink({ ...candidate, url });
      });
    if (replaced) continue;
    if (bodyMarkdown.includes(`<${url}>`)) {
      bodyMarkdown = bodyMarkdown.replace(`<${url}>`, markdownFileLink({ ...candidate, url }));
      continue;
    }
    missing.push(markdownFileLink({ ...candidate, url }));
  }
  if (missing.length === 0) return bodyMarkdown.trim();
  return `${bodyMarkdown.trim()}\n\n${missing.join("\n")}`.trim();
}

/**
 * Inspect one rendered external page. This function is serialized into the
 * browser, so it deliberately closes over no module state.
 */
export function inspectLinkedPage() {
  const signedQueryKey = /^(?:token|access_token|auth|authorization|signature|sig|expires|expiry|x-amz-.+|x-goog-.+|ossaccesskeyid|security-token)$/iu;
  const blockTags = new Set([
    "ADDRESS", "ARTICLE", "BLOCKQUOTE", "DIV", "DL", "FIELDSET", "FIGCAPTION",
    "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6",
    "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION",
    "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "UL",
  ]);
  const ignoredTags = new Set(["CANVAS", "NOSCRIPT", "SCRIPT", "STYLE", "SVG", "TEMPLATE"]);
  const hidden = (node) => {
    if (node.getAttribute?.("hidden") != null) return true;
    if (typeof getComputedStyle !== "function") return false;
    const style = getComputedStyle(node);
    return style.display === "none" || style.visibility === "hidden" || style.contentVisibility === "hidden";
  };
  const safeUrl = (value) => {
    try {
      const parsed = new URL(value, location.href);
      if (!new Set(["http:", "https:"]).has(parsed.protocol)) return null;
      if ([...parsed.searchParams.keys()].some((key) => signedQueryKey.test(key))) {
        parsed.search = "";
        parsed.hash = "";
      }
      return parsed.href;
    } catch {
      return null;
    }
  };
  const exactUrl = (value) => {
    try {
      const parsed = new URL(value, location.href);
      return new Set(["http:", "https:"]).has(parsed.protocol) ? parsed.href : null;
    } catch {
      return null;
    }
  };
  const classify = (parsed, mimeType, visibleText) => {
    const combined = `${mimeType} ${visibleText}`;
    if (/\.pdf$/iu.test(parsed.pathname) || /application\/pdf|\bpdf\b/iu.test(combined)) {
      return "pdf";
    }
    if (
      /\.docx?$/iu.test(parsed.pathname)
      || /application\/(?:msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document)/iu.test(combined)
      || /\bword\b|\.docx?\b/iu.test(combined)
    ) return "word";
    if (
      /\.html?$/iu.test(parsed.pathname)
      || /text\/html/iu.test(mimeType)
      || /\bhtml\b|\.html?\b/iu.test(visibleText)
    ) return "html";
    return null;
  };
  const filename = (type, visibleText, parsed, declared = "") => {
    const extension = type === "word"
      ? (parsed.pathname.match(/\.docx?$/iu)?.[0] ?? ".docx")
      : type === "html"
        ? (parsed.pathname.match(/\.html?$/iu)?.[0] ?? ".html")
        : ".pdf";
    let basename = "";
    try {
      basename = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).at(-1) ?? "");
    } catch {
      basename = parsed.pathname.split("/").filter(Boolean).at(-1) ?? "";
    }
    const candidates = [declared, visibleText, basename]
      .map((candidate) => typeof candidate === "string" ? candidate.trim() : "")
      .filter(Boolean);
    const matching = candidates.find((candidate) => (
      type === "pdf" ? /\.pdf$/iu.test(candidate)
        : type === "word" ? /\.docx?$/iu.test(candidate)
          : /\.html?$/iu.test(candidate)
    ));
    return matching ?? `${candidates[0] ?? `linked-${type}`}${extension}`;
  };
  const label = (value) => value.replace(/([\\\[\]])/gu, "\\$1").replace(/\s+/gu, " ").trim();
  const root = document.querySelector("article, main, [role='main']") || document.body;
  if (!root) {
    return {
      ok: false,
      transient: true,
      code: "LINKED_PAGE_BODY_NOT_READY",
      title: typeof document.title === "string" ? document.title.trim() : "",
      body_markdown: "",
      file_links: [],
    };
  }

  const fileLinks = [];
  const fileByUrl = new Map();
  const mediaElements = [...root.querySelectorAll("a[href], object[data], embed[src], iframe[src]")];
  for (const media of mediaElements) {
    const tag = typeof media.tagName === "string" ? media.tagName.toUpperCase() : "";
    const raw = tag === "OBJECT"
      ? media.getAttribute?.("data")
      : tag === "A"
        ? (media.getAttribute?.("href") || media.href)
        : (media.getAttribute?.("src") || media.src);
    const reportUrl = safeUrl(raw);
    if (!reportUrl || fileByUrl.has(reportUrl)) continue;
    const parsed = new URL(reportUrl);
    const visibleText = typeof media.textContent === "string" ? media.textContent.trim() : "";
    const mimeType = media.getAttribute?.("type") ?? "";
    const type = classify(parsed, mimeType, visibleText);
    if (!type) continue;
    const record = {
      type,
      filename: filename(type, visibleText, parsed, media.getAttribute?.("download") ?? ""),
      url: reportUrl,
    };
    fileByUrl.set(reportUrl, record);
    fileLinks.push(record);
  }

  const emittedFiles = new Set();
  const serialize = (node) => {
    if (!node) return "";
    if (Number(node.nodeType) === 3) return typeof node.nodeValue === "string" ? node.nodeValue : "";
    if (Number(node.nodeType) !== 1) return "";
    const tag = typeof node.tagName === "string" ? node.tagName.toUpperCase() : "";
    if (ignoredTags.has(tag) || hidden(node)) return "";
    if (tag === "BR") return "\n";
    if (tag === "A") {
      const raw = node.getAttribute?.("href") || node.href;
      const reportUrl = safeUrl(raw);
      const visibleText = typeof node.textContent === "string" ? node.textContent.trim() : "";
      if (!reportUrl) return visibleText;
      const file = fileByUrl.get(reportUrl);
      if (file && emittedFiles.has(reportUrl)) return visibleText;
      if (file) emittedFiles.add(reportUrl);
      return `[${label(file?.filename || visibleText || reportUrl)}](<${reportUrl}>)`;
    }
    if (new Set(["OBJECT", "EMBED", "IFRAME"]).has(tag)) return "";
    const content = [...(node.childNodes ?? [])].map(serialize).join("");
    return blockTags.has(tag) ? `\n${content}\n` : content;
  };
  let bodyMarkdown = serialize(root)
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  const missingEmbeddedFiles = fileLinks
    .filter((file) => !emittedFiles.has(file.url))
    .map((file) => `[${label(file.filename)}](<${file.url}>)`);
  if (missingEmbeddedFiles.length > 0) {
    bodyMarkdown = `${bodyMarkdown}\n\n${missingEmbeddedFiles.join("\n")}`.trim();
  }
  const images = [...root.querySelectorAll("img")]
    .map((image) => ({
      // Image acquisition needs the exact in-memory URL. Signed transport
      // values are never rendered and disappear with the task's run state.
      source_url: exactUrl(image.currentSrc || image.src),
      alt: typeof image.getAttribute === "function" ? (image.getAttribute("alt") ?? "") : "",
    }))
    .filter((image) => image.source_url !== null);
  const title = typeof document.title === "string" ? document.title.trim() : "";
  const mainText = (node) => {
    if (Number(node.nodeType) === 3) return node.nodeValue ?? "";
    if (Number(node.nodeType) !== 1) return "";
    const tag = node.tagName?.toUpperCase();
    if (hidden(node) || ignoredTags.has(tag) || ["NAV", "HEADER", "FOOTER", "ASIDE"].includes(tag)
      || node.getAttribute?.("role") === "navigation") return "";
    const text = [...(node.childNodes ?? [])].map(mainText).join("");
    return blockTags.has(tag) ? `\n${text}\n` : text;
  };
  const visibleBody = mainText(root).trim();
  // A loading message is a blocker only when it is the main content,
  // not when it accompanies a readable article (e.g. an ad loading below it).
  const placeholder = /^(?:(?:感谢您的推荐[，,\s]*)?正在寻找[^\n]{0,60}|(?:正在加载|加载中|loading|please wait)[,.…。，\s]*(?:请稍候|please wait)?[.!…。\s]*)$/iu.test(visibleBody);
  const challenge = /^(?:just a moment|access denied|attention required)/iu.test(title)
    || (visibleBody.length < 1000 && /verify (?:that )?you are human|checking your browser|enable javascript and cookies/iu.test(visibleBody));
  const meaningful = !placeholder && !challenge
    && (visibleBody.length > 0 || fileLinks.length > 0 || images.length > 0);
  return {
    ok: meaningful,
    transient: true,
    code: challenge ? "LINKED_PAGE_ACCESS_BLOCKED" : placeholder ? "LINKED_PAGE_LOADING" : "LINKED_PAGE_EMPTY",
    title,
    original_url: safeUrl(location.href),
    body_markdown: bodyMarkdown,
    file_links: fileLinks,
    images,
  };
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

export async function collectLinkedPageOnTab(tab, input) {
  if (!tab || typeof tab !== "object" || typeof tab.playwright?.evaluate !== "function") {
    throw new TypeError("A browser tab with playwright.evaluate is required");
  }
  if (!input || typeof input !== "object") {
    throw new TypeError("Linked-page collection options are required");
  }
  const url = requireHttpUrl(input.url).href;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new TypeError("timeoutMs must be an integer from 1 through 60000");
  }
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 1 || pollIntervalMs > timeoutMs) {
    throw new TypeError("pollIntervalMs must be an integer from 1 through timeoutMs");
  }
  let navigationFailed = false;
  try {
    if (typeof tab.goto === "function") await tab.goto(url);
  } catch {
    // Navigation may time out on a subresource while the article is readable.
    navigationFailed = true;
  }
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot;
  while (true) {
    try {
      const snapshot = await tab.playwright.evaluate(inspectLinkedPage);
      lastSnapshot = snapshot;
      if (navigationFailed && snapshot?.original_url !== sanitizeReportUrl(url)) {
        return { status: "failed", code: "LINKED_PAGE_NAVIGATION_FAILED", title: url,
          reader_note: "浏览器导航失败，未确认已打开目标页面。" };
      }
      if (snapshot?.ok === true) {
        const payload = typeof snapshot.body_markdown === "string" ? snapshot.body_markdown.trim() : "";
        return {
          status: "complete",
          title: snapshot.title || url,
          original_url: snapshot.original_url || url,
          body: payload === "" ? { status: "empty" } : { status: "present", payload },
          file_links: Array.isArray(snapshot.file_links) ? snapshot.file_links : [],
          images: Array.isArray(snapshot.images) ? snapshot.images : [],
        };
      }
    } catch (error) {
      const errorType = error instanceof TypeError ? "TypeError" : error instanceof ReferenceError ? "ReferenceError" : "Error";
      lastSnapshot = { code: "LINKED_PAGE_READ_ERROR", reader_note: `浏览器页面读取失败（${errorType}）。` };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return {
        status: "failed",
        code: lastSnapshot?.code || "LINKED_PAGE_EMPTY",
        title: lastSnapshot?.title || url,
        reader_note: lastSnapshot?.reader_note || ({
          LINKED_PAGE_ACCESS_BLOCKED: "页面仍显示访问拦截，未取得正文。",
          LINKED_PAGE_LOADING: "页面仍只显示加载提示，未取得正文。",
        }[lastSnapshot?.code] ?? "页面未返回可读正文或媒体。"),
      };
    }
    await delay(Math.min(pollIntervalMs, remaining));
  }
}
