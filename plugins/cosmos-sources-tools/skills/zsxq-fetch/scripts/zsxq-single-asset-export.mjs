import { realpathSync } from "node:fs";
import { open, rm, stat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_EXPORT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_EXPORT_BYTES = 50 * 1024 * 1024;

function isInside(path, parent) {
  const rel = relative(parent, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function validateSourceUrl(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("sourceUrl must be a non-empty string");
  }
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError("sourceUrl must use http or https");
  }
  return url.href;
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

function validateContentType(contentType, expectedKind) {
  const normalized = contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (expectedKind === "image" && !normalized.startsWith("image/")) {
    throw new Error(`single-asset export expected an image but received ${normalized || "no content type"}`);
  }
  if (expectedKind === "pdf" && normalized !== "application/pdf") {
    throw new Error(`single-asset export expected a PDF but received ${normalized || "no content type"}`);
  }
  return normalized;
}

async function readBodyWithinLimit(response, maxBytes, controller) {
  if (!response.body) {
    throw new Error("single-asset export returned an empty body");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    byteLength += value.byteLength;
    if (byteLength > maxBytes) {
      const message = `single-asset export exceeds ${maxBytes} bytes`;
      let cancellationError;
      try {
        await reader.cancel(message);
      } catch (error) {
        cancellationError = error;
      }
      controller.abort();
      throw new Error(message, cancellationError ? { cause: cancellationError } : undefined);
    }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  if (byteLength === 0) {
    throw new Error("single-asset export returned an empty body");
  }
  return Buffer.concat(chunks, byteLength);
}

export async function exportSingleAsset({
  workspace,
  sourceUrl,
  outputPath,
  expectedKind = "image",
  timeoutMs = DEFAULT_EXPORT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_EXPORT_BYTES,
  fetchImpl = globalThis.fetch,
}) {
  if (expectedKind !== "image" && expectedKind !== "pdf") {
    throw new TypeError("expectedKind must be image or pdf");
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function");
  }
  const exactSourceUrl = validateSourceUrl(sourceUrl);
  positiveInteger(timeoutMs, "timeoutMs");
  positiveInteger(maxBytes, "maxBytes");

  const canonicalWorkspace = await realpath(resolve(workspace));
  const requestedOutput = resolve(outputPath);
  const canonicalParent = await realpath(dirname(requestedOutput));
  if (!isInside(canonicalParent, canonicalWorkspace)) {
    throw new Error("outputPath must resolve inside the run workspace");
  }
  try {
    await stat(requestedOutput);
    throw new Error("outputPath must not already exist");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(exactSourceUrl, {
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`single-asset export failed with HTTP ${response.status}`);
    }
    const contentType = validateContentType(
      response.headers.get("content-type"),
      expectedKind,
    );
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      const message = `single-asset export exceeds ${maxBytes} bytes`;
      let cancellationError;
      try {
        await response.body?.cancel(message);
      } catch (error) {
        cancellationError = error;
      }
      controller.abort();
      throw new Error(message, cancellationError ? { cause: cancellationError } : undefined);
    }
    const bytes = await readBodyWithinLimit(response, maxBytes, controller);
    let outputHandle;
    try {
      outputHandle = await open(requestedOutput, "wx", 0o600);
    } catch (error) {
      if (error.code === "EEXIST") {
        throw new Error("outputPath must not already exist", { cause: error });
      }
      throw error;
    }
    try {
      await outputHandle.writeFile(bytes);
    } catch (error) {
      await rm(requestedOutput, { force: true });
      throw error;
    } finally {
      await outputHandle.close();
    }
    return {
      output_path: requestedOutput,
      byte_length: bytes.length,
      content_type: contentType,
      remote_export_attempts: 1,
      remote_export_batch_size: 1,
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("Arguments must be --name value pairs");
    }
    options[key.slice(2)] = value;
  }
  return options;
}

async function main(argv) {
  const options = parseArguments(argv);
  const result = await exportSingleAsset({
    workspace: options.workspace,
    sourceUrl: options.url,
    outputPath: options.output,
    expectedKind: options.kind ?? "image",
    timeoutMs: options.timeout ? Number(options.timeout) : DEFAULT_EXPORT_TIMEOUT_MS,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

// Resolve the invoked path before comparing: Node resolves `import.meta.url`
// through symbolic links but leaves `process.argv[1]` as typed.
function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  let resolved = entry;
  try {
    resolved = realpathSync(entry);
  } catch {
    // keep the unresolved path; the comparison below still decides
  }
  return import.meta.url === pathToFileURL(entry).href
    || import.meta.url === pathToFileURL(resolved).href;
}

if (isMainModule()) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
