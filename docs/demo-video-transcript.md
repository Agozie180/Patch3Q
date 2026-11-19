# Patch3Q demo video transcript

Patch3Q is an anonymous, post-quantum bug-bounty escrow built for QoreChain Diana.

A researcher writes vulnerability details locally; no wallet or identity is required. The browser seals the report with ML-KEM-1024 for the program and independent auditor, pads the encrypted envelope, and anchors only hashes, deadlines, a reporter-key commitment, and a sealed payout commitment.

The generated receipt proves the envelope and content commitments without exposing plaintext. The auditor independently decrypts the bundle, checks its authenticated metadata, and opens the payout commitment only after receiving the secret salt.

Bounty release requires two independent ML-DSA-87 signatures. Normal cases use the program and auditor. If the vendor misses the SLA, anyone can escalate and the reporter replaces the vendor as co-signer.

The final approval verifies case, evidence, authority, key, registry, rationale, payout, and both hybrid signatures. ECDSA-only forgeries are rejected.

Diana testnet transactions and 112 independent on-chain checks reproduce the current and preserved deployments plus adversarial evidence. Patch3Q keeps the disclosure private while making accountability and payment publicly verifiable.

