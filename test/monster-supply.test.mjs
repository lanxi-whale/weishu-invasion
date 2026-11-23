import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData } from '../game/server/data.js';
import { GameData } from '../game/server/match/gamedata.js';
import { generateDraft } from '../game/server/match/choices.js';
import { createRng } from '../game/server/sim/rng.js';
import { makeMatch } from '../game/test/match/harness.js';
import { resolveSpCard } from '../game/public/js/ui/choiceOverlay.js';

test('invasion bonuses replace bounty and equipment drafts across versions and modes', () => {
  let replaced = 0, kept = 0;
  for (const version of [undefined, 'act1autochess', 'act1autochess@V1_1', 'act2autochess@V2_1', 'act3autochess@V3_1']) {
    const data = getVersionData(version);
    for (const mode of Object.keys(data.config.modes)) {
      const monster = new GameData(data, mode);
      const original = new GameData({ ...data, config: { ...data.config, monsterOnly: false } }, mode);
      for (const round of monster.spRounds()) for (let seed = 1; seed <= 3; seed++) {
        const expected = generateDraft(original, createRng(seed), round);
        const actual = generateDraft(monster, createRng(seed), round);
        if (['bounty', 'supply', 'shop'].includes(expected?.family)) {
          assert.equal(actual?.family, 'invasion', `${version} ${mode} R${round}`);
          assert.equal(actual.cards.length, monster.isSolo ? 3 : 6);
          assert.ok(actual.cards.every(card => card.kind === 'invasion'));
          assert.equal(new Set(actual.cards.map(card => card.id)).size, actual.cards.length);
          replaced++;
        } else if (actual?.family === 'tactic') {
          for (const card of actual.cards) {
            const buffs = monster.effect(card.id).buffs;
            assert.ok(buffs.every(buff => !['global_special_choice_gain_equip', 'single_special_choice_gloden_equip_chess'].includes(buff.key)), card.name);
          }
          kept++;
        }
      }
    }
  }
  assert.ok(replaced > 0);
  assert.ok(kept > 0);
});

for (const { mode, modeId, round, bots } of [
  { mode: 'coop', modeId: 'mode_multi_hard', round: 3, bots: 3 },
  { mode: 'solo', modeId: 'mode_single_6', round: 6, bots: 0 },
]) {
  test(`regulation ${mode} round ${round} applies invasion bonuses before prep`, () => {
    const h = makeMatch({ mode, modeId, bots, aiPicksLast: true, data: getVersionData('act3autochess@V3_1') });
    try {
      h.autoHumans().start().runToPhase('PREP', 1);
      const ps = h.m.order[0];
      ps.autoplay = false;
      h.m.startRound(round);
      h.runToPhase('SP_DRAFT', round);
      assert.equal(h.m.sp.family, 'invasion');
      const { cards } = h.m.publicView().sp;
      const card = cards[0];
      const resolved = resolveSpCard(card, 'invasion');
      assert.equal(resolved.kind, 'invasion');
      assert.equal(resolved.name, card.name);
      assert.equal(resolved.desc, card.desc);
      const before = [ps.funds, ps.shop.freeRefreshes, ps.nextInvasionExtraMembers, { ...ps.invasionStatBonus }];
      assert.equal(h.m.pickCard(ps, card.idx).ok, true);
      assert.notDeepEqual([ps.funds, ps.shop.freeRefreshes, ps.nextInvasionExtraMembers, { ...ps.invasionStatBonus }], before);
      h.runToPhase('PREP', round);
      for (const player of h.m.order) {
        assert.deepEqual(player.bounties, []);
        assert.deepEqual(player.itemCards(), []);
        assert.ok(player.shop.slots.every(slot => !slot || slot.kind === 'chess'));
      }
    } finally { h.m.dispose(); }
  });
}

test('the invasion equipment pool denies real item ids at acquisition, purchase and reward', () => {
  const data = getVersionData('act3autochess@V3_1');
  const h = makeMatch({ mode: 'solo', modeId: 'mode_single_6', data });
  try {
    h.autoHumans().start().runToPhase('PREP', 1);
    const ps = h.m.order[0];
    ps.autoplay = false;
    const item = Object.values(data.items).find(record => record.itemType === 'EQUIP' && !record.isGolden);
    assert.ok(item);
    assert.equal(h.m.itemPool.canGain(item.id), false);
    assert.equal(h.m.rollItemId(), null);
    assert.equal(ps.acquireItem(item.id, { source: 'reward' }), null);
    assert.equal(h.m.addBounty(ps, data.choices.cards.bounty[0]), null);
    assert.ok(ps.shop.slots.every(slot => !slot || slot.kind === 'chess'));
    assert.ok(ps.offers.every(offer => offer.slots.every(slot => slot.kind === 'chess')));

    const slot = { kind: 'item', id: item.id, basePrice: 1, price: 1, sold: false };
    ps.shop.slots[0] = slot;
    ps.offers.unshift({ slots: [slot] });
    const funds = ps.funds;
    assert.equal(ps.buy(0).error, 'BAD_TARGET');
    assert.equal(ps.pickReward(0).error, 'BAD_TARGET');
    assert.equal(ps.funds, funds);
    assert.equal(slot.sold, false);
    assert.deepEqual(ps.itemCards(), []);
  } finally { h.m.dispose(); }
});
