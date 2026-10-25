import assert from "node:assert/strict";
import test from "node:test";
import { assertReleaseApproval } from "../check-release.mjs";

test("publish gate rejects absent approval, blockers, dirty state and approval for a different commit", () => {
  const commit = "a".repeat(40);
  const approved = { version: "test", publicationApproved: true, approvedCommit: commit, blockers: [] };
  assert.doesNotThrow(() => assertReleaseApproval(approved, "test", commit, false));
  for (const status of [null, {}, { ...approved, publicationApproved: false }, { ...approved, blockers: [{ issue: 27 }] }, { ...approved, approvedCommit: "b".repeat(40) }, { ...approved, version: "other" }]) {
    assert.throws(() => assertReleaseApproval(status, "test", commit, false), /Publication blocked/);
  }
  assert.throws(() => assertReleaseApproval(approved, "test", commit, true));
  assert.doesNotThrow(() => assertReleaseApproval(approved, "test", commit, false, ["release-status.json"]));
  assert.throws(() => assertReleaseApproval(approved, "test", commit, false, ["src/cli.ts"]));
});
