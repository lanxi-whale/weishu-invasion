import puppeteer from 'puppeteer-core';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless:'new', args:['--no-sandbox','--disable-gpu','--window-size=1600,900']});
const p=await b.newPage();
await p.setViewport({width:1600,height:900,deviceScaleFactor:1});
await p.setCacheEnabled(false);
p.on('console',m=>{const t=m.text(); if(t.startsWith('[CAM]'))console.log('LOG',t)});
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
const first=await p.evaluate(()=>{
  const bs=[...document.querySelectorAll('button')].filter(x=>!/本局禁用|添加到桌面|玩法说明|局信息/.test(x.textContent)&&x.textContent.trim().length>1&&x.getBoundingClientRect().width>60);
  const b=bs[0]; if(!b)return null; b.click(); return b.textContent.trim();
});
await sleep(1200);
for(const re of [/确认/,/确定/,/下一步/]){ if(await clickText(re))break; }
await sleep(1000);
await clickText(/确认编队/); await sleep(9000);
const info=await p.evaluate(()=>{
  const out=[];
  document.querySelectorAll('canvas').forEach(c=>{
    const r=c.getBoundingClientRect();
    if(r.width>200) out.push({tag:'canvas',cls:c.className,x:r.x|0,y:r.y|0,w:r.width|0,h:r.height|0});
  });
  return out;
});
console.log('CANVAS',JSON.stringify(info));
// dump view handle if exposed
const api=await p.evaluate(()=>{
  const cand=Object.keys(window).filter(k=>/view|field|game|app|host/i.test(k));
  return cand.slice(0,40);
});
console.log('GLOBALS',JSON.stringify(api));
const tiles=await p.evaluate(()=>{
  const v=window.__SP_VIEW__;
  if(!v||!v.tileScreen) return {err:'no tileScreen', keys:Object.keys(v||{}).slice(0,30)};
  const pick=(r,c)=>{try{const g=v.tileScreen(r,c);return g?{x:Math.round(g.x),y:Math.round(g.y)}:null}catch(e){return 'err'}};
  const slots=[];
  document.querySelectorAll('[class*=slot],[class*=bench],[class*=equip],[class*=bag]').forEach(el=>{
    const r=el.getBoundingClientRect();
    if(r.width>20&&r.height>20) slots.push({cls:el.className.slice(0,60),x:r.x|0,y:r.y|0,w:r.width|0,h:r.height|0,t:(el.textContent||'').trim().slice(0,10)});
  });
  const col=10; const rows=[];
  for(let r=9;r<=18;r++) rows.push([r, pick(r,col)]);
  const info = v.stats? v.stats(): null;
  return {slots:slots.slice(0,25), rows, scale: pick(12,10) && v.tileScreen(12,10).s, stats: info && {pen:info.pen, penHidden:info.penHidden, units:info.units}};
});
console.log('TILES',JSON.stringify(tiles));
await p.screenshot({path:'E:/明日方舟卫戍协议/4v4/demo/_ref/_dbg.png'});
await b.close();
