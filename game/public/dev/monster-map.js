// Exercise the real renderer's two successive stage assignments, as MatchScreen does.
import { createFieldView } from '../js/render/app.js';
import { fieldStage } from '../js/render/app/view.js';
import { data } from '../js/data.js';
import { assets } from '../js/assets.js';
import { GEO } from '/shared/constants.js';

await data.loadAll('chess', 'tokens', 'items', 'enemies', 'stages', 'bonds', 'config');
await assets.ready();
const view = await createFieldView(document.getElementById('field'), { data, assets, board: '3d' });
const maps = data.get('config').mapRotation;
const select = document.getElementById('map');
for (const id of maps) select.add(new Option(id, id));
select.value = 'act3autochess_m05';
const stages = { stage: (id) => data.lookup('stages', id) };
let phase = 'prep';
function prep() {
  phase = 'prep';
  view.setStage(stages.stage(select.value));
  view.setPrep({ board: [], hand: [], temp: [] }, { editable: false });
  view.setCamera('prep', { rect: GEO.FIELD, instant: true });
}
function combat() {
  phase = 'combat';
  const meta = { fieldId: 'map-regression', kind: 'normal', stageId: select.value,
    rect: { r0: 9, r1: 12, c0: 0, c1: 10 }, units: [] };
  view.setStage(fieldStage(stages, meta));
  view.enterBattle(meta);
  view.setCamera('normal', { rect: meta.rect, instant: true });
}
document.getElementById('prep').onclick = prep;
document.getElementById('combat').onclick = combat;
select.onchange = () => phase === 'prep' ? prep() : combat();
setInterval(() => {
  const board = view.debug.board3d;
  document.getElementById('status').textContent = `${phase} | stage: ${board?.stage?.id || '-'} | scene: ${board?.official?.stage || '-'}`;
}, 250);
prep();
