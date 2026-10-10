// WireViz's HTML document is built from repository content (metadata is inserted unescaped),
// so it is shown in an <iframe sandbox> (no scripts, opaque origin) with a Content-Security-Policy
// that blocks every external load. Inline styles and data: images (embedded diagram images) stay.

export const DOCUMENT_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'";

export function withDocumentCsp(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${DOCUMENT_CSP}">`;
  // The policy must come before anything that could load: put it right after <head>.
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head)
    return html.slice(0, head.index + head[0].length) + meta + html.slice(head.index + head[0].length);
  return `<!doctype html><html><head>${meta}</head><body>${html}</body></html>`;
}
