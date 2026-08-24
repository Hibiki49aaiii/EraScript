import { keccak256, type AbiParameter, type Hex } from "viem";
import { EraDiagnosticError } from "../diagnostics.js";
import { encodeArguments } from "./abi.js";
import { bytes32, merkleRoot, type Bytes32, type MerkleProof, type MerkleRoot } from "./types.js";

export interface AbiMerkleScheme<Name extends string = string> {
  readonly kind: "abi-merkle-scheme";
  readonly name: Name;
  readonly parameters: readonly AbiParameter[];
  readonly pairOrdering: "sorted";
  readonly leafHash: "keccak256";
  readonly nodeHash: "keccak256";
  readonly doubleHashLeaf: boolean;
  readonly allowUnsafe64ByteLeafPreimage: boolean;
}

export interface MerkleVerification<Name extends string = string> {
  readonly scheme: AbiMerkleScheme<Name>;
  readonly leaf: Bytes32;
  readonly computedRoot: MerkleRoot;
  readonly expectedRoot: MerkleRoot;
  readonly proofLength: number;
  readonly valid: boolean;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

export function defineAbiMerkleScheme<Name extends string>(input: {
  name: Name;
  parameters: readonly AbiParameter[];
  doubleHashLeaf?: boolean;
  allowUnsafe64ByteLeafPreimage?: boolean;
}): AbiMerkleScheme<Name> {
  if (input.parameters.length === 0) fail("ES3910", "EmptyMerkleLeafSchema", "Merkle leaf ABI schema must contain at least one parameter.");
  return {
    kind: "abi-merkle-scheme",
    name: input.name,
    parameters: input.parameters,
    pairOrdering: "sorted",
    leafHash: "keccak256",
    nodeHash: "keccak256",
    doubleHashLeaf: input.doubleHashLeaf ?? true,
    allowUnsafe64ByteLeafPreimage: input.allowUnsafe64ByteLeafPreimage ?? false,
  };
}

function hexBytes(value: Hex): number {
  return (value.length - 2) / 2;
}

export function abiMerkleLeaf<Name extends string>(scheme: AbiMerkleScheme<Name>, values: readonly unknown[]): Bytes32 {
  let encoded: Hex;
  try { encoded = encodeArguments(scheme.parameters, values); }
  catch (error) {
    if (error instanceof EraDiagnosticError) throw error;
    return fail("ES3911", "MerkleLeafEncodingFailed", "Failed to ABI-encode Merkle leaf values.", { scheme: scheme.name, cause: String(error) });
  }

  if (!scheme.doubleHashLeaf && hexBytes(encoded) === 64 && !scheme.allowUnsafe64ByteLeafPreimage) {
    fail(
      "ES3912",
      "AmbiguousMerkleLeafPreimage",
      "A 64-byte raw leaf preimage can be confused with a concatenated pair of internal nodes in commutative Merkle trees.",
      {
        scheme: scheme.name,
        suggestion: "Use doubleHashLeaf (default) or explicitly acknowledge the scheme with allowUnsafe64ByteLeafPreimage only when matching an existing tree.",
      },
    );
  }

  const first = keccak256(encoded);
  return bytes32(scheme.doubleHashLeaf ? keccak256(first) : first);
}

function sortedPair(a: Bytes32, b: Bytes32): readonly [Bytes32, Bytes32] {
  return a.toLowerCase() <= b.toLowerCase() ? [a, b] : [b, a];
}

export function hashMerklePair(a: Bytes32, b: Bytes32): Bytes32 {
  const [left, right] = sortedPair(a, b);
  const packed = `0x${left.slice(2)}${right.slice(2)}` as Hex;
  return bytes32(keccak256(packed));
}

export function processMerkleProof(leaf: Bytes32, proofValues: readonly Bytes32[] | MerkleProof): MerkleRoot {
  let computed: Bytes32 = leaf;
  for (const sibling of proofValues) computed = hashMerklePair(computed, sibling);
  return merkleRoot(computed);
}

export function verifyAbiMerkleProof<Name extends string>(input: {
  scheme: AbiMerkleScheme<Name>;
  values: readonly unknown[];
  proof: readonly Bytes32[] | MerkleProof;
  root: MerkleRoot;
}): MerkleVerification<Name> {
  const leaf = abiMerkleLeaf(input.scheme, input.values);
  const computedRoot = processMerkleProof(leaf, input.proof);
  return {
    scheme: input.scheme,
    leaf,
    computedRoot,
    expectedRoot: input.root,
    proofLength: input.proof.length,
    valid: computedRoot.toLowerCase() === input.root.toLowerCase(),
  };
}

export function assertAbiMerkleProof<Name extends string>(input: {
  scheme: AbiMerkleScheme<Name>;
  values: readonly unknown[];
  proof: readonly Bytes32[] | MerkleProof;
  root: MerkleRoot;
}): MerkleVerification<Name> {
  const result = verifyAbiMerkleProof(input);
  if (!result.valid) fail("ES3913", "MerkleProofMismatch", "Merkle proof does not reconstruct the expected root under the declared scheme.", {
    scheme: input.scheme.name,
    expectedRoot: result.expectedRoot,
    computedRoot: result.computedRoot,
    proofLength: result.proofLength,
  });
  return result;
}
