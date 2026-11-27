import puppeteer from 'puppeteer-core';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless:'new', args:['--no-sandbox','--disable-gpu','--window-size=1600,900']});
const p=await b.newPage();
await p.setViewport({width:1600,height:900,deviceScaleFactor:1});
await p.setCacheEnabled(false);
const clickText=async(re,sel='button')=>p.evaluate((rs,ss)=>{
  const rx=new RegExp(rs); const el=[...document.querySelectorAll(ss)].find(x=>rx.test((x.textContent||'').trim()));
  if(el){el.click();return (el.textContent||'').trim().slice(0,20)} return null;
},re.source,sel);
await p.goto('http://localhost:3100/',{waitUntil:'networkidle2',timeout:60000});
await sleep(3000);
await clickText(/^关闭$/); await sleep(400);
const inp=await p.$('input'); if(inp){await inp.click();await inp.type('MONSTER')}
await clickText(/^开始/); await sleep(2200);
await clickText(/独立模拟/); await sleep(1800);
await clickText(/标准模拟/); await sleep(900);
await clickText(/开始独立模拟/); await sleep(5000);
await clickText(/开始模拟/); await sleep(6000);
for(const t of [/激活第 1 组/,/激活第 2 组/]){ await clickText(t); await sleep(700); }
await sleep(800);
await clickText(/准备就绪/); await sleep(3000);
await p.evaluate(()=>{const bs=[...document.querySelectorAll('button')].filter(x=>!/本局禁用|添加到桌面|玩法说明|局信息/.test(x.textContent)&&x.textContent.trim().length>1&&x.getBoundingClientRect().width>60); const b=bs[0]; if(b)b.click();});
await sleep(1200);
for(const re of [/确认/,/确定/,/下一步/]){ if(await clickText(re))break; }
await sleep(1000);
await clickText(/确认编队/); await sleep(9000);
// 买一只并拖到棋盘
const buy=await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^\d/.test(x.textContent.trim())&&x.textContent.length>4);if(b){b.click();return b.textContent.trim().slice(0,10)}return null});
console.log('BUY',buy); await sleep(1200);
await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/确认购买/.test(x.textContent));if(b)b.click()});
await sleep(2000);
const found=await p.evaluate(()=>{
  const v=window.__SP_VIEW__;
  for(let i=0;i<10;i++){ const g=v.tileScreen(11,5+i); if(!g) continue; if(v.pieceAtClientPoint(g.x,g.y)!=null){ const t=v.tileScreen(16,10); return {x:Math.round(g.x),y:Math.round(g.y),t:{x:Math.round(t.x),y:Math.round(t.y)}}; } }
  return null;});
console.log('FOUND',JSON.stringify(found));
if(found){ await p.mouse.move(found.x,found.y); await sleep(200); await p.mouse.down(); await sleep(250);
  await p.mouse.move(found.x+8,found.y-8,{steps:5}); await sleep(150);
  await p.mouse.move(found.t.x,found.t.y,{steps:14}); await sleep(350); await p.mouse.up(); await sleep(900);
  await p.mouse.click(found.t.x, found.t.y-72); await sleep(800); }
await clickText(/准备就绪/); await sleep(1500);
await clickText(/准备就绪/); await sleep(5000);
const info=await p.evaluate(()=>{
  const v=window.__SP_VIEW__; const rows=[];
  for(let r=10;r<=18;r++){ const g=v.tileScreen(r,10); rows.push([r,g?{x:Math.round(g.x),y:Math.round(g.y),s:+g.s.toFixed(1)}:null]); }
  return {rows, st: v.stats&&v.stats()};
});
console.log('BATTLE',JSON.stringify(info.rows));
console.log('STATS',JSON.stringify(info.st));
await p.screenshot({path:'E:/明日方舟卫戍协议/4v4/demo/_ref/_battle_dbg.png'});
await b.close();
