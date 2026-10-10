"""The WireViz document: HTML (optionally with the BOM on its own sheet) and its PDF.

SPEC FR-30, FR-37, FR-38; PLAN D17, D21. Runs in the render workers.

- The HTML is WireViz's own output (generate_html_output) from the harness that was already
  built for the diagram, so Graphviz runs once.
- Two sheets: WireViz's templates show the diagram and the BOM on one sheet, with "Sheet 1 of 1".
  For a separate BOM sheet, the template text is changed twice (BOM removed / BOM in place of
  the diagram, sheet numbers filled in), each version is rendered by WireViz, and the two bodies
  are joined with a page break.
- The PDF is made by WeasyPrint at the template's paper size. The document contains file content
  (WireViz inserts metadata unescaped), so the fetcher only allows data: URLs (images WireViz
  already embedded); file:, http: and everything else are refused.
"""

from __future__ import annotations

import re
import shutil
import tempfile
from pathlib import Path
from typing import Any

BOM_PLACEHOLDERS = ("<!-- %bom% -->", "<!-- %bom_reversed% -->")
DIAGRAM_PLACEHOLDER = "<!-- %diagram% -->"
# Each sheet in its own container; a new page starts at every sheet after the first. The gap
# between sheets is for the screen only: a DIN sheet fills its page exactly, so on paper any extra
# height would push the next sheet onto a page of its own.
SHEET_CSS = (
    "<style>.loomviz-sheet + .loomviz-sheet { break-before: page; page-break-before: always; }"
    " @media screen { .loomviz-sheet + .loomviz-sheet { margin-top: 12mm; } }"
    # The BOM sheet: the table sits where the drawing was; centre it.
    " #diagram > table.bom { margin: 8mm auto 0; }</style>"
)

# DIN 6771 frame classes -> paper (the frame plus the template's print margins fit these exactly).
PAGE_SIZES = {
    "A4": "A4 portrait",
    "A3": "A3 landscape",
    "A2": "A2 landscape",
    "sheetsize_default": "A4 portrait",
}


def _builtin_templates_dir() -> Path:
    import wireviz

    return Path(wireviz.__file__).parent / "templates"


def template_text(metadata: dict[str, Any], custom_template: Path | None) -> str:
    """The template WireViz would use (check_template has already validated the name)."""
    if custom_template:
        return custom_template.read_text(encoding="utf-8")
    template = metadata.get("template")
    name = template.get("name") if isinstance(template, dict) else None
    return (_builtin_templates_dir() / f"{name or 'simple'}.html").read_text(encoding="utf-8")


def split_template(text: str) -> tuple[str, str] | None:
    """Template versions for sheet 1 (drawing, no BOM) and sheet 2 (BOM where the drawing was).

    None if the template doesn't have the placeholders needed (e.g. a custom template without a BOM).
    """
    if DIAGRAM_PLACEHOLDER not in text or not any(p in text for p in BOM_PLACEHOLDERS):
        return None
    base = text
    for placeholder in BOM_PLACEHOLDERS:
        base = base.replace(placeholder, "")
    # WireViz's simple template has section headings; DIN 6771 has none.
    sheet1 = base.replace("<h2>Bill of Materials</h2>", "")
    sheet2 = (
        base.replace("<h2>Bill of Materials</h2>", "")
        .replace("<h2>Diagram</h2>", "<h2>Bill of Materials</h2>")
        .replace(DIAGRAM_PLACEHOLDER, BOM_PLACEHOLDERS[0])
        .replace("<!-- %description% -->", "")  # shown on sheet 1 only
        .replace("<!-- %notes% -->", "")
    )
    numbered = []
    for number, sheet in ((1, sheet1), (2, sheet2)):
        numbered.append(
            sheet.replace("<!-- %sheet_current% -->", str(number)).replace("<!-- %sheet_total% -->", "2")
        )
    return numbered[0], numbered[1]


