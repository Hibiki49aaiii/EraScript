# What changes

Both external service signing and human-approved hardware signing use the same trusted authority. A wallet is explicitly attached to one backend. Failure never silently changes the wallet's custody method.

# Why and how

Generated EraScript remains normal Node code. It may request only a transaction already installed by a trusted operator. The authority owns policy, trusted simulation verification and persistent consumption, and calls the selected service/device only after those checks. The returned transaction is checked against the exact approved bytes and sender before being released.

# Important invariants

No client-controlled grant installation, provider credentials, USB driver or replay reset endpoint. No signing a different recipient, amount, fee or nonce under the same approval. Any reserved grant/nonce remains consumed after failure. Signature possession does not prove execution, finality or asset recovery.

# Failure modes and impact

An unavailable service, denied device confirmation, expired grant, repeated nonce or modified response fails closed. An ambiguous timeout requires operator investigation; do not automatically retry. These are new opt-in APIs. Existing Node execution and signing helpers retain their compatibility and limitations. Hardware bridge tests do not prove actual device UX, and separate processes under one OS identity do not prove custody isolation.
