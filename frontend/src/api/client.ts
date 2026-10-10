// Typed client for the LoomViz back-end (SPEC §11). Every call carries the launch token.

import { connectEvents, type ServerEvent } from "./events";

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

/** Read-only git status of the workspace, limited to files under loom/ (SPEC FR-34). */
export type GitStatus =
  | { repository: false }
  | {
      repository: true;
      branch: string | null;
      detached: boolean;
      changed: { path: string; status: string }[];
    };

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
    /** Live file and git events (SPEC FR-9). Returns a function that disconnects. */
    connectEvents(onEvent: (event: ServerEvent) => void, onConnected?: (connected: boolean) => void) {
      return connectEvents(token, onEvent, onConnected);
    },
    async session(): Promise<Session> {
      return (await call("/api/session")).json();
    },
    /** Create the loom/ folder in the workspace (SPEC FR-33). */
    async createLoomFolder(): Promise<void> {
      await call("/api/loom", { method: "POST" });
    },
    async gitStatus(): Promise<GitStatus> {
      return (await call("/api/git/status")).json();
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
    /** The document as a PDF (FR-38). Throws ApiError with the render error on failure. */
    async documentPdf(
      yaml: string,
      path: string | null,
      bomSheet: boolean,
    ): Promise<{ blob: Blob; filename: string }> {
      const response = await call("/api/document.pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yaml, path, bom_sheet: bomSheet }),
      });
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "harness.pdf";
      return { blob: await response.blob(), filename };
    },
    async renameFile(path: string, to: string): Promise<void> {
      await call(`/api/files/${filePath(path)}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to }),
      });
    },
    async deleteFile(path: string): Promise<void> {
      await call(`/api/files/${filePath(path)}`, { method: "DELETE" });
    },
    async render(
      yaml: string,
      path: string | null,
      signal?: AbortSignal,
      html = false,
      bomSheet = false,
    ): Promise<RenderResult> {
      const response = await call("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yaml, path, html, bom_sheet: bomSheet }),
        signal,
      });
      return response.json();
    },
  };
}

export type Client = ReturnType<typeof createClient>;
