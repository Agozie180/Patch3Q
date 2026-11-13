import { randomBytes } from "node:crypto";

import { pqcVerify, qorechainTestnet } from "@qorechain/evm";
import {
  addressFromPublicKey,
  classicalKeyFromPrivate,
  fromBase64,
  messagePqSignBytes,
  pqKeyFromSeed,
  signMessage,
} from "@qorechain/qoresign";
import {
  createPublicClient,
  encodeAbiParameters,
  hexToBytes,
  http,
  keccak256,
  toBytes,
  toHex,
} from "viem";

const client = createPublicClient({
  chain: qorechainTestnet,
  transport: http(qorechainTestnet.rpcUrls.default.http[0]),
});
const approvalTypehash = keccak256(toBytes(
  "Patch3QSeverityApproval(uint256 chainId,address registry,bytes32 caseIdHash,bytes32 envelopeHash,bytes32 contentCommitment,uint8 severity,uint256 payoutAmount,bytes32 rationaleHash)",
));
const approvalDigest = keccak256(encodeAbiParameters(
  [
    { type: "bytes32" },
    { type: "uint256" },
    { type: "address" },
    { type: "bytes32" },
    { type: "bytes32" },
    { type: "bytes32" },
    { type: "uint8" },
    { type: "uint256" },
    { type: "bytes32" },
  ],
  [
    approvalTypehash,
    9800n,
    "0x1111111111111111111111111111111111111111",
    keccak256(toBytes("P3Q-live-precompile-check")),
    keccak256(toBytes("encrypted-envelope")),
    keccak256(toBytes("salted-confidential-report")),
    5,
    2_500_000_000n,
    keccak256(toBytes("critical impact and direct loss")),
  ],
));

function freshClassicalKey() {
  for (;;) {
    try {
      return classicalKeyFromPrivate(new Uint8Array(randomBytes(32)), "eth_secp256k1");
    } catch {
      // Retry the negligible invalid-scalar case.
    }
  }
}

const pqKey = pqKeyFromSeed(new Uint8Array(randomBytes(32)));
const classicalKey = freshClassicalKey();
const signer = addressFromPublicKey(classicalKey.publicKey, classicalKey.type);
const approval = signMessage({
  chainId: "qorechain-diana",
  signer: signer.bech32,
  data: hexToBytes(approvalDigest),
  classicalKey,
  pqKey,
});
if (!approval.pq) throw new Error("QoreSign did not produce an ML-DSA-87 approval signature.");

const message = messagePqSignBytes("qorechain-diana", hexToBytes(approvalDigest));
const signature = fromBase64(approval.pq.signature);
const valid = await pqcVerify(client, {
  pubkey: toHex(pqKey.publicKey),
  signature: toHex(signature),
  message: toHex(message),
});

if (!valid) {
  throw new Error("QoreChain Diana rejected a valid ML-DSA-87 signature.");
}

process.stdout.write("QoreChain Diana verified the exact QoreSign domain used by Patch3Q approvals.\n");
