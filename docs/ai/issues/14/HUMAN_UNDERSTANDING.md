# Issue #14 Human Understanding

The Core CI dependency graph is already reproducible because Issue #11 introduced a root `package-lock.json` and changed Core CI to `npm ci`.

The remaining non-reproducible surface is Live Network Integration:

- root dependencies are still installed with `npm install`,
- the RAILGUN/Waku smoke installs `@railgun-community/waku-broadcaster-client-node@9.1.1` with `--no-save`, leaving transitive versions floating.

The correct fix is not to add Waku to EraScript's root package. It is live-only test infrastructure and should remain isolated.

## Target state

```text
root package-lock.json
  -> Core CI
  -> live public-readonly
  -> live railgun-waku root build deps

test/live/waku-deps/package-lock.json
  -> railgun-waku live-only runtime package
```

The Waku smoke will resolve the live package from that isolated dependency root.

Separately, the production dependency invariant proven in Issue #11 — no High/Critical published/runtime npm audit findings — becomes a continuous CI gate.

Known root dev/test advisories and isolated Waku advisories are evidence streams, not blindly blocking gates. Their presence must remain visible without conflating them with the published EraScript production dependency graph.
