import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import {
  loadSharp,
  planImageTiles,
  TILE_SCHEMA_VERSION,
} from "./zsxq-image-tiles.mjs";

export const SCHEMA_VERSION = 1;
export const GENERATOR = "zsxq-fetch";

const EXTRACTION_STATUSES = new Set(["present", "empty", "failed"]);
const REPRESENTATION_TYPES = new Set([
  "rendered-preview",
  "locator-screenshot",
  "viewer-screenshot",
  "single-asset-export",
  "page-screenshot",
]);
const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/u;

export function sha256Utf8(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function fail(path, message) {
  throw new Error(`${path}: ${message}`);
}

function object(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "must be an object");
  }
  return value;
}

function array(value, path) {
  if (!Array.isArray(value)) {
    fail(path, "must be an array");
  }
  return value;
}

function string(value, path, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    fail(path, allowEmpty ? "must be a string" : "must be a non-empty string");
  }
  return value;
}

function optionalString(value, path) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return string(value, path);
}

function boolean(value, path) {
  if (typeof value !== "boolean") {
    fail(path, "must be a boolean");
  }
  return value;
}

function integer(value, path, { minimum = 0 } = {}) {
  if (!Number.isInteger(value) || value < minimum) {
    fail(path, `must be an integer >= ${minimum}`);
  }
  return value;
}

function oneOf(value, choices, path) {
  if (!choices.has(value)) {
    fail(path, `must be one of ${[...choices].join(", ")}`);
  }
  return value;
}

function cleanSingleLine(value, path) {
  const result = string(value, path).trim();
  if (/\r|\n|[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(result)) {
    fail(path, "must be a single line without control characters");
  }
  return result;
}

function isoTimestamp(value, path) {
  const result = cleanSingleLine(value, path);
  if (!ISO_TIMESTAMP.test(result) || Number.isNaN(Date.parse(result))) {
    fail(path, "must be an ISO-8601 date-time with an explicit Z or UTC offset");
  }
  return result;
}

function httpUrl(value, path) {
  const raw = cleanSingleLine(value, path);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail(path, "must be a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    fail(path, "must use http or https");
  }
  return raw;
}

async function insideWorkspace(path, workspace, field) {
  const absolute = await realpath(resolve(string(path, field))).catch((error) => {
    throw new Error(`${field}: cannot resolve the referenced file: ${error.message}`);
  });
  const canonicalWorkspace = await realpath(workspace);
  const rel = relative(canonicalWorkspace, absolute);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    fail(field, "must point to a file inside the dedicated run workspace");
  }
  return absolute;
}

function assertNoUnexpectedKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail(path, `contains unsupported field ${key}`);
    }
  }
}

function normalizeExtraction(value, path) {
  const input = object(value, path);
  assertNoUnexpectedKeys(
    input,
    new Set([
      "status",
      "payload",
      "recovered_payload",
      "failure_reason",
      "reader_note",
    ]),
    path,
  );
  const status = oneOf(input.status, EXTRACTION_STATUSES, `${path}.status`);

  if (status === "present") {
    const payload = string(input.payload, `${path}.payload`);
    if (
      input.recovered_payload !== undefined ||
      input.failure_reason !== undefined ||
      input.reader_note !== undefined
    ) {
      fail(path, "present content cannot include failure fields");
    }
    return {
      status,
      payload,
      payload_sha256: sha256Utf8(payload),
      recovered_payload: null,
      recovered_payload_sha256: null,
      failure_reason: null,
      reader_note: null,
    };
  }

  if (status === "empty") {
    if (
      input.payload !== undefined ||
      input.recovered_payload !== undefined ||
      input.failure_reason !== undefined ||
      input.reader_note !== undefined
    ) {
      fail(path, "empty content cannot include payload or failure fields");
    }
    return {
      status,
      payload: null,
      payload_sha256: null,
      recovered_payload: null,
      recovered_payload_sha256: null,
      failure_reason: null,
      reader_note: null,
    };
  }

  if (input.payload !== undefined) {
    fail(path, "failed content must use recovered_payload instead of payload");
  }
  const recoveredPayload = optionalString(
    input.recovered_payload,
    `${path}.recovered_payload`,
  );
  return {
    status,
    payload: null,
    payload_sha256: null,
    recovered_payload: recoveredPayload,
    recovered_payload_sha256: recoveredPayload
      ? sha256Utf8(recoveredPayload)
      : null,
    failure_reason: cleanSingleLine(
      input.failure_reason,
      `${path}.failure_reason`,
    ),
    reader_note: cleanSingleLine(input.reader_note, `${path}.reader_note`),
  };
}

async function normalizeSource(value, workspace, path) {
  const input = object(value ?? {}, path);
  assertNoUnexpectedKeys(
    input,
    new Set(["platform_id", "transport_url", "binary_path"]),
    path,
  );
  const platformId = optionalString(input.platform_id, `${path}.platform_id`);
  const transportUrl = input.transport_url
    ? httpUrl(input.transport_url, `${path}.transport_url`)
    : null;
  let sanitizedSourceUrl = null;
  if (transportUrl) {
    const parsed = new URL(transportUrl);
    parsed.search = "";
    parsed.hash = "";
    sanitizedSourceUrl = parsed.href;
  }
  const binaryPath = input.binary_path
    ? await insideWorkspace(input.binary_path, workspace, `${path}.binary_path`)
    : null;
  const binarySha256 = binaryPath ? await sha256File(binaryPath) : null;
  let sourceIdentity = "no-source-identity";
  if (platformId) {
    sourceIdentity = `platform-id:${platformId}`;
  } else if (transportUrl) {
    sourceIdentity = `url-sha256:${sha256Utf8(transportUrl)}`;
  } else if (binarySha256) {
    sourceIdentity = `binary-sha256:${binarySha256}`;
  }
  return {
    platform_id: platformId,
    transport_url: transportUrl,
    sanitized_source_url: sanitizedSourceUrl,
    binary_path: binaryPath,
    binary_sha256: binarySha256,
    source_identity: sourceIdentity,
  };
}

async function representationHash(
  input,
  workspace,
  path,
  { required = true } = {},
) {
  const paths = input.representation_paths ??
    (input.representation_path ? [input.representation_path] : []);
  array(paths, `${path}.representation_paths`);
  if (paths.length === 0) {
    if (required) {
      fail(path, "requires representation_path or representation_paths");
    }
    return {
      representation_paths: [],
      representation_file_sha256: [],
      representation_sha256: null,
    };
  }
  const absolutePaths = [];
  const hashes = [];
  for (const [index, item] of paths.entries()) {
    const absolute = await insideWorkspace(
      item,
      workspace,
      `${path}.representation_paths[${index}]`,
    );
    absolutePaths.push(absolute);
    hashes.push(await sha256File(absolute));
  }
  return {
    representation_paths: absolutePaths,
    representation_file_sha256: hashes,
    representation_sha256:
      hashes.length === 1 ? hashes[0] : sha256Utf8(JSON.stringify(hashes)),
  };
}

function sha256Value(value, path) {
  const result = cleanSingleLine(value, path);
  if (!/^[a-f0-9]{64}$/u.test(result)) {
    fail(path, "must be a lowercase SHA-256 value");
  }
  return result;
}

async function imageMetadata(path, field) {
  let metadata;
  try {
    const sharp = await loadSharp();
    metadata = await sharp(path).metadata();
  } catch (error) {
    fail(field, `cannot read image metadata: ${error.message}`);
  }
  if (!Number.isInteger(metadata.width) || !Number.isInteger(metadata.height)) {
    fail(field, "does not expose integer pixel dimensions");
  }
  return metadata;
}

