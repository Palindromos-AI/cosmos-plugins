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

/**
 * Extract visible Knowledge Planet topic bodies without sibling UI controls.
 *
 * This function is intentionally self-contained so it can be passed directly to
 * the browser's page-evaluation API after being imported from this skill.
 */
export function extractZsxqTopicBodies(input) {
  const documentLike = input !== null
    && typeof input === "object"
    && typeof input.querySelectorAll === "function";
  let documentRoot;
  let expectedTopicCount;
  let topicRootSelector = "app-talk-content";
  let excludedAncestorSelector;

  if (documentLike) {
    documentRoot = input;
  } else {
    if (
      input === null
      || typeof input !== "object"
      || !Number.isInteger(input.expectedTopicCount)
      || input.expectedTopicCount < 0
    ) {
      throw new TypeError(
        "Pass a document-like root or { expectedTopicCount: a non-negative integer }",
      );
    }
    documentRoot = document;
    expectedTopicCount = input.expectedTopicCount;
    if (input.topicRootSelector !== undefined) {
      if (
        typeof input.topicRootSelector !== "string"
        || input.topicRootSelector.trim() === ""
      ) {
        throw new TypeError("topicRootSelector must be a non-empty string");
      }
      topicRootSelector = input.topicRootSelector;
    }
    if (input.excludedAncestorSelector !== undefined) {
      if (
        typeof input.excludedAncestorSelector !== "string"
        || input.excludedAncestorSelector.trim() === ""
      ) {
        throw new TypeError("excludedAncestorSelector must be a non-empty string");
      }
      excludedAncestorSelector = input.excludedAncestorSelector;
    }
  }

  const selectedTopicRoots = [...documentRoot.querySelectorAll(topicRootSelector)];
  if (
    excludedAncestorSelector !== undefined
    && selectedTopicRoots.some((topicRoot) => typeof topicRoot.closest !== "function")
  ) {
    throw new Error(
      "Knowledge Planet topic roots cannot apply the excluded ancestor contract",
    );
  }
  const topicRoots = selectedTopicRoots.filter(
    (topicRoot) => excludedAncestorSelector === undefined
      || topicRoot.closest(excludedAncestorSelector) === null,
  );

  if (
    expectedTopicCount !== undefined
    && topicRoots.length !== expectedTopicCount
  ) {
    throw new Error(
      `Knowledge Planet topic root count ${topicRoots.length} does not match independently observed count ${expectedTopicCount}`,
    );
  }

  return topicRoots.map((topicRoot, index) => {
    const bodyElements = [...topicRoot.querySelectorAll(
      ":scope > .talk-content-container > .content",
    )];

    if (
      bodyElements.length !== 1
      || typeof bodyElements[0].querySelectorAll !== "function"
      || typeof bodyElements[0].innerText !== "string"
    ) {
      throw new Error(
        `Knowledge Planet topic ${index + 1} must have exactly one readable .talk-content-container > .content body`,
      );
    }

    const [bodyElement] = bodyElements;
    if (bodyElement.querySelectorAll(":scope .showAll").length !== 0) {
      throw new Error(
        `Knowledge Planet topic ${index + 1} contains an expand/collapse control inside its body`,
      );
    }

    return {
      dom_index: index,
      body: bodyElement.innerText,
    };
  });
}

/**
 * Wait for a Knowledge Planet detail page to reach a stable readable state.
 *
 * This function is intentionally self-contained so it can be serialized and
 * passed directly to the browser's page-evaluation API after navigation.
 */
