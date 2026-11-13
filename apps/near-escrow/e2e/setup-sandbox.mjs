import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = process.env.NEAR_SANDBOX_VERSION || '2.14.0';
const MIN_PROTOCOL = 88;
const here = dirname(fileURLToPath(import.meta.url));

function platformPath() {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'Darwin-arm64';
  if (process.platform === 'linux' && process.arch === 'x64') return 'Linux-x86_64';
  throw new Error(`Unsupported sandbox platform: ${process.platform}/${process.arch}.`);
}

function protocolOf(binary) {
  try {
    const output = execFileSync(binary, ['--version'], { encoding: 'utf8' });
    const match = output.match(/\(protocol (\d+)\)/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

const packageJson = join(here, 'node_modules', 'near-sandbox', 'package.json');
if (!existsSync(packageJson)) throw new Error('Run npm install in apps/near-escrow/e2e first.');
const binary = join(dirname(packageJson), 'bin', 'near-sandbox');
if (protocolOf(binary) >= MIN_PROTOCOL) {
  console.log(`near-sandbox already supports protocol ${protocolOf(binary)}.`);
  process.exit(0);
}

const platform = platformPath();
const url = `https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/${platform}/${VERSION}/near-sandbox.tar.gz`;
const temporary = mkdtempSync(join(tmpdir(), 'proofgate-sandbox-'));
try {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Sandbox download failed: HTTP ${response.status} from ${url}`);
  const archive = join(temporary, 'near-sandbox.tar.gz');
  writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
  execFileSync('tar', ['-xzf', archive, '-C', temporary]);
  const extracted = join(temporary, platform, 'near-sandbox');
  if (!existsSync(extracted)) {
    throw new Error(`Archive did not contain ${platform}/near-sandbox (found: ${readdirSync(temporary).join(', ')}).`);
  }
  copyFileSync(extracted, binary);
  chmodSync(binary, 0o755);
  const protocol = protocolOf(binary);
  if (protocol < MIN_PROTOCOL) throw new Error(`Installed sandbox reports protocol ${protocol}, expected at least ${MIN_PROTOCOL}.`);
  console.log(`near-sandbox ${VERSION} installed (protocol ${protocol}).`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
