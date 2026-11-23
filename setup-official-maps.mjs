// Reapply after rebuilding version data. Scene geometry is decoded separately by
// game/tools/local-extract; this only installs the matching official tile layouts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
const sourceDir = path.join(root, 'game_ops/data/versions/act3autochess-v3_1');
const official = read(path.join(sourceDir, 'stages.json'));
const pens = read(path.join(root, 'game/data/versions/act3autochess-v3_1/stages.json'));
const ids = Object.keys(official).filter((id) => /^act3autochess_m\d+$/.test(id)).sort();
if (ids.length !== 10) throw new Error('Expected ten official regulation maps');

for (const camp of ['game', 'game_ops']) {
  const data = path.join(root, camp, 'data');
  const dirs = [data, ...fs.readdirSync(path.join(data, 'versions'), { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => path.join(data, 'versions', d.name))];
  for (const dir of dirs) {
    const stageFile = path.join(dir, 'stages.json');
    const configFile = path.join(dir, 'config.json');
    if (!fs.existsSync(stageFile) || !fs.existsSync(configFile)) continue;
    const stages = read(stageFile), config = read(configFile);
    for (const id of ids) {
      if (camp === 'game') {
        // The monster preparation grid is a separate deployment area. Do not put
        // the operator arena's meshes under its different tile coordinates.
        stages[id] = { ...pens[id], id, sceneId: null };
        stages[`arena_${id}`] = { ...official[id], id: `arena_${id}`, sceneId: id };
      } else stages[id] = official[id];
    }
    config.mapRotation = ids;
    // The lobby reads each mode's list for the fixed/random map description too.
    for (const mode of Object.values(config.modes || {})) mode.stages = [...ids];
    write(stageFile, stages);
    write(configFile, config);
    console.log(`${camp}/${path.relative(data, dir) || '.'}: ${ids.length} official maps`);
  }
}

// Both servers serve the same locally decoded resources at their own origin.
const src = path.join(root, 'game/public/assets/local');
const dst = path.join(root, 'game_ops/public/assets/local');
const manifestFile = path.join(root, 'game/data/local-assets.json');
if (fs.existsSync(manifestFile)) {
  const manifest = read(manifestFile);
  const outFile = path.join(root, 'game_ops/data/local-assets.json');
  const target = fs.existsSync(outFile) ? read(outFile) : { version: 1, source: 'local-client', groups: {} };
  for (const [group, entries] of Object.entries(manifest.groups)) {
    if (!/^(scene|map|mesh)\//.test(group)) continue;
    for (const record of Object.values(entries)) {
      if (!record.path?.startsWith('/assets/local/')) continue;
      const rel = record.path.slice('/assets/local/'.length);
      const dest = path.join(dst, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(src, rel), dest);
    }
    target.groups[group] = entries;
  }
  target.count = Object.values(target.groups).reduce((n, entries) => n + Object.keys(entries).length, 0);
  write(outFile, target);
  console.log('Official map resources installed for both camps');
}
