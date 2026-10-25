import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function validateAudit(value) {
  const counts = value?.metadata?.vulnerabilities;
  if (value?.error || !counts || !value.vulnerabilities || typeof value.vulnerabilities !== "object") throw new Error("Audit returned no complete vulnerability evidence");
  for (const name of ["info", "low", "moderate", "high", "critical", "total"]) {
    if (!Number.isSafeInteger(counts[name]) || counts[name] < 0) throw new Error(`Invalid audit count: ${name}`);
  }
  if (["info", "low", "moderate", "high", "critical"].reduce((n, key) => n + counts[key], 0) !== counts.total) throw new Error("Inconsistent audit counts");
  return counts;
}

export function captureAudit({ npmCli, cwd, omitDev = false }) {
  if (!npmCli) throw new Error("npm entry point is required");
  const result = spawnSync(process.execPath, [npmCli, "audit", "--json", ...(omitDev ? ["--omit=dev"] : [])], { cwd, encoding: "utf8", timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
  if (result.error || ![0, 1].includes(result.status)) throw new Error("npm audit failed to produce usable evidence");
  const evidence = JSON.parse(result.stdout);
  validateAudit(evidence);
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , file, cwd = process.cwd()] = process.argv;
  if (!file) throw new Error("Usage: npm run audit:evidence -- output.json [audit-directory]");
  const evidence = captureAudit({ npmCli: process.env.npm_execpath, cwd });
  writeFileSync(file, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(validateAudit(evidence)));
}
