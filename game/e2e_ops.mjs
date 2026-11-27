import puppeteer from 'puppeteer-core';
const shot = (p, n) => p.screenshot({ path: `E:/明日方舟卫戍协议/4v4/demo/_ref/_e2eops_${n}.png` });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--window-size=1600,900'] });
const p = await b.newPage();
const errs = [];
p.on('console', (m) => { const t = m.text(); if (/\[MARCH|\[CAM\]/.test(t)) console.log('LOG', t.slice(0, 160)); if (m.type() === 'error') errs.push(t.slice(0, 200)); });
p.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e).slice(0, 200)));
await p.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
await p.setCacheEnabled(false);
await p.goto('http://localhost:3100/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(3200);
const clickText = async (re, sel = 'button') => p.evaluate((rs, ss) => {
  const rx = new RegExp(rs); const el = [...document.querySelectorAll(ss)].find((x) => rx.test((x.textContent || '').trim()));
  if (el) { el.click(); return (el.textContent || '').trim().slice(0, 20); } return null;
}, re.source, sel);
console.log('close', await clickText(/^关闭$/)); await sleep(500);
const inp = await p.$('input'); if (inp) { await inp.click(); await inp.type('OPS'); }
console.log('start', await clickText(/^开始/)); await sleep(2400);
console.log('solo', await clickText(/独立模拟/)); await sleep(1200);
console.log('camp', await p.evaluate(() => { const c = document.querySelector('.camp-card--ops'); if (c) { c.click(); return 'ops'; } return null; }));
await sleep(6500);   // 跳过去是新页面：等自动弹出的「选择模拟协议」
console.log('std', await clickText(/标准模拟/)); await sleep(900);
console.log('create', await clickText(/开始独立模拟/)); await sleep(6000);
console.log('A', await clickText(/开始模拟/)); await sleep(7000);
await shot(p, '0_brief');
for (const t of [/激活第 1 组/, /激活第 2 组/]) { console.log('grp', await clickText(t)); await sleep(900); }
await sleep(800);
console.log('ready', await clickText(/准备就绪/)); await sleep(3500);
const first = await p.evaluate(() => { const bs = [...document.querySelectorAll('button')].filter((x) => !/本局禁用|添加到桌面|玩法说明|局信息/.test(x.textContent) && x.textContent.trim().length > 1 && x.getBoundingClientRect().width > 60); const b = bs[0]; if (!b) return null; b.click(); return b.textContent.trim(); });
console.log('pick', first); await sleep(1500);
for (const re of [/确认/, /确定/, /选择策略/, /下一步/, /开始/]) { const r = await clickText(re); if (r) { console.log('confirm', r); break; } }
await sleep(4000);
console.log('team', await clickText(/确认编队/));
await sleep(12000);
await shot(p, '1_prep');
console.log('BTNS', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('button')].map((x) => x.textContent.trim()).filter(Boolean).slice(-10))));
console.log('buy', await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /^\d/.test(x.textContent.trim()) && x.textContent.length > 4); if (b) { b.click(); return b.textContent.trim().slice(0, 12); } return null; }));
await sleep(1200);
console.log('confirmBuy', await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /确认购买/.test(x.textContent)); if (b) { b.click(); return 'ok'; } return null; }));
await sleep(2200);
await shot(p, '2_bought');
// 干员方：手牌 row 7 / cols 0..9，目标 (10,6)
const foundStart = await p.evaluate(() => {
  const v = window.__SP_VIEW__; if (!v || !v.tileScreen) return null;
  for (let i = 0; i < 10; i++) { const g = v.tileScreen(7, i); if (!g) continue;
    const uid = v.pieceAtClientPoint(g.x, g.y);
    if (uid != null) return { x: Math.round(g.x), y: Math.round(g.y) }; }
  return null; });
console.log('FOUND', JSON.stringify(foundStart));
let placedAt = null;
for (const [r, c] of [[12, 4], [12, 5], [11, 4], [11, 5], [12, 6], [12, 3]]) {
  const t = await p.evaluate((rr, cc) => { const g = window.__SP_VIEW__.tileScreen(rr, cc); return g && { x: Math.round(g.x), y: Math.round(g.y) }; }, r, c);
  if (!t || !foundStart) continue;
  await p.mouse.move(foundStart.x, foundStart.y); await sleep(200); await p.mouse.down(); await sleep(250);
  await p.mouse.move(foundStart.x + 8, foundStart.y - 8, { steps: 5 }); await sleep(150);
  await p.mouse.move(t.x, t.y, { steps: 14 }); await sleep(400); await p.mouse.up(); await sleep(800);
  await p.mouse.click(t.x, t.y - 72); await sleep(900);
  const ok = await p.evaluate((x, y) => window.__SP_VIEW__.pieceAtClientPoint(x, y) != null, t.x, t.y);
  console.log('place', r, c, ok);
  if (ok) { placedAt = [r, c]; break; }
}
await sleep(600);
console.log('TOAST', await p.evaluate(() => { const t = [...document.querySelectorAll('*')].find((e) => /无法部署|已部署|不可部署/.test(e.textContent || '') && e.children.length === 0); return t ? t.textContent.trim().slice(0, 30) : null; }));
await shot(p, '3_placed');
console.log('fight', await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /准备就绪/.test(x.textContent)); if (b) { b.click(); return 'ok'; } return null; }));
await sleep(1200);
console.log('dlg', await p.evaluate(() => { const bs = [...document.querySelectorAll('button')].filter((x) => /准备就绪/.test(x.textContent)); const b = bs[bs.length - 1]; if (b) { b.click(); return 'ok' + bs.length; } return null; }));
await sleep(2500); await shot(p, '4_combat');
await sleep(2500); await shot(p, '4_combat2');
console.log('CAM', await p.evaluate(() => document.querySelector('[data-camera]')?.getAttribute('data-camera')));
console.log('errors', JSON.stringify(errs.slice(0, 6)));
await b.close();
