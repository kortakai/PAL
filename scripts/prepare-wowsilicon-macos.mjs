import { createReadStream, createWriteStream, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';

const version = '3.2.2';
const commit = '5276d92';
const sourceArchiveRoot = 'WoWSilicon-5276d92627f26334f6580270eabadf22361d3717';
const appDmgUrl = `https://github.com/WoWSilicon/WoWSilicon/releases/download/v${version}/WoWSilicon-${version}.dmg`;
const sourceUrl = `https://github.com/WoWSilicon/WoWSilicon/archive/${commit}.tar.gz`;
const appDmgSha256 = '53771ef7595371cdd31db1a1269df481750c4e33f479ad862bb94376427d894c';
const sourceSha256 = '3f2b76f0dfe6e0070ab61a705fb77ee70df70607ae76c795406fb306f5656674';
const projectRoot = resolve(import.meta.dirname, '..');
const resourceRoot = join(projectRoot, 'src-tauri', 'resources', 'wowsilicon');

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('The bundled WoWSilicon runtime is built only on Apple Silicon macOS.');
}

async function sha256(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

async function download(url, destination, expectedHash) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Unable to download ${url}: HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
  const actualHash = await sha256(destination);
  if (actualHash !== expectedHash) {
    throw new Error(`SHA-256 mismatch for ${url}: got ${actualHash}`);
  }
}

const tempRoot = mkdtempSync(join(tmpdir(), 'aethro-wowsilicon-'));
const dmgPath = join(tempRoot, `WoWSilicon-${version}.dmg`);
const sourcePath = join(tempRoot, `WoWSilicon-${commit}.tar.gz`);
const mountPath = join(tempRoot, 'mounted');
const stagingRoot = join(tempRoot, 'resources');
const mountAttached = { value: false };

try {
  mkdirSync(mountPath);
  mkdirSync(stagingRoot);
  console.log(`Downloading WoWSilicon ${version} and verifying the upstream release digest…`);
  await download(appDmgUrl, dmgPath, appDmgSha256);
  await download(sourceUrl, sourcePath, sourceSha256);

  execFileSync('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mountPath, dmgPath], { stdio: 'inherit' });
  mountAttached.value = true;

  const upstreamApp = join(mountPath, 'WoWSilicon.app');
  const stagedApp = join(stagingRoot, 'WoWSilicon.app');
  execFileSync('/usr/bin/ditto', [upstreamApp, stagedApp]);
  const stagedSource = join(stagingRoot, `WoWSilicon-${version}-source.tar.gz`);
  execFileSync('/bin/cp', [sourcePath, stagedSource]);
  const license = execFileSync('/usr/bin/tar', ['-xOf', sourcePath, `${sourceArchiveRoot}/LICENSE`]);
  writeFileSync(join(stagingRoot, 'WoWSilicon-GPL-3.0.txt'), license);

  execFileSync('/usr/bin/hdiutil', ['detach', mountPath, '-quiet']);
  mountAttached.value = false;

  mkdirSync(dirname(resourceRoot), { recursive: true });
  rmSync(resourceRoot, { recursive: true, force: true });
  renameSync(stagingRoot, resourceRoot);
  console.log(`Prepared bundled WoWSilicon ${version} and corresponding GPL source at ${resourceRoot}`);
} finally {
  if (mountAttached.value) {
    try { execFileSync('/usr/bin/hdiutil', ['detach', mountPath, '-quiet']); } catch {}
  }
  rmSync(tempRoot, { recursive: true, force: true });
}
