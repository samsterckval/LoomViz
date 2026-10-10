// The launch token arrives once in the URL printed by the back-end (`/?token=…`). Move it
// into sessionStorage (survives reloads, gone with the tab) and remove it from the address bar
// so it doesn't end up in history, bookmarks or screenshots.

const STORAGE_KEY = "loomviz.launchToken";

export function takeLaunchToken(
  location: Pick<Location, "search" | "pathname" | "hash"> = window.location,
  history: Pick<History, "replaceState"> = window.history,
  storage: Pick<Storage, "getItem" | "setItem"> = window.sessionStorage,
): string | null {
  const params = new URLSearchParams(location.search);
  const fromUrl = params.get("token");
  if (fromUrl) {
    try {
      storage.setItem(STORAGE_KEY, fromUrl);
    } catch {
      // Storage can be unavailable (private mode); the token still works for this page load.
    }
    params.delete("token");
    const query = params.toString();
    history.replaceState(null, "", location.pathname + (query ? `?${query}` : "") + location.hash);
    return fromUrl;
  }
  try {
    return storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
