// Build from a local official client, then reapply the established 4v4 overlays.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const local = path.join(root, 'local-client-data');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const write = (p, v) => fs.writeFileSync(p, JSON.stringify(v));
const manifest = read(path.join(local, 'manifest.json'));
const python = process.env.SP_PYTHON || 'python';
const slug = 'versions/act3autochess-v3_1';
const run = (exe, args, cwd = root) => execFileSync(exe, args, { cwd, stdio: 'inherit' });
run(process.execPath, ['tools/build-data.mjs', '--version', 'act3autochess@V3_1', '--offline',
  '--client-data', path.join(local, 'gamedata'), '--out', path.join(local, 'built'),
  '--report', path.join(local, 'build-report.json'), '--quiet'], path.join(root, 'game_ops'));
const report = read(path.join(local, 'build-report.json'));
if (report.errors?.length) throw new Error('Official data integrity check failed');
const built = path.join(local, 'built');
const files = fs.readdirSync(built).filter((f) => f.endsWith('.json'));
const source = {
  kind: 'local-client', version: manifest.version, schemaRevision: manifest.schemaRevision,
  tables: Object.fromEntries(manifest.assets.filter((a) => !a.name.startsWith('level_')).map((a) => [a.name,
    crypto.createHash('sha256').update(fs.readFileSync(path.join(local, `${a.name}.bytes`))).digest('hex')])),
};
// Preserve the monster's distinct prep stage geometry; setup-official-maps adds its matching arena aliases.
for (const camp of ['game_ops', 'game']) {
  const target = path.join(root, camp, 'data', slug);
  const backup = path.join(local, 'backup', manifest.version, camp);
  fs.mkdirSync(backup, { recursive: true });
  const old = Object.fromEntries(files.map((f) => [f, read(path.join(target, f))]));
  for (const f of files) {
    const saved = path.join(backup, f);
    if (!fs.existsSync(saved)) fs.copyFileSync(path.join(target, f), saved);
  }
  for (const f of files) {
    const value = read(path.join(built, f));
    if (camp === 'game' && f === 'stages.json') continue;
    if (camp === 'game' && (f === 'chess.json' || f === 'bonds.json')) {
      const prefix = f === 'chess.json' ? 'chess_mon_' : 'mon_';
      Object.assign(value, Object.fromEntries(Object.entries(old[f]).filter(([k]) => k.startsWith(prefix))));
    }
    if (f === 'config.json') {
      value.officialData = source;
      if (camp === 'game') value.monsterOnly = true;
    }
    write(path.join(target, f), value);
  }
}
run(python, ['gen_game_monsters.py', '--official-enemies', path.join(built, 'enemies.json'),
  '--target', path.join(root, 'game/data', slug)]);
run(process.execPath, ['setup-official-maps.mjs']);
console.log(`Installed official client ${source.version}; ${report.counts.chess} operator forms, ${report.counts.enemies} enemies, ten maps.`);
