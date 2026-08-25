// EraScript intentionally adapts ecosystem clients structurally. The core interfaces
// retain only the stable metadata we inspect directly, while provider/SDK actions are
// discovered and validated at the call site. These augmentations make that open method
// surface explicit so object literals from viem/Bundler/Paymaster clients type-check
// without pretending EraScript owns their full versioned SDK interfaces.

import type {} from "./erc4337.js";
import type {} from "./erc4337-paymaster.js";
import type {} from "./rpc.js";

declare module "./erc4337.js" {
  interface BundlerClientLike {
    readonly [action: string]: unknown;
  }
}

declare module "./erc4337-paymaster.js" {
  interface PaymasterClientLike {
    readonly [action: string]: unknown;
  }
}

declare module "./rpc.js" {
  interface ViemClientLike {
    readonly [action: string]: unknown;
  }
}
