import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderResult } from "../src/api/client";
import { createRenderScheduler, type PreviewState } from "../src/preview/renderScheduler";

interface Pending {
  yaml: string;
  signal: AbortSignal;
  resolve: (r: RenderResult) => void;
}

function setup() {
  const calls: Pending[] = [];
  const states: PreviewState[] = [];
  const render = (yaml: string, _path: string | null, signal: AbortSignal) =>
    new Promise<RenderResult>((resolve) => calls.push({ yaml, signal, resolve }));
  const scheduler = createRenderScheduler({ render, onUpdate: (s) => states.push(s), delayMs: 400 });
  const latest = () => states[states.length - 1];
  return { calls, scheduler, latest };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe("render scheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces: rapid edits send a single request with the last text", async () => {
    const { calls, scheduler } = setup();
    for (const text of ["a", "ab", "abc"]) {
      scheduler.schedule(text, null);
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(400);
    expect(calls.map((c) => c.yaml)).toEqual(["abc"]);
  });

  it("aborts the previous request and ignores its late response", async () => {
    const { calls, scheduler, latest } = setup();
    scheduler.schedule("old", null);
    await vi.advanceTimersByTimeAsync(400);
    scheduler.schedule("new", null);
    await vi.advanceTimersByTimeAsync(400);
    expect(calls).toHaveLength(2);
    expect(calls[0].signal.aborted).toBe(true);

    calls[1].resolve({ svg: "<svg>new</svg>", warnings: [] });
    await flush();
    calls[0].resolve({ svg: "<svg>old</svg>", warnings: [] }); // slow old response arrives last
    await flush();
    expect(latest().svg).toBe("<svg>new</svg>");
  });

  it("keeps the last good diagram when a render fails", async () => {
    const { calls, scheduler, latest } = setup();
    void scheduler.now("good", null);
    calls[0].resolve({ svg: "<svg>good</svg>", warnings: [] });
    await flush();

    void scheduler.now("bad", null);
    calls[1].resolve({ error: "YAML syntax error", line: 4, kind: "syntax" });
    await flush();
    expect(latest()).toMatchObject({
      svg: "<svg>good</svg>",
      error: { message: "YAML syntax error", line: 4 },
      rendering: false,
    });

    void scheduler.now("fixed", null);
    calls[2].resolve({ svg: "<svg>fixed</svg>", warnings: ["w"] });
    await flush();
    expect(latest()).toMatchObject({ svg: "<svg>fixed</svg>", error: null, warnings: ["w"] });
  });

  it("reports network failures without dropping the diagram", async () => {
    const states: PreviewState[] = [];
    let fail = false;
    const scheduler = createRenderScheduler({
      render: async () => {
        if (fail) throw new TypeError("Failed to fetch");
        return { svg: "<svg/>", warnings: [] };
      },
      onUpdate: (s) => states.push(s),
    });
    await scheduler.now("a", null);
    fail = true;
    await scheduler.now("b", null);
    expect(states[states.length - 1].svg).toBe("<svg/>");
    expect(states[states.length - 1].error?.message).toContain("Failed to fetch");
  });

  it("asks for the HTML document only when wanted", async () => {
    const flags: boolean[] = [];
    const scheduler = createRenderScheduler({
      render: async (_y, _p, _s, html) => {
        flags.push(html);
        return { svg: "<svg/>", html: html ? "<html></html>" : undefined, warnings: [] };
      },
      onUpdate: () => {},
    });
    await scheduler.now("a", null);
    scheduler.setWantHtml(true);
    await scheduler.now("a", null);
    expect(flags).toEqual([false, true]);
  });

  it("reset forgets the diagram and ignores in-flight results", async () => {
    const { calls, scheduler, latest } = setup();
    void scheduler.now("a", null);
    scheduler.reset();
    calls[0].resolve({ svg: "<svg>a</svg>", warnings: [] });
    await flush();
    expect(latest().svg).toBe(null);
  });
});
