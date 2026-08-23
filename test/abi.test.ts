import assert from "node:assert/strict";
import test from "node:test";
import { parseAbi, type AbiParameter } from "viem";
import {
  decodeArgumentsFromCalldata,
  decodeCall,
  encodeArguments,
  encodeCall,
  selectorOf,
  stripSelector,
} from "../src/web3/abi.js";

const transferAbi = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
]);

test("encodeCall and decodeCall round-trip standard EVM calldata", () => {
  const to = "0x000000000000000000000000000000000000dead";
  const data = encodeCall(transferAbi, "transfer", [to, 123n]);
  assert.equal(selectorOf(data).length, 10);
  assert.equal(stripSelector(data).startsWith("0x"), true);

  const decoded = decodeCall(transferAbi, data);
  assert.equal(decoded.functionName, "transfer");
  assert.equal(decoded.args.length, 2);
  assert.equal(decoded.args[1], 123n);
});

test("decodeArgumentsFromCalldata strips the 4-byte selector before ABI decoding", () => {
  const bytes = `0x${"ab".repeat(32)}`;
  const parameters: readonly AbiParameter[] = [
    { name: "proof", type: "bytes32[]" },
  ];
  const encoded = encodeArguments(parameters, [[bytes, bytes]]);
  const fullCalldata = `0x12345678${encoded.slice(2)}`;

  const decoded = decodeArgumentsFromCalldata(parameters, fullCalldata);
  assert.equal(Array.isArray(decoded[0]), true);
  assert.deepEqual(decoded[0], [bytes, bytes]);
});
