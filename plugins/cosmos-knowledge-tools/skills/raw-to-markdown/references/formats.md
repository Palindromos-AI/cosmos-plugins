# Format routing

Use the pinned local MarkItDown engine for all supported inputs. Do not invoke other Skills or network services.

## Supported inputs

| Family | Extensions | Expected preservation | Important limitation |
| --- | --- | --- | --- |
| Word | `.docx` | Headings, paragraphs, lists, tables, links | Complex floating layout, tracked-change state, and embedded images may not survive |
| PDF | `.pdf` | Text order and Chinese section headings; fragmented dense or short sparse false tables trigger local cleanup | Image-only/scanned PDFs require OCR; true tables may need manual comparison after prose fallback |
| PowerPoint | `.pptx` | Slide order, titles, text, tables, notes when exposed | Spatial layout, diagrams, and image-only content become incomplete text |
| Excel | `.xlsx`, `.xls` | Sheet names and tabular values | Formatting, charts, and formula relationships may be flattened |
| Outlook | `.msg` | Headers and message body | Embedded or unusual attachments may require separate conversion |
| Web/text | `.html`, `.htm`, `.csv`, `.tsv`, `.json`, `.xml`, `.txt` | Text structure and tables where representable | Presentation styling is intentionally discarded |
| Containers/books | `.zip`, `.epub` | Text from supported members or chapters | Review ordering and attachment coverage after conversion |

## Unsupported in this version

- Existing `.md` files: already Markdown; never reconvert them.
- Office lock files (`~$*`) and operating-system metadata files (`._*`, `.DS_Store`): skip them.
- Legacy Word/PowerPoint and OpenDocument files: `.doc`, `.ppt`, `.rtf`, `.odt`, `.ods`, `.odp`.
- Standalone images, audio, and video.
- Remote URLs and cloud documents.

Do not silently substitute another converter. Report the unsupported format and ask whether the user wants the Skill extended.

## Quality checks by family

- Word: compare headings, lists, tables, footnotes/endnotes if material, and the beginning/end of the document.
- PDF: compare at least the first page, one dense middle page, the last page, and every material table cited in later analysis. Confirm repeated headers, explicit copyright/confidentiality footer labels, unambiguous margin page numbers, false Markdown tables, and hard line wraps were removed without dropping headings, references, footnotes, recurring URL/citation continuations, body numbers, sparse-page digits, or real tables.
- PowerPoint: verify slide count markers/order and inspect representative text-heavy and table-heavy slides.
- Excel: verify every sheet is represented and spot-check headers, row/column alignment, formulas versus displayed values, and empty-cell handling.
- Structured text: confirm delimiter, encoding, key nesting, and row count or top-level item count where relevant.

Markdown is a semantic derivative, not a layout-faithful replacement. The original file remains authoritative.
