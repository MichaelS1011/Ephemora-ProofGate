import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nearAPI from 'near-api-js';

const here = dirname(fileURLToPath(import.meta.url));
const target = process.env.NEAR_TESTNET_CREDENTIALS || resolve(here, '../../../.local/near-testnet/master.json');
if (existsSync(target)) {
  console.log(`Testnet credentials already exist at ${target}.`);
  process.exit(0);
}

const key = nearAPI.KeyPair.fromRandom('ed25519');
const accountId = `proofgate-${Date.now().toString(36)}.testnet`;
const response = await fetch('https://helper.testnet.near.org/account', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: key.getPublicKey().toString() }),
});
if (!response.ok) throw new Error(`Testnet helper rejected the account: HTTP ${response.status}`);
const body = await response.json();
const created = body?.transaction?.receiver_id || accountId;
mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
writeFileSync(target, JSON.stringify({ accountId: created, secretKey: key.toString() }, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ accountId: created, credentials: target, status: body?.final_execution_status }, null, 2));
