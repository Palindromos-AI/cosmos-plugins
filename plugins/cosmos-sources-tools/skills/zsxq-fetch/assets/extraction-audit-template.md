---
generator: zsxq-fetch
artifact_type: extraction-audit
planet: "{{planet_name}}"
planet_url: "{{planet_url}}"
date: "{{YYYY-MM-DD}}"
retrieved_at: "{{ISO-8601 timestamp}}"
snapshot_at: "{{ISO-8601 platform snapshot timestamp}}"
post_count: {{post_count}}
completeness: {{complete|incomplete}}
---

# {{planet_name}}｜{{YYYY-MM-DD}}｜内部提取审计

## 时间线覆盖

- 顶部已确认：{{true|false}}
- 新内容已加载：{{true|false}}
- 已越过目标日期：{{true|false}}
- 时间顺序一致：{{true|false}}
- 访问范围完整：{{true|false}}
- 覆盖证据：{{visible_boundary_evidence}}

## 主题 1｜{{HH:MM}}

- 发布者：{{author_display_name}}
- 发布时间：{{source_timestamp}}
- 原帖：{{topic_permalink|未从时间线页面获取}}
- 主题标识：{{topic_key}}
- 正文状态：{{present|empty|failed}}
- 正文 SHA-256：{{body_sha256|不适用}}
- 图片总数：{{image_count}}
- 图片总数证据：{{完整附件槽位 1..N|主题详情完整图组|图片查看器 1/N|完整展开后确认无图片}}
- 恢复内容 SHA-256：{{仅 failed 且有可靠恢复内容时填写；否则不适用}}
- 失败说明：{{仅 failed 时填写具体原因；否则删除本行}}

### 星球正文

{{unchanged_topic_body|无正文|recovered_topic_body|无可可靠恢复内容}}

### 图片 1

- 附件标识：{{attachment_key}}
- 来源身份：{{source_identity}}
- 平台标识：{{platform_attachment_id|未显示}}
- 原始序号：{{source_ordinal}}
- 图片序号：{{image_ordinal}}
- 主题关联证据：{{topic_association_evidence}}
- 资源地址（已脱敏）：{{sanitized_image_url|未显示}}
- 来源文件 SHA-256：{{source_binary_sha256|未获取}}
- 图像尺寸：{{width×height|未获取}}
- 图像 SHA-256：{{sha256|未获取}}
- 读取载体：{{rendered-preview|locator-screenshot|viewer-screenshot|single-asset-export|page-screenshot|未获取}}
- 分析模式：{{whole-image|tiled|unavailable}}
- 切片清单 SHA-256：{{仅 tiled；否则不适用}}
- 归一化图像 SHA-256：{{仅 tiled；否则不适用}}
- 切片设置：{{仅 tiled；max_width×max_height，重叠 Npx}}
- 切片网格：{{仅 tiled；N 列 × M 行}}
- 切片 {{tile_index}}：{{仅 tiled；row/column、left/top/width/height、sha256、verification_status、verification_note}}
- 截图来源账号：{{source_account|未显示}}
- 提取状态：{{present|empty|failed}}
- 校核状态：{{verified|failed}}
- 校核说明：{{已与读取载体逐区对照，实质内容完整|失败：缺失、不可读或不确定的具体内容}}
- 缓存复用自：{{source_occurrence_key|无}}
- 文字 SHA-256：{{text_sha256|不适用}}
- 恢复内容 SHA-256：{{仅 failed 且有可靠恢复内容时填写；否则不适用}}
- 失败说明：{{仅 failed 时填写具体原因；否则删除本行}}

#### 图片内容文字

{{image_text|未检测到可读文字|recovered_image_text|无可可靠恢复内容}}

### 外部网页 1｜{{page_title}}

- 附件标识：{{attachment_key}}
- 来源身份：{{source_identity}}
- 平台标识：{{platform_attachment_id|未显示}}
- 资源地址（已脱敏）：{{sanitized_source_url|未显示}}
- 来源文件 SHA-256：{{source_binary_sha256|未获取}}
- 原始序号：{{source_ordinal}}
- 原始链接：{{original_page_url}}
- 规范链接：{{canonical_page_url|与原始链接相同|未显示}}
- 稳定页面标识：{{stable_page_id|未显示}}
- 内嵌媒体清单状态：{{complete|failed}}
- 内嵌媒体总数：{{embedded_media_count|未知}}
- 内嵌媒体总数证据：{{embedded_media_count_evidence}}
- 内嵌媒体清单失败说明：{{仅无法确认完整范围时填写具体原因；否则删除本行}}
- 内嵌媒体清单读者说明：{{仅无法确认完整范围时填写面向读者的局部说明；否则删除本行}}
- 作者：{{page_author|未显示}}
- 发布时间：{{page_publication_time|未显示}}
- 提取状态：{{present|empty|failed}}
- 网页正文状态：{{present|empty|failed}}
- 正文 SHA-256：{{text_sha256|不适用}}
- 恢复内容 SHA-256：{{仅 failed 且有可靠恢复内容时填写；否则不适用}}
- 失败说明：{{仅 failed 时填写具体原因；否则删除本行}}

