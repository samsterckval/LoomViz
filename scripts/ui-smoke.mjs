#!/usr/bin/env node
// UI smoke test: drives headless Chrome over the DevTools protocol (no dependencies) against a
// running LoomViz started on examples/ (scripts/dev.sh examples).
//
//   node scripts/ui-smoke.mjs "http://127.0.0.1:8000/?token=…"
//
// Checks: the editor and diagram load without requests to other hosts; clicking a wire selects
// it and fills the info panel; the cursor on a connection-set entry highlights the diagram; the
// Document view shows WireViz's page in a sandboxed frame. Exits non-zero on the first failure.
// Chrome: $CHROME, else the usual macOS/Linux locations.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2];
if (!url || !url.includes("token=")) {
  console.error('usage: node scripts/ui-smoke.mjs "http://127.0.0.1:8000/?token=…"');
  process.exit(2);
}
const chromePath =
  process.env.CHROME ??
  [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].find(existsSync);
if (!chromePath) {
  console.error("Chrome not found; set $CHROME");
  process.exit(2);
}

const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), "loomviz-smoke-"));
const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--window-size=1500,950",
  "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed = true;
};

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
    } catch {
      // not up yet
    }
  }
  if (!target) throw new Error("Chrome didn't start");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const pending = new Map();
  const requests = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    } else if (m.method === "Network.requestWillBeSent") {
      requests.push(m.params.request.url);
    } else if (m.method === "Page.javascriptDialogOpening") {
      void send("Page.handleJavaScriptDialog", { accept: true });
    }
  });
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const evaluate = async (expression) => {
    const r = (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result;
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "evaluation failed");
    return r.result.value;
  };
  const waitFor = async (expression, timeout = 10000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await evaluate(expression)) return true;
      await sleep(200);
    }
    return false;
  };

  await send("Page.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url });

  check("editor loads (Monaco)", await waitFor(`!!document.querySelector(".monaco-editor .view-line")`));
  check("diagram renders", await waitFor(`!!document.querySelector(".diagram svg #wire-W1-3-a")`));
  check("diagram has no scripts", (await evaluate(`document.querySelectorAll(".diagram script").length`)) === 0);
  const appHost = new URL(url).host;
  const foreign = [...new Set(requests.map((u) => new URL(u).host).filter((h) => h && h !== appHost))];
  check("no requests to other hosts", foreign.length === 0, foreign.join(", "));

  await evaluate(`document.querySelector("#wire-W1-3-a path").dispatchEvent(new MouseEvent("click", { bubbles: true }))`);
  const panelOk = await waitFor(`document.querySelector(".selection")?.innerText.includes("X1:3 (SCL)")`, 3000);
  check("clicking a wire selects it", panelOk, await evaluate(`document.querySelector(".selection strong")?.innerText ?? "no panel"`));
  check("both halves of the wire highlighted", (await evaluate(`document.querySelectorAll(".diagram .selected").length`)) === 2);
  check("editor highlights its lines", await waitFor(`document.querySelectorAll(".selected-line").length > 0`, 2000));

  await evaluate(`[...document.querySelectorAll('[role="tab"]')].find((t) => t.innerText === "Document").click()`);
  const docOk = await waitFor(`document.querySelector("iframe")?.srcdoc.includes('<table class="bom">')`, 8000);
  check("document view shows WireViz's page", docOk);
  check("document frame is sandboxed", (await evaluate(`document.querySelector("iframe")?.getAttribute("sandbox")`)) === "");
  ws.close();
} catch (err) {
  check("smoke test ran", false, String(err));
} finally {
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
