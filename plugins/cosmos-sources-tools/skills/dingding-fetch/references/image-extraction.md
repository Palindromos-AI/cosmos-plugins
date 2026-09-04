# DingTalk image content extraction

Use this procedure for every image attached to an in-window DingTalk message. The image may determine whether the parent message satisfies the filter, so do not skip an image only because the surrounding text looks irrelevant. Skip this procedure only for an image `SKILL.md` step 2 omits — every image when the run's extraction scope excludes image content, and an image that is only a chart or graph; step 2 then governs.

## Associate and acquire

1. Prove that the image belongs to the current group message from the bubble and attachment order. Inspect the rendered attachment only enough to establish association and apply the chart omission rule; extract text from the downloaded original.
2. Record the image's ordinal within that message. Use DingTalk's visible image context menu and select `下载原图` (or its localized equivalent). Downloading in-scope images for temporary local extraction is part of this workflow; do not request separate download approval. Respect an explicit user prohibition on downloads and any tool or system permission requirements.
3. Save each original to a unique file in the private run directory. In a native Save dialog, navigate to that directory with the folder/location control, then enter only the filename in the name field; do not assume an absolute path in the filename field changes the destination. Verify the actual saved file and its association with the current message and image ordinal. If DingTalk saves to its default download folder, identify only the file created by this action and move it into the run directory; never inspect application caches or obtain the image through private URLs or endpoints.
4. Open the downloaded original with the available local image-reading tool at original resolution. Verify the whole image and every line of substantive text. For a long or dense image, use lossless crops at native resolution with overlap, cover every region, and merge overlap text once. Do not upscale, sharpen, denoise, or generate replacement pixels.
5. If downloading is prohibited, unavailable, or fails, or the downloaded original cannot be opened, mark the affected group incomplete and state the actual restriction or failure. Do not fall back to thumbnail transcription, a separate image viewer, or screenshots.
6. Keep downloaded originals and analysis crops temporary. Remove only this run's files after successful publication, including any verified download left outside the run directory; do not retain or publish the image files unless the user explicitly requests them. If cleanup is blocked, report the retained file rather than claiming it was removed.

## Extract substantive content

- Transcribe the semantic text and structured data a reader needs to understand what the sender shared. Preserve headings, paragraphs, lists, quotations, code, table rows, and their natural reading order; omit charts and their labels as required by `SKILL.md` step 2.
- Exclude unrelated interface chrome: desktop or phone status bars, clocks, signal and battery indicators, DingTalk navigation, viewer controls, input placeholders, reaction controls, and standalone like, share, favorite, or comment counts.
- Keep interface text only when it is material evidence, such as an error message, setting name, transaction value, or tutorial step.
- Preserve a visible source account or identifying watermark as separate provenance, using `来源账号：<原文>` after the extracted body. Do not mix it into the body.
- Write `未检测到可读文字` only after visually confirming that the image contains no readable text or structured textual data. Do not invent a caption or infer hidden text.

## Verify and fail visibly

- Mark the image `无法完整辨认` because of source quality only after inspecting every region of the downloaded original at native resolution and confirming the source itself is blurry or too low-resolution. Distinguish download, permission, or local-reading failures from source-quality failures. Retain only reliably recovered fragments and do not invent or autocomplete missing content.
- If image association, image count, or complete reading cannot be proven, mark the parent group incomplete. Never silently drop the image or use surrounding text as a substitute for unreadable pixels.
