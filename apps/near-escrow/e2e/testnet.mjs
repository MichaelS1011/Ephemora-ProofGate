import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nearAPI from 'near-api-js';

const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = resolve(here, '../target/wasm32-unknown-unknown/release/proofgate_escrow.wasm');
if (!existsSync(wasmPath)) {
  console.error('Build the contract first: cargo build --target wasm32-unknown-unknown --release');
  process.exit(1);
}
const wasm = readFileSync(wasmPath);
const yocto = (amount) => BigInt(Math.round(Number(amount) * 1e6)) * 10n ** 18n;
const tgas = (value) => BigInt(value) * 10n ** 12n;
const runId = Date.now().toString(36);
const nodeUrl = process.env.NEAR_TESTNET_RPC_URL || 'https://test.rpc.fastnear.com';
const explorer = (hash) => `https://explorer.testnet.near.org/transactions/${hash}`;
const results = {
  network: 'testnet',
  contractWasmSha256: 'sha256:' + createHash('sha256').update(wasm).digest('hex'),
};

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

const credentialsPath = process.env.NEAR_TESTNET_CREDENTIALS || resolve(here, '../../../.local/near-testnet/master.json');
if (!existsSync(credentialsPath)) {
  throw new Error(`Testnet credentials not found at ${credentialsPath}. Run create-testnet-master.mjs first.`);
}
const masterCreds = JSON.parse(readFileSync(credentialsPath, 'utf8'));
const accountsPath = process.env.NEAR_TESTNET_ACCOUNTS || resolve(dirname(credentialsPath), 'accounts.jsonl');
const savedKeys = new Map();
if (existsSync(accountsPath)) {
  for (const line of readFileSync(accountsPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line);
    const accountId = entry.accountId || entry.owner || entry.verifier || entry.beneficiary || entry.attacker;
    if (accountId && entry.secretKey) savedKeys.set(accountId, entry.secretKey);
  }
}

const keyStore = new nearAPI.keyStores.InMemoryKeyStore();
keyStore.setKey('testnet', masterCreds.accountId, nearAPI.KeyPair.fromString(masterCreds.secretKey));
const near = await nearAPI.connect({ networkId: 'testnet', nodeUrl, keyStore });
const master = await near.account(masterCreds.accountId);
const masterId = masterCreds.accountId;

function saveKey(accountId, keyPair) {
  appendFileSync(accountsPath, JSON.stringify({ accountId, secretKey: keyPair.toString() }) + '\n', { mode: 0o600 });
  savedKeys.set(accountId, keyPair.toString());
}

async function existingState(accountId) {
  try {
    return await (await near.account(accountId)).state();
  } catch {
    return null;
  }
}

async function ensureAccount(role, amount) {
  const accountId = `${role}.${masterId}`;
  let keyPair;
  if (savedKeys.has(accountId)) keyPair = nearAPI.KeyPair.fromString(savedKeys.get(accountId));
  else keyPair = nearAPI.KeyPair.fromRandom('ed25519');
  keyStore.setKey('testnet', accountId, keyPair);
  const state = await existingState(accountId);
  if (!state) {
    await master.createAccount(accountId, keyPair.getPublicKey(), yocto(amount));
    saveKey(accountId, keyPair);
  } else if (!savedKeys.has(accountId)) {
    throw new Error(`Account ${accountId} exists but no key is saved for it.`);
  }
  return { id: accountId, account: await near.account(accountId) };
}

async function finalize(txHash, signerId) {
  const final = await near.connection.provider.txStatus(txHash, signerId, 'FINAL');
  if (final.status?.Failure) throw new Error(JSON.stringify(final.status.Failure));
  return final;
}

async function waitForJob(contractId, jobId, expected) {
  const contract = await near.account(contractId);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const value = await contract.viewFunction({
      contractId,
      methodName: 'get_job',
      args: { job_id: jobId },
    });
    if (value?.status === expected) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  }
  throw new Error(`Job ${jobId} did not reach ${expected}.`);
}