async function normalizeTileAnalysis(
  input,
  representation,
  workspace,
  width,
  height,
  path,
) {
  if (
    input.tile_manifest_path === undefined &&
    input.tile_verifications === undefined
  ) {
    return null;
  }
  if (
    input.tile_manifest_path === undefined ||
    input.tile_verifications === undefined
  ) {
    fail(path, "tile_manifest_path and tile_verifications must appear together");
  }
  if (representation.representation_paths.length !== 1) {
    fail(path, "tiled analysis requires exactly one source representation");
  }

  const manifestPath = await insideWorkspace(
    input.tile_manifest_path,
    workspace,
    `${path}.tile_manifest_path`,
  );
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    fail(`${path}.tile_manifest_path`, `cannot read tile manifest: ${error.message}`);
  }
  object(manifest, `${path}.tile_manifest`);
  assertNoUnexpectedKeys(
    manifest,
    new Set(["schema_version", "source", "normalized", "settings", "grid", "tiles"]),
    `${path}.tile_manifest`,
  );
  if (manifest.schema_version !== TILE_SCHEMA_VERSION) {
    fail(`${path}.tile_manifest.schema_version`, `must equal ${TILE_SCHEMA_VERSION}`);
  }

  const source = object(manifest.source, `${path}.tile_manifest.source`);
  assertNoUnexpectedKeys(
    source,
    new Set(["path", "sha256"]),
    `${path}.tile_manifest.source`,
  );
  const sourcePath = await insideWorkspace(
    source.path,
    workspace,
    `${path}.tile_manifest.source.path`,
  );
  const sourceSha256 = sha256Value(
    source.sha256,
    `${path}.tile_manifest.source.sha256`,
  );
  if (
    sourcePath !== representation.representation_paths[0] ||
    sourceSha256 !== representation.representation_file_sha256[0]
  ) {
    fail(path, "tile manifest source must equal the image representation byte-for-byte");
  }

  const normalized = object(
    manifest.normalized,
    `${path}.tile_manifest.normalized`,
  );
  assertNoUnexpectedKeys(
    normalized,
    new Set(["path", "sha256", "width", "height"]),
    `${path}.tile_manifest.normalized`,
  );
  const normalizedPath = await insideWorkspace(
    normalized.path,
    workspace,
    `${path}.tile_manifest.normalized.path`,
  );
  const normalizedSha256 = sha256Value(
    normalized.sha256,
    `${path}.tile_manifest.normalized.sha256`,
  );
  if (await sha256File(normalizedPath) !== normalizedSha256) {
    fail(`${path}.tile_manifest.normalized`, "SHA-256 does not match its file");
  }
  const normalizedWidth = integer(
    normalized.width,
    `${path}.tile_manifest.normalized.width`,
    { minimum: 1 },
  );
  const normalizedHeight = integer(
    normalized.height,
    `${path}.tile_manifest.normalized.height`,
    { minimum: 1 },
  );
  const normalizedMetadata = await imageMetadata(
    normalizedPath,
    `${path}.tile_manifest.normalized.path`,
  );
  if (
    normalizedMetadata.format !== "png" ||
    normalizedMetadata.width !== normalizedWidth ||
    normalizedMetadata.height !== normalizedHeight ||
    width !== normalizedWidth ||
    height !== normalizedHeight
  ) {
    fail(path, "normalized tile source must be a PNG matching the recorded image dimensions");
  }
  const settings = object(manifest.settings, `${path}.tile_manifest.settings`);
  assertNoUnexpectedKeys(
    settings,
    new Set(["max_tile_width", "max_tile_height", "overlap"]),
    `${path}.tile_manifest.settings`,
  );
  const maxTileWidth = integer(
    settings.max_tile_width,
    `${path}.tile_manifest.settings.max_tile_width`,
    { minimum: 1 },
  );
  const maxTileHeight = integer(
    settings.max_tile_height,
    `${path}.tile_manifest.settings.max_tile_height`,
    { minimum: 1 },
  );
  const overlap = integer(
    settings.overlap,
    `${path}.tile_manifest.settings.overlap`,
  );
  let expectedPlan;
  try {
    expectedPlan = planImageTiles({
      width: normalizedWidth,
      height: normalizedHeight,
      maxTileWidth,
      maxTileHeight,
      overlap,
    });
  } catch (error) {
    fail(`${path}.tile_manifest.settings`, error.message);
  }
  const grid = object(manifest.grid, `${path}.tile_manifest.grid`);
  assertNoUnexpectedKeys(
    grid,
    new Set(["columns", "rows"]),
    `${path}.tile_manifest.grid`,
  );
  if (
    integer(grid.columns, `${path}.tile_manifest.grid.columns`, { minimum: 1 }) !==
      expectedPlan.columns ||
    integer(grid.rows, `${path}.tile_manifest.grid.rows`, { minimum: 1 }) !==
      expectedPlan.rows
  ) {
    fail(path, "tile grid does not match the deterministic coverage plan");
  }

  const manifestTiles = array(manifest.tiles, `${path}.tile_manifest.tiles`);
  if (manifestTiles.length !== expectedPlan.tiles.length) {
    fail(path, "tile count does not match the deterministic coverage plan");
  }
  const tilePaths = new Set();
  const tiles = [];
  for (const [index, expected] of expectedPlan.tiles.entries()) {
    const tilePath = `${path}.tile_manifest.tiles[${index}]`;
    const inputTile = object(manifestTiles[index], tilePath);
    assertNoUnexpectedKeys(
      inputTile,
      new Set([
        "tile_index",
        "row",
        "column",
        "left",
        "top",
        "width",
        "height",
        "path",
        "sha256",
      ]),
      tilePath,
    );
    for (const field of [
      "tile_index",
      "row",
      "column",
      "left",
      "top",
      "width",
      "height",
    ]) {
      const minimum = field === "left" || field === "top" ? 0 : 1;
      if (integer(inputTile[field], `${tilePath}.${field}`, { minimum }) !== expected[field]) {
        fail(tilePath, `${field} does not match the deterministic coverage plan`);
      }
    }
    const representationPath = await insideWorkspace(
      inputTile.path,
      workspace,
      `${tilePath}.path`,
    );
    if (tilePaths.has(representationPath)) {
      fail(tilePath, "reuses another tile file");
    }
    tilePaths.add(representationPath);
    const representationSha256 = sha256Value(
      inputTile.sha256,
      `${tilePath}.sha256`,
    );
    if (await sha256File(representationPath) !== representationSha256) {
      fail(tilePath, "SHA-256 does not match its file");
    }
    const metadata = await imageMetadata(representationPath, `${tilePath}.path`);
    if (
      metadata.format !== "png" ||
      metadata.width !== expected.width ||
      metadata.height !== expected.height
    ) {
      fail(tilePath, "must be a PNG with the planned pixel dimensions");
    }
    tiles.push({
      ...expected,
      representation_path: representationPath,
      representation_sha256: representationSha256,
    });
  }

  const verificationInputs = array(
    input.tile_verifications,
    `${path}.tile_verifications`,
  );
  if (verificationInputs.length !== tiles.length) {
    fail(path, "tile_verifications must cover every planned tile exactly once");
  }
  const verifications = verificationInputs.map((value, index) => {
    const verificationPath = `${path}.tile_verifications[${index}]`;
    const verification = object(value, verificationPath);
    assertNoUnexpectedKeys(
      verification,
      new Set(["tile_index", "status", "note"]),
      verificationPath,
    );
    const tileIndex = integer(
      verification.tile_index,
      `${verificationPath}.tile_index`,
      { minimum: 1 },
    );
    if (tileIndex !== index + 1) {
      fail(verificationPath, "must appear exactly once in tile order");
    }
    return {
      tile_index: tileIndex,
      status: oneOf(
        verification.status,
        new Set(["verified", "failed"]),
        `${verificationPath}.status`,
      ),
      note: cleanSingleLine(verification.note, `${verificationPath}.note`),
    };
  });

  return {
    manifest_path: manifestPath,
    manifest_sha256: await sha256File(manifestPath),
    source_path: sourcePath,
    source_sha256: sourceSha256,
    normalized_path: normalizedPath,
    normalized_sha256: normalizedSha256,
    settings: {
      max_tile_width: maxTileWidth,
      max_tile_height: maxTileHeight,
      overlap,
    },
    grid: { columns: expectedPlan.columns, rows: expectedPlan.rows },
    tiles,
    verifications,
  };
}

function allAttachments(manifest, currentAttachments = []) {
  const result = [...currentAttachments];
  for (const topic of manifest.topics) {
    for (const attachment of topic.attachments) {
      result.push(attachment);
      if (attachment.type === "web") {
        result.push(...attachment.embedded_media);
      }
    }
  }
  return result;
}

async function verifyEvidenceFile(path, expectedHash, workspace, field) {
  const canonical = await insideWorkspace(path, workspace, field);
  if (canonical !== path) {
    fail(field, "resolved path changed after the topic checkpoint");
  }
  const actualHash = await sha256File(canonical);
  if (actualHash !== expectedHash) {
    fail(field, "content changed after the topic checkpoint");
  }
  return actualHash;
}

export async function verifyManifestEvidence(manifestValue) {
  const manifest = object(manifestValue, "manifest");
  const attachments = allAttachments(manifest);
  for (const [index, attachment] of attachments.entries()) {
    const path = `manifest evidence[${index}]`;
    if (attachment.source.binary_path) {
      await verifyEvidenceFile(
        attachment.source.binary_path,
        attachment.source.binary_sha256,
        manifest.workspace,
        `${path}.source.binary_path`,
      );
    }
    if (attachment.type !== "image" && attachment.type !== "pdf") {
      continue;
    }
    if (
      attachment.representation_paths.length !==
      attachment.representation_file_sha256.length
    ) {
      fail(path, "representation path/hash counts changed after checkpointing");
    }
    const hashes = [];
    for (const [representationIndex, representationPath] of
      attachment.representation_paths.entries()) {
      hashes.push(
        await verifyEvidenceFile(
          representationPath,
          attachment.representation_file_sha256[representationIndex],
          manifest.workspace,
          `${path}.representation_paths[${representationIndex}]`,
        ),
      );
    }
    const aggregate =
      hashes.length === 0
        ? null
        : hashes.length === 1
          ? hashes[0]
          : sha256Utf8(JSON.stringify(hashes));
    if (aggregate !== attachment.representation_sha256) {
      fail(path, "representation hash changed after checkpointing");
    }
    if (attachment.type === "image" && attachment.tile_analysis !== null) {
      await verifyEvidenceFile(
        attachment.tile_analysis.manifest_path,
        attachment.tile_analysis.manifest_sha256,
        manifest.workspace,
        `${path}.tile_analysis.manifest_path`,
      );
      await verifyEvidenceFile(
        attachment.tile_analysis.normalized_path,
        attachment.tile_analysis.normalized_sha256,
        manifest.workspace,
        `${path}.tile_analysis.normalized_path`,
      );
      for (const [tileIndex, tile] of attachment.tile_analysis.tiles.entries()) {
        await verifyEvidenceFile(
          tile.representation_path,
          tile.representation_sha256,
          manifest.workspace,
          `${path}.tile_analysis.tiles[${tileIndex}].representation_path`,
        );
      }
    }
  }
}

