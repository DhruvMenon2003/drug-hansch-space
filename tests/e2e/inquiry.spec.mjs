import {test,expect} from '@playwright/test';
const ready=async page=>{await page.goto('/?debug');await page.waitForFunction(()=>document.querySelector('#stage-status').hidden);await page.click('#inquiry-start');await expect(page.locator('#inquiry-name')).toHaveText('Caffeine');await page.waitForFunction(()=>window.__hansch.app.view.x==='logp'&&window.__hansch.anim.t===1);};
test('pinned identity survives map and filter changes; actual colour encoding stays connected @mobile',async({page})=>{
 await ready(page);
 const pin=await page.evaluate(()=>window.__hansch.app.inquiry.cid);
 await page.locator('#g-filters').evaluate(el=>el.open=true);
 await page.selectOption('#f-route','ORAL');
 await page.click('[data-inquiry-map="structure"]');
 await expect(page.locator('[data-inquiry-map="structure"]')).toHaveAttribute('aria-pressed','true');
 expect(await page.evaluate(()=>({cid:window.__hansch.app.inquiry.cid,route:window.__hansch.app.view.route,x:window.__hansch.app.view.x}))).toEqual({cid:pin,route:'ORAL',x:'ts1'});
 await page.selectOption('#f-route','');
 await page.selectOption('#color-by','oral');
 const before=await page.evaluate(()=>Array.from(window.__hansch.stage.points.instanceColor.array));
 await page.selectOption('#color-by','ro5');
 const after=await page.evaluate(()=>Array.from(window.__hansch.stage.points.instanceColor.array));
 expect(after).not.toEqual(before);await expect(page.locator('#legend')).toContainText('rule-of-five');
 expect(await page.evaluate(()=>window.__hansch.app.inquiry.cid)).toBe(pin);
 await page.click('#inquiry-evidence');await expect(page.locator('#d-name')).toHaveText('caffeine');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('slice changes geometry sizes and counts without changing records or colour mode',async({page})=>{
 await ready(page);await page.check('#inquiry-slice-enable');
 const before=await page.evaluate(()=>({n:window.__hansch.app.visible.length,mode:window.__hansch.app.view.color,data:JSON.stringify(window.__hansch.app.drugs.map(d=>({cid:d.cid,d:d.d,act:d.act})))}));
 await page.locator('#inquiry-slice').fill('50');
 await expect(page.locator('#inquiry-slice-value')).toHaveText('50 Å²');
 const after=await page.evaluate(()=>({n:window.__hansch.app.visible.length,mode:window.__hansch.app.view.color,data:JSON.stringify(window.__hansch.app.drugs.map(d=>({cid:d.cid,d:d.d,act:d.act})))}));
 expect(after).toEqual(before);await expect(page.locator('#inquiry-slice-result')).toContainText('above');
 await page.click('[data-inquiry-map="pca"]');await expect(page.locator('#inquiry-slice')).toBeDisabled();
 await page.waitForFunction(()=>window.__hansch.app.tiReady);
 await page.selectOption('#color-by','ti');
 await expect(page.locator('#ti-live')).toBeVisible();expect(await page.locator('#color-by option[value="ti"]').count()).toBe(1);
});
test('inquiry calculations and source detail remain available with WebGL disabled',async({page})=>{
 await page.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(t,...args){return /webgl/i.test(t)?null:get.call(this,t,...args)}});
 await ready(page);await expect(page.locator('#fallback-2d')).toBeVisible();
 expect(await page.locator('[data-neighbour]').count()).toBe(5);
 await expect(page.locator('#inquiry-projection')).toBeVisible();
 expect(await page.locator('.projection-point').count()).toBe(759);
 const population=await page.evaluate(()=>({visible:window.__hansch.app.visible.map(d=>d.cid),neighbours:window.__hansch.app.inquiry.neighbours.map(d=>d.cid)}));
 await page.click('#inquiry-projection-zoom');
 expect(await page.locator('.projection-point').count()).toBe(14);
 await expect(page.locator('#inquiry-projection figcaption')).toContainText('14 of 759 filtered records in frame · 745 off-screen');
 await expect(page.locator('#inquiry-projection figcaption')).toContainText('known ofatumumab name–structure mismatch');
 expect(await page.locator('.projection-identity-mark').count()).toBe(1);
 expect(await page.evaluate(()=>({visible:window.__hansch.app.visible.map(d=>d.cid),neighbours:window.__hansch.app.inquiry.neighbours.map(d=>d.cid)}))).toEqual(population);
 await expect(page.locator('#inquiry-slice-result')).toContainText('Across all 759 filtered records');
 await page.click('#inquiry-projection-zoom');
 expect(await page.locator('.projection-point').count()).toBe(759);
 await expect(page.locator('#inquiry-projection figcaption')).toContainText('MR is omitted');
 await page.selectOption('#color-by','oral');
 expect(await page.locator('.projection-point').evaluateAll(points=>new Set(points.map(p=>p.getAttribute('fill'))).size)).toBe(3);
 await expect(page.locator('.projection-legend')).toContainText('oral');
 await page.locator('#g-filters').evaluate(el=>el.open=true);
 await page.selectOption('#f-route','ORAL');
 expect(await page.locator('.projection-point').count()).toBe(537);
 await page.click('[data-inquiry-map="structure"]');await expect(page.locator('#inquiry-map-title')).toHaveText('Fingerprint map');
 await page.click('#inquiry-evidence');await expect(page.locator('#d-name')).toHaveText('caffeine');await expect(page.locator('#d-2d svg')).toBeVisible();
});
test('concrete caffeine/theophylline comparison exposes stored values and missing activity',async({page})=>{
 await ready(page);
 await page.click('[data-neighbour="2153"]');
 await expect(page.locator('#inquiry-compare')).not.toHaveAttribute('open');
 await expect(page.locator('#inquiry-pair')).toBeVisible();
 await page.locator('#inquiry-compare summary').click();
 await expect(page.locator('#inquiry-compare')).toHaveAttribute('open','');
 await expect(page.locator('#inquiry-comparison')).toContainText('10.86');
 await expect(page.locator('#inquiry-comparison')).toContainText('Caffeine has no activity aggregate in this snapshot');
 await expect(page.locator('#inquiry-comparison')).toContainText('Stored median pChEMBL 4.25');
 await expect(page.locator('#inquiry-comparison')).toContainText('IC50, Ki · 4 ChEMBL documents');
 await expect(page.locator('#inquiry-comparison')).toContainText('do not support a potency difference');
 await page.click('[data-inquiry-map="pca"]');
 await expect(page.locator('#inquiry-comparison caption')).toContainText('independent of the current map');
 await expect(page.locator('#inquiry-map-context')).toBeVisible();
 await expect(page.locator('[data-neighbour="6918250"]')).toContainText('Identity mapping needs review');
 await page.click('[data-neighbour="6918250"]');
 await expect(page.locator('#inquiry-comparison')).toContainText('do not describe validated ofatumumab chemistry');
 await page.click('[data-inquiry-map="properties"]');
 await page.click('[data-neighbour="2153"]');
 expect(await page.locator('#inquiry-comparison a[href="https://pubchem.ncbi.nlm.nih.gov/compound/2153"]').count()).toBe(1);
 const actual=await page.evaluate(()=>{const h=window.__hansch;return [h.app.byCid.get(2519).d.tpsa,h.app.byCid.get(2153).d.tpsa]});
 expect(actual).toEqual([61.82,72.68]);
});

