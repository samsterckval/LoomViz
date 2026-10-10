import { describe, expect, it, vi } from "vitest";
import { takeLaunchToken } from "../src/api/token";

function fakeStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe("takeLaunchToken", () => {
  it("takes the token from the URL, stores it and cleans the address bar", () => {
    const storage = fakeStorage();
    const history = { replaceState: vi.fn() };
    const token = takeLaunchToken({ search: "?token=abc&x=1", pathname: "/", hash: "#h" }, history, storage);
    expect(token).toBe("abc");
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/?x=1#h");
    expect(storage.getItem("loomviz.launchToken")).toBe("abc");
  });

  it("reuses the stored token after a reload", () => {
    const storage = fakeStorage();
    takeLaunchToken({ search: "?token=abc", pathname: "/", hash: "" }, { replaceState: vi.fn() }, storage);
    const history = { replaceState: vi.fn() };
    expect(takeLaunchToken({ search: "", pathname: "/", hash: "" }, history, storage)).toBe("abc");
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  it("returns null without a token anywhere", () => {
    expect(
      takeLaunchToken({ search: "", pathname: "/", hash: "" }, { replaceState: vi.fn() }, fakeStorage()),
    ).toBe(null);
  });

  it("still works when storage throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const history = { replaceState: vi.fn() };
    expect(takeLaunchToken({ search: "?token=abc", pathname: "/", hash: "" }, history, broken)).toBe("abc");
    expect(takeLaunchToken({ search: "", pathname: "/", hash: "" }, history, broken)).toBe(null);
  });
});
