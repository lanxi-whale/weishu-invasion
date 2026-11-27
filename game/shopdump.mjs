import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--window-size=1600,900'] });
const p = await b.newPage();
await p.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
await p.setCacheEnabled(false);
await p.goto('http://monster.localhost:3100/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(3400);
const clickText = async (re) => p.evaluate((rs) => {
  const rx = new RegExp(rs); const el = [...document.querySelectorAll('button')].find((x) => rx.test((x.textContent || '').trim()));
  if (el) { el.click(); return (el.textContent || '').trim().slice(0, 18); } return null;
}, re.source);
await clickText(/^关闭$/); await sleep(400);
const inp = await p.$('input'); if (inp) { await inp.click(); await inp.type('SHOP'); await clickText(/^开始/); await sleep(2600); }
await clickText(/独立模拟/); await sleep(1100);
await p.evaluate(() => document.querySelector('.camp-card.is-here')?.click()); await sleep(1300);
await clickText(/标准模拟/); await sleep(600);
await clickText(/开始独立模拟/); await sleep(5500);
await clickText(/开始模拟/); await sleep(6500);
for (const t of [/激活第 1 组/]) { await clickText(t); await sleep(700); }
await clickText(/准备就绪/); await sleep(3000);
await p.evaluate(() => { const bs = [...document.querySelectorAll('button')].filter((x) => !/本局禁用|添加到桌面|玩法说明|局信息/.test(x.textContent) && x.textContent.trim().length > 1 && x.getBoundingClientRect().width > 60); bs[0]?.click(); }); await sleep(1200);
for (const re of [/确认/, /确定/, /选择策略/, /下一步/, /开始/]) { if (await clickText(re)) break; }
await sleep(3500);
await clickText(/确认编队/); await sleep(12000);
const info = await p.evaluate(() => {
  const out = [];
  for (const card of document.querySelectorAll('.scard')) {
    const art = card.querySelector('.scard__art');
    const r = card.getBoundingClientRect();
    const ar = art ? art.getBoundingClientRect() : null;
    const cs = art ? getComputedStyle(art) : null;
    out.push({
      cls: card.className,
      text: (card.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30),
      card: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      art: ar ? [Math.round(ar.x), Math.round(ar.y), Math.round(ar.width), Math.round(ar.height)] : null,
      src: art ? (art.currentSrc || art.src || '').split('/').slice(-2).join('/') : null,
      nat: art ? [art.naturalWidth, art.naturalHeight] : null,
      pos: cs ? [cs.position, cs.objectFit, cs.width, cs.height, cs.right, cs.top] : null,
    });
  }
  return out;
});
console.log(JSON.stringify(info, null, 1));
await p.screenshot({ path: 'E:/明日方舟卫戍协议/4v4/demo/_ref/_shop_full.png' });
const cardBtn = await p.$('.scard');
if (cardBtn) { await cardBtn.click({ button: 'right' }); await sleep(1200); await p.screenshot({ path: 'E:/明日方舟卫戍协议/4v4/demo/_ref/_detail_monster.png' }); }
const card = await p.$('.scard');
if (card) await card.screenshot({ path: 'E:/明日方舟卫戍协议/4v4/demo/_ref/_shop_card.png' });
const html = await p.evaluate(() => { const c = document.querySelector('.scard'); return c ? c.outerHTML.slice(0, 2000) : null; });
console.log('HTML', html);
await b.close();
