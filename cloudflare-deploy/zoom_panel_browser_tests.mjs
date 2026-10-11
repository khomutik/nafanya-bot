import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import worker, { ZoomMeetingStateDurableObject, ZoomSharedTimerStateDurableObject, AnnouncementStateDurableObject } from './worker.mjs';

function namespace(Class) {
  const objects = new Map();
  return { getByName(name) {
    if (!objects.has(name)) {
      const values = new Map();
      const instance = new Class({ storage: { get: async key => structuredClone(values.get(key)), put: async (key,value) => values.set(key,structuredClone(value)) } });
      let pending = Promise.resolve();
      objects.set(name, { fetch(url,init) { const response = pending.then(() => instance.fetch(new Request(url,init))); pending = response.catch(() => {}); return response; } });
    }
    return objects.get(name);
  } };
}
const env = { ZOOM_PANEL_TOKEN:'browser-test', ZOOM_BRIDGE_SECRET:'test', ZOOM_MEETING_STATE:namespace(ZoomMeetingStateDurableObject), ZOOM_SHARED_TIMER_STATE:namespace(ZoomSharedTimerStateDurableObject), ANNOUNCEMENT_STATE:namespace(AnnouncementStateDurableObject) };
const browser = await chromium.launch({headless:true,...(process.env.PN_CHROME_PATH ? {executablePath:process.env.PN_CHROME_PATH} : {})});
const artifacts = process.env.PN_UI_ARTIFACTS || '.test-artifacts';
await mkdir(artifacts,{recursive:true});
try {
  const page = await browser.newPage({viewport:{width:420,height:900}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://nafanya.test/**', async route => {
    const req=route.request();
    const response=await worker.fetch(new Request(req.url(),{method:req.method(),headers:req.headers(),...(req.method()==='POST'?{body:req.postData()}: {})}),env);
    await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
  });
  await page.goto('https://nafanya.test/zoom-only/app?token=browser-test');
  const day=page.locator('[data-day="thursday"]');
  await day.evaluate(el=>el.open=true);
  const addEntry=async text=>{await day.locator('[data-entry-input]').fill(text);await day.locator('[data-add-entry]').click();await assert.doesNotReject(()=>day.locator('[data-entry-input]').filter({visible:true}).waitFor());};
  await addEntry('111');
  await day.locator('[data-entry-list] .state-row').waitFor();
  await addEntry('222');
  await page.waitForFunction(()=>document.querySelectorAll('[data-day="thursday"] [data-entry-list] .state-row').length===2);
  let row=day.locator('[data-entry-list] .state-row').first();
  assert.deepEqual(await row.locator('.row-actions button').allTextContents(),['✅','Редактировать','Удалить','Пропускает']);
  await row.getByRole('button',{name:'Редактировать',exact:true}).click();
  await row.locator('input').fill('111 corrected');
  await page.evaluate(()=>refreshState());
  assert.equal(await row.locator('input').inputValue(),'111 corrected','Polling must preserve an unfinished edit');
  await row.getByRole('button',{name:'Сохранить',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-day="thursday"] [data-entry-list] .state-row>span')?.textContent.includes('111 corrected'));
  await row.getByRole('button',{name:'Высказался',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-day="thursday"] [data-entry-list] .check')?.getAttribute('aria-pressed')==='true');
  assert.equal(await row.getByRole('button',{name:'Пропускает',exact:true}).isDisabled(),true);
  await row.getByRole('button',{name:'Вернуть в очередь',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-day="thursday"] [data-entry-list] .check')?.getAttribute('aria-pressed')==='false');
  await row.getByRole('button',{name:'Пропускает',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-day="thursday"] [data-entry-list] .state-row>span')?.textContent.includes('222'));
  await day.locator('[data-topic-input]').fill('Old topic');await day.locator('[data-add-topic]').click();
  const topic=day.locator('[data-topic-list] .state-row').first();await topic.waitFor();
  assert.deepEqual(await topic.locator('button').allTextContents(),['Редактировать','Удалить']);
  await topic.getByRole('button',{name:'Редактировать',exact:true}).click();await topic.locator('input').fill('New topic');await topic.getByRole('button',{name:'Сохранить',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-day="thursday"] [data-topic-list] .state-row>span')?.textContent.includes('New topic'));
  const readOutbox=async()=>{
    const response=await worker.fetch(new Request('https://nafanya.test/zoom-only/outbox',{method:'POST',headers:{'content-type':'application/json','x-nafanya-zoom-secret':'test'},body:JSON.stringify({limit:50})}),env);
    assert.equal(response.status,200);
    return (await response.json()).messages;
  };
  const outboxBeforeCongrats=await readOutbox();
  const congratsAdd=async text=>{await day.locator('[data-congratulations-input]').fill(text);await day.locator('[data-congratulations-add]').click();};
  await congratsAdd('Маня 1 год 2 месяца');
  await day.locator('[data-congratulations-list] .state-row').waitFor();
  await congratsAdd('Саша 3 дня');
  await page.waitForFunction(()=>document.querySelectorAll('[data-day="monday"] [data-congratulations-list] .state-row').length===2);
  assert.equal((await readOutbox()).length,outboxBeforeCongrats.length,'Congratulation draft rows must not send before explicit publish');
  const congratsRow=day.locator('[data-congratulations-list] .state-row').first();
  await congratsRow.getByRole('button',{name:'Редактировать',exact:true}).click();
  await congratsRow.locator('input').fill('Маня 1 год 3 месяца');
  await congratsRow.getByRole('button',{name:'Сохранить',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-day="thursday"] [data-congratulations-list] .state-row>span')?.textContent.includes('Маня 1 год 3 месяца'));
  await day.locator('[data-congratulations-list] .state-row').nth(1).getByRole('button',{name:'Удалить',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-day="thursday"] [data-congratulations-list] .state-row').length===1);
  await congratsAdd('Вася 7 месяцев');
  await page.waitForFunction(()=>document.querySelectorAll('[data-day="thursday"] [data-congratulations-list] .state-row').length===2);
  await day.locator('[data-congratulations-publish]').click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-day="thursday"] [data-congratulations-list] .state-row').length===0);
  const congratsOutbox=(await readOutbox()).at(-1);
  assert.match(congratsOutbox.text,/\*\*🎉ПОЗДРАВЛЯЕМ\*\*[\s\S]*🥳 Маня 1 год 3 месяца[\s\S]*🥳 Вася 7 месяцев[\s\S]*\*\*Спасибо участникам/u);
  assert.equal(congratsOutbox.coalesceKey,undefined,'Congratulation message is not a replaceable queue snapshot');
  const speaker=page.locator('[data-speaker]');await speaker.evaluate(el=>el.open=true);
  await speaker.locator('[data-speaker-input]').fill('First question');await speaker.locator('[data-speaker-add]').click();
  const question=speaker.locator('.state-row').first();await question.waitFor();
  assert.deepEqual(await question.locator('button').allTextContents(),['✅','Редактировать','Удалить','Пропускает']);
  await question.getByRole('button',{name:'Редактировать',exact:true}).click();await question.locator('input').fill('Corrected question');await question.getByRole('button',{name:'Сохранить',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-speaker-list] .state-row>span')?.textContent.includes('Corrected question'));
  await question.getByRole('button',{name:'Высказался',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-speaker-list] .check')?.getAttribute('aria-pressed')==='true');
  for(const width of [340,420,1000]) {
    await page.setViewportSize({width,height:1100});
    for(const panel of await page.locator('.day-panel').all()) {
      await panel.evaluate(el=>el.open=true);
      assert.equal(await panel.locator('[data-message-key="group_sponsors"]').count(),1);
      const labels=await panel.locator('[data-message-group]').allTextContents();
      assert.deepEqual(labels,['Начало собрания в 21:30','Выложить в 22:00','Конец собрания 22:45-22:55']);
    }
    const overflow=await page.evaluate(()=>({viewport:innerWidth,body:document.documentElement.scrollWidth,rows:[...document.querySelectorAll('.state-row')].filter(el=>el.scrollWidth>el.clientWidth+1).length}));
    assert.ok(overflow.body<=width+1,JSON.stringify(overflow));assert.equal(overflow.rows,0,JSON.stringify(overflow));
    const clipped = await page.evaluate(()=>[...document.querySelectorAll('.day-body>section,.board-part,.state-row,.row-actions')].map(el=>{const r=el.getBoundingClientRect(),p=el.parentElement.getBoundingClientRect();return {class:el.className,left:r.left,right:r.right,parentLeft:p.left,parentRight:p.right}}).filter(r=>r.left<r.parentLeft-1||r.right>r.parentRight+1));
    assert.deepEqual(clipped,[],`Clipped panel content at ${width}px: ${JSON.stringify(clipped)}`);
    await day.locator('section').first().screenshot({path:path.join(artifacts,`messages-${width}.png`)});
    await day.locator('.board-editor').screenshot({path:path.join(artifacts,`queue-${width}.png`)});
  }
  assert.deepEqual(errors,[]);
  console.log('Browser checks passed: six panels, three widths, edit/mark/restore/defer, no overflow or script errors.');
} finally {await browser.close();}
