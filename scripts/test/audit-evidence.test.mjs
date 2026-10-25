import assert from "node:assert/strict";
import test from "node:test";
import { validateAudit } from "../audit-evidence.mjs";

test("missing or failed audit evidence cannot look like zero advisories", () => {
  for (const bad of [{}, { error: { code: "ENETUNREACH" } }, { metadata: { vulnerabilities: {} } }]) assert.throws(() => validateAudit(bad));
  const valid = { vulnerabilities: {}, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } } };
  assert.equal(validateAudit(valid).total, 0);
  assert.throws(() => validateAudit({ ...valid, metadata: { vulnerabilities: { ...valid.metadata.vulnerabilities, high: 1 } } }));
});