test('pair values and selected identity persist across maps with keyboard descriptor controls @mobile',async({page})=>{
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 await ready(page);
 await page.click('[data-neighbour="2153"]');
 const pair=page.locator('#inquiry-pair'), disclosure=page.locator('#inquiry-compare');
 await expect(disclosure).not.toHaveAttribute('open');
 await expect(pair.locator('[data-pair-name="a"]')).toHaveText('Caffeine');
 await expect(pair.locator('[data-pair-name="b"]')).toHaveText('Theophylline');
 const controls=pair.getByRole('group',{name:'Descriptor to compare'});
 for(const [name,key,a,b,delta] of [
  ['TPSA','tpsa','61.820 Å²','72.680 Å²','+10.860 Å²'],
  ['log P','logp','−1.029','−1.040','−0.011'],
  ['Molar refractivity','mr','51.196 cm³/mol','46.576 cm³/mol','−4.620 cm³/mol'],
 ]){
  const button=controls.getByRole('button',{name,exact:true});
  await button.focus();await page.keyboard.press('Enter');
  await expect(button).toHaveAttribute('aria-pressed','true');
  await expect(controls.locator('[aria-pressed="true"]')).toHaveCount(1);
  await expect(pair.locator('[data-pair-value="a"]')).toHaveText(a);
  await expect(pair.locator('[data-pair-value="b"]')).toHaveText(b);
  await expect(pair.getByRole('status')).toContainText(delta);
  await expect(pair.locator('.pair-ruler').getByRole('img')).toHaveAccessibleName(/Pair window, not population scale/);
  expect(await page.evaluate(()=>window.__hansch.app.inquiry.descriptor)).toBe(key);
 }
 for(const map of ['pca','structure','properties']){
  await page.click(`[data-inquiry-map="${map}"]`);
  await expect(page.locator(`[data-inquiry-map="${map}"]`)).toHaveAttribute('aria-pressed','true');
  await expect(pair.locator('[data-pair-name="b"]')).toHaveText('Theophylline');
  await expect(pair.getByRole('status')).toContainText('−4.620 cm³/mol');
  await expect(disclosure).not.toHaveAttribute('open');
  expect(await page.evaluate(()=>{const h=window.__hansch;return {pin:h.app.inquiry.cid,comparison:h.app.inquiry.comparisonCid,selected:h.app.drugs[h.app.selected].cid,descriptor:h.app.inquiry.descriptor};})).toEqual({pin:2519,comparison:2153,selected:2153,descriptor:'mr'});
 }
 expect(errors).toEqual([]);
});
