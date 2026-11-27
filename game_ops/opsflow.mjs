import puppeteer from 'puppeteer-core';
const shot=(p,n)=>p.screenshot({path:`E:/明日方舟卫戍协议/4v4/demo/_ref/_ops_${n}.png`});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless:'new', args:['--no-sandbox','--disable-gpu','--window-size=1600,900']});
const p=await b.newPage();
p.on('console',m=>{const t=m.text(); if(t.startsWith('[CAM]'))console.log('CAMLOG',t.slice(0,240))});
await p.setViewport({width:1600,height:900,deviceScaleFactor:1});
await p.setCacheEnabled(false);
await p.evaluateOnNewDocument(()=>{window.__CAMDBG__=true});
await p.goto('http://localhost:3200/',{waitUntil:'networkidle2',timeout:60000});
await sleep(3000);
const clickText=async(re,sel='button')=>p.evaluate((rs,ss)=>{
  const rx=new RegExp(rs); const el=[...document.querySelectorAll(ss)].find(x=>rx.test((x.textContent||'').trim()));
  if(el){el.click();return (el.textContent||'').trim().slice(0,20)} return null;
},re.source,sel);

await clickText(/^关闭$/); await sleep(500);
const inp=await p.$('input'); if(inp){await inp.click();await inp.type('MONSTER')}
await clickText(/^开始/); await sleep(2200);
await clickText(/独立模拟/); await sleep(1800);
await clickText(/标准模拟/); await sleep(900);
await clickText(/开始独立模拟/); await sleep(5000);
console.log('A',await clickText(/开始模拟/)); await sleep(6000);
await shot(p,'0_brief');
// 盟约组
for(const t of [/激活第 1 组/,/激活第 2 组/]){ console.log('grp',await clickText(t)); await sleep(900); }
await sleep(1000);
console.log('ready',await clickText(/准备就绪/)); await sleep(3500);
await shot(p,'1_strategy');
// 点第一张策略卡（策略卡本身就是按钮）
const first=await p.evaluate(()=>{
  const bs=[...document.querySelectorAll('button')].filter(b=>!/本局禁用|添加到桌面|玩法说明|局信息/.test(b.textContent)&&b.textContent.trim().length>1&&b.getBoundingClientRect().width>60);
  const b=bs[0]; if(!b)return null; b.click(); return b.textContent.trim();
});
console.log('pick',first); await sleep(1500);
await shot(p,'2_picked');
for(const re of [/确认/,/确定/,/选择策略/,/下一步/,/开始/]){
  const r=await clickText(re); if(r){console.log('confirm',r);break}
}
await sleep(4000);
console.log('team',await clickText(/确认编队/));
await sleep(11000);
await shot(p,'3_prep');
console.log('BTNS',JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(Boolean).slice(-12))));
// 买一只怪，看手牌里的模型
console.log('buy',await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^\d/.test(x.textContent.trim())&&x.textContent.length>4);if(b){b.click();return b.textContent.trim().slice(0,12)}return null}));
await sleep(1200);
console.log('confirmBuy',await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/确认购买/.test(x.textContent));if(b){b.click();return 'ok'}return null}));
await sleep(2200);
await shot(p,'4_bought');
// 选中手牌第一格并点屏幕中央，看是否可部署
await p.evaluate(()=>{const el=document.querySelector('[data-slot="0"], [class*=hand] [class*=slot]');if(el)el.click()});
await sleep(600);
const found=await p.evaluate(()=>{
  const v=window.__SP_VIEW__; if(!v||!v.tileScreen) return null;
  for(let i=0;i<12;i++){ const g=v.tileScreen(11, 4+i); if(!g) continue;
    const uid=v.pieceAtClientPoint(g.x,g.y);
    if(uid!=null){ const t=v.tileScreen(16,10); return {x:Math.round(g.x),y:Math.round(g.y),uid,t:t&&{x:Math.round(t.x),y:Math.round(t.y)}}; } }
  return null;
});
console.log('FOUND',JSON.stringify(found));
if(found){
  const tgt=found.t;
  await p.mouse.move(found.x,found.y); await sleep(200); await p.mouse.down(); await sleep(250);
  await p.mouse.move(found.x+8,found.y-8,{steps:5}); await sleep(150);
  await p.mouse.move(tgt.x,tgt.y,{steps:14}); await sleep(400); await p.mouse.up(); await sleep(900);
  // 朝向轮盘：点向上的箭头确认
  await p.mouse.click(tgt.x, tgt.y-72); await sleep(900);
}
await sleep(600);
const toast=await p.evaluate(()=>{const t=[...document.querySelectorAll('*')].find(e=>/无法部署|已部署|不可部署/.test(e.textContent||'')&&e.children.length===0);return t?t.textContent.trim().slice(0,30):null});
console.log('TOAST',toast);
await shot(p,'5_placed');
console.log('fight',await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/准备就绪/.test(x.textContent));if(b){b.click();return 'ok'}return null}));
await sleep(1200);
console.log('dlg',await p.evaluate(()=>{const bs=[...document.querySelectorAll('button')].filter(x=>/准备就绪/.test(x.textContent));const b=bs[bs.length-1];if(b){b.click();return 'ok'+bs.length}return null}));
await sleep(2200);
await shot(p,'6_combat');
await sleep(2500);
await shot(p,'6d_combat2');
const bt=await p.evaluate(()=>{
  const v=window.__SP_VIEW__; const rows=[];
  for(let r=10;r<=18;r++){ const g=v.tileScreen(r,10); rows.push([r,g?Math.round(g.y):null]); }
  const cam=document.querySelector('[data-camera]')?.getAttribute('data-camera');
  return {rows, cam, phase: document.body.innerText.slice(0,40)};
});
console.log('BATTLE',JSON.stringify(bt));
await sleep(9000);
await shot(p,'7_after');
const imgs=await p.evaluate(()=>[...document.querySelectorAll('[class*=shop] img')].map(i=>({src:i.currentSrc||i.src,w:i.naturalWidth})));
console.log('IMGS',JSON.stringify(imgs.slice(0,6)));
await b.close();