function findOccurrence(manifest, key, currentAttachments, path) {
  const match = allAttachments(manifest, currentAttachments).find(
    (item) =>
      item.attachment_key === key || item.embedded_media_key === key,
  );
  if (!match) {
    fail(path, `does not refer to an earlier recorded occurrence: ${key}`);
  }
  return match;
}

function imageIsComplete(image) {
  return (
    (image.extraction.status === "present" ||
      image.extraction.status === "empty") &&
    image.verification.status === "verified" &&
    (image.tile_analysis === null ||
      image.tile_analysis.verifications.every(
        (verification) => verification.status === "verified",
      ))
  );
}

function pdfIsComplete(pdf) {
  return (
    !pdf.document_failure &&
    pdf.pages.length === pdf.page_count &&
    pdf.pages.every(
      (page, index) =>
        page.page_number === index + 1 &&
        (page.extraction.status === "present" ||
          page.extraction.status === "empty"),
    )
  );
}

function occurrenceKey(parentKey, type, sourceOrdinal, sourceIdentity, embedded) {
  return embedded
    ? `${parentKey}:embedded-${type}:${sourceOrdinal}:${sourceIdentity}`
    : `${parentKey}:${type}:${sourceOrdinal}:${sourceIdentity}`;
}

async function normalizeImage(
  inputValue,
  context,
  path,
  { embedded = false, parentKey = null } = {},
) {
  const input = object(inputValue, path);
  const allowed = new Set([
    "type",
    "source_ordinal",
    "image_ordinal",
    "topic_association_evidence",
    "source",
    "representation_path",
    "representation_paths",
    "width",
    "height",
    "representation_type",
    "tile_manifest_path",
    "tile_verifications",
    "source_account",
    "extraction",
    "verification",
    "reuse_extraction_from",
  ]);
  assertNoUnexpectedKeys(input, allowed, path);
  const sourceOrdinal = integer(
    input.source_ordinal,
    `${path}.source_ordinal`,
    { minimum: 1 },
  );
  const source = await normalizeSource(input.source, context.workspace, `${path}.source`);
  const key = occurrenceKey(
    parentKey ?? context.topicKey,
    "image",
    sourceOrdinal,
    source.source_identity,
    embedded,
  );
  const representation = await representationHash(input, context.workspace, path, {
    required: false,
  });
  const hasRepresentation = Boolean(representation.representation_sha256);
  const representationType = hasRepresentation
    ? oneOf(
        input.representation_type,
        REPRESENTATION_TYPES,
        `${path}.representation_type`,
      )
    : null;
  if (!hasRepresentation && input.representation_type !== undefined) {
    fail(path, "representation_type requires a captured representation");
  }
  if (
    !hasRepresentation &&
    (input.width !== undefined || input.height !== undefined)
  ) {
    fail(path, "image dimensions require a captured representation");
  }
  const width = hasRepresentation
    ? integer(input.width, `${path}.width`, { minimum: 1 })
    : null;
  const height = hasRepresentation
    ? integer(input.height, `${path}.height`, { minimum: 1 })
    : null;
  if (
    input.reuse_extraction_from &&
    (input.tile_manifest_path !== undefined || input.tile_verifications !== undefined)
  ) {
    fail(path, "reused image extraction cannot redefine tile analysis");
  }
  const tileAnalysis = input.reuse_extraction_from
    ? null
    : await normalizeTileAnalysis(
        input,
        representation,
        context.workspace,
        width,
        height,
        path,
      );
  let extraction;
  let verification;
  let sourceAccount;
  let reusedFrom = null;
  let analysisMode;
  if (input.reuse_extraction_from) {
    if (!hasRepresentation) {
      fail(path, "image cache reuse requires a captured representation");
    }
    const sourceImage = findOccurrence(
      context.manifest,
      cleanSingleLine(input.reuse_extraction_from, `${path}.reuse_extraction_from`),
      context.currentAttachments,
      `${path}.reuse_extraction_from`,
    );
    if (
      sourceImage.type !== "image" ||
      !imageIsComplete(sourceImage) ||
      sourceImage.representation_sha256 !== representation.representation_sha256
    ) {
      fail(path, "image cache source is not complete, verified, and binary-identical");
    }
    extraction = structuredClone(sourceImage.extraction);
    verification = structuredClone(sourceImage.verification);
    sourceAccount = sourceImage.source_account;
    reusedFrom = sourceImage.attachment_key ?? sourceImage.embedded_media_key;
    analysisMode = sourceImage.analysis_mode;
    if (
      input.extraction !== undefined ||
      input.verification !== undefined ||
      input.source_account !== undefined
    ) {
      fail(path, "reused image extraction cannot redefine copied content fields");
    }
  } else {
    extraction = normalizeExtraction(input.extraction, `${path}.extraction`);
    const verificationInput = object(input.verification, `${path}.verification`);
    assertNoUnexpectedKeys(
      verificationInput,
      new Set(["status", "note"]),
      `${path}.verification`,
    );
    verification = {
      status: oneOf(
        verificationInput.status,
        new Set(["verified", "failed"]),
        `${path}.verification.status`,
      ),
      note: cleanSingleLine(verificationInput.note, `${path}.verification.note`),
    };
    sourceAccount = optionalString(input.source_account, `${path}.source_account`) ?? "未显示";
    analysisMode = hasRepresentation
      ? tileAnalysis === null ? "whole-image" : "tiled"
      : "unavailable";
  }
  if (
    (extraction.status === "failed" && verification.status !== "failed") ||
    (extraction.status !== "failed" && verification.status !== "verified")
  ) {
    fail(path, "extraction and visual verification states contradict each other");
  }
  if (
    !hasRepresentation &&
    (extraction.status !== "failed" || verification.status !== "failed")
  ) {
    fail(
      path,
      "an image without any captured representation must record failed extraction and verification",
    );
  }
  if (
    tileAnalysis !== null &&
    extraction.status !== "failed" &&
    tileAnalysis.verifications.some(
      (verification) => verification.status !== "verified",
    )
  ) {
    fail(path, "complete image extraction requires every planned tile to be verified");
  }
  const image = {
    type: "image",
    source_ordinal: sourceOrdinal,
    image_ordinal: embedded
      ? null
      : integer(input.image_ordinal, `${path}.image_ordinal`, { minimum: 1 }),
    topic_association_evidence: embedded
      ? null
      : cleanSingleLine(
          input.topic_association_evidence,
          `${path}.topic_association_evidence`,
        ),
    source,
    attachment_key: embedded ? null : key,
    embedded_media_key: embedded ? key : null,
    parent_attachment_key: embedded ? parentKey : null,
    width,
    height,
    representation_type: representationType,
    analysis_mode: analysisMode,
    tile_analysis: tileAnalysis,
    source_account: sourceAccount,
    extraction,
    verification,
    reused_from: reusedFrom,
    ...representation,
  };
  return image;
}

function normalizePdfPage(inputValue, occurrenceKeyValue, index, path) {
  const input = object(inputValue, path);
  assertNoUnexpectedKeys(input, new Set(["page_number", "extraction"]), path);
  const pageNumber = integer(input.page_number, `${path}.page_number`, {
    minimum: 1,
  });
  return {
    page_key: `${occurrenceKeyValue}:page:${pageNumber}`,
    page_number: pageNumber,
    extraction: normalizeExtraction(input.extraction, `${path}.extraction`),
    source_index: index,
  };
}

