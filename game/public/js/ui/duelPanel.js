import { useEffect, useState } from '../../vendor/hooks.module.js';
import { PHASE } from '../../../shared/constants.js';
import { t } from '../../../shared/i18n.js';
import { data } from '../data.js';
import { html, Button, Icon, Modal, Tabs } from './components.js';
import { Img } from './gameComponents.js';
import { bandIconUrl, bondIconUrl, chessAvatarUrl, enemyIconUrl, tokenAvatarUrl } from './assetUrls.js';
import { EmoteBubble } from './emotes.js';

const initials = name => [...(name || '')][0] || '?';
const tiers = ['', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ'];

function PlayerFace({ player, camp, ready = false }) {
  const assets = data.get('assets');
  const fallback = player?.isBot ? html`<${Icon} name="robot" />` : initials(player?.name);
  const src = enemyIconUrl(assets, player?.leaderKey) || bandIconUrl(assets, player?.bandId);
  return html`<span class=${`duel-face duel-face--${camp}`}>
    <${Img} src=${src} fallback=${fallback} />
    ${player?.isBot ? html`<small class="duel-face__ai">AI</small>` : null}
    ${ready && player?.ready ? html`<span class="duel-face__ready" title=${t('已就绪')}><${Icon} name="check" /></span>` : null}
  </span>`;
}

function FormationUnit({ unit }) {
  const assets = data.get('assets');
  const src = (unit.kind === 'token' && tokenAvatarUrl(assets, unit.defId))
    || enemyIconUrl(assets, unit.avatar) || enemyIconUrl(assets, unit.spine)
    || chessAvatarUrl(assets, { assets: { avatar: unit.avatar }, isGolden: unit.golden });
  return html`<span class=${`duel-unit${unit.golden ? ' is-golden' : ''}`} title=${unit.name}>
    <${Img} src=${src || null} alt=${unit.name} fallback=${html`<span aria-label=${unit.name}>${initials(unit.name)}</span>`} />
    ${tiers[unit.tier] ? html`<small class="duel-unit__tier">${tiers[unit.tier]}</small>` : null}
  </span>`;
}

export function duelScoutField(player, map) {
  if (!player?.formation || !map) return null;
  const { formation, playerId } = player;
  const { stage, rect } = map;
  const overrides = formation.devices ?? {};
  const devices = (stage.devices || []).map(device => Object.hasOwn(overrides, device.alias)
    ? { ...device, active: overrides[device.alias] } : device);
  const melee = [];
  const rangedOnly = [];
  for (const [row, col, kind] of formation.tiles) (kind === 'melee' ? melee : rangedOnly).push([row, col]);
  return {
    fieldId: `duel-scout:${playerId}`, stageId: stage.id, prep: true, kind: 'normal', rect,
    stage: { ...stage, devices, deployTiles: { normal: { melee, rangedOnly } } },
    nextEnemies: [],
    units: formation.units.map(unit => ({ ...unit, ownerId: playerId, area: 'board', side: 'ally' })),
  };
}

/** Both seats of an individual pairing watch the same field. An explicit pick supplies the bond owner. */
export function duelBattleOwner(pub, field, who) {
  if (!pub?.duelMatchups || !field || field.prep) return null;
  const selectedId = who?.fieldId === field.fieldId ? who.playerId : null;
  if (field.kind === 'unite') {
    if (!selectedId) return null;
    for (const { attacker, defender } of pub.duelMatchups) {
      if (attacker?.playerId === selectedId) return { player: attacker, camp: 'monster' };
      if (defender?.playerId === selectedId) return { player: defender, camp: 'ops' };
    }
    return null;
  }
  const lane = pub.duelMatchups.find(entry => entry.fieldId === field.fieldId);
  if (!lane) return null;
  if (selectedId && lane.attacker?.playerId === selectedId) return { player: lane.attacker, camp: 'monster' };
  return lane.defender ? { player: lane.defender, camp: 'ops' } : null;
}

function CampRoster({ players, camp, myId, selectedSeat, inPrep, canInspect, onSelect }) {
  const assets = data.get('assets');
  return html`<div class="duel-roster">
    <div class="duel-roster__head"><span>${t('玩家')}</span><span>${t('羁绊')}</span><span>${t('上场单位')}</span></div>
    ${players.map((row) => {
      const { seat, player } = row;
      const formation = player?.formation;
      const name = player?.name || `P${seat + 1}`;
      const inspect = inPrep ? t('查看 {name} 的布阵', { name }) : t('查看 {name} 的战场', { name });
      const activeBonds = formation?.bonds.filter(bond => bond.active) ?? [];
      return html`<div key=${seat} class=${`duel-roster__row${seat === selectedSeat ? ' is-selected' : ''}`}>
        <div class="duel-roster__player">
          <button type="button" class="duel-roster__face" disabled=${!canInspect(row)}
              aria-label=${inspect} title=${inspect} onClick=${() => onSelect(row)}>
            <${PlayerFace} player=${player} camp=${camp} />
            <span class="duel-roster__search"><${Icon} name="search" /></span>
          </button>
          <span class="duel-roster__name" title=${name}>${name}
            ${player?.playerId === myId ? html`<small>${t('你自己')}</small>` : null}
          </span>
        </div>
        <div class="duel-roster__bonds">
          ${activeBonds.length ? activeBonds.map(bond => {
            const bondName = data.lookup('bonds', bond.bondId)?.name || bond.name;
            return html`<span key=${bond.bondId} class="duel-roster__bond" title=${bondName}>
              <${Img} src=${bondIconUrl(assets, bond.bondId)} fallback=${initials(bondName)} />
              <span>${bondName}</span><b class="num">${bond.layers || bond.count}</b>
            </span>`;
          }) : html`<span class="duel-empty">${formation ? t('暂无羁绊') : '—'}</span>`}
        </div>
        <div class="duel-roster__units">
          ${formation?.units.length ? formation.units.map(unit => html`<${FormationUnit} key=${unit.id} unit=${unit} />`)
            : html`<span class="duel-empty">${formation ? t('暂无上场单位') : '—'}</span>`}
        </div>
      </div>`;
    })}
  </div>`;
}

export function DuelPanel({ pub, myId, localCamp, watching, bubbles, onWatch, onScout }) {
  const [selection, setSelection] = useState(null);
  const tabs = [{ id: 'monster', label: t('侵略阵营') }, { id: 'ops', label: t('盟约阵营') }];
  const camp = selection?.camp || localCamp;
  const matchups = pub.duelMatchups;
  const inPrep = pub.phase === PHASE.PREP;
  const inCombat = pub.phase === PHASE.COMBAT;
  const inJoint = pub.phase === PHASE.UNITE;
  const joint = inJoint ? pub.fields?.find(field => field.kind === 'unite') : null;
  const canOpen = inPrep || inCombat || inJoint;
  const players = matchups.map(lane => {
    const fieldId = inCombat ? lane.fieldId : joint?.fieldId;
    return camp === 'monster'
      ? { seat: lane.attackerSeat, player: lane.attacker, fieldId }
      : { seat: lane.defenderSeat, player: lane.defender, fieldId };
  }).sort((a, b) => a.seat - b.seat);
  useEffect(() => { if (!canOpen) setSelection(null); }, [canOpen]);
  const close = () => setSelection(null);
  const openCamp = (side, seat) => setSelection({ camp: side, seat });
  const canInspect = ({ player, fieldId }) => inPrep
    ? !!(player?.formation && pub.duelFormationMaps?.[camp])
    : !!(player && fieldId);
  const inspect = row => {
    if (!canInspect(row)) return;
    close();
    if (inPrep) onScout(camp, row.player.playerId);
    else onWatch(row.fieldId, row.player.playerId);
  };

  function face(player, side, seat) {
    const label = tabs.find(tab => tab.id === side).label;
    const name = player?.name || `P${seat + 1}`;
    const tip = `${label} · ${name} · ${t('阵容总览')}`;
    const bubble = side === localCamp && player ? bubbles?.get(player.playerId) : null;
    return html`<div class="duel-matchup__player">
      <button type="button" class=${`duel-matchup__face${player?.playerId === myId ? ' is-self' : ''}`}
          disabled=${!canOpen || !player} aria-label=${tip} title=${tip}
          aria-haspopup="dialog" data-camp=${side} data-seat=${seat}
          onClick=${() => openCamp(side, seat)}>
        <${PlayerFace} player=${player} camp=${side} ready=${inPrep} />
        <span class="duel-matchup__seat num">P${seat + 1}</span>
      </button>
      ${bubble ? html`<${EmoteBubble} key=${bubble.seq} id=${bubble.id} class="team__bubble" />` : null}
    </div>`;
  }

  return [
    html`<aside class="team duel-matchups" aria-label=${t('本轮对阵')}>
      <div class="duel-matchups__head"><span>${t('进攻方')}</span><span>${t('防守方')}</span></div>
      ${matchups.map(lane => {
        const count = lane.gateLeaks;
        const label = count == null ? t('漏怪') : t('漏怪 {n}', { n: count });
        const fieldName = lane.defender?.name || `P${lane.defenderSeat + 1}`;
        return html`<div key=${lane.attackerSeat} class=${`duel-matchup${lane.fieldId && lane.fieldId === watching ? ' is-watching' : ''}`}>
          ${face(lane.attacker, 'monster', lane.attackerSeat)}
          <button type="button" class="duel-matchup__arrow" disabled=${!inCombat || !lane.fieldId}
              aria-label=${`${t('查看战场「{name}」', { name: fieldName })} · ${label}`} title=${label}
              data-field=${lane.fieldId} onClick=${() => onWatch(lane.fieldId)}>
            <b class="duel-matchup__count num">${count ?? '—'}</b>
            <span aria-hidden="true">→</span>
          </button>
          ${face(lane.defender, 'ops', lane.defenderSeat)}
        </div>`;
      })}
      ${joint?.gateLeaks != null ? html`<div class="duel-matchup__joint" title=${t('漏怪 {n}', { n: joint.gateLeaks })}>
        ${t('联防')} <b class="num">${joint.gateLeaks}</b>
      </div>` : null}
    </aside>`,
    html`<${Modal} open=${canOpen && !!selection} class=${`duel-dialog duel-dialog--${camp}`} tone=${camp === 'monster' ? 'red' : 'mint'}
        title=${t('阵容总览')} onClose=${close}
        actions=${html`<${Button} size="sm" onClick=${close}>${t('关闭')}<//>`}>
      <${Tabs} items=${tabs} value=${camp} onChange=${side => openCamp(side, null)} size="sm" />
      <${CampRoster} players=${players} camp=${camp} myId=${myId} selectedSeat=${selection?.seat}
        inPrep=${inPrep} canInspect=${canInspect} onSelect=${inspect} />
    <//>`,
  ];
}
