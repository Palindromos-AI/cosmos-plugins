import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { configureRuntime } from "../../../scripts/workspace-runtime.mjs";
import {
  renderAudit,
  renderReader,
  sha256File,
  sha256Utf8,
  SCHEMA_VERSION,
} from "../scripts/run-model.mjs";
import { createRun, loadRun, writeReaderSafely } from "../scripts/run-store.mjs";
import { runCli } from "../scripts/zsxq-runner.mjs";

const BODY = "主题正文第一行\n第二行";
const OCR = "图片内文字";
const PDF_PAGE = "PDF 第一页内容";
const IMAGE_URL_SIGNED_INVENTORY = "https://images.example/golden.png?sig=one";
const IMAGE_URL_SIGNED_EXTRACTION = "https://images.example/golden.png?sig=two";
const IMAGE_URL_SANITIZED = "https://images.example/golden.png";
const IMAGE_COUNT_EVIDENCE =
  "1 img slot(s) across 1 app-image-gallery gallery(ies) verified without "
  + "an overflow indicator in the expanded topic container";

async function goldenEnvironment(t, label) {
  const parent = await mkdtemp(path.join(os.tmpdir(), `zsxq-runner-${label}-`));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const runtimeOptions = {
    configFile: path.join(parent, "config", "runtime.json"),
    pluginRoot: path.join(parent, "installed-plugin"),
    validation: { temporaryRoots: [] },
  };
  const workspaceRoot = path.join(parent, "cosmos-root");
  await mkdir(workspaceRoot);
  const binding = await configureRuntime({ workspaceRoot, ...runtimeOptions });
  return { parent, runtimeOptions, binding };
}

async function writeWorkspaceJson(workspace, name, value) {
  const target = path.join(workspace, name);
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return target;
}

