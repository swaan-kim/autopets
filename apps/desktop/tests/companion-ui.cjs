const assert = require('node:assert/strict');
const path = require('node:path');
const template = require('../../../packages/contracts/data/ui-pet.json');

exports.runCompanionChecks = async ({newPage,mockBridge,fixture,origin,screenshotDir,checks}) => {
 const screenshots=[];
 const page=await newPage({width:992,height:688});
 await mockBridge(page,{...structuredClone(fixture),sessions:[],slots:[],petLinks:[],setup:{version:1,connectionMode:'explicit-pet',connections:[{hostId:'codex-windows-local',configured:true}]}});
 await page.goto(origin);
 const home=page.locator('.pet-home');
 await home.locator('[data-assets="ready"]').first().waitFor();
 const capture=async(name)=>{const p=path.join(screenshotDir,`companion-${name}.png`);await page.screenshot({path:p,fullPage:true});screenshots.push(p);};
 await capture('first');
 const greeting=page.locator('.pet-home-greeting');
 await greeting.focus();await page.keyboard.press('Enter');
 assert.equal(await page.getByLabel('맡길 일',{exact:true}).evaluate(el=>document.activeElement===el),true,'pet keyboard greeting focuses request input');
 assert.deepEqual(await page.evaluate(()=>window.__uiTest.calls),[],'greeting does not save, connect, or execute');
 await page.emulateMedia({reducedMotion:'reduce'});
 await home.locator('.companion-pet[data-playing="false"]').waitFor();
 for(const [w,h] of [[992,688],[716,701],[390,844]]){
   await page.setViewportSize({width:w,height:h});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
   const action=page.getByRole('button',{name:'펫 찾기',exact:true});
   await action.scrollIntoViewIfNeeded();assert.equal(await action.isVisible(),true);
   await capture(`viewport-${w}`);
 }
 await page.setViewportSize({width:992,height:688});await page.emulateMedia({reducedMotion:'no-preference'});
 await page.locator('.app-header nav').getByRole('button',{name:'내 작업',exact:true}).click();
 assert.ok(await page.locator('.pet-home .companion-pet').evaluateAll(nodes=>nodes.every(n=>n.dataset.playing==='false')),'hidden home stops motion');
 await page.close();

 const run={id:'companion-run-a',settingsRevision:1,profile:'standard',model:'fixture-model',effort:'low',state:'working',childId:'child-a',turnId:'turn-a',observedModel:'fixture-model',observedEffort:'low',evidence:null,startedAt:Date.now(),resultReturned:true,runtimeCompleted:true};
 const link={version:1,target:{sourceId:'codex-windows-local',threadId:'11111111-2222-4333-8444-555555555555',cwd:'C:/UI fixture only A'},slot:0,revision:1,enabled:true,connected:true,profile:'standard',template,run};
 const b={...structuredClone(link),slot:1,target:{...link.target,threadId:'22222222-2222-4333-8444-555555555555',cwd:'C:/UI fixture only B'},run:{...run,id:'companion-run-b',state:'waiting'}};
 const live=await newPage({width:992,height:688});
 await mockBridge(live,{...structuredClone(fixture),sessions:[],slots:[],petLinks:[link,b]}); await live.goto(origin); await live.locator('.app-header nav').getByRole('button',{name:'내 작업',exact:true}).click();
 const aPet=live.locator('.pet-card-0 .companion-pet'), bPet=live.locator('.pet-card-1 .companion-pet');
 await aPet.scrollIntoViewIfNeeded();
 await aPet.locator('[data-clip="working"]').waitFor();
 const update=async(state,connected=true)=>live.evaluate(({state,connected})=>{const a=window.__uiTest.state.petLinks[0];a.run.state=state;a.connected=connected;window.__uiTest.emitEvent('autopets://snapshot',structuredClone(window.__uiTest.state));},{state,connected});
 await live.evaluate(()=>{window.__completedClips=0;let last='working';new MutationObserver(()=>{const clip=document.querySelector('.pet-card-0 .companion-sprite')?.dataset.clip;if(clip==='complete' && last!=='complete')window.__completedClips++;last=clip;}).observe(document.querySelector('.pet-card-0'),{subtree:true,attributes:true,attributeFilter:['data-clip']});});
 await update('complete'); await aPet.scrollIntoViewIfNeeded(); await aPet.locator('[data-clip="complete"]').waitFor(); await aPet.locator('[data-clip="blink"]').waitFor();
 const count=await live.evaluate(()=>window.__completedClips);assert.equal(count,1);
 await update('complete');await update('complete',false);await aPet.scrollIntoViewIfNeeded();await aPet.locator('[data-clip="still"]').waitFor();await update('complete');await live.waitForTimeout(1700);
 assert.equal(await live.evaluate(()=>window.__completedClips),1,'duplicate and reconnect do not replay completion');
 assert.equal(await bPet.getAttribute('data-state'),'waiting');
 assert.deepEqual(await live.evaluate(()=>window.__uiTest.calls),[],'motions do not change tasks');
 // Persist a completed fixture before a document reload, as a real snapshot would.
 await live.addInitScript(()=>{window.__uiTest.state.petLinks[0].run.state='complete';}); await live.reload(); await live.locator('.app-header nav').getByRole('button',{name:'내 작업',exact:true}).click();
 await aPet.scrollIntoViewIfNeeded();
 await aPet.locator('[data-clip="blink"]').waitFor();
 assert.equal(await aPet.locator('[data-clip="complete"]').count(),0,'restored result does not celebrate');
 await update('unknown');await aPet.scrollIntoViewIfNeeded();await aPet.locator('[data-clip="still"]').waitFor();
 assert.equal(await aPet.getAttribute('data-state'),'error');
 await live.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 await live.waitForFunction(()=>[...document.querySelectorAll('.companion-pet')].every(el=>el.dataset.playing==='false'));
 assert.equal(await live.locator('.companion-sprite').evaluateAll(nodes=>nodes.reduce((n,e)=>n+e.getAnimations().length,0)),0);
 await live.close();

 const fallback=await newPage(); await fallback.route('**/companion-v1/social.webp',route=>route.abort());await fallback.goto(origin);
 await fallback.locator('.pet-home [data-assets="failed"] [data-asset="soft"]').waitFor(); await fallback.close();
 const locks=await newPage();await locks.goto(origin);
 const claimed=await locks.evaluate(async()=>{const m=await import('/src/features/pets/companionMotion.ts');return Promise.all(Array.from({length:8},()=>m.claimCompletion('test-shared-run')));});
 assert.equal(claimed.filter(Boolean).length,1,'concurrent completion receipts claim once');
 await locks.evaluate(()=>localStorage.setItem('autopets.companion-completions.v1','broken'));
 assert.equal(await locks.evaluate(async()=>{const m=await import('/src/features/pets/companionMotion.ts');return m.claimCompletion('another-run');}),false,'damaged receipt suppresses celebration');
 await locks.close();
 checks.push('home greeting focuses task input without backend changes; small viewports and reduced motion; A/B isolation; completion dedupe/reload/reconnect; hidden playback stops; failed assets fall back; concurrent receipts serialize');
 return screenshots;
};
