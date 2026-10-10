import { describe, expect, it } from "vitest";
import {
  buffersReducer,
  isDirty,
  persistBuffers,
  restoreBuffers,
  type Buffers,
} from "../src/workspace/buffers";
import { buildTree, normaliseNewPath } from "../src/workspace/tree";

const load = (state: Buffers, path: string, text: string, etag: string) =>
  buffersReducer(state, { type: "loaded", path, text, etag });

describe("buffers", () => {
  it("tracks unsaved edits per file", () => {
    let s = load({}, "a.yml", "a: 1\n", "e1");
    s = load(s, "b.yml", "b: 1\n", "e2");
    s = buffersReducer(s, { type: "edited", path: "a.yml", text: "a: 2\n" });
    expect(isDirty(s["a.yml"])).toBe(true);
    expect(isDirty(s["b.yml"])).toBe(false);
    s = buffersReducer(s, { type: "saved", path: "a.yml", text: "a: 2\n", etag: "e3" });
    expect(isDirty(s["a.yml"])).toBe(false);
    expect(s["a.yml"].etag).toBe("e3");
  });

  it("reloads a clean buffer when the disk changes", () => {
    let s = load({}, "a.yml", "a: 1\n", "e1");
    s = load(s, "a.yml", "a: from disk\n", "e2");
    expect(s["a.yml"]).toEqual({
      path: "a.yml",
      text: "a: from disk\n",
      savedText: "a: from disk\n",
      etag: "e2",
    });
  });

  it("asks before replacing unsaved edits with a changed disk version", () => {
    let s = load({}, "a.yml", "a: 1\n", "e1");
    s = buffersReducer(s, { type: "edited", path: "a.yml", text: "a: mine\n" });
    s = load(s, "a.yml", "a: theirs\n", "e2");
    expect(s["a.yml"].text).toBe("a: mine\n");
    expect(s["a.yml"].conflict).toEqual({ diskText: "a: theirs\n", diskEtag: "e2" });

    const keepMine = buffersReducer(s, { type: "resolved", path: "a.yml", keep: "mine" });
    expect(keepMine["a.yml"]).toEqual({
      path: "a.yml",
      text: "a: mine\n",
      savedText: "a: theirs\n",
      etag: "e2",
    });
    expect(isDirty(keepMine["a.yml"])).toBe(true);

    const takeDisk = buffersReducer(s, { type: "resolved", path: "a.yml", keep: "disk" });
    expect(takeDisk["a.yml"]).toEqual({
      path: "a.yml",
      text: "a: theirs\n",
      savedText: "a: theirs\n",
      etag: "e2",
    });
  });

  it("ignores reloads of the version the edits are based on (e.g. our own save echoed back)", () => {
    let s = load({}, "a.yml", "a: 1\n", "e1");
    s = buffersReducer(s, { type: "edited", path: "a.yml", text: "a: mine\n" });
    s = load(s, "a.yml", "a: 1\n", "e1");
    expect(s["a.yml"].conflict).toBeUndefined();
    expect(s["a.yml"].text).toBe("a: mine\n");
  });

  it("treats a disk version equal to the edits as saved", () => {
    let s = load({}, "a.yml", "a: 1\n", "e1");
    s = buffersReducer(s, { type: "edited", path: "a.yml", text: "a: 2\n" });
    s = load(s, "a.yml", "a: 2\n", "e9");
    expect(isDirty(s["a.yml"])).toBe(false);
    expect(s["a.yml"].conflict).toBeUndefined();
  });

  it("drops clean buffers deleted on disk, keeps dirty ones", () => {
    let s = load(load({}, "a.yml", "a\n", "e1"), "b.yml", "b\n", "e2");
    s = buffersReducer(s, { type: "edited", path: "b.yml", text: "b mine\n" });
    s = buffersReducer(s, { type: "deletedOnDisk", path: "a.yml" });
    s = buffersReducer(s, { type: "deletedOnDisk", path: "b.yml" });
    expect(s["a.yml"]).toBeUndefined();
    expect(s["b.yml"]).toMatchObject({ text: "b mine\n", etag: "", deletedOnDisk: true });
    expect(isDirty(s["b.yml"])).toBe(true);
  });

  it("moves a buffer on rename, unsaved edits included", () => {
    let s = load({}, "a.yml", "a\n", "e1");
    s = buffersReducer(s, { type: "edited", path: "a.yml", text: "a2\n" });
    s = buffersReducer(s, { type: "renamed", from: "a.yml", to: "sub/b.yml" });
    expect(s["a.yml"]).toBeUndefined();
    expect(s["sub/b.yml"]).toMatchObject({ path: "sub/b.yml", text: "a2\n" });
  });
});

describe("persistence", () => {
  const memory = () => {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
  };

  it("keeps only unsaved buffers, per workspace", () => {
    const storage = memory();
    let s = load(load({}, "a.yml", "a\n", "e1"), "b.yml", "b\n", "e2");
    s = buffersReducer(s, { type: "edited", path: "b.yml", text: "b2\n" });
    persistBuffers(storage, "ws1", s, "b.yml");
    const restored = restoreBuffers(storage, "ws1");
    expect(Object.keys(restored.buffers)).toEqual(["b.yml"]);
    expect(restored.buffers["b.yml"]).toEqual({ path: "b.yml", text: "b2\n", savedText: "b\n", etag: "e2" });
    expect(restored.active).toBe("b.yml");
    expect(restoreBuffers(storage, "other").buffers).toEqual({});
  });

  it("survives unavailable or corrupt storage", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    };
    expect(() => persistBuffers(broken, "ws", {}, null)).not.toThrow();
    expect(restoreBuffers(broken, "ws")).toEqual({ buffers: {}, active: null });
    expect(restoreBuffers({ getItem: () => "{not json" }, "ws")).toEqual({ buffers: {}, active: null });
  });
});

describe("tree", () => {
  it("builds folders first, sorted", () => {
    expect(buildTree(["b.yml", "sub/z.yml", "a.yml", "sub/deeper/x.yml"])).toEqual([
      {
        name: "sub",
        path: "sub",
        children: [
          { name: "deeper", path: "sub/deeper", children: [{ name: "x.yml", path: "sub/deeper/x.yml" }] },
          { name: "z.yml", path: "sub/z.yml" },
        ],
      },
      { name: "a.yml", path: "a.yml" },
      { name: "b.yml", path: "b.yml" },
    ]);
  });

  it("normalises new file names", () => {
    expect(normaliseNewPath("sub/new")).toBe("sub/new.yml");
    expect(normaliseNewPath(" /a.YAML ")).toBe("a.YAML");
    expect(normaliseNewPath("x//y.yml")).toBe("x/y.yml");
    expect(normaliseNewPath("folder/")).toBeNull();
    expect(normaliseNewPath("  ")).toBeNull();
  });
});

describe("layout", () => {
  it("keeps panes within bounds", async () => {
    const { clampLayout } = await import("../src/workspace/layout");
    expect(clampLayout({ tree: 50, editor: 100 }, 1400)).toEqual({ tree: 140, editor: 260 });
    expect(clampLayout({ tree: 900, editor: 5000 }, 1400)).toEqual({ tree: 480, editor: 620 }); // preview keeps 300
    expect(clampLayout({ tree: 220, editor: 520 }, 600)).toEqual({ tree: 220, editor: 260 }); // narrow window
  });
});
