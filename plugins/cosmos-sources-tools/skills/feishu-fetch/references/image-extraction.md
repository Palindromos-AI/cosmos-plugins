# Feishu image content extraction

Use this procedure for every image attached to an in-window Feishu message. The image may determine whether the parent message satisfies the filter, so do not skip an image only because the surrounding text looks irrelevant.

## Associate and acquire

1. Prove that the image belongs to the current group message from the bubble, attachment order, thumbnail set, or viewer counter.
2. Record the image's ordinal within that message. Open each slot exactly once unless a clearer view is required.
3. Start with the rendered attachment. Open Feishu's image viewer only when the rendered form is too small or cropped. After opening, recheck the current image and ordinal so a reused viewer does not expose another attachment.
4. Use viewer zoom and overlapping screenshots for small or dense text. Read the regions in natural reading order and merge overlap text once. Do not upscale, sharpen, denoise, or generate replacement pixels.
5. Do not inspect Feishu caches, signed transport URLs, or private endpoints. Do not download the image unless the user separately authorizes an export.

## Extract substantive content

- Transcribe the semantic text and structured data a reader needs to understand what the sender shared. Preserve headings, paragraphs, lists, quotations, code, chart labels, table rows, and their natural reading order.
- Exclude unrelated interface chrome: desktop or phone status bars, clocks, signal and battery indicators, Feishu navigation, viewer controls, input placeholders, reaction controls, and standalone like, share, favorite, or comment counts.
- Keep interface text only when it is material evidence, such as an error message, setting name, transaction value, or tutorial step.
- Preserve a visible source account or identifying watermark as separate provenance, using `来源账号：<原文>` after the extracted body. Do not mix it into the body.
- Write `未检测到可读文字` only after visually confirming that the image contains no readable text or structured textual data. Do not invent a caption or infer hidden text.

## Verify and fail visibly

- Perform a separate visual pass over the same representation. Confirm that every substantive region was read, structure was preserved, overlap was reconciled once, the source account stayed separate, and interface noise was excluded.
- If a clearer viewer state or zoomed region remains unreadable, retain only the reliably recovered fragment and mark the image `无法完整辨认`; do not invent or autocomplete missing content.
- If image association, image count, or complete reading cannot be proven, mark the parent group incomplete. Never silently drop the image or use surrounding text as a substitute for unreadable pixels.
