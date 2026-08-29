import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));

test("era build -o writes a map bound to the actual output filename and original EraScript source", () => {
  const directory = mkdtempSync(join(tmpdir(), "erascript-build-map-"));
  try {
    const input = join(directory, "input.era");
    const output = join(directory, "nested", "custom.js");
    const source = [
      "fn value() -> number {",
      "  mut result = 42",
      "  return result",
      "}",
      "console.log(value())",
    ].join("\n");
    writeFileSync(input, source);

    const result = spawnSync(process.execPath, [cli, "build", input, "-o", output], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(existsSync(output), true);
    assert.equal(existsSync(`${output}.map`), true);

    const javascript = readFileSync(output, "utf8");
    assert.match(javascript, /\/\/# sourceMappingURL=custom\.js\.map\s*$/);

    const map = JSON.parse(readFileSync(`${output}.map`, "utf8")) as {
      version: number;
      file?: string;
      sources: string[];
      sourcesContent?: Array<string | null>;
    };
    assert.equal(map.version, 3);
    assert.equal(map.file, "custom.js");
    assert.deepEqual(map.sources, [input]);
    assert.deepEqual(map.sourcesContent, [source]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
