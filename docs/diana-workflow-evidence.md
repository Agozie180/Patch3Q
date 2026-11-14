# Diana workflow evidence

## What has been verified live

- The public Diana EVM RPC responded on chain ID `9800`.
- QoreChain's `pqcVerify` precompile accepted the exact ML-DSA-87 message domain used by Patch3Q approvals via
  `pnpm verify:precompile`.
- The QCAI probe reached Diana at block `10091116`; its documented AI precompile addresses returned empty data on
  that public endpoint. See `evidence/qcai-audit.json`.

## What remains blocked

The repository and process environment contain no `PATCH3Q_DEPLOYER_PRIVATE_KEY`, funded Diana account, registered
ML-DSA keys, or active scoped EVM authorization window. Therefore no honest deployment or lifecycle transaction
hashes can be produced from this machine. `evidence/testnet.json` deliberately retains nulls.

The required public transaction sequence is:

1. deploy or designate tUSDT;
2. deploy `Patch3QRegistry` bound to that token;
3. submit a sealed case from a reporter with a registered PQ key;
4. acknowledge, triage, and fund it from the program;
5. submit a second funded case, miss its deadline, and permissionlessly escalate it;
6. release normal escrow with program + auditor ML-DSA signatures;
7. release escalated escrow with reporter + auditor ML-DSA signatures;
8. optionally resolve and publish a redacted-report commitment.

Never add a hash to the evidence manifest until the receipt and emitted events have been independently read back
from Diana.
