// Envia a versão do PC (desenvolvimento) para a VPS (produção).
// Uso: npm run deploy            -> testa, envia, testa na VPS e religa se estava ligado
//      npm run deploy -- --ligar -> também liga o bot se estava desligado
// Nunca envia .env, dados/ nem node_modules: esses ficam só na VPS.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('..', import.meta.url));
const host = process.env.WIZARD_DEPLOY_HOST;
const args = new Set(process.argv.slice(2));
const SKIP = new Set(['__pycache__', 'node_modules']);

function run(cmd: string, argv: string[]) {
  const r = spawnSync(cmd, argv, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${cmd} falhou (${r.error?.message ?? 'código ' + r.status}).`);
}

export function listReleaseFiles(base: string): string[] {
  const entries = readFileSync(join(base, 'deploy', 'release-files.txt'), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const files: string[] = [];
  const walk = (abs: string) => {
    if (statSync(abs).isDirectory()) {
      for (const name of readdirSync(abs).sort()) if (!SKIP.has(name)) walk(join(abs, name));
    } else files.push(relative(base, abs).split(sep).join('/'));
  };
  for (const entry of entries) walk(join(base, entry));
  return files;
}

// Tar mínimo (ustar + cabeçalho PAX com o caminho em UTF-8), para não depender do tar do Windows.
function header(name: string, size: number, mode: number, type: string) {
  const h = Buffer.alloc(512);
  const put = (value: string, offset: number, len: number) => h.write(value, offset, len, 'utf8');
  const oct = (n: number, len: number) => n.toString(8).padStart(len - 1, '0') + '\0';
  put(name, 0, 100); put(oct(mode, 8), 100, 8); put(oct(0, 8), 108, 8); put(oct(0, 8), 116, 8);
  put(oct(size, 12), 124, 12); put(oct(Math.floor(Date.now() / 1000), 12), 136, 12);
  put('        ', 148, 8); put(type, 156, 1); put('ustar\u000000', 257, 8);
  let sum = 0; for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return h;
}
const pad = (n: number) => Buffer.alloc((512 - (n % 512)) % 512);
function paxPath(path: string) {
  const body = ` path=${path}\n`;
  let len = Buffer.byteLength(body) + 1;
  while (Buffer.byteLength(String(len) + body) !== len) len++;
  return Buffer.from(String(len) + body, 'utf8');
}
export function makeTarGz(entries: { path: string; data: Buffer; mode?: number }[]) {
  const parts: Buffer[] = [];
  entries.forEach((e, i) => {
    const pax = paxPath(e.path);
    parts.push(header(`PaxHeader/${i}`, pax.length, 0o644, 'x'), pax, pad(pax.length));
    parts.push(header(`f${i}`, e.data.length, e.mode ?? 0o644, '0'), e.data, pad(e.data.length));
  });
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}

function main() {
  if (!host) throw new Error('Defina WIZARD_DEPLOY_HOST no .env (ex.: root@IP-DA-VPS).');
  if (!args.has('--sem-testes')) {
    console.log('[deploy] Rodando os testes no PC...');
    run(process.execPath, ['--test', 'tests/*.test.ts']);
  }
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const release = `versao=${id}\nenviada_de=${hostname()}\n`;
  const files = listReleaseFiles(root);
  const tgz = makeTarGz([
    ...files.map(path => ({ path, data: readFileSync(join(root, path)), mode: path.endsWith('.sh') ? 0o755 : 0o644 })),
    { path: 'RELEASE', data: Buffer.from(release) },
  ]);
  const sha = createHash('sha256').update(tgz).digest('hex');
  const dir = mkdtempSync(join(tmpdir(), 'wizard-deploy-'));
  const local = join(dir, 'release.tgz');
  const remote = `/root/wizard-release-${id}.tgz`, staging = `/root/wizard-staging-${id}`;
  try {
    writeFileSync(local, tgz);
    console.log(`[deploy] Versão ${id}: ${files.length} arquivos, ${(tgz.length / 1024).toFixed(0)} KB. Enviando para ${host}...`);
    run('scp', ['-q', local, `${host}:${remote}`]);
    const ligar = args.has('--ligar') ? ' --ligar' : '';
    run('ssh', [host, `set -e; echo '${sha}  ${remote}' | sha256sum -c --quiet; mkdir -m 700 ${staging}; tar --no-same-owner -xzf ${remote} -C ${staging}; rm -f ${remote}; bash ${staging}/deploy/apply-release.sh ${staging}${ligar}`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try { main(); } catch (err) { console.error('[deploy] ' + (err as Error).message); process.exit(1); }
}
