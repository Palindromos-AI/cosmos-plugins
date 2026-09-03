# DingTalk image content extraction

Use this procedure for every image attached to an in-window DingTalk message. The image may determine whether the parent message satisfies the filter, so do not skip an image only because the surrounding text looks irrelevant. Skip this procedure only for an image `SKILL.md` step 2 omits — every image when the run's extraction scope excludes image content, and an image that is only a chart or graph; step 2 then governs.

## Associate and acquire

1. Prove that the image belongs to the current group message from the bubble, attachment order, thumbnail set, or viewer counter.
2. Record the image's ordinal within that message. Open each slot exactly once unless a clearer view is required.
3. Start with the rendered attachment. A representation is readable only when it shows the complete image with every line of its text legible at the captured scale; a thumbnail or viewer state that crops a long image or shrinks small text below legibility is not readable and never justifies an unreadable verdict. Open DingTalk's image viewer whenever the rendered form falls short of that. After opening, recheck the current image and ordinal so a reused viewer does not expose another attachment.
4. Use viewer zoom and overlapping screenshots for small or dense text, and step a long image through its full height at a legible zoom with overlapping captures until every region has been seen. Read the regions in natural reading order and merge overlap text once. Do not upscale, sharpen, denoise, or generate replacement pixels.
5. Do not download the image unless the user separately authorizes an export.

## Extract substantive content

- Transcribe the semantic text and structured data a reader needs to understand what the sender shared. Preserve headings, paragraphs, lists, quotations, code, chart labels, table rows, and their natural reading order.
- Exclude unrelated interface chrome: desktop or phone status bars, clocks, signal and battery indicators, DingTalk navigation, viewer controls, input placeholders, reaction controls, and standalone like, share, favorite, or comment counts.
- Keep interface text only when it is material evidence, such as an error message, setting name, transaction value, or tutorial step.
- Preserve a visible source account or identifying watermark as separate provenance, using `来源账号：<原文>` after the extracted body. Do not mix it into the body.
- Write `未检测到可读文字` only after visually confirming that the image contains no readable text or structured textual data. Do not invent a caption or infer hidden text.

## Verify and fail visibly

- Mark the image `无法完整辨认` only when the clearest available viewer state — the highest useful zoom, every region visited — still cannot be read because the image itself is blurry or too low-resolution; say so in the note, retain only the reliably recovered fragment, and do not invent or autocomplete missing content.
- If image association, image count, or complete reading cannot be proven, mark the parent group incomplete. Never silently drop the image or use surrounding text as a substitute for unreadable pixels.
