import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { signingError } from "./policy.js";

export interface SigningReplayStore {
  /** Atomically claim each key, persist before returning. Partial failures MUST remain consumed. */
  consume(keys: readonly string[]): Promise<void>;
}

/** Trusted-host local filesystem only. Never delete/reset claims to retry a signature. */
export async function openFileSigningReplayStore(directory: string): Promise<SigningReplayStore> {
  const root = resolve(directory);
  try {
    const info = await lstat(root);
    const canonical = await realpath(root);
    const samePath = process.platform === "win32" ? canonical.toLowerCase() === root.toLowerCase() : canonical === root;
    if (!info.isDirectory() || info.isSymbolicLink() || !samePath) throw signingError("Unavailable");
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
