# UI implementation plan

**Status:** responsive local-first interface refreshed; interactive Cell flow
is connected for all seven supported source paths. Full accessibility,
contrast, and device matrix review remain open.

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
| Settlements | Show financial state without optimistic success | Escrow, pending, paid/refund states, recipient, amount, contract, chain, confirmed transaction link |
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
- `Blocked` or `Needs review` → show the machine-readable reason and safe
  next action.
- `Demo data — sample values only` → persistent badge on every sample-data
  screen and export.

## Visual system

Use the original Ephemora direction with Apple's current 2026 design guidance
as inspiration: content-first hierarchy, responsive layouts, carefully nested
geometry, and Liquid Glass-like material only on the functional navigation
layer. Evidence and audit content stays opaque and readable. Use system fonts
and original inline SVG marks. Do not use Apple logos, proprietary fonts,
endorsement language, or pixel-for-pixel branded screens.

The distinctive product moment is the visible progression from a declared
policy, through inspected execution evidence, to a separately confirmed
settlement. The interface foregrounds that chain instead of generic KPI tiles
or decorative charts. Color denotes state; the blocked and pending states are
as legible as the successful path.

Apple guidance reviewed for this design: [WWDC26 design guide](https://developer.apple.com/wwdc26/guides/design/),
[Human Interface Guidelines: Materials](https://developer.apple.com/design/human-interface-guidelines/materials),
and [Human Interface Guidelines: Layout](https://developer.apple.com/design/human-interface-guidelines/layout).

The first implementation uses the token direction below, then adapts it with
system typography, readable opaque evidence surfaces, and restrained functional
translucency. Contrast review remains open:

| Token | Light | Dark |
|---|---|---|
| Canvas | `#F5F6FB` | `#10131E` |
| Surface | `#FFFFFF` | `#1B2130` |
| Ink | `#161D32` | `#F4F6FF` |
| Accent | `#4C58DB` | `#9B9DFE` |
| Success | `#147C58` | `#77E4B6` |
| Danger | `#BB3148` | `#FF9EAB` |

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

Still open: keyboard and screen-reader pass, contrast measurement, 320–1440 px
layout captures, reduced-motion and reduced-transparency review, and one
explicit blocked run. There is no NEAR transaction or final `Settled` state in
this interface yet.
