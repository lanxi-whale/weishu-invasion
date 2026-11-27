import puppeteer from 'puppeteer-core';
const b=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless:'new', args:['--no-sandbox','--disable-gpu','--window-size=1600,900']});
const p=await b.newPage();
await p.setViewport({width:1600,height:900,deviceScaleFactor:1});
await p.goto('http://localhost:3100/',{waitUntil:'networkidle2',timeout:60000});
await new Promise(r=>setTimeout(r,3000));
await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='关闭');if(b)b.click()});
await new Promise(r=>setTimeout(r,500));
const inp=await p.$('input'); if(inp){await inp.click();await inp.type('MONSTER')}
await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^开始/.test(x.textContent.trim()));if(b)b.click()});
await new Promise(r=>setTimeout(r,2000));
await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/独立模拟/.test(x.textContent));if(b)b.click()});
await new Promise(r=>setTimeout(r,1500));
await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/标准模拟/.test(x.textContent));if(b)b.click()});
await new Promise(r=>setTimeout(r,800));
await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/开始独立模拟/.test(x.textContent));if(b)b.click()});
await new Promise(r=>setTimeout(r,7000));
await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/开始模拟/.test(x.textContent));if(b)b.click()});
await new Promise(r=>setTimeout(r,4000));
for(const t of ['激活第 1 组','激活第 1 组','激活第 2 组']){
  await p.evaluate((tt)=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.replace(/\s/g,'').includes(tt.replace(/\s/g,'')));if(b)b.click()},t);
  await new Promise(r=>setTimeout(r,700));
}
const btns=await p.evaluate(()=>[...document.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(Boolean).slice(-14));
console.log('BTNS',JSON.stringify(btns));
await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/准备就绪/.test(x.textContent));if(b)b.click()});
await new Promise(r=>setTimeout(r,2500));
// 选择策略：点第一张卡，再确认
await p.evaluate(()=>{const c=document.querySelectorAll('[class*=choice] [class*=card], [class*=strategy] [class*=card]');if(c[0])c[0].click()});
await new Promise(r=>setTimeout(r,900));
await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/(确认|选定|确定|准备就绪)/.test(x.textContent));if(b)b.click()});
await new Promise(r=>setTimeout(r,3500));
await p.screenshot({path:'E:/明日方舟卫戍协议/4v4/demo/_live_game3s.png'});
await new Promise(r=>setTimeout(r,2000));
await p.screenshot({path:'E:/明日方舟卫戍协议/4v4/demo/_live_game.png'});
const info=await p.evaluate(()=>({route:location.hash,text:document.body.innerText.slice(0,300)}));
console.log(JSON.stringify(info,null,1));
await b.close();
