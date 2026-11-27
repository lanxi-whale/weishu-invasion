import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getVersionData } from '../game/server/data.js';
import { getVersionData as getAllianceData } from '../game_ops/server/data.js';
import { GameData } from '../game/server/match/gamedata.js';
import { SharedPool, bannedChessForBonds, drawDisabledBonds } from '../game/server/match/pool.js';
import { PlayerEconomy } from '../game/server/match/player/economy.js';
import { createRng } from '../game/server/sim/rng.js';
import { VERSIONS } from '../game/shared/versions.js';
import { enemyKeyOfChess } from '../game/server/match/monsterWave.js';
import { invasionReportOf } from '../bridge/invasion-report.js';

const regulation = 'act3autochess@V3_1';
const mode = 'mode_multi_normal';
const tierCounts = [18, 22, 44, 48, 39, 18];
const revisedTiers = {
  enemy_1112_emppnt: 6,
  enemy_10085_hllevi_2: 5,
  enemy_1017_defdrn: 4,
  enemy_1023_jmage: 3,
  enemy_1041_lazerd: 3,
  enemy_1040_bombd: 4,
  enemy_1104_lfkght_3: 6,
  enemy_1162_magmot: 5,
  enemy_1252_lysytb_2: 4,
  enemy_1254_lypa_2: 5,
  enemy_1119_vofsd: 5,
  enemy_9034_acblk: 5,
};

test('every installed invasion roster has six tiers with the same tier and price on both star forms', () => {
  for (const version of [undefined, ...VERSIONS.map(({ id }) => id)]) {
    const data = getVersionData(version);
    const counts = [0, 0, 0, 0, 0, 0];
    for (const [id, record] of Object.entries(data.chess)) {
      if (!id.startsWith('chess_mon_') || record.isGolden) continue;
      const elite = data.chess[record.goldenId];
      assert.equal(elite?.tier, record.tier, id);
      assert.equal(elite.price, record.price, id);
      assert.equal(record.price, Math.ceil(record.tier / 2) + 1, id);
      counts[record.tier - 1]++;
    }
    const artillery = data.chess.chess_mon_enemy_10122_uacann_2;
    assert.equal(artillery.tier, 4, version);
    assert.equal(artillery.price, 3, version);
    for (const [key, tier] of Object.entries(revisedTiers)) {
      assert.equal(data.chess[`chess_mon_${key}`]?.tier, tier, `${version}: ${key}`);
    }
    assert.deepEqual(counts, tierCounts, version);
  }
});

test('even-tier cards can be drawn at their own shop level, with the round-five elite gate', () => {
  const gd = new GameData(getVersionData(regulation), mode);
  const ids = ['chess_mon_enemy_1132_sarchn', 'chess_mon_enemy_10054_cjhot', 'chess_mon_enemy_1104_lfkght_3'];
  for (const [i, id] of ids.entries()) {
    const tier = (i + 1) * 2;
    const pool = new SharedPool(gd, { banned: gd.visibleChess.filter((other) => other !== id) });
    const roll = (level, round) => {
      const player = { gd, shop: { level }, diyRollEntries: () => [], m: { pool, round, rngShop: createRng(1) } };
      return PlayerEconomy.prototype._rollChessSlot.call(player)?.id ?? null;
    };
    assert.equal(gd.tierOf(id), tier, id);
    assert.equal(gd.shopCanRollChess(id, tier - 1, 5), false, id);
    assert.equal(roll(tier - 1, 5), null, id);
    assert.equal(roll(tier, 5), id);
    assert.equal(roll(tier, 4), tier === 2 ? id : null, id);
  }
  const artillery = 'chess_mon_enemy_10122_uacann_2';
  assert.ok(gd.visibleChess.includes(artillery));
  assert.equal(gd.shopCanRollChess(artillery, 3, 5), false);
  assert.equal(gd.shopCanRollChess(artillery, 4, 5), true);
});

