import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { signingError } from "./policy.js";

export interface SigningReplayStore {
  /** Atomically claim each key, persist before returning. Partial failures MUST remain consumed. */
  consume(keys: readonly string[]): Promise<void>;
}

/** Trusted-host local filesystem only. Never delete/reset claims to retry a signature. */
export async function openFileSigningReplayStore(directory: string): Promise<SigningReplayStore> {
  let root = resolve(directory);
  try {
    // Text equality with realpath rejects valid Windows 8.3 aliases (for example
    // RUNNER~1). Inspect every path component for links, then pin its canonical path.
    for (let current = root; ; current = dirname(current)) {
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) throw signingError("Unavailable");
      if (dirname(current) === current) break;
    }
    root = await realpath(root);
  } catch { throw signingError("Unavailable"); }
  return Object.freeze({
    async consume(keys: readonly string[]): Promise<void> {
      for (const key of keys) {
        const filename = createHash("sha256").update(key).digest("hex");
        let handle;
        try {
          handle = await open(join(root, `${filename}.claim`), "wx", 0o600);
          await handle.writeFile("consumed\n", "utf8");
          await handle.sync();
          // POSIX directory metadata can be flushed; Windows requires separate
          // host/filesystem qualification for power-loss durability.
          if (process.platform !== "win32") {
            const parent = await open(root, "r");
            try { await parent.sync(); } finally { await parent.close(); }
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") throw signingError("Consumed");
          throw signingError("Unavailable");
        } finally { await handle?.close(); }
      }
    },
  });
}
