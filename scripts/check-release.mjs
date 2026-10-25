import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function assertReleaseApproval(status, version, commit, dirty, changedFiles = []) {
  if (status?.publicationApproved !== true || status.version !== version
    || !Array.isArray(status.blockers) || status.blockers.length !== 0
    || !/^[0-9a-f]{40}$/.test(status.approvedCommit ?? "") || status.approvedCommit !== commit || dirty
    || changedFiles.some((file) => file !== "release-status.json")) {
    throw new Error("Publication blocked: this commit has no complete release approval. See release-status.json and docs/RELEASE.md. Use npm run release:prepare for a local candidate.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cwd = dirname(dirname(fileURLToPath(import.meta.url)));
  const git = (args) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (result.status !== 0) throw new Error("Release approval requires a readable Git checkout");
    return result.stdout.trim();
  };
  try {
    const status = JSON.parse(readFileSync(join(cwd, "release-status.json"), "utf8"));
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    // Approval is a following metadata-only commit, avoiding a self-referential SHA.
    if (!/^[0-9a-f]{40}$/.test(status.approvedCommit ?? "")) assertReleaseApproval(status, pkg.version, "", false);
    git(["merge-base", "--is-ancestor", status.approvedCommit, "HEAD"]);
    const changed = git(["diff", "--name-only", status.approvedCommit, "HEAD"]).split(/\r?\n/).filter(Boolean);
    assertReleaseApproval(status, pkg.version, status.approvedCommit, git(["status", "--porcelain"]) !== "", changed);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