async function normalizePdf(
  inputValue,
  context,
  path,
  { embedded = false, parentKey = null } = {},
) {
  const input = object(inputValue, path);
  assertNoUnexpectedKeys(
    input,
    new Set([
      "type",
      "source_ordinal",
      "source",
      "filename",
      "representation_path",
      "representation_paths",
      "page_count",
      "page_count_evidence",
      "pages",
      "document_failure",
      "reuse_extraction_from",
    ]),
    path,
  );
  const sourceOrdinal = integer(
    input.source_ordinal,
    `${path}.source_ordinal`,
    { minimum: 1 },
  );
  const source = await normalizeSource(input.source, context.workspace, `${path}.source`);
  const key = occurrenceKey(
    parentKey ?? context.topicKey,
    "pdf",
    sourceOrdinal,
    source.source_identity,
    embedded,
  );
  const documentFailure = input.document_failure
    ? normalizeExtraction(input.document_failure, `${path}.document_failure`)
    : null;
  if (documentFailure && documentFailure.status !== "failed") {
    fail(`${path}.document_failure`, "must use failed status");
  }
  const representation = await representationHash(input, context.workspace, path, {
    required: !documentFailure,
  });
  let pageCount;
  let pageCountEvidence;
  let pages;
  let reusedFrom = null;
  if (input.reuse_extraction_from) {
    if (documentFailure) {
      fail(path, "a failed PDF document cannot reuse a complete extraction");
    }
    const sourcePdf = findOccurrence(
      context.manifest,
      cleanSingleLine(input.reuse_extraction_from, `${path}.reuse_extraction_from`),
      context.currentAttachments,
      `${path}.reuse_extraction_from`,
    );
    if (
      sourcePdf.type !== "pdf" ||
      !pdfIsComplete(sourcePdf) ||
      sourcePdf.representation_sha256 !== representation.representation_sha256
    ) {
      fail(path, "PDF cache source is not complete and binary-identical");
    }
    if (
      input.page_count !== undefined ||
      input.page_count_evidence !== undefined ||
      input.pages !== undefined ||
      input.document_failure !== undefined
    ) {
      fail(path, "reused PDF extraction cannot redefine copied page fields");
    }
    pageCount = sourcePdf.page_count;
    pageCountEvidence = sourcePdf.page_count_evidence;
    pages = sourcePdf.pages.map((page) => ({
      ...structuredClone(page),
      page_key: `${key}:page:${page.page_number}`,
    }));
    reusedFrom = sourcePdf.attachment_key ?? sourcePdf.embedded_media_key;
  } else if (documentFailure) {
    if (input.pages !== undefined) {
      fail(
        path,
        "a whole-document PDF failure cannot include page entries",
      );
    }
    pageCount =
      input.page_count === undefined
        ? null
        : integer(input.page_count, `${path}.page_count`, { minimum: 1 });
    pageCountEvidence = cleanSingleLine(
      input.page_count_evidence,
      `${path}.page_count_evidence`,
    );
    pages = [];
  } else {
    pageCount = integer(input.page_count, `${path}.page_count`, { minimum: 1 });
    pageCountEvidence = cleanSingleLine(
      input.page_count_evidence,
      `${path}.page_count_evidence`,
    );
    pages = array(input.pages, `${path}.pages`).map((page, index) =>
      normalizePdfPage(page, key, index, `${path}.pages[${index}]`),
    );
    if (
      pages.length !== pageCount ||
      pages.some((page, index) => page.page_number !== index + 1)
    ) {
      fail(path, "PDF pages must appear exactly once in order 1..page_count");
    }
  }
  return {
    type: "pdf",
    source_ordinal: sourceOrdinal,
    source,
    filename:
      optionalString(input.filename, `${path}.filename`) ?? "未显示",
    attachment_key: embedded ? null : key,
    embedded_media_key: embedded ? key : null,
    parent_attachment_key: embedded ? parentKey : null,
    page_count: pageCount,
    page_count_evidence: pageCountEvidence,
    pages,
    document_failure: documentFailure,
    reused_from: reusedFrom,
    ...representation,
  };
}

function webIsComplete(web) {
  return (
    web.embedded_media_inventory?.status === "complete" &&
    (web.body.status === "present" || web.body.status === "empty") &&
    web.embedded_media.every((child) =>
      child.type === "image" ? imageIsComplete(child) : pdfIsComplete(child),
    )
  );
}

async function normalizeWeb(inputValue, context, path) {
  const input = object(inputValue, path);
  assertNoUnexpectedKeys(
    input,
    new Set([
      "type",
      "source_ordinal",
      "source",
      "title",
      "original_url",
      "canonical_url",
      "stable_page_id",
      "author",
      "publication_time",
      "body",
      "embedded_media",
    ]),
    path,
  );
  const sourceOrdinal = integer(
    input.source_ordinal,
    `${path}.source_ordinal`,
    { minimum: 1 },
  );
  const source = await normalizeSource(input.source, context.workspace, `${path}.source`);
  const attachmentKey = occurrenceKey(
    context.topicKey,
    "web",
    sourceOrdinal,
    source.source_identity,
    false,
  );
  const stablePageId = optionalString(
    input.stable_page_id,
    `${path}.stable_page_id`,
  );
  const canonicalUrl = input.canonical_url
    ? httpUrl(input.canonical_url, `${path}.canonical_url`)
    : null;
  const embeddedMediaInventory =
    context.inventoryTopic?.attachments?.[sourceOrdinal - 1]
      ?.embedded_media_inventory ?? null;
  const body = normalizeExtraction(input.body, `${path}.body`);
  const rawChildren = array(
    input.embedded_media ?? [],
    `${path}.embedded_media`,
  );
  const children = [];
  for (const [index, childInput] of rawChildren.entries()) {
    const childPath = `${path}.embedded_media[${index}]`;
    const type = object(childInput, childPath).type;
    const child =
      type === "image"
        ? await normalizeImage(childInput, context, childPath, {
            embedded: true,
            parentKey: attachmentKey,
          })
        : type === "pdf"
          ? await normalizePdf(childInput, context, childPath, {
              embedded: true,
              parentKey: attachmentKey,
            })
          : fail(childPath, "type must be image or pdf");
    children.push(child);
  }
  const ordinals = children.map((child) => child.source_ordinal);
  if (
    new Set(ordinals).size !== ordinals.length ||
    ordinals.some((ordinal, index) => ordinal !== index + 1)
  ) {
    fail(path, "embedded media must appear exactly once in source order 1..N");
  }
  return {
    type: "web",
    source_ordinal: sourceOrdinal,
    source,
    attachment_key: attachmentKey,
    title: cleanSingleLine(input.title, `${path}.title`),
    original_url: httpUrl(input.original_url, `${path}.original_url`),
    canonical_url: canonicalUrl,
    stable_page_id: stablePageId,
    author: optionalString(input.author, `${path}.author`),
    publication_time: optionalString(
      input.publication_time,
      `${path}.publication_time`,
    ),
    body,
    embedded_media: children,
    embedded_media_inventory: embeddedMediaInventory
      ? structuredClone(embeddedMediaInventory)
      : null,
    extraction_status: webIsComplete({
      body,
      embedded_media: children,
      embedded_media_inventory: embeddedMediaInventory,
    })
      ? "present"
      : "failed",
  };
}

function deriveTopicKey(input, path) {
  const source = object(input.source, `${path}.source`);
  assertNoUnexpectedKeys(
    source,
    new Set(["platform_id", "permalink"]),
    `${path}.source`,
  );
  const platformId = optionalString(source.platform_id, `${path}.source.platform_id`);
  const permalink = source.permalink
    ? httpUrl(source.permalink, `${path}.source.permalink`)
    : null;
  if (platformId) {
    return { topicKey: `platform-id:${platformId}`, platformId, permalink };
  }
  if (permalink) {
    return {
      topicKey: `permalink-sha256:${sha256Utf8(permalink)}`,
      platformId,
      permalink,
    };
  }
  return {
    topicKey: `source-order:${input.source_order}:${sha256Utf8(input.timestamp)}`,
    platformId,
    permalink,
  };
}

export async function normalizeTopic(manifestValue, inputValue) {
  const manifest = object(manifestValue, "manifest");
  const input = object(inputValue, "topic");
  assertNoUnexpectedKeys(
    input,
    new Set([
      "source_order",
      "source",
      "author",
      "timestamp",
      "body",
      "image_count",
      "image_count_evidence",
      "attachments",
    ]),
    "topic",
  );
  const sourceOrder = integer(input.source_order, "topic.source_order", {
    minimum: 1,
  });
  const timestamp = isoTimestamp(input.timestamp, "topic.timestamp");
  if (timestamp.slice(0, 10) !== manifest.date) {
    fail("topic.timestamp", `must fall on the run's platform date ${manifest.date}`);
  }
  const previousTopic = manifest.topics.at(-1);
  if (previousTopic && Date.parse(timestamp) > Date.parse(previousTopic.timestamp)) {
    fail("topic.timestamp", "must preserve newest-first source order");
  }
  const { topicKey, platformId, permalink } = deriveTopicKey(
    { ...input, timestamp },
    "topic",
  );
  const context = {
    manifest,
    workspace: manifest.workspace,
    topicKey,
    currentAttachments: [],
    inventoryTopic: manifest.inventory?.topics?.[sourceOrder - 1] ?? null,
  };
  const attachments = [];
  const rawAttachments = array(input.attachments ?? [], "topic.attachments");
  for (const [index, attachmentInput] of rawAttachments.entries()) {
    const path = `topic.attachments[${index}]`;
    const type = object(attachmentInput, path).type;
    let attachment;
    if (type === "image") {
      attachment = await normalizeImage(attachmentInput, context, path);
    } else if (type === "web") {
      attachment = await normalizeWeb(attachmentInput, context, path);
    } else if (type === "pdf") {
      attachment = await normalizePdf(attachmentInput, context, path);
    } else {
      fail(path, "type must be image, web, or pdf");
    }
    attachments.push(attachment);
    context.currentAttachments.push(attachment);
    if (attachment.type === "web") {
      context.currentAttachments.push(...attachment.embedded_media);
    }
  }
  const sourceOrdinals = attachments.map((attachment) => attachment.source_ordinal);
  if (
    new Set(sourceOrdinals).size !== sourceOrdinals.length ||
    sourceOrdinals.some((ordinal, index) => ordinal !== index + 1)
  ) {
    fail("topic.attachments", "must appear exactly once in source order 1..N");
  }
  const imageCount = integer(input.image_count, "topic.image_count");
  const imageOrdinals = attachments
    .filter((attachment) => attachment.type === "image")
    .map((attachment) => attachment.image_ordinal);
  if (
    imageOrdinals.length !== imageCount ||
    imageOrdinals.some((ordinal, index) => ordinal !== index + 1)
  ) {
    fail(
      "topic.attachments",
      "top-level images must appear exactly once in image order 1..image_count",
    );
  }
  return {
    source_order: sourceOrder,
    topic_key: topicKey,
    platform_id: platformId,
    permalink,
    author: cleanSingleLine(input.author, "topic.author"),
    timestamp,
    body: normalizeExtraction(input.body, "topic.body"),
    image_count: imageCount,
    image_count_evidence: cleanSingleLine(
      input.image_count_evidence,
      "topic.image_count_evidence",
    ),
    attachments,
  };
}

