import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function* nodes(node) {
  if (Array.isArray(node)) {
    for (const child of node) yield* nodes(child);
  } else if (node?.props) {
    yield node;
    yield* nodes(node.props.children);
  }
}

for (const [client, bondId, deployedId] of [
  ['game', 'mon_main_slug'],
  ['game', 'mon_main_decay', 'chess_mon_enemy_1425_lrcmra'],
  ['game_ops', 'victoriaShip'],
]) {
  test(`${client} ${bondId} popup shows all available members once and highlights deployed units`, async (context) => {
    context.mock.method(globalThis, 'fetch', async (url) => {
      const name = String(url).split('/').pop();
      try {
        const text = await readFile(new URL(`../${client}/data/${name}`, import.meta.url), 'utf8');
        return { ok: true, status: 200, json: async () => JSON.parse(text) };
      } catch {
        return { ok: false, status: 404 };
      }
    });
    const { data } = await import(`../${client}/public/js/data.js`);
    const { BondPopup } = await import(`../${client}/public/js/ui/bondStrip.js`);
    const { UnitThumb } = await import(`../${client}/public/js/ui/gameComponents.js`);
    await data.loadAll('chess', 'bonds');

    const bond = data.lookup('bonds', bondId);
    const ids = bond.visibleMembers ?? data.list('chess')
      .filter((record) => record.visible && !record.isGolden && record.bonds?.includes(bondId))
      .map((record) => record.chessId);
    assert.ok(ids.length >= 3);
    const deployed = deployedId ?? ids[0];
    assert.ok(ids.includes(deployed));
    const [banned, unowned] = ids.filter((id) => id !== deployed);
    const deployedElite = data.lookup('chess', deployed).goldenId;
    const priv = { board: [{ kind: 'chess', id: deployedElite }] };
    const open = (bannedIds) => [...nodes(BondPopup({ bondId, priv, banned: bannedIds, onClose() {}, onMember() {} }))];
    const portraits = (popup) => popup.filter((node) => node.type === UnitThumb);
    const popup = open([banned]);
    const shown = portraits(popup);
    assert.deepEqual(shown.map((node) => node.props.id).sort(), ids.filter((id) => id !== banned).sort());
    assert.equal(shown[0].props.id, deployed);
    assert.equal(shown[0].props.dim, false);
    assert.equal(shown.find((node) => node.props.id === unowned).props.dim, true);
    assert.ok(popup.some((node) => node.type === 'small' && node.props.children?.join?.('') === `1/${ids.length - 1}`));
    assert.deepEqual(portraits(open(ids)), [], 'a bond with no eligible members has no portraits');
  });
}
