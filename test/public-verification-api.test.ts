import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as rootApi from "../src/index.js";
import * as chainsApi from "../src/chains/index.js";

test("public barrels exclude arbitrary multichain terminal-state construction", () => {
  assert.equal("createMultichainVerificationReport" in rootApi, false);
  assert.equal("createMultichainVerificationReport" in chainsApi, false);

  assert.equal(typeof chainsApi.multichainEvidenceRef, "function");
  assert.equal(typeof chainsApi.multichainVerificationReportHash, "function");
  assert.equal(typeof chainsApi.parseMultichainVerificationReport, "function");
  assert.equal(typeof chainsApi.assertMultichainVerificationState, "function");
});

test("generated public declaration barrel does not re-export the internal constructor", () => {
  const declaration = readFileSync(
    fileURLToPath(new URL("../src/chains/index.d.ts", import.meta.url)),
    "utf8",
  );
  assert.doesNotMatch(declaration, /createMultichainVerificationReport/);
  assert.match(declaration, /parseMultichainVerificationReport/);
  assert.match(declaration, /MultichainVerificationReport/);
});