test("runner golden case renders the exact audit and reader artifacts", async (t) => {
  const { parent, runtimeOptions, binding } = await goldenEnvironment(t, "golden");
  const output = path.join(binding.workspace, "output", "zsxq", "2026-08-15-golden-planet.md");
  const manifestSeed = await createRun(path.join(parent, "run"), {
    planet: "Golden Planet",
    planet_url: "https://wx.zsxq.com/group/15555555555",
    date: "2026-08-15",
    snapshot_at: "2026-08-15T21:00:00+08:00",
    retrieved_at: "2026-08-15T21:00:00+08:00",
    output_path: output,
  }, { runtimeOptions });
  const workspace = manifestSeed.workspace;

  const imagePath = path.join(workspace, "golden-image.png");
  const pdfPath = path.join(workspace, "golden.pdf");
  await writeFile(imagePath, "golden-image-bytes", "utf8");
  await writeFile(pdfPath, "golden-pdf-bytes", "utf8");

  await runCli(["record-coverage", "--workspace", workspace, "--input",
    await writeWorkspaceJson(workspace, "coverage.json", {
      top_established: true,
      pending_new_content_loaded: true,
      crossed_below_target_date: true,
      chronology_consistent: true,
      access_complete: true,
      evidence: "Visible upper and lower boundaries verified",
    })]);
  await runCli(["record-inventory", "--workspace", workspace, "--input",
    await writeWorkspaceJson(workspace, "inventory.json", {
      topics: [
        {
          source_order: 1,
          source: { platform_id: "8151" },
          author: "Golden Author",
          timestamp: "2026-08-15T12:30:00+08:00",
          body: { status: "present", payload: BODY },
          image_count: 1,
          image_count_evidence: IMAGE_COUNT_EVIDENCE,
          attachments: [
            {
              type: "image",
              source_ordinal: 1,
              image_ordinal: 1,
              topic_association_evidence: "expanded topic 1 app-image-gallery slot 1",
              source: { transport_url: IMAGE_URL_SIGNED_INVENTORY },
            },
            {
              type: "pdf",
              source_ordinal: 2,
              source: { platform_id: "file-8151" },
              filename: "golden.pdf",
            },
          ],
        },
        {
          source_order: 2,
          source: {},
          author: "Midnight Author",
          timestamp: "2026-08-14T16:30:00Z",
          body: { status: "empty" },
          image_count: 0,
          image_count_evidence: "Expanded topic contains no image slots",
          attachments: [],
        },
      ],
    })]);
  await runCli(["upsert-topic", "--workspace", workspace, "--input",
    await writeWorkspaceJson(workspace, "topic-1.json", {
      source_order: 1,
      source: { platform_id: "8151" },
      author: "Golden Author",
      timestamp: "2026-08-15T12:30:00+08:00",
      body: { status: "present", payload: BODY },
      image_count: 1,
      image_count_evidence: IMAGE_COUNT_EVIDENCE,
      attachments: [
        {
          type: "image",
          source_ordinal: 1,
          image_ordinal: 1,
          topic_association_evidence: "expanded topic 1 app-image-gallery slot 1",
          source: { transport_url: IMAGE_URL_SIGNED_EXTRACTION },
          representation_path: imagePath,
          width: 640,
          height: 480,
          representation_type: "locator-screenshot",
          source_account: "未显示",
          extraction: { status: "present", payload: OCR },
          verification: { status: "verified", note: "Complete visual comparison" },
        },
        {
          type: "pdf",
          source_ordinal: 2,
          source: { platform_id: "file-8151" },
          filename: "golden.pdf",
          representation_path: pdfPath,
          page_count: 1,
          page_count_evidence: "Parser metadata reports 1 page",
          pages: [
            { page_number: 1, extraction: { status: "present", payload: PDF_PAGE } },
          ],
        },
      ],
    })]);
  await runCli(["upsert-topic", "--workspace", workspace, "--input",
    await writeWorkspaceJson(workspace, "topic-2.json", {
      source_order: 2,
      source: {},
      author: "Midnight Author",
      timestamp: "2026-08-14T16:30:00Z",
      body: { status: "empty" },
      image_count: 0,
      image_count_evidence: "Expanded topic contains no image slots",
      attachments: [],
    })]);

  const manifest = await loadRun(workspace);
  const urlIdentityHash = sha256Utf8(IMAGE_URL_SANITIZED);
  assert.equal(
    manifest.topics[0].attachments[0].source.source_identity,
    `url-sha256:${urlIdentityHash}`,
  );
  const imageSha256 = await sha256File(imagePath);
  const pdfSha256 = await sha256File(pdfPath);
  const topic2Key = `source-order:2:${sha256Utf8("2026-08-14T16:30:00Z")}`;

  const expectedAudit = `---
generator: zsxq-fetch
artifact_type: extraction-audit
planet: "Golden Planet"
planet_url: "https://wx.zsxq.com/group/15555555555"
date: "2026-08-15"
retrieved_at: "2026-08-15T21:00:00+08:00"
snapshot_at: "2026-08-15T21:00:00+08:00"
post_count: 2
completeness: complete
---

# Golden Planet｜2026-08-15｜内部提取审计

## 时间线覆盖

- 顶部已确认：true
- 新内容已加载：true
- 已越过目标日期：true
- 时间顺序一致：true
- 访问范围完整：true
- 覆盖证据：Visible upper and lower boundaries verified

## 主题 1｜2026-08-15T12:30:00+08:00

- 发布者：Golden Author
- 发布时间：2026-08-15T12:30:00+08:00
- 原帖：未从时间线页面获取
- 主题标识：platform-id:8151
- 正文状态：present
- 正文 SHA-256：${sha256Utf8(BODY)}
- 恢复内容 SHA-256：不适用
- 图片总数：1
- 图片总数证据：${IMAGE_COUNT_EVIDENCE}

### 星球正文

${BODY}

### 图片 1

- 附件标识：platform-id:8151:image:1:url-sha256:${urlIdentityHash}
- 来源身份：url-sha256:${urlIdentityHash}
- 平台标识：未显示
- 资源地址（已脱敏）：${IMAGE_URL_SANITIZED}
- 来源文件 SHA-256：未获取
- 原始序号：1
- 图片序号：1
- 主题关联证据：expanded topic 1 app-image-gallery slot 1
- 图像尺寸：640×480
- 图像 SHA-256：${imageSha256}
- 读取载体：locator-screenshot
- 分析模式：whole-image
- 截图来源账号：未显示
- 校核状态：verified
- 校核说明：Complete visual comparison
- 缓存复用自：无
- 提取状态：present
- 文字 SHA-256：${sha256Utf8(OCR)}
- 恢复内容 SHA-256：不适用

#### 图片内容文字

${OCR}

### PDF 1｜golden.pdf

- 附件标识：platform-id:8151:pdf:2:platform-id:file-8151
- 来源身份：platform-id:file-8151
- 平台标识：file-8151
- 资源地址（已脱敏）：未显示
- 来源文件 SHA-256：未获取
- 原始序号：2
- PDF 表示 SHA-256：${pdfSha256}
- 总页数：1
- 页数证据：Parser metadata reports 1 page
- 缓存复用自：无

#### 第 1 页

- 页面标识：platform-id:8151:pdf:2:platform-id:file-8151:page:1
- 页码：1
- 提取状态：present
- 文字 SHA-256：${sha256Utf8(PDF_PAGE)}
- 恢复内容 SHA-256：不适用

${PDF_PAGE}

## 主题 2｜2026-08-14T16:30:00Z

- 发布者：Midnight Author
- 发布时间：2026-08-14T16:30:00Z
- 原帖：未从时间线页面获取
- 主题标识：${topic2Key}
- 正文状态：empty
- 正文 SHA-256：不适用
- 恢复内容 SHA-256：不适用
- 图片总数：0
- 图片总数证据：Expanded topic contains no image slots

### 星球正文

无正文

## 提取异常

无
`;
  assert.equal(renderAudit(manifest), expectedAudit);

  const expectedReader = `# Golden Planet｜2026-08-15

## 主题 1｜2026-08-15 12:30:00｜Golden Author

${BODY}

### 图片 1

${OCR}

### PDF 1｜golden.pdf

#### 第 1 页

${PDF_PAGE}

## 主题 2｜2026-08-15 00:30:00｜Midnight Author

无正文

<!-- zsxq-fetch | planet=Golden%20Planet | planet_url=${encodeURIComponent("https://wx.zsxq.com/group/15555555555")} | date=2026-08-15 | snapshot_at=${encodeURIComponent("2026-08-15T21:00:00+08:00")} | post_count=2 | completeness=complete -->
`;
  assert.equal(renderReader(manifest), expectedReader);

  const finalized = await runCli(["finalize", "--workspace", workspace]);
  assert.equal(finalized.completeness, "complete");
  assert.equal(finalized.post_count, 2);
  assert.equal(finalized.output, output);
  assert.equal(await readFile(output, "utf8"), expectedReader);
  await assert.rejects(readFile(path.join(workspace, "manifest.json")));
});

