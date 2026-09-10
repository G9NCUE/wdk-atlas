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

## 2b. The map redrawn (2026-09-02)

Applied from the UX review: the stack as a cross-section, the engine as a grid.

| Change | Why |
|---|---|
| One band per section, a rail step beside it (`path` on the section), the engine bordered in orange with `seal` | The four layers now fit in one or two screens; the sealed-room argument is drawn, not explained |
| Wallets and protocols as a chain × capability grid (`matrix` on the section, `chains` at the root, `kind` on every wallet, `groups` on the wallets lane) | Chain and capability are the two questions people bring; a protocol sits in the column of the wallet it needs; an empty cell is a gap and reads as one. Cross-chain protocols repeat per column; Spark, RGB and Ark are Bitcoin rows because they require the Bitcoin wallet |
| Chips instead of cards; live is the quiet neutral, amber for in progress, dashed for planned, a purple publisher name for third-party modules | 47 of 53 modules are live; colour now marks the exception |
| A roadmap item touching half of a band of four or more is drawn once as a strip; each chip carries only a count | "Abstract signers" was stamped under twelve wallets |
| Selecting a module fades everything unrelated; details open in a popover under the chip, relations listed by title | Twelve orange rings across two screens were a hunt; the drawer shifted the whole map |
| Column headers filter the grid to one chain | The chain filter the map lacked |
| `short` on a module: a title for the grid when the row and column already say the rest | "Swap & bridge via Symbiosis" in the Swap & bridge row is "Symbiosis" |
| The rail follows the reader: the active layer is the one holding the open module, else the one clicked, else the band nearest the top of the viewport; its step and band light up and the line is orange down to it | A static rail read as a caption, and the engine's permanent orange border made it the centre of everything |

Dropped: the dashed "compatible" guess from shared chain labels. The grid shows it by position.
The developer page keeps the card renderer with the same encoding.

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

Reviewed 2026-09-02 against sources; answered by Jonathan in the decisions document on 2026-09-06.

Still open:

1. **`wdk-signer-local` still has no consumer.** `ISigner` now exists in `wdk-wallet` and
   `wdk-wallet-evm` ships seed and private-key signers; btc has none. `wdk-signer-local` exposes
   plain functions (`sign`, `getPublicKey`, `createMnemonic`…), not an `ISigner`. Is it meant to be
   wrapped as one, and when does btc get a signer?
2. **Social login and recovery: descoped, or still intended?** The Q2 sheet marks it in progress, but no
   WDK module for social login or recovery exists — no repo, no package, and the only code hits in the
   org are the developer portal's own sign-in. The one shipped primitive is Shamir secret sharing in
   `wdk-utils` (split a mnemonic into n shares, k reconstruct), published at 1.0.0-beta.11. So either
   the item was descoped to that and should be closed with the SSS work credited, or it is still
   intended — in which case it is the largest developer-experience gap against Privy, Web3Auth and
   Para, who all lead with social login, and it belongs on the 2027 roadmap with an owner.
3. **Three roadmap items with no definition.** `unified-usdt-balance`, `social-recovery` and
   `browser-extension` are titles in the previous roadmap sheet with no description anywhere else.
   The roadmap shows them with a "scope undefined" blurb on purpose. Who owns each, and what is the
   one-paragraph scope?

Follow-ups from the 2026-09-06 decisions, to close by 2026-09-19 (end of sprint 14):

- Fabrice: message the TW team before `wdk-backup-remote` is archived (is it in use?).
- Fabrice: heads-up to the Telegram team before the two TON protocol repos are archived.
- Fabrice: ask Racquel whether `wdk-module-templates` is worth keeping or can be deleted.
- Fabrice: confirm with Francesco that `wdk-lib-lookup-storage` is indexer plumbing and stays private.
- Fabrice: confirm the Flutter-through-a-grant route with Raquel.
- Jonathan (sprint task): delete the twelve empty scaffolds and `wdk-demo-wallet`; archive the four
  2025 EVM protocols, the two TON protocols, both backup packages, `wdk-wrapper-failover-cascade`,
  `wdk-safe-core-sdk`, and `wdk-secret-manager` with an npm deprecation and a docs fix.
- Jonathan: publish `wdk-indexer-http` to npm; ship `wdk-core-swift` on Swift Package Manager.
- Atlas, once GitHub reflects the above: the weekly check goes quiet on those repos; flip the indexer
  client and the Swift cards when the releases land.

Answered (2026-09-06):

- **Seed encryption.** `wdk-secret-manager` is archived and dropped from WDK; the worklet's own
  encryption is the one implementation. Card removed from the map; docs still credit the package.
- **Node or worklet.** Both are official paths. Plain Node stays documented as lightweight, familiar
  and easier to debug; the worklet is the phone path. The engine text says so.
- **Flutter.** Not on the core team's plate; to be built by the ecosystem under the grant template if
  there is a product case. In the backlog as an ecosystem initiative; owner to confirm with Raquel.
- **Private repos.** `wdk-core-swift` will ship on Swift Package Manager; `wdk-playground` holds
  end-to-end test runners and may go public as a dev tool but is off the map; `arkade-os/wdk` is
  private but published on npm, Arkade may be asked to open it.
- **`wdk-policies`** will hold a library of common policies; the engine stays in `wdk`.
  `wdk-safe-core-sdk` is an archived fork, no longer a dependency.

## 6. Not done

- No visual check of the layout beyond a headless DOM; curves, widths and the drawer's 320px
  are judged by eye.
- Roadmap chips are still shown by default.
- The stack-map artifact (a separate page built from the same YAML, with moor-wallet traces) is
  not part of this repo.

## PoC note (asana sync)

Placeholder edit for the GitHub Project to Asana synchronisation proof of concept. Safe to revert.
Adds the Cards interface module as a planned item, see issue #3.