async function expectFailure(account, signerId, call, pattern) {
  try {
    const outcome = await account.functionCall(call);
    const txHash = outcome.transaction_outcome.id;
    const final = await near.connection.provider.txStatus(txHash, signerId, 'FINAL');
    assert.ok(final.status?.Failure, 'Expected a failed transaction.');
    assert.match(JSON.stringify(final.status.Failure), pattern);
    return { txHash, failure: final.status.Failure };
  } catch (error) {
    assert.match(String(error), pattern);
    return { error: String(error) };
  }
}

const verifier = await ensureAccount('verifier', 1);
const beneficiary = await ensureAccount('beneficiary', 0.5);
const attacker = await ensureAccount('attacker', 0.5);
const owner = await ensureAccount('owner', 1.5);

let contractId = process.env.NEAR_TESTNET_CONTRACT_ID;
let escrow;
if (contractId) {
  escrow = await near.account(contractId);
  const configuration = await escrow.viewFunction({ contractId, methodName: 'get_configuration', args: {} });
  assert.equal(configuration.verifier_id, verifier.id);
} else {
  contractId = `escrow-${runId}.${masterId}`;
  const escrowKey = nearAPI.KeyPair.fromRandom('ed25519');
  keyStore.setKey('testnet', contractId, escrowKey);
  escrow = await master.createAndDeployContract(contractId, escrowKey.getPublicKey(), wasm, yocto(3));
  const initOutcome = await owner.account.functionCall({
    contractId,
    methodName: 'new',
    args: { verifier_id: verifier.id },
    gas: tgas(30),
    attachedDeposit: '0',
  });
  await finalize(initOutcome.transaction_outcome.id, owner.id);
}

const apiBase = process.env.PROOFGATE_API;
const apiJobId = process.env.PROOFGATE_JOB_ID;
const bridgeToken = process.env.PROOFGATE_BRIDGE_TOKEN;
let paidJob = `PG-TESTNET-PAID-${runId}`;
let paidAmount = '0.10';
let paidDigest = 'sha256:' + 'a'.repeat(64);
if (apiBase && apiJobId) {
  const jobResponse = await fetch(`${apiBase}/api/jobs/${apiJobId}`);
  if (!jobResponse.ok) throw new Error(`ProofGate job ${apiJobId} is unavailable (${jobResponse.status}).`);
  const apiJob = (await jobResponse.json()).job;
  if (apiJob.state !== 'Verified') throw new Error(`ProofGate job ${apiJobId} is not verified (${apiJob.state}).`);
  if (apiJob.beneficiary !== beneficiary.id) {
    throw new Error(`Create the ProofGate job with beneficiary ${beneficiary.id}; got ${apiJob.beneficiary}.`);
  }
  const receiptResponse = await fetch(`${apiBase}/api/jobs/${apiJobId}/receipt`);
  if (!receiptResponse.ok) throw new Error(`ProofGate receipt ${apiJobId} is unavailable (${receiptResponse.status}).`);
  const bundle = await receiptResponse.json();
  paidJob = apiJob.id;
  paidAmount = apiJob.reward;
  paidDigest = receiptDigest(bundle.receipt);
  results.apiJobId = apiJob.id;
}

const expiry = (BigInt(Date.now()) + 3_600_000n) * 1_000_000n;
const createOutcome = await owner.account.functionCall({
  contractId,
  methodName: 'create_job',
  args: { job_id: paidJob, beneficiary_id: beneficiary.id, expires_at_ns: expiry.toString() },
  gas: tgas(30),
  attachedDeposit: yocto(paidAmount).toString(),
});
const createTx = createOutcome.transaction_outcome.id;
await finalize(createTx, owner.id);
await waitForJob(contractId, paidJob, 'Open');
results.createJobTx = createTx;
results.createJobExplorer = explorer(createTx);