test("a session-rotated signed URL no longer breaks inventory comparison", async (t) => {
  const { parent, runtimeOptions, binding } = await goldenEnvironment(t, "rotation");
  const output = path.join(binding.workspace, "output", "zsxq", "2026-08-15-rotation.md");
  const manifestSeed = await createRun(path.join(parent, "run"), {
    planet: "Rotation Planet",
    planet_url: "https://wx.zsxq.com/group/16666666666",
    date: "2026-08-15",
    snapshot_at: "2026-08-15T21:00:00+08:00",
    retrieved_at: "2026-08-15T21:00:00+08:00",
    output_path: output,
  }, { runtimeOptions });
  const workspace = manifestSeed.workspace;
  const imagePath = path.join(workspace, "image.png");
  await writeFile(imagePath, "rotation-image", "utf8");

  await runCli(["record-inventory", "--workspace", workspace, "--input",
    await writeWorkspaceJson(workspace, "inventory.json", {
      topics: [{
        source_order: 1,
        source: { platform_id: "9001" },
        author: "Rotation Author",
        timestamp: "2026-08-15T09:00:00+08:00",
        body: { status: "empty" },
        image_count: 1,
        image_count_evidence: "Viewer counter 1/1",
        attachments: [{
          type: "image",
          source_ordinal: 1,
          image_ordinal: 1,
          topic_association_evidence: "topic 1 slot 1",
          source: { transport_url: "https://images.example/a.png?token=first&sig=aa" },
        }],
      }],
    })]);
  const accepted = await runCli(["upsert-topic", "--workspace", workspace, "--input",
    await writeWorkspaceJson(workspace, "topic-1.json", {
      source_order: 1,
      source: { platform_id: "9001" },
      author: "Rotation Author",
      timestamp: "2026-08-15T09:00:00+08:00",
      body: { status: "empty" },
      image_count: 1,
      image_count_evidence: "Viewer counter 1/1",
      attachments: [{
        type: "image",
        source_ordinal: 1,
        image_ordinal: 1,
        topic_association_evidence: "topic 1 slot 1",
        source: { transport_url: "https://images.example/a.png?token=second&sig=bb" },
        representation_path: imagePath,
        width: 100,
        height: 100,
        representation_type: "rendered-preview",
        extraction: { status: "empty" },
        verification: { status: "verified", note: "No readable text" },
      }],
    })]);
  assert.equal(accepted.source_order, 1);

  const manifest = await loadRun(workspace);
  assert.equal(
    manifest.topics[0].attachments[0].source.source_identity,
    `url-sha256:${sha256Utf8("https://images.example/a.png")}`,
  );
  const differentPath = await writeWorkspaceJson(workspace, "topic-1b.json", {
    source_order: 1,
    source: { platform_id: "9001" },
    author: "Rotation Author",
    timestamp: "2026-08-15T09:00:00+08:00",
    body: { status: "empty" },
    image_count: 1,
    image_count_evidence: "Viewer counter 1/1",
    attachments: [{
      type: "image",
      source_ordinal: 1,
      image_ordinal: 1,
      topic_association_evidence: "topic 1 slot 1",
      source: { transport_url: "https://images.example/other.png?sig=cc" },
      representation_path: imagePath,
      width: 100,
      height: 100,
      representation_type: "rendered-preview",
      extraction: { status: "empty" },
      verification: { status: "verified", note: "No readable text" },
    }],
  });
  await assert.rejects(
    runCli(["upsert-topic", "--workspace", workspace, "--input", differentPath]),
    /sanitized transport URL differs from the source inventory/,
  );
});

