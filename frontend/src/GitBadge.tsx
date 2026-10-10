import type { GitStatus } from "./api/client";

// Header summary of the read-only git status (SPEC FR-34): branch and uncommitted harness files.
export function GitBadge({ status }: { status: GitStatus | null }) {
  if (!status) return null;
  if (!status.repository) return <span className="git muted">not a git repository</span>;
  const branch = status.detached ? "detached HEAD" : (status.branch ?? "?");
  const count = status.changed.length;
  const title = count
    ? status.changed.map((c) => `${c.status}: ${c.path}`).join("\n")
    : "No uncommitted changes in loom/";
  return (
    <span className="git" title={title}>
      <span aria-hidden>⎇</span> {branch}
      <span className={count ? "changed" : "muted"}>
        {" · "}
        {count ? `${count} file${count === 1 ? "" : "s"} changed in loom/` : "no changes in loom/"}
      </span>
    </span>
  );
}
