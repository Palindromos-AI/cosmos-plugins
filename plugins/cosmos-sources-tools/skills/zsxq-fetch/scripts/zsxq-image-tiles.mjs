import { realpathSync } from "node:fs";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const TILE_SCHEMA_VERSION = 1;
export const MAX_TILE_COUNT = 512;
export const DEFAULT_TILE_OPTIONS = Object.freeze({
  maxTileWidth: 512,
  maxTileHeight: 768,
  overlap: 96,
});

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

function nonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
  return value;
}

let sharpPromise;

export async function loadSharp() {
  sharpPromise ??= import("sharp").then(({ default: sharp }) => sharp);
  try {
    return await sharpPromise;
  } catch (error) {
    throw new Error(
      "Tiled image analysis requires sharp. Run `npm install --omit=dev` " +
        `in the zsxq-fetch skill directory. Cause: ${error.message}`,
    );
  }
}

function axisPlan(length, maximum, overlap, name) {
  positiveInteger(length, `${name} length`);
  positiveInteger(maximum, `${name} maximum`);
  nonNegativeInteger(overlap, "overlap");
  if (overlap < 1) {
    throw new RangeError("overlap must be at least 1 pixel");
  }
  if (overlap >= maximum) {
    throw new RangeError(`overlap must be smaller than the ${name} maximum`);
  }
  if (length <= maximum) {
    return { count: 1, finalStart: 0 };
  }

  const count = Math.ceil((length - overlap) / (maximum - overlap));
  return { count, finalStart: length - maximum };
}

function materializeAxis({ count, finalStart }, length, maximum) {
  if (count === 1) {
    return [{ start: 0, size: length }];
  }
  return Array.from({ length: count }, (_, index) => ({
    start: Math.round((finalStart * index) / (count - 1)),
    size: maximum,
  }));
}

export function planImageTiles({
  width,
  height,
  maxTileWidth = DEFAULT_TILE_OPTIONS.maxTileWidth,
  maxTileHeight = DEFAULT_TILE_OPTIONS.maxTileHeight,
  overlap = DEFAULT_TILE_OPTIONS.overlap,
}) {
  if (
    maxTileWidth > DEFAULT_TILE_OPTIONS.maxTileWidth ||
    maxTileHeight > DEFAULT_TILE_OPTIONS.maxTileHeight
  ) {
    throw new RangeError(
      `tile dimensions may not exceed ${DEFAULT_TILE_OPTIONS.maxTileWidth}×` +
        `${DEFAULT_TILE_OPTIONS.maxTileHeight} pixels`,
    );
  }
  const columnPlan = axisPlan(width, maxTileWidth, overlap, "width");
  const rowPlan = axisPlan(height, maxTileHeight, overlap, "height");
  if (
    columnPlan.count > MAX_TILE_COUNT ||
    rowPlan.count > Math.floor(MAX_TILE_COUNT / columnPlan.count)
  ) {
    throw new RangeError(`tile plan may not exceed ${MAX_TILE_COUNT} tiles`);
  }
  const columns = materializeAxis(columnPlan, width, maxTileWidth);
  const rows = materializeAxis(rowPlan, height, maxTileHeight);
  const tiles = [];
  for (const [rowIndex, row] of rows.entries()) {
    for (const [columnIndex, column] of columns.entries()) {
      tiles.push({
        tile_index: tiles.length + 1,
        row: rowIndex + 1,
        column: columnIndex + 1,
        left: column.start,
        top: row.start,
        width: column.size,
        height: row.size,
      });
    }
  }
  return {
    source_width: width,
    source_height: height,
    columns: columns.length,
    rows: rows.length,
    max_tile_width: maxTileWidth,
    max_tile_height: maxTileHeight,
    overlap,
    tiles,
  };
}

function isInside(path, parent) {
  const rel = relative(parent, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export async function createImageTiles({
  workspace,
  sourcePath,
  outputDirectory,
  maxTileWidth = DEFAULT_TILE_OPTIONS.maxTileWidth,
  maxTileHeight = DEFAULT_TILE_OPTIONS.maxTileHeight,
  overlap = DEFAULT_TILE_OPTIONS.overlap,
}) {
  const sharp = await loadSharp();
  const canonicalWorkspace = await realpath(resolve(workspace));
  const canonicalSource = await realpath(resolve(sourcePath));
  if (!isInside(canonicalSource, canonicalWorkspace)) {
    throw new Error("sourcePath must resolve inside the run workspace");
  }

  const requestedOutput = resolve(outputDirectory);
  const canonicalParent = await realpath(dirname(requestedOutput));
  if (!isInside(canonicalParent, canonicalWorkspace)) {
    throw new Error("outputDirectory must resolve inside the run workspace");
  }

  const sourceMetadata = await sharp(canonicalSource).metadata();
  const oriented = sourceMetadata.autoOrient;
  if (!Number.isInteger(oriented?.width) || !Number.isInteger(oriented?.height)) {
    throw new Error("source image does not expose oriented integer pixel dimensions");
  }
  const plan = planImageTiles({
    width: oriented.width,
    height: oriented.height,
    maxTileWidth,
    maxTileHeight,
    overlap,
  });

  await mkdir(requestedOutput);
  const normalizedPath = join(requestedOutput, "source-normalized.png");
  const normalizedInfo = await sharp(canonicalSource)
    .rotate()
    .toColourspace("srgb")
    .png({ compressionLevel: 9 })
    .toFile(normalizedPath);
  if (
    normalizedInfo.width !== plan.source_width ||
    normalizedInfo.height !== plan.source_height
  ) {
    throw new Error("normalized dimensions differ from the oriented source metadata");
  }

  const tiles = [];
  for (const geometry of plan.tiles) {
    const filename = `tile-${String(geometry.tile_index).padStart(3, "0")}.png`;
    const path = join(requestedOutput, filename);
    const info = await sharp(normalizedPath)
      .extract({
        left: geometry.left,
        top: geometry.top,
        width: geometry.width,
        height: geometry.height,
      })
      .png({ compressionLevel: 9 })
      .toFile(path);
    if (info.width !== geometry.width || info.height !== geometry.height) {
      throw new Error(`generated tile ${geometry.tile_index} dimensions changed`);
    }
    tiles.push({ ...geometry, path });
  }

  const manifest = {
    schema_version: TILE_SCHEMA_VERSION,
    source: {
      path: canonicalSource,
    },
    normalized: {
      path: normalizedPath,
      width: plan.source_width,
      height: plan.source_height,
    },
    settings: {
      max_tile_width: plan.max_tile_width,
      max_tile_height: plan.max_tile_height,
      overlap: plan.overlap,
    },
    grid: {
      columns: plan.columns,
      rows: plan.rows,
    },
    tiles,
  };
  const manifestPath = join(requestedOutput, "tiles.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "wx",
  });
  return { manifest_path: manifestPath, ...manifest };
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
  for (const required of ["workspace", "source", "output-directory"]) {
    if (!options[required]) {
      throw new Error(`Missing --${required}`);
    }
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = await createImageTiles({
    workspace: options.workspace,
    sourcePath: options.source,
    outputDirectory: options["output-directory"],
    maxTileWidth: options["max-tile-width"] === undefined
      ? DEFAULT_TILE_OPTIONS.maxTileWidth
      : Number(options["max-tile-width"]),
    maxTileHeight: options["max-tile-height"] === undefined
      ? DEFAULT_TILE_OPTIONS.maxTileHeight
      : Number(options["max-tile-height"]),
    overlap: options.overlap === undefined
      ? DEFAULT_TILE_OPTIONS.overlap
      : Number(options.overlap),
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
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
