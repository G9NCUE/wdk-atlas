# Notes on the atlas — branch `relations`

Working notes from reading the atlas as an architecture rather than a catalogue,
2026-08-31. Everything below is checked against package sources, the RN starter,
or the npm registry; where it is not, it says so.

## 1. How to read WDK

Follow a tap on **Send**, top to bottom:

```
Your app        starter or your own screens
Phone plumbing  host binding (RN / Kotlin / Swift) + app-side services
The engine      pear-wrk-wdk, a Bare worklet: a sealed room on the phone
   The assembler   wdk — creates each wallet, builds every protocol with that wallet's account
   Protocols       swap & bridge, earn & borrow, buy & sell, shared approval — each holds a wallet
   Wallets         one per chain; variants (gasless, smart account, L2) hang under their base
   Other modules   the P2P address book — loaded like a protocol, not about money
   Under the hood  failover, seed encryption, local signer
   Foundation      wdk-wallet — the blank forms every wallet and protocol fills in
```

Three facts the lane order used to hide:

- `wdk` is the **assembler**, not a layer traffic crosses. `wdk.js:335`: `new Protocol(account, config)`
  — it builds each protocol *with* the account and hangs it on the account. After that the protocol
  talks to the wallet directly.
- `wdk-wallet` is a **foundation**, not a kernel. Every method in `wallet-account.js` throws
  `NotImplementedError`; chain modules fill the form in. The `I…Protocol` files are the same
  forms for lending, fiat, swidge, multisig, SDA. A protocol's first constructor argument is a
  wallet account: protocols sit *on* wallets.
- The **worklet is the engine's room**, not plumbing. The bundle config of the RN starter packs
  wallet packages only; everything else runs in the app.

## 2. What changed

One commit on top of `31e88fc`. In the order the decisions were made:

| Change | Why |
|---|---|
| Highlight from `relations`; *Requires / Required by* in the details | `app.js` never read the 30 relations in the YAML; the only highlight was a chain-badge guess. The guess stays as a fainter dashed state |
| Same-lane `requires` drawn as a column under the base | An SVG line layer was tried first and made the poster unreadable; `btc > spark, rgb, arkade` and `evm > 4337, 7702` read better as stacks |
| Sections in call-path order; plain `title:` on all 62 modules; `?page=dev` for developer tools | Package ids are unreadable for a non-developer; dev tools answer a different question |
| Details in a fixed left drawer; sections are `<details>` with remembered state | The tooltip covered neighbouring boxes |
| `pear-wrk-wdk` is the engine box itself (`module:` on the section, shown as a chip on the title line); `worklet-bundler` on the dev page | One is the room, the other runs on the developer's laptop |
| Pricing, indexer, asset registry, cloud backup out of the engine into *Services*; secret manager, failover, local signer, address book kept engine-side in *Other modules* / *Under the hood* | See §3 |

Renderer changes are small: `renderColumns`, `relationsOf`, the drawer, `page`, `title`,
`lane.blurb`, `section.module`. No build step; `python3 -m http.server 4173` from the repo.

## 3. Where each "helper" really runs

Method: who imports it (starter source, Moor's `node_modules`, org code search), what its own
dependencies are, and whether it is in the worklet bundle.

| Package | Side | Evidence |
|---|---|---|
| pricing-provider, coingecko, bitfinex | app | starter `src/wdk/pricing.ts` builds the client inside a React hook |
| indexer-http | app | starter `src/wdk/indexer.ts`, called from `useWalletData.ts` |
| asset-registry | anywhere | Pure in-memory: two classes over a `Map`, zod + fast-equals, no I/O. Runs wherever it is imported. Only consumer in the org is `wdk-cli` (Node); the RN starter declares its own asset list. Moved to *Foundation* 2026-09-02 on the package's stated intent ("the type system and interfaces for standardized asset identification across all WDK modules"), not on usage |
| backup-cloud | app | starter `CloudBackupContext.tsx` |
| secret-manager | **engine** | the seed is generated and encrypted inside the worklet (`pear-wrk-wdk/src/handlers/secrets.js`), called over RPC by rn-core; the app only ever receives the encrypted form. This package is the standalone version of that code; nothing in the shipped flow imports it yet |
| failover-provider | engine (and app) | imported by `wdk-wallet-evm` and `-7702-gasless` (worklet), and by `wdk-pricing-provider` (app). Zero deps |
| signer-local | engine | Bare native addon (C + Kotlin, `bare-make`); Keychain/KeyStore + biometrics. **Nothing in the org imports it**; it is the consumer of the "Abstract signers" roadmap |
| p2p-address-book | engine | hyperswarm, corestore, autobase — Bare only; loaded as a module |

## 4. Data corrections made to `atlas.yaml`

- `wdk-failover-provider` "requires wdk-pricing-provider" was backwards. Now: `wdk-wallet-evm`,
  `wdk-wallet-evm-7702-gasless` and `wdk-pricing-provider` require it.
- `wdk-secret-manager`: summary rewritten; note that the worklet ships its own implementation.
- `wdk-signer-local`: summary rewritten; note that no wallet uses it.
- Protocol groups renamed for readers: Swap & bridge, Earn & borrow, Buy & sell for cash, Shared approval.

## 5. Questions for the maintainer

1. **Two implementations of seed encryption.** `pear-wrk-wdk/handlers/secrets.js` and
   `wdk-secret-manager` do the same job; the docs credit the package, the starter uses neither
   directly. Which is canonical?
2. **`wdk-signer-local` has no consumer.** Is it waiting on "Abstract signers" (wip 80% on btc/evm)?
3. **`wdk-rgb-lightning` has no `requires`** while `wdk-wallet-rgb` requires btc. Deliberate?
4. **No Flutter host binding** in the list; Kotlin and Swift cores exist. Moor's `wdk_core_flutter`
   POC sits on the Kotlin core's floor.
5. **Bare is missing.** The engine stands on Holepunch's Bare runtime and BareKit; the atlas names
   neither. An ecosystem entry would make the foundation honest.
6. **"API clients" was the right name and Core the wrong section.** Pricing and the indexer run in
   the app beside the host binding.
7. `notes:` on `wdk-wallet` lists five interfaces as free text; as `relations: implements` on the
   protocols they would be data.
8. **Four repo links 404 from outside** (checked 2026-08-31): `tetherto/wdk-playground`,
   `tetherto/wdk-core-swift`, `tetherto/wdk-starter-swift`, and `arkade-os/wdk`. Private, or not
   created yet? The Swift core claudiovb linked on bundler#46 (`claudiovb/wdk-core-swift`) also
   404s now. Arkade's module is at `arkade-os/arkade-wdk`; fixed in the YAML.
9. **Two repos exist that the YAML doesn't link**: `tetherto/wdk-policies` (public, pushed
   08-28, still marked *planned*) and `tetherto/wdk-doctor-app` (public, pushed 08-24). Links added;
   the status of `wdk-policies` is the maintainer's call.

## 6. Not done

- No visual check of the layout beyond a headless DOM; curves, widths and the drawer's 320px
  are judged by eye.
- Roadmap chips are still shown by default.
- The stack-map artifact (a separate page built from the same YAML, with moor-wallet traces) is
  not part of this repo.
