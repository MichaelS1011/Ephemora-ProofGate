# NEAR HACKATHON strategy

**Rules checked:** official [`HACKATHON.md`](https://nearhackathon.com/HACKATHON.md)
and the live challenge landing page, checked 10 Nov 2026. Re-check both at
publication/submission time because rules and track criteria may change.

## Tracks

- **Primary: AI Security & Defense (`security`).** ProofGate limits what an
  agent workload can do, verifies its evidence outside the workload, and gates
  payment on explicit policy.
- **Secondary: Agent Economy (`agents`).** A compute job is commissioned,
  checked, and paid only after its result passes the configured checks.

The NEAR prompts are optional starting points, not mandatory integrations.
Q-011 explicitly allows an original NEAR contract that fits the track. Q-010
allows testnet-only projects. ProofGate should build its own escrow contract
and a real, reproducible job loop rather than adding an unrelated wallet or
marketplace feature.

## Winning demonstration

Show one complete causal path:

1. An operator defines a small job, its allowed capabilities, budget,
   beneficiary, and expiry.
2. The real Ephemora Cell route runs it; one prohibited capability is denied.
3. ProofGate validates the actual job-bound evidence and explains every check.
4. The escrow contract accepts one configured verifier release, records the
   receipt digest, and prevents a second movement. Expiry refunds return funds
   to the job owner. The local sandbox and the Testnet deployment now prove
   this path end to end; the public demo still needs the repository, X post,
   and final submission.
5. The UI distinguishes `Verified`, transfer pending, `Settled`, and refunded
   only from final chain state. A sandbox settlement is labeled `NEAR sandbox`,
   never as a Mainnet payment.

The demo must also show one failure path, ideally a tampered receipt or a
forbidden capability. No UI-only state change may stand in for Cell evidence,
signature verification, or a NEAR transaction.

## Challenge-specific work

Ephemora Cell is pre-existing owner code and is a baseline dependency. Clearly
separate it from the new ProofGate work. The challenge entry must demonstrate
the new NEAR escrow/verifier integration, not present Cell itself as the
hackathon result.

The current official rules describe automated Claude Code/Codex screening
before human judging. Prepare literal `run this → see this` reproduction
steps and expected outputs; clearly disclose illustrative UI states and the
external Cell/runtime dependencies a clean checkout cannot reproduce alone.
The required challenge material also names the official announcement post,
the rules, the closing demo livestream, and
`https://nearhackathon.com/api/applications` as the submission endpoint.

## Challenge API and submission boundary

The challenge has a submission API, but it is not the project's NEAR runtime
API. The exact documented route is
`POST https://nearhackathon.com/api/applications`; a successful `201` saves
the one project submission. The live rules specify no validation-only or
dry-run route. Their procedure says to gather human-provided project, lead,
email, team size, tracks, prize NEAR account, public repository and demo URLs,
description, and consent, then print the exact payload and wait for explicit
human confirmation before posting. The `requestId` must be generated once and
reused after a retry. A second submission for the same repository is rejected;
mistakes go through the organizer's request-changes form.

On 9 Nov 2026, a non-mutating `OPTIONS` request to that route returned `204`
with `Allow: GET, HEAD, OPTIONS, POST`. No application `POST` was sent. This
checks endpoint availability and accepted HTTP methods; it does not validate
a submission body or create a submission.

For chain reads, the Testnet endpoint `https://test.rpc.fastnear.com` (allowed
by the local API) answered a one-request `status` query with `chain_id:
testnet`, protocol 88, and `syncing: false`. The older
`archival-rpc.testnet.near.org` endpoint now returns HTTP 429 with a
deprecation warning. This is read-only connectivity evidence, not a contract
interaction or payout. Public shared RPC endpoints must not be load-tested.

**Current integration state:** the escrow contract passes a full local nearcore
2.14.0 sandbox run: deploy, funded job, verifier-only release, exact payout,
attacker and double-release rejection, expiry refund, and pause. The local API
accepts a confirmed sandbox settlement only from a bridge token holder after
validating the receipt digest, amount, and beneficiary. The Testnet contract
is deployed at `escrow-mw956wm0.proofgate-mw952xad.testnet`; documented create,
release, and refund transactions are in the README. The ProofGate-linked job
`PG-16EA8CE4` has a final 0.10 Testnet NEAR release recorded in local ignored
state. Its exact explorer transaction exists, but the real Cell/receipt bundle
and settlement record are not part of a clean public checkout. Testnet
accounts are throwaway; no Mainnet key or real funds are used. The local web
preview is currently disconnected from Cell/API. Read-only
`/api/near/status` is implemented; the recorded reachability check is past
operational evidence, not a live check now.

## Submission boundary

The official rules checked 10 Nov 2026 require a public repository before the
14 Nov 2026 23:59 UTC deadline, a public X demo post stating the project was
built at NEAR HACKATHON and tagging `@NEARProtocol` and `#NEARHackathon`, and
one final `POST` to `https://nearhackathon.com/api/applications`. There is no
validation-only submission mode. The payload requires the human's real name,
email, team size, NEAR **Mainnet payout address**, track IDs, public repository
URL, public X post URL, idea, and consent. The local draft still has `<your
name>`, `<mainnet payout account>`, and `<public X post URL>` placeholders; no
submission status has been confirmed, so do not claim it was submitted.
The official process requires showing the exact payload, waiting for explicit
owner confirmation, reusing the same `requestId` on retry, and never posting a
second submission. Owner-controlled work still open: review/update the draft,
confirm the prize payout address, publish the GitHub repository and demo X
post, then confirm the exact final API payload. Do not make any external
change, post, transaction, or submission from this checklist without its
required owner-controlled step.

## Design direction

Use the current Apple 2026 guidance as inspiration for adaptable layout,
content-first hierarchy, and a restrained floating functional layer. The
ProofGate expression remains original: evidence is the visual anchor, while
translucency belongs to navigation.