const before = BigInt((await beneficiary.account.state()).amount);
const releaseOutcome = await verifier.account.functionCall({
  contractId,
  methodName: 'release_job',
  args: { job_id: paidJob, receipt_digest: paidDigest },
  gas: tgas(100),
});
const releaseTx = releaseOutcome.transaction_outcome.id;
await finalize(releaseTx, verifier.id);
const paidState = await waitForJob(contractId, paidJob, 'Paid');
const after = BigInt((await beneficiary.account.state()).amount);
assert.equal(after - before, yocto(paidAmount));
results.releaseJobTx = releaseTx;
results.releaseJobExplorer = explorer(releaseTx);
results.paidJob = {
  status: paidState.status,
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
      network: 'testnet',
      contractId,
      receiptDigest: paidDigest,
      amount: paidAmount,
      beneficiary: beneficiary.id,
      status: 'Paid',
      txHash: releaseTx,
    }),
  });
  const settlementBody = await settlementResponse.json();
  if (!settlementResponse.ok) {
    throw new Error(`Settlement record rejected: ${settlementBody.error || settlementResponse.status}`);
  }
  results.apiSettlement = settlementBody.job?.settlement;
  assert.equal(settlementBody.job?.settled, true);
}

if (process.env.NEAR_TESTNET_FAST !== '1') {
  const blockedJob = `PG-TESTNET-BLOCKED-${runId}`;
  await owner.account.functionCall({
    contractId,
    methodName: 'create_job',
    args: { job_id: blockedJob, beneficiary_id: beneficiary.id, expires_at_ns: expiry.toString() },
    gas: tgas(30),
    attachedDeposit: yocto('0.10').toString(),
  });
  const attackerResult = await expectFailure(
    attacker.account,
    attacker.id,
    { contractId, methodName: 'release_job', args: { job_id: blockedJob, receipt_digest: paidDigest }, gas: tgas(100), attachedDeposit: '0' },
    /Only the configured verifier/,
  );
  await waitForJob(contractId, blockedJob, 'Open');
  results.attackerRelease = { result: 'rejected; job stayed Open', tx: attackerResult.txHash };

  const doubleRelease = await expectFailure(
    verifier.account,
    verifier.id,
    { contractId, methodName: 'release_job', args: { job_id: paidJob, receipt_digest: paidDigest }, gas: tgas(100), attachedDeposit: '0' },
    /Job is not open/,
  );
  results.doubleRelease = { result: 'rejected; job stayed Paid', tx: doubleRelease.txHash };

  const refundJob = `PG-TESTNET-REFUND-${runId}`;
  const shortExpiry = (BigInt(Date.now()) + 5_000n) * 1_000_000n;
  await owner.account.functionCall({
    contractId,
    methodName: 'create_job',
    args: { job_id: refundJob, beneficiary_id: beneficiary.id, expires_at_ns: shortExpiry.toString() },
    gas: tgas(30),
    attachedDeposit: yocto('0.10').toString(),
  });
  await new Promise((resolveWait) => setTimeout(resolveWait, 7_000));
  let refundTx = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const outcome = await owner.account.functionCall({
        contractId,
        methodName: 'refund_expired',
        args: { job_id: refundJob },
        gas: tgas(100),
        attachedDeposit: '0',
      });
      refundTx = outcome.transaction_outcome.id;
      await finalize(refundTx, owner.id);
      break;
    } catch (error) {
      if (!/Job has not expired/.test(String(error))) throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
    }
  }
  if (!refundTx) throw new Error('Refund did not become available before the timeout.');
  const refundState = await waitForJob(contractId, refundJob, 'Refunded');
  results.refundJob = { status: refundState.status, tx: refundTx, explorer: explorer(refundTx) };

  await owner.account.functionCall({ contractId, methodName: 'pause', args: {}, gas: tgas(30), attachedDeposit: '0' });
  const pausedCreate = await expectFailure(
    owner.account,
    owner.id,
    {
      contractId,
      methodName: 'create_job',
      args: { job_id: `PG-TESTNET-PAUSED-${runId}`, beneficiary_id: beneficiary.id, expires_at_ns: expiry.toString() },
      gas: tgas(30),
      attachedDeposit: yocto('0.10').toString(),
    },
    /Escrow is paused/,
  );
  await owner.account.functionCall({ contractId, methodName: 'unpause', args: {}, gas: tgas(30), attachedDeposit: '0' });
  results.pause = { result: 'creation rejected while paused; unpaused afterwards', tx: pausedCreate.txHash };
}

results.master = masterId;
results.contractId = contractId;
results.accounts = {
  owner: owner.id,
  verifier: verifier.id,
  beneficiary: beneficiary.id,
  attacker: attacker.id,
};
console.log(JSON.stringify({ ok: true, ...results }, null, 2));
