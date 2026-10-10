// Typed client for the LoomViz back-end (SPEC §11). Every call carries the launch token.

export interface WireEnd {
  connector: string;
  pin: number | string;
  label: string | null;
}

/** One wire as WireViz resolved it, keyed "<cable>-<wire>" in RenderResult.wires. */
export interface WireInfo {
  cable: string;
  wire: number | string;
  color: string | null;
  gauge: string | null;
  length: string | null;
  from: WireEnd | null;
  to: WireEnd | null;
}

export type RenderResult =
  | { svg: string; html?: string; wires?: Record<string, WireInfo>; warnings: string[] }
  | { error: string; line: number | null; kind: string };

export interface FileList {
  loom_folder: string;
  loom_folder_exists: boolean;
  files: string[];
}

export interface Session {
  state: "none" | "open";
  workspace?: string; // folder name
  loom_folder_exists?: boolean;
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const filePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

export function createClient(token: string, fetchFn: typeof fetch = fetch.bind(globalThis)) {
  async function call(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    const response = await fetchFn(url, { ...init, headers });
    if (!response.ok) {
      let message = response.statusText;
      try {
        message = (await response.json()).detail ?? message;
      } catch {
        // not JSON
      }
      throw new ApiError(response.status, message);
    }
    return response;
  }

  return {
    async session(): Promise<Session> {
      return (await call("/api/session")).json();
    },
    /** Create the loom/ folder in the workspace (SPEC FR-33). */
    async createLoomFolder(): Promise<void> {
      await call("/api/loom", { method: "POST" });
    },
    async listFiles(): Promise<FileList> {
      return (await call("/api/files")).json();
    },
    async readFile(path: string): Promise<{ text: string; etag: string }> {
      const response = await call(`/api/files/${filePath(path)}`);
      return { text: await response.text(), etag: response.headers.get("ETag") ?? "" };
    },
    /** Saves `text`. Pass the ETag the editor loaded, or null to create a new file. Returns the new ETag. */
    async writeFile(path: string, text: string, etag: string | null): Promise<string> {
      const headers: Record<string, string> = { "Content-Type": "text/yaml; charset=utf-8" };
      if (etag) headers["If-Match"] = etag;
      else headers["If-None-Match"] = "*";
      const response = await call(`/api/files/${filePath(path)}`, { method: "PUT", headers, body: text });
      return response.headers.get("ETag") ?? "";
    },
    /** `html: true` also returns WireViz's HTML document (diagram, BOM, drawing template). */
    async render(
      yaml: string,
      path: string | null,
      signal?: AbortSignal,
      html = false,
    ): Promise<RenderResult> {
      const response = await call("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yaml, path, html }),
        signal,
      });
      return response.json();
    },
  };
}

export type Client = ReturnType<typeof createClient>;
