import puppeteer from 'puppeteer-core';
const shot = (p, n) => p.screenshot({ path: `E:/明日方舟卫戍协议/4v4/demo/_ref/_e2e_${n}.png` });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--window-size=1600,900'] });
const p = await b.newPage();
const errs = [];
p.on('console', (m) => { const t = m.text(); if (/\[MARCH|\[TOGGLE|\[CAM\]/.test(t)) console.log('LOG', t.slice(0, 160)); if (m.type() === 'error') errs.push(t.slice(0, 200)); });
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
const inp = await p.$('input'); if (inp) { await inp.click(); await inp.type('MONSTER'); }
console.log('start', await clickText(/^开始/)); await sleep(2400);
console.log('solo', await clickText(/独立模拟/)); await sleep(1200);
console.log('camp', await p.evaluate(() => { const c = document.querySelector('.camp-card--monster'); if (c) { c.click(); return 'monster'; } return null; }));
await sleep(6500);   // 跳过去是新页面：等它起好、自动弹出「选择模拟协议」
console.log('std', await clickText(/标准模拟/)); await sleep(900);
console.log('create', await clickText(/开始独立模拟/)); await sleep(6000);
console.log('A', await clickText(/开始模拟/)); await sleep(7000);
await shot(p, '0_brief');
for (const t of [/激活第 1 组/, /激活第 2 组/]) { console.log('grp', await clickText(t)); await sleep(900); }
await sleep(800);
console.log('ready', await clickText(/准备就绪/)); await sleep(3500);
const first = await p.evaluate(() => {
  const bs = [...document.querySelectorAll('button')].filter((x) => !/本局禁用|添加到桌面|玩法说明|局信息/.test(x.textContent) && x.textContent.trim().length > 1 && x.getBoundingClientRect().width > 60);
  const b = bs[0]; if (!b) return null; b.click(); return b.textContent.trim();
});
console.log('pick', first); await sleep(1500);
for (const re of [/确认/, /确定/, /选择策略/, /下一步/, /开始/]) { const r = await clickText(re); if (r) { console.log('confirm', r); break; } }
await sleep(4000);
console.log('team', await clickText(/确认编队/));
await sleep(12000);
await shot(p, '1_prep');
console.log('BTNS', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('button')].map((x) => x.textContent.trim()).filter(Boolean).slice(-10))));
// 买一只怪
console.log('buy', await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /^\d/.test(x.textContent.trim()) && x.textContent.length > 4); if (b) { b.click(); return b.textContent.trim().slice(0, 12); } return null; }));
await sleep(1200);
console.log('confirmBuy', await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /确认购买/.test(x.textContent)); if (b) { b.click(); return 'ok'; } return null; }));
await sleep(2200);
await shot(p, '2_bought');
// 手牌第一格 → 拖到 (16,10)
const foundStart = await p.evaluate(() => {
  const v = window.__SP_VIEW__; if (!v || !v.tileScreen) return null;
  for (let i = 0; i < 12; i++) { const g = v.tileScreen(11, 4 + i); if (!g) continue;
    const uid = v.pieceAtClientPoint(g.x, g.y);
    if (uid != null) { const t = v.tileScreen(16, 10); return { x: Math.round(g.x), y: Math.round(g.y), t: t && { x: Math.round(t.x), y: Math.round(t.y) } }; } }
  return null; });
console.log('FOUND', JSON.stringify(foundStart));
if (foundStart && foundStart.t) {
  await p.mouse.move(foundStart.x, foundStart.y); await sleep(200); await p.mouse.down(); await sleep(250);
  await p.mouse.move(foundStart.x + 8, foundStart.y - 8, { steps: 5 }); await sleep(150);
  await p.mouse.move(foundStart.t.x, foundStart.t.y, { steps: 14 }); await sleep(400); await p.mouse.up(); await sleep(900);
  await p.mouse.click(foundStart.t.x, foundStart.t.y - 72); await sleep(900);
}
await sleep(600);
console.log('TOAST', await p.evaluate(() => { const t = [...document.querySelectorAll('*')].find((e) => /无法部署|已部署|不可部署/.test(e.textContent || '') && e.children.length === 0); return t ? t.textContent.trim().slice(0, 30) : null; }));
await shot(p, '3_placed');
// 准备就绪（两次点击：底下那个确认）
console.log('fight', await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /准备就绪/.test(x.textContent)); if (b) { b.click(); return 'ok'; } return null; }));
await sleep(1000);
console.log('dlg', await p.evaluate(() => { const bs = [...document.querySelectorAll('button')].filter((x) => /准备就绪/.test(x.textContent)); const b = bs[bs.length - 1]; if (b) { b.click(); return 'ok' + bs.length; } return null; }));
await sleep(700); await shot(p, '4_march_a');
await sleep(900); await shot(p, '4_march_b');
await sleep(4500); await shot(p, '5_combat');
console.log('CAM', await p.evaluate(() => document.querySelector('[data-camera]')?.getAttribute('data-camera')));
// 切自己的棋盘 → 切回干员战场 → 再切（复现第二、三个问题）
const penBtn = await p.$('[data-testid="check-enemy"]');
console.log('PENBTN', !!penBtn);
if (penBtn) {
  await p.click('[data-testid="check-enemy"]'); await sleep(700); await shot(p, '6_own');
  console.log('CAM1', await p.evaluate(() => document.querySelector('[data-camera]')?.getAttribute('data-camera')));
  await p.click('[data-testid="check-enemy"]'); await sleep(700); await shot(p, '7_back');
  console.log('CAM2', await p.evaluate(() => document.querySelector('[data-camera]')?.getAttribute('data-camera')));
  await p.click('[data-testid="check-enemy"]'); await sleep(700); await shot(p, '8_own2');
  console.log('CAM3', await p.evaluate(() => document.querySelector('[data-camera]')?.getAttribute('data-camera')));
  await p.click('[data-testid="check-enemy"]'); await sleep(700); await shot(p, '9_back2');
  console.log('CAM4', await p.evaluate(() => document.querySelector('[data-camera]')?.getAttribute('data-camera')));
}
console.log('errors', JSON.stringify(errs.slice(0, 6)));
await b.close();
