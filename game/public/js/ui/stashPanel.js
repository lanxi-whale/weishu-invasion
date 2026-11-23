// Regulation overflow is separate from the visible equipment row. Show its actual
// contents so a blocked player can keep a unit or sell/destroy a chosen card.
import { useState } from '../../vendor/hooks.module.js';
import { html, confirmDialog } from './components.js';
import { data } from '../data.js';
import { actions } from './gameActions.js';
import { t } from '../../../shared/i18n.js';

export function StashPanel({ priv, editable }) {
  const [busy, setBusy] = useState(false);
  const stash = Array.isArray(priv?.stash) ? priv.stash : [];
  if (!stash.length) return null;
  const nameOf = (p) => data.lookup(p.kind === 'item' ? 'items' : p.kind === 'token' ? 'tokens' : 'chess', p.id)?.name || p.id;
  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };
  const remove = async (p) => {
    if (p.kind === 'chess') return actions.sell(p.uid);
    if (p.kind !== 'item') return;
    const ok = await confirmDialog({ title: t('销毁道具'),
      text: t('道具无法出售。确定要销毁「{name}」吗？', { name: nameOf(p) }), okText: t('销毁'), danger: true });
    if (ok) await actions.destroy(p.uid);
  };
  return html`<aside class="stash-panel" data-testid="stash-panel">
    <b>${t('暂存 {count} 个单位：{rule}', { count: stash.length,
      rule: t('有空位时自动移入；休整期结束时仍在暂存的单位将被销毁') })}</b>
    <div class="stash-panel__list">${stash.map((p) => {
      const row = p.kind === 'item' ? priv.temp : priv.hand;
      const idx = Array.isArray(row) ? row.findIndex((slot) => !slot) : -1;
      return html`<div class="stash-panel__unit" key=${p.uid} data-uid=${p.uid}>
        <span>${nameOf(p)}</span>
        <button type="button" disabled=${!editable || busy || idx < 0}
          onClick=${() => run(() => actions.move(p.uid, { area: p.kind === 'item' ? 'temp' : 'hand', idx }))}>${p.kind === 'item' ? t('装备区') : t('整备区')}</button>
        ${p.kind === 'chess' || p.kind === 'item' ? html`<button type="button" disabled=${!editable || busy}
          onClick=${() => run(() => remove(p))}>${p.kind === 'chess' ? t('出售') : t('销毁')}</button>` : null}
      </div>`;
    })}</div>
  </aside>`;
}
