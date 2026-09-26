const assert = require('node:assert/strict');
const path = require('node:path');
const templates = require('../../../packages/contracts/data/roles.json');
exports.runPetLinkChecks = async ({ newPage, mockBridge, fixture, origin, screenshotDir, checks }) => {
  const page=await newPage({width:1120,height:900});
  const value={...structuredClone(fixture),sessions:[],slots:[0,1,2].map(index=>({index,sessionId:null})),petLinks:[{
    version:1,target:{sourceId:'codex-windows-local',threadId:'fixture-parent',cwd:'C:/UI fixture only'},slot:0,revision:1,enabled:true,connected:true,profile:'light',template:templates[1],run:null,
  }]};
  await mockBridge(page,value);await page.goto(origin);
  await page.getByText('채팅 연결됨 · 작업을 기다려요',{exact:true}).waitFor();
  assert.equal(await page.getByText('펫 작업 완료',{exact:true}).count(),0);
  await page.evaluate(()=>{window.__uiTest.state.petLinks[0].run={state:'returned'};window.__uiTest.emitEvent('autopets://snapshot',window.__uiTest.state);});
  await page.getByText('결과 반환 · 실행 기록 확인 필요',{exact:true}).waitFor();
  await page.evaluate(()=>{window.__uiTest.state.petLinks[0].run.state='waiting';window.__uiTest.emitEvent('autopets://snapshot',window.__uiTest.state);});
  await page.getByText('계획 확인 필요',{exact:true}).waitFor();
  const image=path.join(screenshotDir,'native-ui-explicit-pet.png');await page.screenshot({path:image,fullPage:true});
  const overlay=await newPage({width:420,height:640});await mockBridge(overlay,value);await overlay.goto(`${origin}/?pet=0`);
  await overlay.getByRole('button',{name:'제작 펫 메뉴',exact:true}).click();
  await overlay.getByRole('button',{name:'도움 끄기',exact:true}).waitFor();
  await overlay.evaluate(()=>{window.__uiTest.state.petLinks[0].connected=false;window.__uiTest.emitEvent('autopets://snapshot',window.__uiTest.state);});
  await overlay.getByText('저장됨 · 채팅에서 연결을 다시 확인해 주세요',{exact:true}).first().waitFor();
  checks.push('explicit pet connection works without a hook session, returned results are unverified, plans await confirmation, restart is disconnected');
  return [image];
};