export async function waitForZsxqDetailReady(input) {
  if (input === null || typeof input !== "object") {
    throw new TypeError("Pass Knowledge Planet detail readiness options");
  }

  const expectedTopicCount = input.expectedTopicCount;
  const expectedImageCount = input.expectedImageCount;
  const timeoutMs = input.timeoutMs ?? 5_000;
  const pollIntervalMs = input.pollIntervalMs ?? 250;
  const stableSamples = input.stableSamples ?? 2;

  if (!Number.isInteger(expectedTopicCount) || expectedTopicCount < 1) {
    throw new TypeError("expectedTopicCount must be a positive integer");
  }
  if (
    expectedImageCount !== undefined
    && (!Number.isInteger(expectedImageCount) || expectedImageCount < 0)
  ) {
    throw new TypeError(
      "expectedImageCount must be a non-negative integer when supplied",
    );
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new TypeError("timeoutMs must be an integer from 1 through 60000");
  }
  if (
    !Number.isInteger(pollIntervalMs)
    || pollIntervalMs < 1
    || pollIntervalMs > timeoutMs
  ) {
    throw new TypeError(
      "pollIntervalMs must be a positive integer no greater than timeoutMs",
    );
  }
  if (!Number.isInteger(stableSamples) || stableSamples < 1 || stableSamples > 10) {
    throw new TypeError("stableSamples must be an integer from 1 through 10");
  }

  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let previousSignature;
  let consecutiveStableSamples = 0;
  let lastState;

  while (true) {
    attempts += 1;
    const detailPanels = [...document.querySelectorAll(".topic-detail-panel")];
    const topicRoots = [...document.querySelectorAll(
      ".topic-detail-panel app-talk-content",
    )];
    const imageElements = [...document.querySelectorAll(
      ".topic-detail-panel app-talk-content img",
    )];

    const bodySnapshots = topicRoots.map((topicRoot) => {
      const bodyElements = [...topicRoot.querySelectorAll(
        ":scope > .talk-content-container > .content",
      )];
      if (
        bodyElements.length !== 1
        || typeof bodyElements[0].innerText !== "string"
        || typeof bodyElements[0].querySelectorAll !== "function"
      ) {
        return null;
      }
      if (bodyElements[0].querySelectorAll(":scope .showAll").length !== 0) {
        return null;
      }
      return bodyElements[0].innerText;
    });
    const readableBodyCount = bodySnapshots.filter(
      (bodySnapshot) => bodySnapshot !== null,
    ).length;

    const imageSnapshots = imageElements.map((imageElement) => ({
      source: typeof imageElement.currentSrc === "string" && imageElement.currentSrc
        ? imageElement.currentSrc
        : typeof imageElement.src === "string"
          ? imageElement.src
          : "",
      complete: imageElement.complete === true,
      naturalWidth: Number(imageElement.naturalWidth) || 0,
      naturalHeight: Number(imageElement.naturalHeight) || 0,
    }));

    const pendingImageCount = imageSnapshots.filter(
      (imageSnapshot) => imageSnapshot.complete !== true,
    ).length;
    const brokenImageCount = imageSnapshots.filter(
      (imageSnapshot) => imageSnapshot.complete === true
        && (imageSnapshot.naturalWidth < 1 || imageSnapshot.naturalHeight < 1),
    ).length;
    const loadedImageCount = imageSnapshots.filter(
      (imageSnapshot) => imageSnapshot.complete === true
        && imageSnapshot.naturalWidth >= 1
        && imageSnapshot.naturalHeight >= 1,
    ).length;

    lastState = {
      detailPanelCount: detailPanels.length,
      topicRootCount: topicRoots.length,
      readableBodyCount,
      imageElementCount: imageElements.length,
      pendingImageCount,
      brokenImageCount,
      loadedImageCount,
      attempts,
    };

    const structureReady = detailPanels.length === 1
      && topicRoots.length === expectedTopicCount
      && readableBodyCount === expectedTopicCount;
    const imagesReady = pendingImageCount === 0
      && brokenImageCount === 0
      && (
        expectedImageCount === undefined
        || loadedImageCount === expectedImageCount
      );
    const signature = JSON.stringify([
      detailPanels.length,
      topicRoots.length,
      bodySnapshots,
      imageSnapshots,
    ]);

    if (structureReady && imagesReady) {
      consecutiveStableSamples = signature === previousSignature
        ? consecutiveStableSamples + 1
        : 1;
      if (consecutiveStableSamples >= stableSamples) {
        return lastState;
      }
    } else {
      consecutiveStableSamples = 0;
    }
    previousSignature = signature;

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      const expectedImages = expectedImageCount === undefined
        ? "stable loaded set"
        : expectedImageCount;
      throw new Error(
        `Knowledge Planet detail page did not become ready within ${timeoutMs}ms `
        + `(panels=${lastState.detailPanelCount}, `
        + `topics=${lastState.topicRootCount}/${expectedTopicCount}, `
        + `readableBodies=${lastState.readableBodyCount}/${expectedTopicCount}, `
        + `pendingImages=${lastState.pendingImageCount}, `
        + `brokenImages=${lastState.brokenImageCount}, `
        + `loadedImages=${lastState.loadedImageCount}/${expectedImages})`,
      );
    }

    await new Promise((resolvePromise) => {
      setTimeout(resolvePromise, Math.min(pollIntervalMs, remainingMs));
    });
  }
}

/**
 * Enter the page-level readiness poll after redirects have settled.
 *
 * Unlike waitForZsxqDetailReady, this function runs in the persistent Node
 * browser-control session and must not be serialized into the page.
 */
export async function waitForZsxqDetailReadyOnTab(tab, input) {
  if (
    tab === null
    || typeof tab !== "object"
    || tab.playwright === null
    || typeof tab.playwright !== "object"
    || typeof tab.playwright.evaluate !== "function"
  ) {
    throw new TypeError("Pass a browser tab with playwright.evaluate");
  }
  if (input === null || typeof input !== "object") {
    throw new TypeError("Pass Knowledge Planet detail readiness options");
  }

  const timeoutMs = input.timeoutMs ?? 5_000;
  const pollIntervalMs = input.pollIntervalMs ?? 250;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new TypeError("timeoutMs must be an integer from 1 through 60000");
  }
  if (
    !Number.isInteger(pollIntervalMs)
    || pollIntervalMs < 1
    || pollIntervalMs > timeoutMs
  ) {
    throw new TypeError(
      "pollIntervalMs must be a positive integer no greater than timeoutMs",
    );
  }

  const deadline = Date.now() + timeoutMs;
  let navigationAttempts = 0;
  let lastNavigationError;

  while (true) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(
        `Knowledge Planet detail navigation did not stabilize within ${timeoutMs}ms`,
        { cause: lastNavigationError },
      );
    }

    navigationAttempts += 1;
    try {
      const state = await tab.playwright.evaluate(waitForZsxqDetailReady, {
        ...input,
        timeoutMs: remainingMs,
        pollIntervalMs: Math.min(pollIntervalMs, remainingMs),
      });
      return { ...state, navigationAttempts };
    } catch (error) {
      const message = thrownMessage(error);
      const navigationChanged = /Inspected target navigated or closed/u.test(message)
        || /Execution context was destroyed.*navigation/iu.test(message);
      if (!navigationChanged) {
        throw error;
      }
      await assertTabReachable(tab, error);
      lastNavigationError = error;
    }

    const remainingAfterFailure = deadline - Date.now();
    if (remainingAfterFailure <= 0) {
      throw new Error(
        `Knowledge Planet detail navigation did not stabilize within ${timeoutMs}ms`,
        { cause: lastNavigationError },
      );
    }
    await new Promise((resolvePromise) => {
      setTimeout(
        resolvePromise,
        Math.min(pollIntervalMs, remainingAfterFailure),
      );
    });
  }
}