function normalizeInventorySource(inputValue, path) {
  const sourceInput = object(inputValue ?? {}, path);
  assertNoUnexpectedKeys(
    sourceInput,
    new Set(["platform_id", "transport_url"]),
    path,
  );
  return {
    platform_id: optionalString(sourceInput.platform_id, `${path}.platform_id`),
    transport_url: sourceInput.transport_url
      ? httpUrl(sourceInput.transport_url, `${path}.transport_url`)
      : null,
  };
}

function normalizeInventoryEmbeddedMedia(inputValue, path) {
  const input = object(inputValue, path);
  assertNoUnexpectedKeys(
    input,
    new Set(["type", "source_ordinal", "source", "filename"]),
    path,
  );
  if (!new Set(["image", "pdf"]).has(input.type)) {
    fail(`${path}.type`, "must be image or pdf");
  }
  return {
    type: input.type,
    source_ordinal: integer(input.source_ordinal, `${path}.source_ordinal`, {
      minimum: 1,
    }),
    source: normalizeInventorySource(input.source, `${path}.source`),
    filename:
      input.type === "pdf"
        ? (optionalString(input.filename, `${path}.filename`) ?? "未显示")
        : null,
  };
}

function normalizeInventoryAttachment(inputValue, path) {
  const input = object(inputValue, path);
  assertNoUnexpectedKeys(
    input,
    new Set([
      "type",
      "source_ordinal",
      "image_ordinal",
      "topic_association_evidence",
      "source",
      "filename",
      "stable_page_id",
      "original_url",
    ]),
    path,
  );
  if (!new Set(["image", "web", "pdf"]).has(input.type)) {
    fail(`${path}.type`, "must be image, web, or pdf");
  }
  const source = normalizeInventorySource(input.source, `${path}.source`);
  const result = {
    type: input.type,
    source_ordinal: integer(input.source_ordinal, `${path}.source_ordinal`, {
      minimum: 1,
    }),
    image_ordinal:
      input.type === "image"
        ? integer(input.image_ordinal, `${path}.image_ordinal`, { minimum: 1 })
        : null,
    topic_association_evidence:
      input.type === "image"
        ? cleanSingleLine(
            input.topic_association_evidence,
            `${path}.topic_association_evidence`,
          )
        : null,
    source,
    filename:
      input.type === "pdf"
        ? (optionalString(input.filename, `${path}.filename`) ?? "未显示")
        : null,
    stable_page_id:
      input.type === "web"
        ? optionalString(input.stable_page_id, `${path}.stable_page_id`)
        : null,
    original_url:
      input.type === "web"
        ? httpUrl(input.original_url, `${path}.original_url`)
        : null,
    embedded_media_inventory:
      input.type === "web"
        ? {
            recorded: false,
            status: "unrecorded",
            count: null,
            evidence: null,
            inventory_failure: null,
            items: [],
          }
        : null,
  };
  return result;
}

function normalizeInventoryTopic(inputValue, index) {
  const path = `inventory.topics[${index}]`;
  const input = object(inputValue, path);
  assertNoUnexpectedKeys(
    input,
    new Set([
      "source_order",
      "source",
      "author",
      "timestamp",
      "body",
      "image_count",
      "image_count_evidence",
      "attachments",
    ]),
    path,
  );
  const sourceOrder = integer(input.source_order, `${path}.source_order`, {
    minimum: 1,
  });
  const timestamp = isoTimestamp(input.timestamp, `${path}.timestamp`);
  const { topicKey, platformId, permalink } = deriveTopicKey(
    { ...input, timestamp },
    path,
  );
  const attachments = array(input.attachments ?? [], `${path}.attachments`).map(
    (attachment, attachmentIndex) =>
      normalizeInventoryAttachment(
        attachment,
        `${path}.attachments[${attachmentIndex}]`,
      ),
  );
  if (
    attachments.some(
      (attachment, attachmentIndex) =>
        attachment.source_ordinal !== attachmentIndex + 1,
    )
  ) {
    fail(`${path}.attachments`, "must appear exactly once in source order 1..N");
  }
  const imageCount = integer(input.image_count, `${path}.image_count`);
  const imageOrdinals = attachments
    .filter((attachment) => attachment.type === "image")
    .map((attachment) => attachment.image_ordinal);
  if (
    imageOrdinals.length !== imageCount ||
    imageOrdinals.some((ordinal, imageIndex) => ordinal !== imageIndex + 1)
  ) {
    fail(
      `${path}.attachments`,
      "top-level images must appear exactly once in image order 1..image_count",
    );
  }
  return {
    source_order: sourceOrder,
    topic_key: topicKey,
    platform_id: platformId,
    permalink,
    author: cleanSingleLine(input.author, `${path}.author`),
    timestamp,
    body: normalizeExtraction(input.body, `${path}.body`),
    image_count: imageCount,
    image_count_evidence: cleanSingleLine(
      input.image_count_evidence,
      `${path}.image_count_evidence`,
    ),
    attachments,
  };
}

export function normalizeInventory(inputValue) {
  const input = object(inputValue, "inventory");
  assertNoUnexpectedKeys(input, new Set(["topics"]), "inventory");
  const topics = array(input.topics, "inventory.topics").map((topic, index) =>
    normalizeInventoryTopic(topic, index),
  );
  if (topics.some((topic, index) => topic.source_order !== index + 1)) {
    fail("inventory.topics", "must appear exactly once in source order 1..N");
  }
  assertUnique(
    topics.map((topic) => topic.topic_key),
    "inventory topic keys",
  );
  return { recorded: true, topics };
}

export function recordWebInventory(manifestValue, inputValue) {
  const manifest = object(manifestValue, "manifest");
  const input = object(inputValue, "web inventory");
  assertNoUnexpectedKeys(
    input,
    new Set([
      "topic_source_order",
      "attachment_source_ordinal",
      "embedded_media_count",
      "embedded_media_count_evidence",
      "embedded_media",
      "inventory_failure",
    ]),
    "web inventory",
  );
  if (manifest.inventory?.recorded !== true) {
    fail("web inventory", "requires a frozen top-level source inventory");
  }
  const topicOrder = integer(
    input.topic_source_order,
    "web inventory.topic_source_order",
    { minimum: 1 },
  );
  const attachmentOrder = integer(
    input.attachment_source_ordinal,
    "web inventory.attachment_source_ordinal",
    { minimum: 1 },
  );
  if (manifest.topics.some((topic) => topic.source_order === topicOrder)) {
    fail("web inventory", "cannot change after that topic was checkpointed");
  }
  const topic = manifest.inventory.topics[topicOrder - 1];
  if (!topic || topic.source_order !== topicOrder) {
    fail("web inventory", "does not identify an inventoried topic");
  }
  const attachment = topic.attachments[attachmentOrder - 1];
  if (
    !attachment ||
    attachment.source_ordinal !== attachmentOrder ||
    attachment.type !== "web"
  ) {
    fail("web inventory", "does not identify an inventoried webpage attachment");
  }
  if (attachment.embedded_media_inventory.recorded) {
    fail("web inventory", "is already frozen for this webpage occurrence");
  }
  let inventoryFailure = null;
  if (input.inventory_failure !== undefined) {
    const failure = object(
      input.inventory_failure,
      "web inventory.inventory_failure",
    );
    assertNoUnexpectedKeys(
      failure,
      new Set(["failure_reason", "reader_note"]),
      "web inventory.inventory_failure",
    );
    if (input.embedded_media_count !== undefined) {
      fail(
        "web inventory.embedded_media_count",
        "must be omitted when the complete child count is unknown",
      );
    }
    inventoryFailure = {
      failure_reason: cleanSingleLine(
        failure.failure_reason,
        "web inventory.inventory_failure.failure_reason",
      ),
      reader_note: cleanSingleLine(
        failure.reader_note,
        "web inventory.inventory_failure.reader_note",
      ),
    };
  }
  const count = inventoryFailure
    ? null
    : integer(
        input.embedded_media_count,
        "web inventory.embedded_media_count",
      );
  const items = array(
    input.embedded_media,
    "web inventory.embedded_media",
  ).map((item, index) =>
    normalizeInventoryEmbeddedMedia(
      item,
      `web inventory.embedded_media[${index}]`,
    ),
  );
  if (
    items.some((item, index) => item.source_ordinal !== index + 1) ||
    (!inventoryFailure && items.length !== count)
  ) {
    fail(
      "web inventory.embedded_media",
      inventoryFailure
        ? "known recovered items must appear exactly once in source order 1..N"
        : "must appear exactly once in source order 1..embedded_media_count",
    );
  }
  attachment.embedded_media_inventory = {
    recorded: true,
    status: inventoryFailure ? "failed" : "complete",
    count,
    evidence: cleanSingleLine(
      input.embedded_media_count_evidence,
      "web inventory.embedded_media_count_evidence",
    ),
    inventory_failure: inventoryFailure,
    items,
  };
  return attachment.embedded_media_inventory;
}

