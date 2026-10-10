// The diagram SVG is built from repository content and inserted into the page so it can be
// clicked (PLAN D15). Sanitise it first: no scripts, event handlers, embedded HTML, styles or
// external references. Only in-document (#…) and data:image references survive.

import DOMPurify from "dompurify";

const purify = DOMPurify(window);

purify.addHook("uponSanitizeAttribute", (_node, data) => {
  if (data.attrName === "href" || data.attrName === "xlink:href") {
    const value = data.attrValue.trim();
    if (!value.startsWith("#") && !/^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i.test(value)) {
      data.keepAttr = false;
    }
  }
});

export function sanitizeSvg(svg: string): string {
  return purify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["style", "foreignObject", "a", "use", "script"],
    FORBID_ATTR: ["style"],
    ADD_DATA_URI_TAGS: ["image"],
  });
}
