// Lea CLI - uses @getlea/web3
// Always prints JSON; supports -o/--outfile to save output.

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

// Import SDK from built bundle
// Note: expects this repo layout: lea_cli/ and dist/ at the same level
// If publishing separately, switch to consuming the package instead of a relative path.
import { SystemProgram, Connection } from '@getlea/web3';

// Base program (basePod) address key used in decoded result maps
const BASE_POD_HEX = '1111111111111111111111111111111111111111111111111111111111111111';

// --------------- Utilities ---------------
const isJsonPath = (p) => typeof p === 'string' && p.toLowerCase().endsWith('.json');

const toBigInt = (x) => {
  if (typeof x === 'bigint') return x;
  if (typeof x === 'number') return BigInt(x);
  if (typeof x === 'string') return BigInt(x.endsWith('n') ? x.slice(0, -1) : x);
  throw new Error(`Invalid amount: ${x}`);
};

const mapToObject = (m) => {
  const obj = Object.create(null);
  for (const [k, v] of m.entries()) obj[k] = v;
  return obj;
};

const serialize = (value) => {
  // Convert BigInt to string and Map to object recursively to make JSON-safe
  const seen = new WeakSet();
  const conv = (v) => {
    if (v === null || typeof v !== 'object') {
      if (typeof v === 'bigint') return v.toString();
      return v;
    }
    if (seen.has(v)) return '[Circular]';
    seen.add(v);
    // Convert TypedArray (e.g., Uint8Array) to plain number arrays for JSON
    if (ArrayBuffer.isView(v)) {
      // Treat DataView as a byte array as well
      if (v instanceof DataView) {
        return Array.from(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
      }
      return Array.from(v);
    }
    if (v instanceof Map) {
      const obj = {};
      for (const [k, val] of v.entries()) obj[k] = conv(val);
      return obj;
    }
    if (Array.isArray(v)) return v.map(conv);
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = conv(val);
    return out;
  };
  return conv(value);
};

async function readJson(filePath) {
  const data = await fs.readFile(filePath, 'utf8');
  return JSON.parse(data);
}

async function fetchPrevTxHashFromNetwork(connection, address) {
  try {
    const tx = await SystemProgram.getLastTxHash(address);
    const res = await connection.sendTransaction(tx);
    const exec = res?.executionStatus;
    const abort = res?.abortCode;
    // If there is no previous tx, backends may return non-ok or non-zero exec/abort.
    if (!res?.ok || (typeof exec === 'number' && exec !== 0) || (typeof abort === 'number' && abort !== 0)) {
      return undefined;
    }
    const decoded = res.decoded;
    // Decoded result is a Map keyed by program/contract id hex; for our
    // implementation, lastTxHash lives under the basePod program id.
    if (decoded && typeof decoded.get === 'function') {
      const baseEntry = decoded.get(BASE_POD_HEX);
      const last = baseEntry?.lastTxHash;
      if (last instanceof Uint8Array && last.length === 32) return last;
      if (Array.isArray(last) && last.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
        const bytes = new Uint8Array(last);
        if (bytes.length === 32) return bytes;
      }
    }
    return undefined;
  } catch (_) {
    // Network/transport error: treat as missing prev hash to allow first tx to proceed
    return undefined;
  }
}

async function buildWithPrevHash(connection, buildFn, args, signerAddress) {
  const prevTxHash = await fetchPrevTxHashFromNetwork(connection, signerAddress);
  return await buildFn(...args, prevTxHash ? { prevTxHash } : {});
}

async function resolveAddress(input) {
  if (!input) throw new Error('Address is required');
  if (isJsonPath(input)) {
    const j = await readJson(path.resolve(input));
    if (!j.address) throw new Error(`Keyfile '${input}' missing 'address'`);
    return String(j.address);
  }
  return String(input);
}

async function readSigner(keyfile) {
  if (!keyfile || !isJsonPath(keyfile)) throw new Error('A --key <path.json> is required');
  const j = await readJson(path.resolve(keyfile));
  if (!j.keyset || !j.address) throw new Error(`Keyfile '${keyfile}' must include 'keyset' and 'address'`);
  return { keyset: j.keyset, address: String(j.address) };
}

async function sendAndReport(connection, txObject, outfile, quiet = false) {
  try {
    const res = await connection.sendTransaction(txObject);
    // Brief status line to stderr for troubleshooting
    if (!quiet) {
      process.stderr.write(
        `[lea] ok=${res.ok} status=${res.status} txId=${res.txId ?? ''} exec=${res.executionStatus ?? ''} abort=${res.abortCode ?? ''}\n`
      );
    }
    // Only print the decoded response as JSON
    const decodedOnly = serialize(res.decoded);
    const jsonStr = JSON.stringify(decodedOnly);
    if (outfile) {
      await fs.writeFile(path.resolve(outfile), jsonStr + '\n', 'utf8');
    }
    process.stdout.write(jsonStr + '\n');
    if (!res.ok) process.exitCode = 1;
  } catch (e) {
    const errMsg = String(e?.message || e);
    if (!quiet) process.stderr.write(`[lea] error: ${errMsg}\n`);
    const errOut = { error: errMsg };
    const jsonStr = JSON.stringify(errOut);
    if (outfile) await fs.writeFile(path.resolve(outfile), jsonStr + '\n', 'utf8');
    process.stdout.write(jsonStr + '\n');
    process.exitCode = 1;
  }
}

// --------------- Argument parsing ---------------
function parseArgs(argv) {
  const args = [...argv];
  let command = null;
  if (args.length > 0 && !args[0].startsWith('-')) {
    command = args.shift();
  }
  const opts = { cluster: 'mainnet-beta', outfile: null };
  while (args.length) {
    const a = args.shift();
    switch (a) {
      case '--cluster':
        opts.cluster = args.shift();
        break;
      case '--key':
        opts.key = args.shift();
        break;
      case '--to':
        opts.to = args.shift();
        break;
      case '--amount':
        opts.amount = args.shift();
        break;
      case '--address':
        opts.address = args.shift();
        break;
      case '--quiet':
        opts.quiet = true;
        break;
      case '-o':
      case '--outfile':
        opts.outfile = args.shift();
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        // Positional fallback: if no command yet, treat it as command; else ignore
        if (!command) command = a;
        break;
    }
  }
  return { command, opts };
}

function helpText() {
  return [
    'Usage: lea <command> [options]',
    '',
    'Global options:',
    '  --cluster <name|URL>   devnet|testnet|mainnet-beta|local|URL (default mainnet-beta)',
    '  -o, --outfile <path>   Write JSON result to a file (also printed to stdout)',
    '  --quiet                 Suppress stderr status line',
    '',
    'Output:',
    '  - stdout: decoded response as JSON only',
    '  - stderr: status line (ok, HTTP status, txId, exec, abort)',
    '',
    'Commands:',
    '  keygen                 Run the @getlea/keygen CLI (proxy)',
    '  publish-keyset         --key keyfile.json',
    '  mint                   --key minter.json --to <address|keyfile.json> --amount <uLEA>',
    '  transfer               --key sender.json --to <address|keyfile.json> --amount <uLEA>',
    '  burn                   --key account.json --amount <uLEA>',
    '  get-balance            --address <address|keyfile.json>',
    '  get-last-tx-hash       --address <address|keyfile.json>',
    '  get-allowed-mint       --address <address|keyfile.json>',
    '  get-current-supply',
    '  mint-whitelist         --key authority.json --to <address|keyfile.json> --amount <uLEA>'
  ].join('\n');
}

// --------------- Command handlers ---------------
async function main() {
  const argv = process.argv.slice(2);

  // Fast-path: proxy `lea keygen ...` to @getlea/keygen
  if (argv[0] === 'keygen') {
    const forward = argv.slice(1);
    await runKeygen(forward);
    return;
  }

  const { command, opts } = parseArgs(argv);
  if (!command || opts.help) {
    process.stdout.write(helpText() + '\n');
    return;
  }

  const connection = Connection(opts.cluster || 'mainnet-beta');

  try {
    switch (command) {
      case 'publish-keyset': {
        const signer = await readSigner(opts.key);
        const tx = await buildWithPrevHash(connection, SystemProgram.publishKeyset, [signer], signer.address);
        await sendAndReport(connection, tx, opts.outfile, opts.quiet);
        break;
      }
      case 'mint': {
        const signer = await readSigner(opts.key);
        const toAddr = await resolveAddress(opts.to);
        const amount = toBigInt(opts.amount);
        const tx = await buildWithPrevHash(connection, SystemProgram.mint, [signer, toAddr, amount], signer.address);
        await sendAndReport(connection, tx, opts.outfile, opts.quiet);
        break;
      }
      case 'transfer': {
        const signer = await readSigner(opts.key);
        const toAddr = await resolveAddress(opts.to);
        const amount = toBigInt(opts.amount);
        const tx = await buildWithPrevHash(connection, SystemProgram.transfer, [signer, toAddr, amount], signer.address);
        await sendAndReport(connection, tx, opts.outfile, opts.quiet);
        break;
      }
      case 'burn': {
        const signer = await readSigner(opts.key);
        const amount = toBigInt(opts.amount);
        const tx = await buildWithPrevHash(connection, SystemProgram.burn, [signer, amount], signer.address);
        await sendAndReport(connection, tx, opts.outfile, opts.quiet);
        break;
      }
      case 'get-balance': {
        const addr = await resolveAddress(opts.address);
        const tx = await SystemProgram.getBalance(addr);
        await sendAndReport(connection, tx, opts.outfile, opts.quiet);
        break;
      }
      case 'get-last-tx-hash': {
        const addr = await resolveAddress(opts.address);
        const tx = await SystemProgram.getLastTxHash(addr);
        await sendAndReport(connection, tx, opts.outfile, opts.quiet);
        break;
      }
      case 'get-allowed-mint': {
        const addr = await resolveAddress(opts.address);
        const tx = await SystemProgram.getAllowedMint(addr);
        await sendAndReport(connection, tx, opts.outfile, opts.quiet);
        break;
      }
      case 'get-current-supply': {
        const tx = await SystemProgram.getCurrentSupply();
        await sendAndReport(connection, tx, opts.outfile, opts.quiet);
        break;
      }
      case 'mint-whitelist': {
        const signer = await readSigner(opts.key);
        const toAddr = await resolveAddress(opts.to);
        const amount = toBigInt(opts.amount);
        const tx = await buildWithPrevHash(connection, SystemProgram.mintWhitelist, [signer, toAddr, amount], signer.address);
        await sendAndReport(connection, tx, opts.outfile, opts.quiet);
        break;
      }
      default: {
        process.stderr.write(`Unknown command: ${command}\n\n`);
        process.stdout.write(helpText() + '\n');
        process.exitCode = 1;
      }
    }
  } catch (err) {
    const out = { error: String(err?.message || err) };
    if (opts.outfile) await fs.writeFile(path.resolve(opts.outfile), JSON.stringify(out) + '\n', 'utf8');
    process.stdout.write(JSON.stringify(out) + '\n');
    process.exitCode = 1;
  }
}

main();

// --------------- Keygen proxy ---------------
async function runKeygen(args) {
  const require = createRequire(import.meta.url);
  // Try to resolve installed dependency path first
  try {
    const pkgPath = require.resolve('@getlea/keygen/package.json');
    const keygenPkg = require(pkgPath);
    const binField = keygenPkg?.bin;
    let relBin = null;
    if (typeof binField === 'string') relBin = binField;
    else if (binField && typeof binField === 'object') relBin = binField['lea-keygen'] || Object.values(binField)[0];
    if (relBin) {
      const binPath = path.resolve(path.dirname(pkgPath), relBin);
      // Execute the resolved CLI with Node directly (no shell needed)
      await spawnAndWait(process.execPath, [binPath, ...args], { shell: false });
      return;
    }
  } catch (_) {
    // fallthrough
  }

  // Fallback: try PATH-resolved binary
  try {
    const cmd = process.platform === 'win32' ? 'lea-keygen.cmd' : 'lea-keygen';
    // On Windows, .cmd wrappers are more reliable via a shell
    await spawnAndWait(cmd, args, { shell: process.platform === 'win32' });
    return;
  } catch (_) {
    // fallthrough
  }

  // Last resort: use npx to fetch/run it
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  await spawnAndWait(npxCmd, ['-y', '@getlea/keygen', ...args], { shell: process.platform === 'win32' });
}

function spawnAndWait(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', windowsHide: true, ...options });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (typeof code === 'number') {
        if (code !== 0) process.exitCode = code;
        resolve();
      } else {
        reject(new Error(`Process terminated with signal ${signal || 'UNKNOWN'}`));
      }
    });
  });
}
