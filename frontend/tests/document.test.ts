import { describe, expect, it } from "vitest";
import { DOCUMENT_CSP, withDocumentCsp } from "../src/preview/document";

describe("withDocumentCsp", () => {
  it("puts the policy first in <head>, before anything that could load", () => {
    const out = withDocumentCsp(
      '<html><head lang="en"><link rel="stylesheet" href="https://x"></head></html>',
    );
    expect(out.indexOf("Content-Security-Policy")).toBeLessThan(out.indexOf("<link"));
    expect(out).toContain(DOCUMENT_CSP);
  });

  it("wraps documents without a <head>", () => {
    const out = withDocumentCsp("<p>hi</p>");
    expect(out).toMatch(/^<!doctype html><html><head><meta http-equiv="Content-Security-Policy"/);
    expect(out).toContain("<body><p>hi</p></body>");
  });

  it("blocks all external loads", () => {
    expect(DOCUMENT_CSP).toContain("default-src 'none'");
    expect(DOCUMENT_CSP).not.toMatch(/https?:|\*/);
  });
});