#### 网页正文

{{main_page_text|未检测到正文|recovered_main_page_text|无可可靠恢复内容}}

#### 网页内嵌图片 1

- 内嵌资源标识：{{embedded_media_key}}
- 父附件标识：{{parent_attachment_key}}
- 来源身份：{{source_identity}}
- 平台标识：{{platform_attachment_id|未显示}}
- 原始序号：{{source_ordinal}}
- 资源地址（已脱敏）：{{sanitized_image_url|未显示}}
- 来源文件 SHA-256：{{source_binary_sha256|未获取}}
- 图像尺寸：{{width×height|未获取}}
- 图像 SHA-256：{{sha256|未获取}}
- 读取载体：{{rendered-preview|locator-screenshot|viewer-screenshot|single-asset-export|page-screenshot|未获取}}
- 分析模式：{{whole-image|tiled|unavailable}}
- 切片清单 SHA-256：{{仅 tiled；否则不适用}}
- 归一化图像 SHA-256：{{仅 tiled；否则不适用}}
- 切片设置：{{仅 tiled；max_width×max_height，重叠 Npx}}
- 切片网格：{{仅 tiled；N 列 × M 行}}
- 切片 {{tile_index}}：{{仅 tiled；row/column、left/top/width/height、sha256、verification_status、verification_note}}
- 截图来源账号：{{source_account|未显示}}
- 提取状态：{{present|empty|failed}}
- 校核状态：{{verified|failed}}
- 校核说明：{{已与读取载体逐区对照，实质内容完整|失败：缺失、不可读或不确定的具体内容}}
- 缓存复用自：{{source_occurrence_key|无}}
- 文字 SHA-256：{{text_sha256|不适用}}
- 恢复内容 SHA-256：{{仅 failed 且有可靠恢复内容时填写；否则不适用}}
- 失败说明：{{仅 failed 时填写具体原因；否则删除本行}}

##### 图片内容文字

{{image_text|未检测到可读文字|recovered_image_text|无可可靠恢复内容}}

#### 网页内嵌 PDF 1｜{{filename}}

- 内嵌资源标识：{{embedded_media_key}}
- 父附件标识：{{parent_attachment_key}}
- 来源身份：{{source_identity}}
- 平台标识：{{platform_attachment_id|未显示}}
- 原始序号：{{source_ordinal}}
- 资源地址（已脱敏）：{{sanitized_pdf_url|无法获取独立链接}}
- 来源文件 SHA-256：{{source_binary_sha256|未获取}}
- PDF 表示 SHA-256：{{representation_sha256|未获取}}
- 总页数：{{page_count|未知}}
- 页数证据：{{page_count_evidence}}
- 缓存复用自：{{source_occurrence_key|无}}

{{若整份文档均无法读取，在此直接填写提取状态、恢复内容 SHA-256、失败说明与可靠恢复内容；删除全部分页小节}}

##### 第 1 页

- 页面标识：{{page_key}}
- 页码：{{page_number}}
- 提取状态：{{present|empty|failed}}
- 文字 SHA-256：{{page_text_sha256|不适用}}
- 恢复内容 SHA-256：{{仅 failed 且有可靠恢复内容时填写；否则不适用}}
- 失败说明：{{仅 failed 时填写具体原因；否则删除本行}}

{{page_text|未检测到可读文字|recovered_page_text|无可可靠恢复内容}}

### PDF 1｜{{filename}}

- 附件标识：{{attachment_key}}
- 来源身份：{{source_identity}}
- 平台标识：{{platform_attachment_id|未显示}}
- 原始序号：{{source_ordinal}}
- 资源地址（已脱敏）：{{sanitized_pdf_url|无法获取独立链接}}
- 来源文件 SHA-256：{{source_binary_sha256|未获取}}
- PDF 表示 SHA-256：{{representation_sha256|未获取}}
- 总页数：{{page_count|未知}}
- 页数证据：{{page_count_evidence}}
- 缓存复用自：{{source_occurrence_key|无}}

{{若整份文档均无法读取，在此直接填写提取状态、恢复内容 SHA-256、失败说明与可靠恢复内容；删除全部分页小节}}

#### 第 1 页

- 页面标识：{{page_key}}
- 页码：{{page_number}}
- 提取状态：{{present|empty|failed}}
- 文字 SHA-256：{{page_text_sha256|不适用}}
- 恢复内容 SHA-256：{{仅 failed 且有可靠恢复内容时填写；否则不适用}}
- 失败说明：{{仅 failed 时填写具体原因；否则删除本行}}

{{page_text|未检测到可读文字|recovered_page_text|无可可靠恢复内容}}

<!-- 按原始附件顺序重复图片、外部网页和 PDF 小节；在对应网页小节内按页面顺序重复内嵌图片或 PDF 子小节；按时间线顺序重复主题。删除未使用的占位小节。post_count 为 0 时，删除整个“主题 1”示例。 -->

## 提取异常

{{无|逐项列出主题、附件或页码及具体失败原因}}