test("a schema-1 manifest is rejected instead of silently migrated", async (t) => {
  const { parent, runtimeOptions, binding } = await goldenEnvironment(t, "schema");
  assert.equal(SCHEMA_VERSION, 2);
  const output = path.join(binding.workspace, "output", "zsxq", "2026-08-15-schema.md");
  const manifestSeed = await createRun(path.join(parent, "run"), {
    planet: "Schema Planet",
    planet_url: "https://wx.zsxq.com/group/17777777777",
    date: "2026-08-15",
    snapshot_at: "2026-08-15T21:00:00+08:00",
    retrieved_at: "2026-08-15T21:00:00+08:00",
    output_path: output,
  }, { runtimeOptions });
  const workspace = manifestSeed.workspace;

  const manifestPath = path.join(workspace, "manifest.json");
  const stored = JSON.parse(await readFile(manifestPath, "utf8"));
  stored.schema_version = 1;
  await writeFile(manifestPath, `${JSON.stringify(stored, null, 2)}\n`, "utf8");

  await assert.rejects(
    runCli(["status", "--workspace", workspace]),
    /unsupported schema or generator/,
  );
});

test("reader writer creates fresh output exclusively and refuses unmarked files", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "zsxq-reader-write-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const scope = {
    planet: "Test Planet",
    planet_url: "https://wx.zsxq.com/group/test",
    date: "2026-08-16",
    snapshot_at: "2026-08-16T01:00:00Z",
  };

  const target = path.join(directory, "reader.md");
  await writeReaderSafely(target, "# report\n", scope, "complete");
  assert.equal(await readFile(target, "utf8"), "# report\n");
  assert.deepEqual(await readdir(directory), ["reader.md"]);

  const unmarked = path.join(directory, "unmarked.md");
  await writeFile(unmarked, "user notes\n");
  await assert.rejects(
    writeReaderSafely(unmarked, "# report\n", scope, "complete"),
    /Refusing to overwrite an unmarked file/,
  );
  assert.equal(await readFile(unmarked, "utf8"), "user notes\n");
  assert.deepEqual(
    (await readdir(directory)).sort(),
    ["reader.md", "unmarked.md"],
  );
});
