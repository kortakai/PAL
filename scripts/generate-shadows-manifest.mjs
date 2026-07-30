import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_BASE_URL = 'https://aethro.net/launcher/shadows/stable/files';
const DEFAULT_MINECRAFT_VERSION = '1.21.1';
const DEFAULT_LOADER = 'fabric';
const DEFAULT_JAVA_MAJOR = 21;
const IGNORED_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

function usage() {
  console.log([
    'Usage:',
    '  node scripts/generate-shadows-manifest.mjs <sourceDir> [outputFile] [baseUrl]',
    '',
    'Example:',
    '  node scripts/generate-shadows-manifest.mjs /Users/paul/Documents/ShadowPackSource manifests/shadows-stable.json'
  ].join('\n'));
}

function toManifestPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function encodeUrlPath(relativePath) {
  return relativePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

async function walkFiles(rootDir, currentDir = rootDir) {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (IGNORED_NAMES.has(entry.name)) continue;

    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(rootDir, absolutePath));
      continue;
    }

    if (!entry.isFile()) continue;

    files.push({
      absolutePath,
      relativePath: toManifestPath(path.relative(rootDir, absolutePath))
    });
  }

  return files;
}

async function sha256File(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function buildManifest(sourceDir, baseUrl) {
  const rootDir = path.resolve(sourceDir);
  const rootStats = await stat(rootDir);
  if (!rootStats.isDirectory()) {
    throw new Error(`Source path is not a folder: ${rootDir}`);
  }

  const sourceFiles = (await walkFiles(rootDir)).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const files = [];

  for (const [index, file] of sourceFiles.entries()) {
    console.log(`[${index + 1}/${sourceFiles.length}] ${file.relativePath}`);
    const fileStats = await stat(file.absolutePath);
    files.push({
      path: file.relativePath,
      url: `${baseUrl.replace(/\/$/, '')}/${encodeUrlPath(file.relativePath)}`,
      sha256: await sha256File(file.absolutePath),
      sizeBytes: fileStats.size,
      required: true
    });
  }

  return {
    schemaVersion: 1,
    gameId: 'shadows',
    channel: 'stable',
    displayName: 'Shadows of Aethro',
    minecraft: {
      version: DEFAULT_MINECRAFT_VERSION,
      loader: DEFAULT_LOADER,
      javaMajor: DEFAULT_JAVA_MAJOR
    },
    files,
    removeExtraFilesUnder: ['mods'],
    launch: {
      jvmArgs: ['-Xmx6G', '-Xms2G'],
      gameArgs: ['--quickPlayMultiplayer', 'mc.aethro.net:25567']
    }
  };
}

const [, , sourceDir, outputFile = 'manifests/shadows-stable.json', baseUrl = DEFAULT_BASE_URL] = process.argv;

if (!sourceDir || sourceDir === '--help' || sourceDir === '-h') {
  usage();
  process.exit(sourceDir ? 0 : 1);
}

try {
  const manifest = await buildManifest(sourceDir, baseUrl);
  const outputPath = path.resolve(outputFile);
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const totalBytes = manifest.files.reduce((sum, file) => sum + file.sizeBytes, 0);
  console.log(`Wrote ${manifest.files.length} files to ${outputPath}`);
  console.log(`Total payload: ${(totalBytes / 1024 / 1024).toFixed(1)} MiB`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
