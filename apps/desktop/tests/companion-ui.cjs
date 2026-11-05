const assert = require('node:assert/strict');
const path = require('node:path');
const template = require('../../../packages/contracts/data/ui-pet.json');
const dailyTemplate = require('../../../packages/contracts/data/pet-catalog.json').find(entry => entry.id === 'daily-plan').template;

exports.runCompanionChecks = async ({newPage,mockBridge,fixture,origin,screenshotDir,checks}) => {
 const screenshots=[];
 const unassigned = await newPage({ width: 180, height: 230 });
 await unassigned.emulateMedia({ reducedMotion: 'no-preference' });
 await mockBridge(unassigned, { ...structuredClone(fixture), sessions: [], petLinks: [], slots: [0, 1, 2].map(index => ({ index, sessionId: null })) });
 await unassigned.goto(`${origin}/?pet=0`);
 await unassigned.locator('.pet-hit [role="img"]').waitFor();
 const idlePet = unassigned.locator('.pet-hit .companion-pet');
 assert.equal(await idlePet.count(), 1, 'an unassigned overlay must not remain a paused still image');
 await unassigned.locator('.pet-hit .companion-pet[data-assets="ready"][data-playing="true"]').waitFor();
 await idlePet.locator('[data-clip="blink"]').waitFor();
 assert.equal(await idlePet.getAttribute('data-state'), 'idle');
 assert.ok(await idlePet.evaluate(element => element.getAnimations({ subtree: true }).some(animation => animation.playState === 'running')));
 const idleBefore = await unassigned.evaluate(() => JSON.stringify({ calls: window.__uiTest.calls, sessions: window.__uiTest.state.sessions, links: window.__uiTest.state.petLinks, slots: window.__uiTest.state.slots }));
 const idleStatus = await unassigned.locator('.floating-status').textContent();
 await unassigned.locator('.pet-hit').dispatchEvent('pointerdown', { button: 0 });
 await idlePet.locator('[data-clip="greet"]').waitFor();
 assert.equal(await unassigned.evaluate(() => JSON.stringify({ calls: window.__uiTest.calls, sessions: window.__uiTest.state.sessions, links: window.__uiTest.state.petLinks, slots: window.__uiTest.state.slots })), idleBefore, 'an idle reaction never connects, assigns or executes work');
 assert.equal(await unassigned.getByRole('button', { name: '모스 · 작업 카드 열기', exact: true }).count(), 1);
 assert.equal(await unassigned.locator('.floating-status').textContent(), idleStatus);
 await unassigned.setViewportSize({ width: 328, height: 600 });
 for (const key of ['Enter', 'Space']) {
   await unassigned.locator('.pet-hit').focus();
   await unassigned.keyboard.press(key);
   await unassigned.locator('.pet-quick-card').waitFor();
   assert.equal(await unassigned.locator('.pet-hit').getAttribute('aria-expanded'), 'true');
   await idlePet.locator('[data-clip="greet"]').waitFor();
   await unassigned.keyboard.press('Escape');
   await unassigned.locator('.pet-quick-card').waitFor({ state: 'hidden' });
   assert.equal(await unassigned.locator('.pet-hit').evaluate(element => element === document.activeElement), true);
 }
 await unassigned.emulateMedia({ reducedMotion: 'reduce' });
 await unassigned.waitForFunction(() => document.querySelector('.pet-hit .companion-pet')?.dataset.playing === 'false');
 assert.equal(await idlePet.evaluate(element => element.getAnimations({ subtree: true }).length), 0);
 await unassigned.emulateMedia({ reducedMotion: 'no-preference' });
 await unassigned.waitForFunction(() => document.querySelector('.pet-hit .companion-pet')?.dataset.playing === 'true');
 await unassigned.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
 await unassigned.waitForFunction(() => document.querySelector('.pet-hit .companion-pet')?.dataset.playing === 'false');
 assert.equal(await idlePet.evaluate(element => element.getAnimations({ subtree: true }).length), 0);
 await unassigned.close();
 checks.push('unassigned compact overlay breathes/blinks and reacts to touch without assigning or running work; Enter/Space preserve menu and Escape focus; its identity/waiting status and reduced/hidden stop remain intact');
 const page=await newPage({width:992,height:688});
 await mockBridge(page,{...structuredClone(fixture),sessions:[],slots:[],petLinks:[],setup:{version:1,connectionMode:'explicit-pet',connections:[{hostId:'codex-windows-local',configured:true}]}});
 await page.goto(origin);
 await page.locator('.workspace-role-grid').waitFor();
 assert.equal(await page.locator('.pet-home').count(),0,'first use opens the useful catalog without an extra home step');
 await page.locator('.app-header nav').getByRole('button',{name:'홈',exact:true}).click();
 const home=page.locator('.pet-home');
 assert.equal(await home.getAttribute('data-agent-scope'),'home');
 for(const id of ['home.root','home.greeting','home.title','home.intro','home.choose-pet','home.connection']) assert.equal(await home.locator(`[data-agent-id="${id}"]`).count()+(id==='home.root'?1:0),1,'each home feedback target has a unique stable id');
 await home.locator('[data-assets="ready"]').first().waitFor();
 const capture=async(name)=>{const p=path.join(screenshotDir,`companion-${name}.png`);await page.screenshot({path:p,fullPage:true});screenshots.push(p);};
 await capture('first');
 const greeting=page.locator('.pet-home-greeting');
 await greeting.focus();await page.keyboard.press('Enter');
 assert.equal(await page.locator('.pet-home-find').evaluate(el=>document.activeElement===el),true,'pet keyboard greeting focuses choosing a pet without submitting a task');
 assert.equal(await page.locator('.pet-home-find').getAttribute('aria-describedby'),'home-codex-hint');
 assert.deepEqual(await page.evaluate(()=>window.__uiTest.calls),[],'greeting does not save, connect, or execute');
 await page.emulateMedia({reducedMotion:'reduce'});
 await home.locator('.companion-pet[data-playing="false"]').waitFor();
 for(const [w,h] of [[992,688],[716,701],[390,844]]){
   await page.setViewportSize({width:w,height:h});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
   const action=page.locator('.pet-home-find');
   await action.scrollIntoViewIfNeeded();assert.equal(await action.isVisible(),true);
   await capture(`viewport-${w}`);
 }
 await page.setViewportSize({width:992,height:688});await page.emulateMedia({reducedMotion:'no-preference'});
 await page.locator('.app-header nav').getByRole('button',{name:'내 작업',exact:true}).click();
 assert.ok(await page.locator('.pet-home .companion-pet').evaluateAll(nodes=>nodes.every(n=>n.dataset.playing==='false')),'hidden home stops motion');
 await page.close();

 const run={id:'companion-run-a',settingsRevision:1,profile:'standard',model:'fixture-model',effort:'low',state:'working',childId:'child-a',turnId:'turn-a',observedModel:'fixture-model',observedEffort:'low',evidence:null,startedAt:Date.now(),resultReturned:true,runtimeCompleted:true};
 const link={version:1,target:{sourceId:'codex-windows-local',threadId:'11111111-2222-4333-8444-555555555555',cwd:'C:/UI fixture only A'},slot:0,revision:1,enabled:true,connected:true,profile:'standard',template:dailyTemplate,run};
 const b={...structuredClone(link),slot:1,template,target:{...link.target,threadId:'22222222-2222-4333-8444-555555555555',cwd:'C:/UI fixture only B'},run:{...run,id:'companion-run-b',state:'waiting'}};
 const live=await newPage({width:992,height:688});
 await mockBridge(live,{...structuredClone(fixture),sessions:[],slots:[],petLinks:[link,b]}); await live.goto(origin); await live.locator('.app-header nav').getByRole('button',{name:'내 작업',exact:true}).click();
 const aPet=live.locator('.pet-card-0 .companion-pet'), bPet=live.locator('.pet-card-1 .companion-pet');
 await aPet.scrollIntoViewIfNeeded();
 await aPet.locator('[data-clip="working"]').waitFor();
 assert.equal(await aPet.getAttribute('data-playing'),'true','a compact daily pet animates its real work state as a UI pet does');
 await aPet.evaluate(pet=>{
  const sprite=pet.querySelector('.companion-sprite:not(.companion-previous-pose)');
  const clip=sprite.getAnimations().find(animation=>animation.effect.getKeyframes().some(frame=>frame.backgroundPosition));
  clip.pause();clip.currentTime=900;
  const presence=pet.querySelector('.companion-body').getAnimations()[0];presence.pause();presence.currentTime=1100;
  window.__continuingMotion={clip,presence,position:getComputedStyle(sprite).backgroundPosition};
 });
 await live.locator('.pet-card-0 .task-pet-art').dispatchEvent('pointerdown');
 await live.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal(await aPet.evaluate(pet=>{
  const sprite=pet.querySelector('.companion-sprite:not(.companion-previous-pose)');
  return sprite.getAnimations().includes(window.__continuingMotion.clip) && window.__continuingMotion.clip.currentTime===900
   && getComputedStyle(sprite).backgroundPosition===window.__continuingMotion.position;
 }),true,'touching a working pet preserves its exact animation and rendered pose');
 assert.equal(await aPet.locator('[data-clip="greet"]').count(),0,'interacting with a working pet preserves its work pose');
 await aPet.locator('[data-clip="working"]').waitFor();
 const update=async(state,connected=true)=>live.evaluate(({state,connected})=>{const a=window.__uiTest.state.petLinks[0];a.run.state=state;a.connected=connected;window.__uiTest.emitEvent('autopets://snapshot',structuredClone(window.__uiTest.state));},{state,connected});
 await aPet.locator('.companion-sprite:not(.companion-previous-pose)').evaluate(element=>{element.getAnimations().forEach(animation=>animation.pause());window.__previousPose=getComputedStyle(element).backgroundPosition;});
 await update('waiting');await aPet.locator('[data-clip="waiting"]').waitFor();
 assert.equal(await aPet.evaluate(pet=>pet.querySelector('.companion-body').getAnimations().includes(window.__continuingMotion.presence)
  && window.__continuingMotion.presence.currentTime===1100),true,'presence motion keeps its clock while the task changes state');
 await live.evaluate(()=>window.__continuingMotion.presence.play());
 assert.equal(await aPet.locator('.companion-previous-pose').evaluate(element=>element.style.backgroundPosition===window.__previousPose),true,'pose transition preserves the rendered frame before canceling its animation');
 await update('working');await live.waitForFunction(()=>document.querySelector('.pet-card-0 .companion-pet')?.dataset.state==='working');await aPet.scrollIntoViewIfNeeded();await aPet.locator('[data-clip="working"]').waitFor();
 await live.evaluate(()=>{window.__completedClips=0;let last='working';new MutationObserver(()=>{const clip=document.querySelector('.pet-card-0 .companion-sprite')?.dataset.clip;if(clip==='complete' && last!=='complete')window.__completedClips++;last=clip;}).observe(document.querySelector('.pet-card-0'),{subtree:true,attributes:true,attributeFilter:['data-clip']});});
 await update('complete'); await aPet.scrollIntoViewIfNeeded(); await aPet.locator('[data-clip="complete"]').waitFor();
 await aPet.evaluate(pet=>{
  const clip=pet.querySelector('.companion-sprite:not(.companion-previous-pose)').getAnimations().find(animation=>animation.effect.getKeyframes().some(frame=>frame.backgroundPosition));
  clip.pause();clip.currentTime=450;window.__completionMotion=clip;
 });
 await live.locator('.pet-card-0 .task-pet-art').dispatchEvent('pointerdown');
 await live.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal(await aPet.evaluate(pet=>pet.querySelector('.companion-sprite:not(.companion-previous-pose)').getAnimations().includes(window.__completionMotion)
  && window.__completionMotion.currentTime===450),true,'touching a completion does not cancel or replay its one-shot clip');
 await live.evaluate(()=>window.__completionMotion.play());
 await aPet.locator('[data-clip="blink"]').waitFor();
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
 await update('working');await live.waitForFunction(()=>document.querySelector('.pet-card-0 .companion-pet')?.dataset.state==='working');
 await aPet.scrollIntoViewIfNeeded();await aPet.locator('[data-clip="working"]').waitFor();
 await live.emulateMedia({reducedMotion:'reduce'});
 await live.waitForFunction(()=>[...document.querySelectorAll('.companion-pet')].every(el=>el.dataset.playing==='false'));
 assert.equal(await live.locator('.companion-pet, .companion-pet *').evaluateAll(nodes=>nodes.reduce((n,el)=>n+el.getAnimations().length,0)),0,'reduced motion stops every presentation layer');
 await live.emulateMedia({reducedMotion:'no-preference'});await aPet.scrollIntoViewIfNeeded();await aPet.locator('[data-clip="working"]').waitFor();
 await live.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 await live.waitForFunction(()=>[...document.querySelectorAll('.companion-pet')].every(el=>el.dataset.playing==='false'));
 assert.equal(await live.locator('.companion-pet, .companion-pet *').evaluateAll(nodes=>nodes.reduce((n,e)=>n+e.getAnimations().length,0)),0);
 await live.close();

 const fallback=await newPage(); await fallback.route('**/companion-v1/social.webp',route=>route.abort());await fallback.goto(origin);await fallback.locator('.app-header nav').getByRole('button',{name:'홈',exact:true}).click();
 await fallback.locator('.pet-home [data-assets="failed"] [data-asset="soft"]').waitFor(); await fallback.close();
 const locks=await newPage();await locks.goto(origin);
 const claimed=await locks.evaluate(async()=>{const m=await import('/src/features/pets/companionMotion.ts');return Promise.all(Array.from({length:8},()=>m.claimCompletion('test-shared-run')));});
 assert.equal(claimed.filter(Boolean).length,1,'concurrent completion receipts claim once');
 await locks.evaluate(()=>localStorage.setItem('autopets.companion-completions.v1','broken'));
 assert.equal(await locks.evaluate(async()=>{const m=await import('/src/features/pets/companionMotion.ts');return m.claimCompletion('another-run');}),false,'damaged receipt suppresses celebration');
 await locks.close();
 checks.push('home greeting; work/completion interaction preserves exact timeline and pose; presence clock spans task states; A/B isolation; completion dedupe/reload/reconnect; reduced/hidden stops all layers; small viewports, fallback and concurrent receipts');
 return screenshots;
};
