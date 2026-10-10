"""Document with a separate BOM sheet (FR-37) and PDF download (FR-38)."""

import asyncio
import io
import re
from pathlib import Path

import pytest
from pypdf import PdfReader

from loomviz.document import page_css, split_template
from loomviz.render import Renderer

from .conftest import DEMO

SIMPLE_TEMPLATE = """<html><head><title><!-- %title% --></title></head><body>
<h1><!-- %title% --></h1>
<h2>Diagram</h2>
<div id="description"><!-- %description% --></div>
<div id="diagram"><!-- %diagram% --></div>
<h2>Bill of Materials</h2>
<div id="bom"><!-- %bom% --></div>
</body></html>"""


def test_split_template_moves_the_bom_to_its_own_sheet():
    sheet1, sheet2 = split_template(SIMPLE_TEMPLATE)
    assert "<!-- %diagram% -->" in sheet1 and "<!-- %bom% -->" not in sheet1
    assert "Bill of Materials" not in sheet1
    assert "<!-- %diagram% -->" not in sheet2 and sheet2.count("<!-- %bom% -->") == 1
    assert sheet2.count("Bill of Materials") == 1 and "<h2>Diagram</h2>" not in sheet2
    assert "<!-- %description% -->" not in sheet2  # description stays on sheet 1


def test_split_template_numbers_the_sheets():
    din = "<!-- %diagram% --><!-- %bom_reversed% -->Sheet <!-- %sheet_current% --> of <!-- %sheet_total% -->"
    sheet1, sheet2 = split_template(din)
    assert sheet1.endswith("Sheet 1 of 2") and sheet2.endswith("Sheet 2 of 2")


def test_split_template_without_placeholders():
    assert split_template("<html><!-- %diagram% --></html>") is None


def test_page_css_follows_the_sheet_size():
    assert "A3 landscape" in page_css('<div id="frame" class="A3">')
    assert "A2 landscape" in page_css('<div id="frame" class="A2">')
    assert "A4 portrait" in page_css('<div id="frame" class="A4">')
    # The simple template (no frame): A4 landscape with margins, since diagrams are usually wide.
    assert "A4 landscape" in page_css("<html>no frame</html>") and "margin: 12mm" in page_css("<html></html>")


def render(client, bom_sheet: bool, text: str | None = None) -> str:
    body = {"yaml": text or DEMO.read_text(), "path": "demo02.yml", "html": True, "bom_sheet": bom_sheet}
    return client.post("/api/render", json=body).json()["html"]


def test_document_with_bom_sheet(client):
    one = render(client, bom_sheet=False)
    two = render(client, bom_sheet=True)
    assert one.count('id="frame"') == 1 and re.findall(r"Sheet<br />(\d)", one) == ["1"]
    assert two.count('id="frame"') == 2 and re.findall(r"Sheet<br />(\d)", two) == ["1", "2"]
    assert re.findall(r"of (\d)</td>", two) == ["2", "2"]
    sheet1, sheet2 = two.split('<div class="loomviz-sheet">')[1:]
    assert "<svg" in sheet1 and '<table class="bom">' not in sheet1
    assert "<svg" not in sheet2 and '<table class="bom">' in sheet2


def test_simple_template_with_bom_sheet(client):
    text = (
        DEMO.read_text().replace("    name: din-6771\n", "").replace("  template:\n    sheetsize: A3\n", "")
    )
    two = render(client, bom_sheet=True, text=text)
    assert two.count('class="loomviz-sheet"') == 2
    assert two.count("<h2>Bill of Materials</h2>") == 1


def pdf(client, bom_sheet: bool, text: str | None = None):
    body = {"yaml": text or DEMO.read_text(), "path": "demo02.yml", "bom_sheet": bom_sheet}
    return client.post("/api/document.pdf", json=body)


@pytest.mark.parametrize(("bom_sheet", "pages"), [(False, 1), (True, 2)])
def test_pdf_download(client, bom_sheet, pages):
    response = pdf(client, bom_sheet)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["content-disposition"] == 'attachment; filename="demo02.pdf"'
    reader = PdfReader(io.BytesIO(response.content))
    assert len(reader.pages) == pages
    for page in reader.pages:  # A3 landscape, 420 x 297 mm
        width_mm = float(page.mediabox.width) * 25.4 / 72
        height_mm = float(page.mediabox.height) * 25.4 / 72
        assert (round(width_mm), round(height_mm)) == (420, 297)
    text = reader.pages[0].extract_text()
    assert "WireViz Demo 2" in text and "Molex KK 254" in text


def test_pdf_of_broken_yaml_is_an_error(client):
    response = pdf(client, False, text="connectors: [\n")
    assert response.status_code == 422
    assert "YAML syntax error" in response.json()["detail"]


def test_pdf_refuses_everything_but_data_urls(workspace):
    """Metadata goes into the document unescaped: it must not make the PDF read files or call out."""
    text = DEMO.read_text().replace(
        "title: WireViz Demo 2",
        """title: >-
    Demo <img src="file:///etc/passwd"> <img src="http://example.invalid/track.png">
    <link rel="stylesheet" href="https://example.invalid/x.css">""",
    )
    renderer = Renderer(workspace / "loom", workers=1)
    try:
        result = asyncio.run(renderer.pdf(text, workspace / "loom" / "demo02.yml", False))
    finally:
        renderer.close()
    assert "pdf" in result, result
    assert "file:///etc/passwd" in result["refused"]
    assert "http://example.invalid/track.png" in result["refused"]
    assert "https://example.invalid/x.css" in result["refused"]
    assert b"root:" not in result["pdf"]


# --- wide BOM in the simple template (regression: the BOM ran off the page) ---------------------

WIDE_BOM = (Path(__file__).parent / "fixtures" / "wide_bom.yml").read_text()
BOM_VALUES = ["999-888-777", "Cables R Us", "Label-ID-1", "WIRE3", "W1-RD", "1009", "Digimouse"]


def test_bom_header_becomes_thead():
    from loomviz.document import _bom_header_repeats

    html = '<table class="bom">\n  <tr>\n    <th>Id</th>\n  </tr>\n  <tr>\n    <td>1</td>\n  </tr>\n</table>'
    out = _bom_header_repeats(html)
    assert "<thead><tr>" in out and "</thead><tbody>" in out and out.endswith("</tbody></table>")
    reversed_bom = (
        '<table class="bom">\n  <tr>\n    <td>1</td>\n  </tr>\n  <tr>\n    <th>Id</th>\n  </tr>\n</table>'
    )
    assert _bom_header_repeats(reversed_bom) == reversed_bom  # header at the bottom: left alone


@pytest.mark.parametrize("bom_sheet", [False, True])
def test_wide_bom_fits_the_page(client, bom_sheet):
    response = client.post(
        "/api/document.pdf", json={"yaml": WIDE_BOM, "path": "demo02.yml", "bom_sheet": bom_sheet}
    )
    assert response.status_code == 200
    reader = PdfReader(io.BytesIO(response.content))
    for page in reader.pages:  # A4 landscape
        width_mm = float(page.mediabox.width) * 25.4 / 72
        height_mm = float(page.mediabox.height) * 25.4 / 72
        assert (round(width_mm), round(height_mm)) == (297, 210)
    text = "\n".join(page.extract_text() for page in reader.pages)
    for value in BOM_VALUES:  # every column, including the right-most ones, made it onto paper
        assert value in text, value
    bom_pages = [p for p in reader.pages if "Designators" in p.extract_text()]
    assert all("Manufacturer" in p.extract_text() for p in bom_pages)  # header repeats on each BOM page