test('the apprentice and Left Hand are separate recruits in the shop, battle, and both catalogues', () => {
  const apprenticeKey = 'enemy_1104_lfkght';
  const leftHandKey = 'enemy_1104_lfkght_3';
  const apprenticeId = 'chess_mon_' + apprenticeKey;
  const leftHandId = 'chess_mon_' + leftHandKey;
  for (const { id: version } of VERSIONS) {
    const raw = getVersionData(version);
    const gd = new GameData(raw, mode);
    const apprentice = gd.chess(apprenticeId);
    const leftHand = gd.chess(leftHandId);
    assert.ok(gd.visibleChess.includes(leftHandId), version);
    assert.deepEqual([apprentice.tier, apprentice.price], [4, 3]);
    assert.deepEqual([leftHand.tier, leftHand.price], [6, 4]);
    assert.deepEqual(apprentice.bonds, ['mon_minor_knight', 'mon_sub_reborn']);
    assert.deepEqual(leftHand.bonds, ['mon_minor_knight', 'mon_sub_reborn']);
    assert.deepEqual([leftHand.stats.maxHp, leftHand.stats.atk, leftHand.stats.def], [20000, 750, 700]);
    for (const [card, key] of [[apprentice, apprenticeKey], [leftHand, leftHandKey]]) {
      const golden = gd.chess(card.goldenId);
      assert.equal(card.baseId, card.chessId);
      assert.equal(card.upgradeChessId, golden.chessId);
      assert.equal(golden.baseId, card.chessId);
      assert.equal(golden.name, card.name);
      assert.deepEqual(golden.bonds, card.bonds);
      assert.equal(enemyKeyOfChess(card.chessId, gd), key);
      assert.equal(enemyKeyOfChess(golden.chessId, gd), key);
    }
    const golden = gd.chess(leftHand.goldenId);
    assert.deepEqual([golden.stats.maxHp, golden.stats.atk, golden.stats.def], [32000, 1200, 1120]);
    assert.ok(getAllianceData(version).enemies[leftHandKey]?.skills.length, version);
    assert.deepEqual(gd.enemy(leftHandKey), getAllianceData(version).enemies[leftHandKey]);
    const report = invasionReportOf(raw);
    for (const bondId of ['mon_minor_knight', 'mon_sub_reborn']) {
      const bond = report.find(entry => entry.bondId === bondId);
      assert.equal(bond.monsters.find(card => card.chessId === leftHandId)?.tier, 6, `${version} / ${bondId}`);
    }
  }
  const gallery = readFileSync(new URL('../怪物图鉴/data.js', import.meta.url), 'utf8').trim();
  const { groups } = JSON.parse(gallery.slice('window.MONSTERS = '.length, -1));
  const leftHand = groups.flatMap(group => group.items).find(item => item.id === leftHandKey);
  assert.equal(leftHand.variantOf, null);
  assert.equal(leftHand.recruit, true);
  assert.deepEqual(leftHand.minors, ['骑士团']);
  assert.deepEqual([leftHand.tier, leftHand.cost, leftHand.subs], [6, 4, ['复苏']]);
});

test('invasion covenant draws keep a playable opening and contain the new tiers', () => {
  const data = getVersionData(regulation);
  for (const modeId of [mode, 'mode_single_6']) {
    const gd = new GameData(data, modeId);
    for (let seed = 1; seed <= 40; seed++) {
      const rng = createRng(seed);
      const { drawn, staticOff, choice } = drawDisabledBonds(gd, rng);
      for (const off of choice?.groups ?? [[]]) {
        const banned = new Set(bannedChessForBonds(gd, [...drawn, ...off], staticOff, rng));
        const pool = gd.visibleChess.filter((id) => !banned.has(id));
        assert.ok(pool.some((id) => gd.tierOf(id) === 1 && gd.shopCanRollChess(id, 1, 1)), modeId + ' / ' + seed);
        for (const tier of [2, 4, 6]) {
          assert.ok(pool.some((id) => gd.tierOf(id) === tier && gd.shopCanRollChess(id, tier, 5)), modeId + ' / ' + seed + ' / ' + tier);
        }
      }
    }
  }
});