function sameNullable(left, right) {
  return (left ?? null) === (right ?? null);
}

export function assertTopicMatchesInventory(topic, inventoryTopic) {
  const path = `topic ${topic.source_order}`;
  if (!inventoryTopic || inventoryTopic.source_order !== topic.source_order) {
    fail(path, "does not have a matching source inventory entry");
  }
  for (const field of [
    "topic_key",
    "platform_id",
    "permalink",
    "author",
    "timestamp",
    "image_count",
    "image_count_evidence",
  ]) {
    if (topic[field] !== inventoryTopic[field]) {
      fail(path, `${field} differs from the source inventory`);
    }
  }
  for (const field of [
    "status",
    "payload_sha256",
    "recovered_payload_sha256",
    "failure_reason",
    "reader_note",
  ]) {
    if (!sameNullable(topic.body[field], inventoryTopic.body[field])) {
      fail(path, `body ${field} differs from the source inventory`);
    }
  }
  if (topic.attachments.length !== inventoryTopic.attachments.length) {
    fail(path, "attachment count differs from the source inventory");
  }
  for (const [index, attachment] of topic.attachments.entries()) {
    const inventoryAttachment = inventoryTopic.attachments[index];
    for (const field of ["type", "source_ordinal", "image_ordinal"] ) {
      if (!sameNullable(attachment[field], inventoryAttachment[field])) {
        fail(path, `attachment ${index + 1} ${field} differs from the source inventory`);
      }
    }
    if (
      attachment.type === "image" &&
      attachment.topic_association_evidence !==
        inventoryAttachment.topic_association_evidence
    ) {
      fail(
        path,
        `attachment ${index + 1} topic association evidence differs from the source inventory`,
      );
    }
    if (
      inventoryAttachment.source.platform_id &&
      attachment.source.platform_id !== inventoryAttachment.source.platform_id
    ) {
      fail(path, `attachment ${index + 1} platform ID differs from the source inventory`);
    }
    if (
      inventoryAttachment.source.transport_url &&
      attachment.source.transport_url !== inventoryAttachment.source.transport_url
    ) {
      fail(path, `attachment ${index + 1} transport URL differs from the source inventory`);
    }
    if (
      attachment.type === "pdf" &&
      attachment.filename !== inventoryAttachment.filename
    ) {
      fail(path, `attachment ${index + 1} filename differs from the source inventory`);
    }
    if (
      attachment.type === "web" &&
      (attachment.original_url !== inventoryAttachment.original_url ||
        !sameNullable(
          attachment.stable_page_id,
          inventoryAttachment.stable_page_id,
        ))
    ) {
      fail(path, `attachment ${index + 1} page identity differs from the source inventory`);
    }
    if (attachment.type === "web") {
      const childInventory = inventoryAttachment.embedded_media_inventory;
      if (childInventory?.recorded !== true) {
        fail(
          path,
          `attachment ${index + 1} webpage child inventory was not frozen`,
        );
      }
      if (!["complete", "failed"].includes(childInventory.status)) {
        fail(path, `attachment ${index + 1} webpage child inventory is invalid`);
      }
      const expectedChildCount =
        childInventory.status === "complete"
          ? childInventory.count
          : childInventory.items.length;
      if (attachment.embedded_media.length !== expectedChildCount) {
        fail(
          path,
          `attachment ${index + 1} embedded media count differs from the source inventory`,
        );
      }
      for (const [childIndex, child] of attachment.embedded_media.entries()) {
        const inventoryChild = childInventory.items[childIndex];
        for (const field of ["type", "source_ordinal"]) {
          if (child[field] !== inventoryChild[field]) {
            fail(
              path,
              `attachment ${index + 1} embedded media ${childIndex + 1} ${field} differs from the source inventory`,
            );
          }
        }
        if (
          inventoryChild.source.platform_id &&
          child.source.platform_id !== inventoryChild.source.platform_id
        ) {
          fail(
            path,
            `attachment ${index + 1} embedded media ${childIndex + 1} platform ID differs from the source inventory`,
          );
        }
        if (
          inventoryChild.source.transport_url &&
          child.source.transport_url !== inventoryChild.source.transport_url
        ) {
          fail(
            path,
            `attachment ${index + 1} embedded media ${childIndex + 1} transport URL differs from the source inventory`,
          );
        }
        if (child.type === "pdf" && child.filename !== inventoryChild.filename) {
          fail(
            path,
            `attachment ${index + 1} embedded PDF ${childIndex + 1} filename differs from the source inventory`,
          );
        }
      }
    }
  }
}

export function normalizeCoverage(inputValue) {
  const input = object(inputValue, "coverage");
  assertNoUnexpectedKeys(
    input,
    new Set([
      "top_established",
      "pending_new_content_loaded",
      "crossed_below_target_date",
      "chronology_consistent",
      "access_complete",
      "evidence",
      "failure_reason",
    ]),
    "coverage",
  );
  const coverage = {
    top_established: boolean(input.top_established, "coverage.top_established"),
    pending_new_content_loaded: boolean(
      input.pending_new_content_loaded,
      "coverage.pending_new_content_loaded",
    ),
    crossed_below_target_date: boolean(
      input.crossed_below_target_date,
      "coverage.crossed_below_target_date",
    ),
    chronology_consistent: boolean(
      input.chronology_consistent,
      "coverage.chronology_consistent",
    ),
    access_complete: boolean(input.access_complete, "coverage.access_complete"),
    evidence: cleanSingleLine(input.evidence, "coverage.evidence"),
    failure_reason: optionalString(
      input.failure_reason,
      "coverage.failure_reason",
    ),
  };
  const proven = coverageIsProven(coverage);
  if (proven && coverage.failure_reason) {
    fail("coverage.failure_reason", "must be absent when coverage is proven");
  }
  if (!proven && !coverage.failure_reason) {
    fail("coverage.failure_reason", "is required when coverage is not proven");
  }
  return coverage;
}

export function coverageIsProven(coverage) {
  return Boolean(
    coverage?.top_established &&
      coverage.pending_new_content_loaded &&
      coverage.crossed_below_target_date &&
      coverage.chronology_consistent &&
      coverage.access_complete,
  );
}

function collectKeys(manifest) {
  const topicKeys = [];
  const attachmentKeys = [];
  const childKeys = [];
  const pageKeys = [];
  for (const topic of manifest.topics) {
    topicKeys.push(topic.topic_key);
    for (const attachment of topic.attachments) {
      attachmentKeys.push(attachment.attachment_key);
      if (attachment.type === "pdf") {
        pageKeys.push(...attachment.pages.map((page) => page.page_key));
      } else if (attachment.type === "web") {
        for (const child of attachment.embedded_media) {
          childKeys.push(child.embedded_media_key);
          if (child.type === "pdf") {
            pageKeys.push(...child.pages.map((page) => page.page_key));
          }
        }
      }
    }
  }
  return { topicKeys, attachmentKeys, childKeys, pageKeys };
}

function assertUnique(values, path) {
  if (new Set(values).size !== values.length) {
    fail(path, "contains duplicate keys");
  }
}

function assertTopicChronology(topics, date, path) {
  for (const [index, topic] of topics.entries()) {
    if (topic.timestamp.slice(0, 10) !== date) {
      fail(`${path}[${index}].timestamp`, `must fall on platform date ${date}`);
    }
    if (
      index > 0 &&
      Date.parse(topic.timestamp) > Date.parse(topics[index - 1].timestamp)
    ) {
      fail(path, "must preserve newest-first timestamp order");
    }
  }
}

function extractionFailure(extraction, location, failures) {
  if (extraction.status === "failed") {
    failures.push({
      location,
      failure_reason: extraction.failure_reason,
      reader_note: extraction.reader_note,
    });
  }
}

