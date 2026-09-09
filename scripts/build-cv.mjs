import { spawnSync } from 'node:child_process';
import { access, chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const version = '0.17.0';
const targets = {
  'win32-x64': 'x86_64-pc-windows-msvc.zip',
  'linux-x64': 'x86_64-unknown-linux-musl.tar.gz',
  'linux-arm64': 'aarch64-unknown-linux-musl.tar.gz',
  'darwin-x64': 'x86_64-apple-darwin.tar.gz',
  'darwin-arm64': 'aarch64-apple-darwin.tar.gz',
};
const platform = `${process.platform}-${process.arch}`;
const cache = join(root, '.astro', 'cv-tools', `${version}-${platform}`);
const output = join(root, '.astro', 'cv-build');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status}).`);
}

async function compiler() {
  // An explicit override also supports platforms without a prebuilt release.
  if (process.env.TECTONIC_PATH) return process.env.TECTONIC_PATH;
  const target = targets[platform];
  if (!target) throw new Error(`Unsupported platform ${platform}. Set TECTONIC_PATH to a Tectonic executable.`);
  const executable = join(cache, process.platform === 'win32' ? 'tectonic.exe' : 'tectonic');
  try {
    await access(executable);
    return executable;
  } catch {
    // Keep the compiler in Astro's ignored cache, outside the deployed assets.
  }
  await mkdir(cache, { recursive: true });
  const archive = `tectonic-${version}-${target}`;
  const url = `https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${version}/${archive}`;
  console.log(`[cv] Downloading Tectonic ${version} for ${platform}...`);
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Compiler download failed: HTTP ${response.status}`);
  const archivePath = join(cache, archive);
  await writeFile(archivePath, Buffer.from(await response.arrayBuffer()));
  // Windows includes bsdtar, which also extracts ZIP archives.
  run('tar', ['-xf', archivePath, '-C', cache]);
  await access(executable);
  if (process.platform !== 'win32') await chmod(executable, 0o755);
  return executable;
}

try {
  await access(join(root, 'cv.txt'));
  const executable = await compiler();
  await mkdir(output, { recursive: true });
  console.log('[cv] Compiling cv.txt...');
  run(executable, ['--untrusted', '--outdir', output, join(root, 'cv.txt')]);
  const pdf = join(output, 'cv.pdf');
  if (!(await readFile(pdf)).subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new Error('Compiler output is not a PDF.');
  }
  await mkdir(join(root, 'public'), { recursive: true });
  await copyFile(pdf, join(root, 'public', 'cv.pdf'));
  console.log('[cv] Generated public/cv.pdf');
} catch (error) {
  console.error(`[cv] ${error.message}`);
  process.exitCode = 1;
}
