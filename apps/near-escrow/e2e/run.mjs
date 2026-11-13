import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'near-workspaces';

const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = resolve(here, '../target/wasm32-unknown-unknown/release/proofgate_escrow.wasm');
if (!existsSync(wasmPath)) {
  console.error('Build the contract first: cargo build --target wasm32-unknown-unknown --release');
  process.exit(1);
}
const wasm = readFileSync(wasmPath);
const near = (amount) => BigInt(Math.round(Number(amount) * 1e6)) * 10n ** 18n;
const tgas = (value) => BigInt(value) * 10n ** 12n;
const digest = 'sha256:' + 'a'.repeat(64);
const results = { contractWasmSha256: 'sha256:' + createHash('sha256').update(wasm).digest('hex') };

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  }
  return value;
}

function receiptDigest(receipt) {
  return 'sha256:' + createHash('sha256').update(JSON.stringify(canonicalJson(receipt.payload))).digest('hex');
}

async function job(contract, jobId) {
  return contract.view('get_job', { job_id: jobId });
}

const worker = await Worker.init();
try {
  const owner = await worker.rootAccount.createSubAccount('owner', { initialBalance: near(100) });
  const verifier = await worker.rootAccount.createSubAccount('verifier', { initialBalance: near(50) });
  const beneficiary = await worker.rootAccount.createSubAccount('beneficiary', { initialBalance: near(10) });
  const attacker = await worker.rootAccount.createSubAccount('attacker', { initialBalance: near(50) });

  const escrow = await owner.createSubAccount('escrow', { initialBalance: near(25) });
  await escrow.deploy(wasm);
  await owner.call(escrow, 'new', { verifier_id: verifier.accountId });
  const configuration = await escrow.view('get_configuration');
  assert.equal(configuration.owner_id, owner.accountId);
  assert.equal(configuration.verifier_id, verifier.accountId);

  const apiBase = process.env.PROOFGATE_API;
  const apiJobId = process.env.PROOFGATE_JOB_ID;
  const bridgeToken = process.env.PROOFGATE_BRIDGE_TOKEN;
  let paidJob = 'PG-E2E-PAID';
  let paidAmount = '0.5';
  let paidDigest = digest;
  if (apiBase && apiJobId) {
    const jobResponse = await fetch(`${apiBase}/api/jobs/${apiJobId}`);
    if (!jobResponse.ok) throw new Error(`ProofGate job ${apiJobId} is unavailable (${jobResponse.status}).`);
    const apiJob = (await jobResponse.json()).job;
    if (apiJob.state !== 'Verified') throw new Error(`ProofGate job ${apiJobId} is not verified (${apiJob.state}).`);
    if (apiJob.beneficiary !== beneficiary.accountId) {
      throw new Error(`Create the ProofGate job with beneficiary ${beneficiary.accountId}; got ${apiJob.beneficiary}.`);
    }
    const receiptResponse = await fetch(`${apiBase}/api/jobs/${apiJobId}/receipt`);
    if (!receiptResponse.ok) throw new Error(`ProofGate receipt ${apiJobId} is unavailable (${receiptResponse.status}).`);
    const bundle = await receiptResponse.json();
    paidJob = apiJob.id;
    paidAmount = apiJob.reward;
    paidDigest = receiptDigest(bundle.receipt);
    results.apiJobId = apiJob.id;
  }
  const paidAmountYocto = near(paidAmount);

  const expiry = (Date.now() + 60 * 60 * 1000) * 1_000_000;
  const createPaid = await owner.callRaw(
    escrow,
    'create_job',
    { job_id: paidJob, beneficiary_id: beneficiary.accountId, expires_at_ns: String(expiry) },
    { attachedDeposit: paidAmountYocto, gas: tgas(30) },
  );
  assert.equal((await job(escrow, paidJob)).status, 'Open');
  results.createJobTx = createPaid.transactionReceipt.hash;

  const before = BigInt((await beneficiary.balance()).total);
  const release = await verifier.callRaw(
    escrow,
    'release_job',
    { job_id: paidJob, receipt_digest: paidDigest },
    { gas: tgas(100) },
  );
  const after = BigInt((await beneficiary.balance()).total);
  assert.equal((await job(escrow, paidJob)).status, 'Paid');
  assert.equal(after - before, paidAmountYocto);
  results.releaseJobTx = release.transactionReceipt.hash;
  results.paidJob = {
    status: 'Paid',
    amount: paidAmount,
    receiptDigest: paidDigest,
    beneficiaryDeltaYocto: String(after - before),
  };

  if (apiBase && apiJobId) {
    if (!bridgeToken) throw new Error('PROOFGATE_BRIDGE_TOKEN is required to record the settlement.');
    const settlementResponse = await fetch(`${apiBase}/api/jobs/${apiJobId}/settlement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-ProofGate-Bridge': bridgeToken },
      body: JSON.stringify({
        network: 'sandbox',
        contractId: escrow.accountId,
        receiptDigest: paidDigest,
        amount: paidAmount,
        beneficiary: beneficiary.accountId,
        status: 'Paid',
        txHash: release.transactionReceipt.hash,
      }),
    });
    const settlementBody = await settlementResponse.json();
    if (!settlementResponse.ok) {
      throw new Error(`Settlement record rejected: ${settlementBody.error || settlementResponse.status}`);
    }
    results.apiSettlement = settlementBody.job?.settlement;
    assert.equal(settlementBody.job?.settled, true);
  }

  const blockedJob = 'PG-E2E-BLOCKED';
  await owner.call(
    escrow,
    'create_job',
    { job_id: blockedJob, beneficiary_id: beneficiary.accountId, expires_at_ns: String(expiry) },
    { attachedDeposit: near(0.5), gas: tgas(30) },
  );
  const attackerResult = await attacker.callRaw(
    escrow,
    'release_job',
    { job_id: blockedJob, receipt_digest: digest },
    { gas: tgas(100) },
  );
  assert.equal(attackerResult.failed, true);
  assert.match(JSON.stringify(attackerResult.failures), /Only the configured verifier/);
  assert.equal((await job(escrow, blockedJob)).status, 'Open');
  results.attackerRelease = 'rejected; job stayed Open';

  const doubleRelease = await verifier.callRaw(
    escrow,
    'release_job',
    { job_id: paidJob, receipt_digest: paidDigest },
    { gas: tgas(100) },
  );
  assert.equal(doubleRelease.failed, true);
  assert.match(JSON.stringify(doubleRelease.failures), /Job is not open/);
  results.doubleRelease = 'rejected; job stayed Paid';

  const refundJob = 'PG-E2E-REFUND';
  const shortExpiry = (Date.now() + 2_000) * 1_000_000;
  await owner.call(
    escrow,
    'create_job',
    { job_id: refundJob, beneficiary_id: beneficiary.accountId, expires_at_ns: String(shortExpiry) },
    { attachedDeposit: near(0.5), gas: tgas(30) },
  );
  await new Promise((resolveWait) => setTimeout(resolveWait, 3_000));
  const refund = await owner.callRaw(escrow, 'refund_expired', { job_id: refundJob }, { gas: tgas(100) });
  assert.equal((await job(escrow, refundJob)).status, 'Refunded');
  results.refundJob = { status: 'Refunded', tx: refund.transactionReceipt.hash };

  await owner.call(escrow, 'pause', {});
  const pausedCreate = await owner.callRaw(
    escrow,
    'create_job',
    { job_id: 'PG-E2E-PAUSED', beneficiary_id: beneficiary.accountId, expires_at_ns: String(expiry) },
    { attachedDeposit: near(0.5), gas: tgas(30) },
  );
  assert.equal(pausedCreate.failed, true);
  assert.match(JSON.stringify(pausedCreate.failures), /Escrow is paused/);
  await owner.call(escrow, 'unpause', {});
  results.pause = 'creation rejected while paused; unpaused afterwards';

  results.contractId = escrow.accountId;
  results.accounts = {
    owner: owner.accountId,
    verifier: verifier.accountId,
    beneficiary: beneficiary.accountId,
    attacker: attacker.accountId,
  };
  console.log(JSON.stringify({ ok: true, ...results }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: String(error), ...results }, null, 2));
  process.exitCode = 1;
} finally {
  await worker.tearDown();
}
