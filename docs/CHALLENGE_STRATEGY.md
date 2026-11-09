# NEAR HACKATHON strategy

**Rules checked:** the live official
[`HACKATHON.md`](https://nearhackathon.com/HACKATHON.md), re-read 9 Nov 2026.
Re-check it before publication or submission.

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
4. A NEAR Testnet escrow contract accepts one configured verifier release,
   records the receipt digest, and prevents a second movement. Expiry refunds
   return funds to the job owner.
5. The UI distinguishes `Verified`, transfer pending, `Settled`, and refunded
   only from final chain state.

The demo must also show one failure path, ideally a tampered receipt or a
forbidden capability. No UI-only state change may stand in for Cell evidence,
signature verification, or a NEAR transaction.

## Challenge-specific work

Ephemora Cell is pre-existing owner code and is a baseline dependency. Clearly
separate it from the new ProofGate work. The challenge entry must demonstrate
the new NEAR escrow/verifier integration, not present Cell itself as the
hackathon result.

The official challenge page says Claude Code and Codex screen for
reproducibility and feature claims before human judging. The README therefore
needs literal `run this → see this` steps, an expected output for each step,
and clear labels for anything still simulated.

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

For chain reads, the official NEAR RPC provider directory lists the Testnet
endpoint `https://archival-rpc.testnet.near.org` and documents JSON-RPC 2.0
`POST` requests. A one-request `status` query returned `chain_id: testnet`,
protocol 88, and `syncing: false`. This is read-only connectivity evidence,
not a contract interaction or payout. Public shared RPC endpoints must not be
load-tested.

**Current integration gap:** ProofGate's verified Cell jobs remain local and
unpaid. A read-only `/api/near/status` route and Settings UI now check Testnet
RPC reachability, but there is no contract-call adapter or finality tracker.
The challenge's winning path still needs the newly written escrow contract, a
clean local/sandbox contract check, and—after the required key/transaction
decision—a real Testnet create/verify/settle demonstration.

## Submission boundary

The official rules require a public repository, public X demo post tagged
`@NEARProtocol` and `#NEARHackathon`, and one final submission by 14 November
2026 at 23:59 UTC. The human owner controls repository publication, external
posting and submission. The project files may be prepared in advance; no
external action is taken by this plan. The project decision record separately
requires explicit authorization before transaction signing or spending.

## Design direction

Use the current Apple 2026 guidance as inspiration for adaptable layout,
content-first hierarchy, and a restrained floating functional layer. The
ProofGate expression remains original: evidence is the visual anchor, while
translucency belongs to navigation. See
[`UI_IMPLEMENTATION_PLAN.md`](../UI_IMPLEMENTATION_PLAN.md).
