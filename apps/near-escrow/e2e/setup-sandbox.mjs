import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = process.env.NEAR_SANDBOX_VERSION || '2.14.0';
const MIN_PROTOCOL = 88;
// Known-good SHA-256 digests of the official nearcore sandbox tarballs,
// computed from the same URLs used below. An entry is verified by default;
// NEAR_SANDBOX_SHA256 overrides the pin (e.g. for a newer version), and an
// unknown version without the override only warns.
const PINNED_SHA256 = {
  'Darwin-arm64/2.14.0': 'ea53448ef97540c012e5c3d967c74d78292b0465a98cf7027811a936718fe232',
};
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
  const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
  const pin = process.env.NEAR_SANDBOX_SHA256 || PINNED_SHA256[`${platform}/${VERSION}`];
  if (pin) {
    if (digest !== pin.toLowerCase()) {
      throw new Error(`Sandbox archive checksum mismatch: got ${digest}, expected ${pin.toLowerCase()}. Refusing to install.`);
    }
    console.log(`sandbox archive sha256 verified: ${digest}`);
  } else {
    console.warn(`warning: no SHA-256 pin for ${platform}/${VERSION}; downloaded sha256 is ${digest}. Set NEAR_SANDBOX_SHA256 to pin it.`);
  }
  execFileSync('tar', ['-xzf', archive, '-C', temporary]);
  const extracted = join(temporary, platform, 'near-sandbox');
  if (!existsSync(extracted)) {
    throw new Error(`Archive did not contain ${platform}/near-sandbox (found: ${readdirSync(temporary).join(', ')}).`);
  }
  mkdirSync(dirname(binary), { recursive: true });
  copyFileSync(extracted, binary);
  chmodSync(binary, 0o755);
  const protocol = protocolOf(binary);
  if (protocol < MIN_PROTOCOL) throw new Error(`Installed sandbox reports protocol ${protocol}, expected at least ${MIN_PROTOCOL}.`);
  console.log(`near-sandbox ${VERSION} installed (protocol ${protocol}).`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