def _render_with_template(harness: Any, stem: str, text: str, tmp: Path, name: str) -> str:
    """Run WireViz's HTML generator with `text` as the template (found next to the output file)."""
    from wireviz.wv_bom import bom_list
    from wireviz.wv_html import generate_html_output

    (tmp / f"{name}.html").write_text(text, encoding="utf-8")
    metadata = dict(harness.metadata)
    template = dict(metadata.get("template") or {})
    template["name"] = name
    metadata["template"] = template
    base = tmp / stem
    generate_html_output(base, bom_list(harness.bom()), metadata, harness.options)
    return Path(f"{base}.html").read_text(encoding="utf-8")


def _join_sheets(pages: list[str]) -> str:
    head_match = re.search(r"<head\b.*?</head>", pages[0], re.S | re.I)
    head = head_match.group(0) if head_match else "<head></head>"
    head = re.sub(r"</head>", SHEET_CSS + "</head>", head, count=1, flags=re.I)
    body_tag = re.search(r"<body\b[^>]*>", pages[0], re.I)
    bodies = [
        m.group(1) if (m := re.search(r"<body\b[^>]*>(.*)</body>", p, re.S | re.I)) else p for p in pages
    ]
    sheets = "".join(f'<div class="loomviz-sheet">{body}</div>' for body in bodies)
    return f"<!DOCTYPE html>\n<html>{head}{body_tag.group(0) if body_tag else '<body>'}{sheets}</body></html>"


def document_html(harness: Any, stem: str, custom_template: Path | None, bom_sheet: bool = False) -> str:
    """WireViz's document for an already-built harness (its SVG is reused, no new Graphviz run)."""
    text = template_text(harness.metadata, custom_template)
    sheets = split_template(text) if bom_sheet else None
    tmp = Path(tempfile.mkdtemp(prefix="loomviz-html-"))
    try:
        Path(f"{tmp / stem}.tmp.svg").write_text(harness.svg, encoding="utf-8")
        if sheets:
            pages = [
                _render_with_template(harness, stem, sheet, tmp, f"loomviz-sheet-{i}")
                for i, sheet in enumerate(sheets, start=1)
            ]
            html = _join_sheets(pages)
        else:
            html = _render_with_template(harness, stem, text, tmp, "loomviz-sheet")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return html.replace(f"{tmp}/", "").replace(str(tmp), "")


def page_css(html: str) -> str:
    """@page rules for the PDF: the template's sheet size, or A4 with margins for the simple one."""
    frame = re.search(r'id="frame" class="([^"]*)"', html)
    if frame:
        size = PAGE_SIZES.get(frame.group(1).strip(), "A4 portrait")
        # The template limits the drawing with a percentage max-height and centres it with a
        # transform; WeasyPrint doesn't resolve those like browsers do, so the drawing overlapped
        # the title block (and width/height 100% made the whole sheet disappear). Use the same
        # limit in mm: the frame height minus the title block's 13 rows of 4.25 mm, minus a margin.
        drawing = (
            "#diagram svg { width: auto; height: auto; max-width: 95%; top: 0; transform: none; }"
            " .A4 #diagram svg, .A3 #diagram svg, .sheetsize_default #diagram svg { max-height: 217mm; }"
            " .A2 #diagram svg { max-height: 340mm; }"
        )
        return f"@page {{ size: {size}; margin: 0 }} {drawing}"
    return "@page { size: A4 portrait; margin: 12mm } svg { max-width: 100%; height: auto }"


def document_pdf(html: str) -> tuple[bytes, list[str]]:
    """PDF of the document. Returns the PDF and the URLs that were refused."""
    from weasyprint import HTML
    from weasyprint.urls import URLFetcher

    refused: list[str] = []

    class DataOnlyFetcher(URLFetcher):
        def fetch(self, url: str, headers: Any = None) -> Any:
            if not url.lower().startswith("data:"):
                refused.append(url)
                raise ValueError(f"LoomViz only embeds data: URLs in PDFs, refused {url}")
            return super().fetch(url, headers)

    styled = html.replace("</head>", f"<style>{page_css(html)}</style></head>", 1)
    fetcher = DataOnlyFetcher(allowed_protocols=("data",), timeout=5)
    pdf = HTML(string=styled, url_fetcher=fetcher).write_pdf()
    return bytes(pdf), refused
