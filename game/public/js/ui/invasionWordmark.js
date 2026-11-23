import { useState } from '../../vendor/hooks.module.js';
import { getLang } from '../../../shared/i18n.js';
import { localAsset } from '../data.js';
import { html } from './components.js';

/** @param {{ title: string }} props */
export function InvasionWordmark({ title }) {
  const mark = getLang() === 'zh' ? localAsset('ui/season/act3autochess', 'common_title') : null;
  const [unavailable, setUnavailable] = useState(/** @type {string|null} */ (null));
  if (!mark || mark === unavailable) return title;
  return html`<span class="invasion-wordmark" aria-hidden="true">
    <img class="invasion-wordmark__protocol" src=${mark} alt="" draggable=${false} onError=${() => setUnavailable(mark)} />
    <span class="invasion-wordmark__english">INVASION</span>
    <span class="invasion-wordmark__name"><span>${title.split('：').at(-1)}</span></span>
  </span>`;
}
