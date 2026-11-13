# UI implementation plan

**Status:** Apple 2026-inspired interface pass applied and structurally
verified: skip link and keyboard order, dialog focus trap and focus return,
accessible names on every button and form field, axe WCAG 2.2 AA scan with 0
violations across 11 page/view combinations, light/dark and 320–1440 px
layouts without horizontal overflow, offline/sample states, and a real blocked
network probe. Native VoiceOver read-through and a reduced-transparency device
pass remain follow-ups.

## Product experience

The first-use journey is **Execute → Verify → Settle**. The UI makes each
state and reason visible, while signer trust and payout eligibility remain
backend decisions. The experience is English-only and uses original Ephemora
branding.

## Screen map

| Screen | Purpose | Main evidence or action |
|---|---|---|
| Overview | Show execution and payment posture | Recent jobs; create a protected job; clearly disclosed demo state |
| New Execution | Define the job without hidden privileges | Validated runtime, program/input, allowed capabilities, resource limits, reward, recipient, network; permission review before create |
| Execution Detail | Show the causal chain | Submitted → Sandboxed → Signed → Verified → Settled, with only completed steps active |
| Receipts | Explain what the evidence says and what it does not prove | Job/run IDs, runtime, digests, signer, signature and policy checks; copy/download evidence |
| Settlements | Show financial state without optimistic success | Escrow, pending, paid/refund states, recipient, amount, contract, chain, confirmed transaction link; sandbox records are labeled and never linked as a public explorer transaction |
| Security | Explain policy and denials | Blocked claims, trusted verifier status, capability policies, audit events and exact reasons |
| Settings | Control safe local preferences | Appearance, Testnet network, exports, runtime metadata; no implicit Mainnet choice |

## Status semantics

- `Ready` → review the job.
- `Executing` → show progress and logs from the actual run.
- `Verified · Awaiting settlement` → evidence passed; payment is not confirmed.
- `Settlement pending` → transaction submitted or confirmation unavailable;
  never display `Settled`.
- `Settled` → final chain confirmation exists and a validated transaction ID
  is available.
- `Settled · NEAR sandbox` → final local sandbox transfer recorded by the
  bridge; labeled separately, not a Mainnet payment, and not given an explorer
  link.
- `Blocked` or `Needs review` → show the machine-readable reason and safe
  next action.
- `Demo data — sample values only` → persistent badge on every sample-data
  screen and export.

## Visual system

Use the original Ephemora direction with Apple's current 2026 design guidance
as inspiration: content-first hierarchy, responsive layouts, carefully nested
geometry, and Liquid Glass-like material only on the functional navigation
layer. Evidence and audit content stays opaque and readable. The implementation
uses the SF system-font stack with optical sizing, an 11–40 px type scale,
sentence-case labels, tabular numerals, custom SF-like inline icons, 44-pt
controls, and native light/dark semantics. Do not use Apple logos, proprietary
fonts, endorsement language, or pixel-for-pixel branded screens.

The distinctive product moment is the visible progression from a declared
policy, through inspected execution evidence, to a separately confirmed
settlement. The interface foregrounds that chain instead of generic KPI tiles
or decorative charts. Color denotes state; the blocked and pending states are
as legible as the successful path.

Apple guidance reviewed for this design: [WWDC26 design guide](https://developer.apple.com/wwdc26/guides/design/),
[Human Interface Guidelines: Materials](https://developer.apple.com/design/human-interface-guidelines/materials),
and [Human Interface Guidelines: Layout](https://developer.apple.com/design/human-interface-guidelines/layout).

The interface now uses the warm Ephemora palette with system typography,
readable opaque evidence surfaces, and restrained functional translucency. Beige
frames the workspace, white keeps evidence surfaces crisp, and deep red is the
brand and action accent. Green is reserved for genuinely successful checks;
red also communicates blocked states. Light and dark modes preserve the same
palette identity. The updated principal tokens are:

| Token | Light | Dark |
|---|---|---|
| Canvas | `#F2ECE4` | `#171310` |
| Surface | `#FFFEFC` | `#211B18` |
| Ink | `#251E1A` | `#F8F2EB` |
| Accent | `#922B35` | `#F0A7A6` |
| Action | `#A52C38` | `#A92C38` |
| Success | `#176242` | `#70D19B` |
| Danger | `#A52431` | `#FF878B` |

## Component and copy plan

Reusable pieces: navigation rail/menu, utility toolbar, status badge, metric
card, execution tracker, receipt fingerprint, verification checklist,
settlement state, evidence log, accessible dialog, and form controls. Public
strings live in a central English dictionary, including loading, empty, error,
forbidden, and retry text.

No fake transactions, artificial metrics, or local JavaScript receipt toggle in
real mode. Any explorer link must come from a trusted backend response with a
validated transaction identifier and official explorer template.

## Accessibility and review evidence

- Keyboard access and visible focus for every control; semantic landmarks and
  headings; descriptive icon names; `aria-live` for verification/payment
  transitions.
- WCAG 2.2 AA contrast targets: 4.5:1 normal text and 3:1 large text and
  relevant controls, verified against rendered states.
- Light, dark, reduced-motion, and reduced-transparency behavior.
- No functional clipping at 320, 390, 768, 1280, and 1440 CSS pixels.
- Review blocked, verified-but-unpaid, pending, final, demo/offline, empty,
  loading, and unavailable-network states.
- Capture desktop/tablet/mobile and both themes; record results against UX-01
  through UX-12 in the journal.

## Implementation approach

Implemented screens: Overview, Executions, Execution Detail, Receipts,
Settlements, Security, and Settings. The refreshed interface uses a restrained
Apple-inspired system typography and material treatment, responsive layouts,
theme support, and reduced-motion/transparency preferences. The local API now
creates SQLite jobs, executes the selected reviewed source guest through Cell,
displays actual output and signed evidence metadata, and distinguishes
`Verified · unpaid` from settlement. All seven language/runtime choices show
their ABI and profile. Sample and offline records are labelled. If the API
drops after a real connection, cached local records are kept distinct from demo
data and actions are disabled until reconnect.

Implemented settlement display: a verified job with a stored bridge record
shows `Settled`, the network (`NEAR sandbox` or `NEAR Testnet`), contract,
receipt digest, amount, beneficiary, and transaction hash; a Testnet record
links to the official explorer, a sandbox record does not. The interface never
starts a payout and never infers `Settled` from a local click.

Verified: skip link and keyboard order, dialog focus trap and focus return,
accessible names, axe 0 violations, 320/390/768/920/1280/1440 px widths,
offline/sample data, reduced-motion durations, and a real blocked network
probe with ENOTSOCK and `/sandbox` as the only preopen. Follow-ups: a native
VoiceOver read-through and a reduced-transparency device pass.