function collectFailures(manifest) {
  const failures = [];
  for (const topic of manifest.topics) {
    const topicLocation = `主题 ${topic.source_order}`;
    extractionFailure(topic.body, `${topicLocation} 正文`, failures);
    const typeCounts = { image: 0, web: 0, pdf: 0 };
    for (const attachment of topic.attachments) {
      typeCounts[attachment.type] += 1;
      const location = `${topicLocation} ${
        attachment.type === "image"
          ? "图片"
          : attachment.type === "web"
            ? "链接内容"
            : "PDF"
      } ${typeCounts[attachment.type]}`;
      if (attachment.type === "image") {
        extractionFailure(attachment.extraction, location, failures);
      } else if (attachment.type === "pdf") {
        if (attachment.document_failure) {
          extractionFailure(attachment.document_failure, location, failures);
        } else {
          for (const page of attachment.pages) {
            extractionFailure(
              page.extraction,
              `${location} 第 ${page.page_number} 页`,
              failures,
            );
          }
        }
      } else {
        if (attachment.embedded_media_inventory?.inventory_failure) {
          failures.push({
            location: `${location} 内嵌媒体范围`,
            ...attachment.embedded_media_inventory.inventory_failure,
          });
        }
        extractionFailure(attachment.body, `${location}正文`, failures);
        const childCounts = { image: 0, pdf: 0 };
        for (const child of attachment.embedded_media) {
          childCounts[child.type] += 1;
          const childLocation = `${location} 页面内${
            child.type === "image" ? "图片" : "PDF"
          } ${childCounts[child.type]}`;
          if (child.type === "image") {
            extractionFailure(child.extraction, childLocation, failures);
          } else if (child.document_failure) {
            extractionFailure(child.document_failure, childLocation, failures);
          } else {
            for (const page of child.pages) {
              extractionFailure(
                page.extraction,
                `${childLocation} 第 ${page.page_number} 页`,
                failures,
              );
            }
          }
        }
      }
    }
  }
  return failures;
}

export function assessManifest(
  manifestValue,
  { requireInventoryComplete = false } = {},
) {
  const manifest = object(manifestValue, "manifest");
  if (manifest.schema_version !== SCHEMA_VERSION || manifest.generator !== GENERATOR) {
    fail("manifest", "has an unsupported schema or generator");
  }
  array(manifest.topics, "manifest.topics");
  const inventory = object(manifest.inventory, "manifest.inventory");
  array(inventory.topics, "manifest.inventory.topics");
  const sourceOrders = manifest.topics.map((topic) => topic.source_order);
  if (sourceOrders.some((order, index) => order !== index + 1)) {
    fail("manifest.topics", "must be in exact source order 1..N");
  }
  const keys = collectKeys(manifest);
  assertTopicChronology(inventory.topics, manifest.date, "manifest.inventory.topics");
  assertTopicChronology(manifest.topics, manifest.date, "manifest.topics");
  assertUnique(keys.topicKeys, "manifest topic keys");
  assertUnique(keys.attachmentKeys, "manifest attachment keys");
  assertUnique(keys.childKeys, "manifest embedded media keys");
  assertUnique(keys.pageKeys, "manifest PDF page keys");
  if (manifest.topics.length > inventory.topics.length) {
    fail("manifest.topics", "contains more topics than the source inventory");
  }
  for (const [index, topic] of manifest.topics.entries()) {
    assertTopicMatchesInventory(topic, inventory.topics[index]);
  }
  const inventoryComplete =
    inventory.recorded === true &&
    manifest.topics.length === inventory.topics.length;
  if (requireInventoryComplete && !inventoryComplete) {
    fail(
      "manifest.topics",
      `does not cover the complete source inventory (${manifest.topics.length}/${inventory.topics.length})`,
    );
  }
  const failures = collectFailures(manifest);
  return {
    coverage_proven: coverageIsProven(manifest.coverage),
    completeness: failures.length === 0 ? "complete" : "incomplete",
    post_count: manifest.topics.length,
    extraction_failure_count: failures.length,
    inventory_topic_count: inventory.topics.length,
    inventory_complete: inventoryComplete,
    failures,
    ...keys,
  };
}

function auditExtraction(
  lines,
  extraction,
  payloadHeading,
  statusLabel = "提取状态",
) {
  lines.push(`- ${statusLabel}：${extraction.status}`);
  lines.push(`- 文字 SHA-256：${extraction.payload_sha256 ?? "不适用"}`);
  lines.push(
    `- 恢复内容 SHA-256：${extraction.recovered_payload_sha256 ?? "不适用"}`,
  );
  if (extraction.failure_reason) {
    lines.push(`- 失败说明：${extraction.failure_reason}`);
  }
  lines.push("");
  if (payloadHeading) {
    lines.push(payloadHeading, "");
  }
  if (extraction.status === "present") {
    lines.push(extraction.payload);
  } else if (extraction.status === "empty") {
    lines.push("无可提取内容");
  } else {
    lines.push(extraction.recovered_payload ?? "无可可靠恢复内容");
  }
  lines.push("");
}

function auditSource(lines, source) {
  lines.push(`- 来源身份：${source.source_identity}`);
  lines.push(`- 平台标识：${source.platform_id ?? "未显示"}`);
  lines.push(`- 资源地址（已脱敏）：${source.sanitized_source_url ?? "未显示"}`);
  lines.push(`- 来源文件 SHA-256：${source.binary_sha256 ?? "未获取"}`);
}

function renderAuditImage(
  lines,
  image,
  heading,
  payloadHeading = "#### 图片内容文字",
) {
  lines.push(heading, "");
  lines.push(
    `- ${image.embedded_media_key ? "内嵌资源标识" : "附件标识"}：${image.embedded_media_key ?? image.attachment_key}`,
  );
  if (image.parent_attachment_key) {
    lines.push(`- 父附件标识：${image.parent_attachment_key}`);
  }
  auditSource(lines, image.source);
  lines.push(`- 原始序号：${image.source_ordinal}`);
  if (image.image_ordinal !== null) {
    lines.push(`- 图片序号：${image.image_ordinal}`);
    lines.push(`- 主题关联证据：${image.topic_association_evidence}`);
  }
  lines.push(
    `- 图像尺寸：${image.width === null ? "未获取" : `${image.width}×${image.height}`}`,
  );
  lines.push(`- 图像 SHA-256：${image.representation_sha256 ?? "未获取"}`);
  lines.push(`- 读取载体：${image.representation_type ?? "未获取"}`);
  lines.push(`- 分析模式：${image.analysis_mode}`);
  if (image.tile_analysis !== null) {
    lines.push(`- 切片清单 SHA-256：${image.tile_analysis.manifest_sha256}`);
    lines.push(`- 归一化图像 SHA-256：${image.tile_analysis.normalized_sha256}`);
    lines.push(
      `- 切片设置：${image.tile_analysis.settings.max_tile_width}×${image.tile_analysis.settings.max_tile_height}，重叠 ${image.tile_analysis.settings.overlap}px`,
    );
    lines.push(
      `- 切片网格：${image.tile_analysis.grid.columns} 列 × ${image.tile_analysis.grid.rows} 行`,
    );
    for (const [index, tile] of image.tile_analysis.tiles.entries()) {
      const verification = image.tile_analysis.verifications[index];
      lines.push(
        `- 切片 ${tile.tile_index}：第 ${tile.row} 行第 ${tile.column} 列；范围 ${tile.left},${tile.top},${tile.width},${tile.height}；SHA-256 ${tile.representation_sha256}；校核 ${verification.status}（${verification.note}）`,
      );
    }
  }
  lines.push(`- 截图来源账号：${image.source_account}`);
  lines.push(`- 校核状态：${image.verification.status}`);
  lines.push(`- 校核说明：${image.verification.note}`);
  lines.push(`- 缓存复用自：${image.reused_from ?? "无"}`);
  auditExtraction(lines, image.extraction, payloadHeading);
}

function renderAuditPdf(lines, pdf, heading, pageHeadingLevel) {
  lines.push(heading, "");
  lines.push(
    `- ${pdf.embedded_media_key ? "内嵌资源标识" : "附件标识"}：${pdf.embedded_media_key ?? pdf.attachment_key}`,
  );
  if (pdf.parent_attachment_key) {
    lines.push(`- 父附件标识：${pdf.parent_attachment_key}`);
  }
  auditSource(lines, pdf.source);
  lines.push(`- 原始序号：${pdf.source_ordinal}`);
  lines.push(`- PDF 表示 SHA-256：${pdf.representation_sha256 ?? "未获取"}`);
  lines.push(`- 总页数：${pdf.page_count ?? "未知"}`);
  lines.push(`- 页数证据：${pdf.page_count_evidence}`);
  lines.push(`- 缓存复用自：${pdf.reused_from ?? "无"}`, "");
  if (pdf.document_failure) {
    auditExtraction(lines, pdf.document_failure, null);
    return;
  }
  for (const page of pdf.pages) {
    lines.push(`${pageHeadingLevel} 第 ${page.page_number} 页`, "");
    lines.push(`- 页面标识：${page.page_key}`);
    lines.push(`- 页码：${page.page_number}`);
    auditExtraction(lines, page.extraction, null);
  }
}

