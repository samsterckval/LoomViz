import { describe, expect, it } from "vitest";
import { planReload } from "../src/api/events";

const open = new Set(["a.yml", "sub/b.yml"]);

describe("planReload", () => {
  it("re-reads open files that changed and refreshes git", () => {
    expect(
      planReload(
        { type: "files", added: [], changed: ["a.yml", "closed.yml"], deleted: [], other: false },
        open,
        "a.yml",
      ),
    ).toEqual({ reload: ["a.yml"], deleted: [], refreshTree: false, rerender: false, refreshGit: true });
  });

  it("treats re-created open files as changed, and refreshes the tree on additions and deletions", () => {
    expect(
      planReload(
        { type: "files", added: ["sub/b.yml", "new.yml"], changed: [], deleted: ["a.yml"], other: false },
        open,
        null,
      ),
    ).toEqual({
      reload: ["sub/b.yml"],
      deleted: ["a.yml"],
      refreshTree: true,
      rerender: false,
      refreshGit: true,
    });
  });

  it("re-renders when an image or template changed", () => {
    const plan = planReload(
      { type: "files", added: [], changed: [], deleted: [], other: true },
      open,
      "a.yml",
    );
    expect(plan.rerender).toBe(true);
    expect(
      planReload({ type: "files", added: [], changed: [], deleted: [], other: true }, open, null).rerender,
    ).toBe(false);
  });

  it("only refreshes git on git events", () => {
    expect(planReload({ type: "git" }, open, "a.yml")).toEqual({
      reload: [],
      deleted: [],
      refreshTree: false,
      rerender: false,
      refreshGit: true,
    });
  });
});