export function renderAudit(manifest) {
  const assessment = assessManifest(manifest, { requireInventoryComplete: true });
  const lines = [
    "---",
    `generator: ${GENERATOR}`,
    "artifact_type: extraction-audit",
    `planet: ${JSON.stringify(manifest.planet)}`,
    `planet_url: ${JSON.stringify(manifest.planet_url)}`,
    `date: ${JSON.stringify(manifest.date)}`,
    `retrieved_at: ${JSON.stringify(manifest.retrieved_at)}`,
    `snapshot_at: ${JSON.stringify(manifest.snapshot_at)}`,
    `post_count: ${assessment.post_count}`,
    `completeness: ${assessment.completeness}`,
    "---",
    "",
    `# ${manifest.planet}｜${manifest.date}｜内部提取审计`,
    "",
    "## 时间线覆盖",
    "",
    `- 顶部已确认：${manifest.coverage.top_established}`,
    `- 新内容已加载：${manifest.coverage.pending_new_content_loaded}`,
    `- 已越过目标日期：${manifest.coverage.crossed_below_target_date}`,
    `- 时间顺序一致：${manifest.coverage.chronology_consistent}`,
    `- 访问范围完整：${manifest.coverage.access_complete}`,
    `- 覆盖证据：${manifest.coverage.evidence}`,
    "",
  ];
  for (const topic of manifest.topics) {
    lines.push(`## 主题 ${topic.source_order}｜${topic.timestamp}`, "");
    lines.push(`- 发布者：${topic.author}`);
    lines.push(`- 发布时间：${topic.timestamp}`);
    lines.push(`- 原帖：${topic.permalink ?? "未从时间线页面获取"}`);
    lines.push(`- 主题标识：${topic.topic_key}`);
    lines.push(`- 正文状态：${topic.body.status}`);
    lines.push(`- 正文 SHA-256：${topic.body.payload_sha256 ?? "不适用"}`);
    lines.push(
      `- 恢复内容 SHA-256：${topic.body.recovered_payload_sha256 ?? "不适用"}`,
    );
    if (topic.body.failure_reason) {
      lines.push(`- 失败说明：${topic.body.failure_reason}`);
    }
    lines.push(`- 图片总数：${topic.image_count}`);
    lines.push(`- 图片总数证据：${topic.image_count_evidence}`);
    lines.push("", "### 星球正文", "");
    lines.push(
      topic.body.status === "present"
        ? topic.body.payload
        : topic.body.status === "empty"
          ? "无正文"
          : (topic.body.recovered_payload ?? "无可可靠恢复内容"),
      "",
    );
    const counts = { image: 0, web: 0, pdf: 0 };
    for (const attachment of topic.attachments) {
      counts[attachment.type] += 1;
      if (attachment.type === "image") {
        renderAuditImage(lines, attachment, `### 图片 ${counts.image}`);
      } else if (attachment.type === "pdf") {
        renderAuditPdf(lines, attachment, `### PDF ${counts.pdf}｜${attachment.filename}`, "####");
      } else {
        const childInventory = attachment.embedded_media_inventory;
        lines.push(`### 外部网页 ${counts.web}｜${attachment.title}`, "");
        lines.push(`- 附件标识：${attachment.attachment_key}`);
        auditSource(lines, attachment.source);
        lines.push(`- 原始序号：${attachment.source_ordinal}`);
        lines.push(`- 原始链接：${attachment.original_url}`);
        lines.push(`- 规范链接：${attachment.canonical_url ?? "未显示"}`);
        lines.push(`- 稳定页面标识：${attachment.stable_page_id ?? "未显示"}`);
        lines.push(`- 内嵌媒体清单状态：${childInventory.status}`);
        lines.push(`- 内嵌媒体总数：${childInventory.count ?? "未知"}`);
        lines.push(`- 内嵌媒体总数证据：${childInventory.evidence}`);
        if (childInventory.inventory_failure) {
          lines.push(
            `- 内嵌媒体清单失败说明：${childInventory.inventory_failure.failure_reason}`,
          );
          lines.push(
            `- 内嵌媒体清单读者说明：${childInventory.inventory_failure.reader_note}`,
          );
        }
        lines.push(`- 作者：${attachment.author ?? "未显示"}`);
        lines.push(`- 发布时间：${attachment.publication_time ?? "未显示"}`);
        lines.push(`- 提取状态：${attachment.extraction_status}`);
        auditExtraction(
          lines,
          attachment.body,
          "#### 网页正文",
          "网页正文状态",
        );
        const childCounts = { image: 0, pdf: 0 };
        for (const child of attachment.embedded_media) {
          childCounts[child.type] += 1;
          if (child.type === "image") {
            renderAuditImage(
              lines,
              child,
              `#### 网页内嵌图片 ${childCounts.image}`,
              "##### 图片内容文字",
            );
          } else {
            renderAuditPdf(
              lines,
              child,
              `#### 网页内嵌 PDF ${childCounts.pdf}｜${child.filename}`,
              "#####",
            );
          }
        }
      }
    }
  }
  lines.push("## 提取异常", "");
  if (assessment.failures.length === 0) {
    lines.push("无", "");
  } else {
    for (const failure of assessment.failures) {
      lines.push(`- ${failure.location}：${failure.failure_reason}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
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

function markerValue(value) {
  return encodeURIComponent(value);
}

function readerMarker(manifest, assessment) {
  return `<!-- ${GENERATOR} | planet=${markerValue(manifest.planet)} | planet_url=${markerValue(manifest.planet_url)} | date=${manifest.date} | snapshot_at=${markerValue(manifest.snapshot_at)} | post_count=${assessment.post_count} | completeness=${assessment.completeness} -->`;
}

function markdownLink(title, url) {
  return `[${title.replaceAll("[", "\\[").replaceAll("]", "\\]")}](<${url.replaceAll(">", "%3E")}>)`;
}

function renderReaderPdf(lines, pdf, heading, pageHeadingLevel) {
  lines.push(`${heading}｜${pdf.filename}`, "");
  if (pdf.document_failure) {
    lines.push(
      extractionReaderPayload(pdf.document_failure, "未检测到可读文字"),
      "",
    );
    return;
  }
  for (const page of pdf.pages) {
    lines.push(`${pageHeadingLevel} 第 ${page.page_number} 页`, "");
    lines.push(extractionReaderPayload(page.extraction, "未检测到可读文字"), "");
  }
}

export function renderReader(manifest) {
  const assessment = assessManifest(manifest, { requireInventoryComplete: true });
  if (!assessment.coverage_proven) {
    throw new Error(
      `Timeline coverage is not proven: ${manifest.coverage?.failure_reason ?? "unknown reason"}`,
    );
  }
  const lines = [`# ${manifest.planet}｜${manifest.date}`, ""];
  for (const topic of manifest.topics) {
    lines.push(
      `## 主题 ${topic.source_order}｜${topic.timestamp}｜${topic.author}`,
      "",
    );
    lines.push(extractionReaderPayload(topic.body, "无正文"), "");
    const counts = { image: 0, web: 0, pdf: 0 };
    for (const attachment of topic.attachments) {
      counts[attachment.type] += 1;
      if (attachment.type === "image") {
        lines.push(`### 图片 ${counts.image}`, "");
        lines.push(
          extractionReaderPayload(attachment.extraction, "未检测到可读文字"),
          "",
        );
      } else if (attachment.type === "pdf") {
        renderReaderPdf(lines, attachment, `### PDF ${counts.pdf}`, "####");
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
        const childCounts = { image: 0, pdf: 0 };
        for (const child of attachment.embedded_media) {
          childCounts[child.type] += 1;
          if (child.type === "image") {
            lines.push(`#### 页面内图片 ${childCounts.image}`, "");
            lines.push(
              extractionReaderPayload(child.extraction, "未检测到可读文字"),
              "",
            );
          } else {
            renderReaderPdf(
              lines,
              child,
              `#### 页面内 PDF ${childCounts.pdf}`,
              "#####",
            );
          }
        }
        if (attachment.embedded_media_inventory?.inventory_failure) {
          lines.push(
            `[${attachment.embedded_media_inventory.inventory_failure.reader_note}]`,
            "",
          );
        }
      }
    }
  }
  if (assessment.completeness === "incomplete") {
    lines.push("## 未能完整读取的内容", "");
    for (const failure of assessment.failures) {
      lines.push(`- ${failure.location}：${failure.reader_note}`);
    }
    lines.push("");
  }
  lines.push(readerMarker(manifest, assessment));
  return `${lines.join("\n").trimEnd()}\n`;
}

export function validateAudit(audit, manifest) {
  const expected = renderAudit(manifest);
  if (audit !== expected) {
    throw new Error("Audit ledger differs from the verified manifest");
  }
  // Validate the runner-owned sanitized URL fields directly instead of
  // scanning rendered audit text: source payloads are rendered verbatim, so a
  // body legitimately containing a line that resembles the audit resource
  // label must never be rejected as a leak.
  for (const occurrence of allAttachments(manifest)) {
    const sanitized = occurrence.source?.sanitized_source_url;
    if (typeof sanitized === "string" && sanitized !== "") {
      const url = new URL(sanitized);
      if (url.search || url.hash) {
        throw new Error("Audit ledger contains an unsanitized asset URL");
      }
    }
  }
}

export function findBinaryCache(manifest, representationSha256) {
  for (const occurrence of allAttachments(manifest)) {
    if (
      occurrence.representation_sha256 === representationSha256 &&
      ((occurrence.type === "image" && imageIsComplete(occurrence)) ||
        (occurrence.type === "pdf" && pdfIsComplete(occurrence)))
    ) {
      return {
        hit: true,
        source_occurrence_key:
          occurrence.attachment_key ?? occurrence.embedded_media_key,
        type: occurrence.type,
      };
    }
  }
  return { hit: false };
}
