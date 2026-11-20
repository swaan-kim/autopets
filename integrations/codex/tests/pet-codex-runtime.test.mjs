import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import { runPet, petFailure, resolveCodexExecutable } from '../skills/autopets/scripts/pet.mjs';

const thread='11111111-1111-4111-8111-111111111111';
const cwd=path.resolve('fixture');
// A real absolute file stands in for codex.exe; the runtime itself is never spawned here.
const realExe=process.execPath;
const missingExe=path.join(os.tmpdir(),'autopets-test','OpenAI.Codex_0.0.0.0_x64__test','app','resources','codex.exe');
const unchanged={ok:true,link:null};

function deps(overrides={}) {
  const seen={inspect:[],connection:0,request:0};
  return {seen,value:{cwd,realpath:async v=>v,
    inspect:async args=>{ seen.inspect.push(args.executable); return {node:{cwd},models:[]}; },
    readConnection:async()=>{ seen.connection++; return {}; },
    request:async()=>{ seen.request++; return unchanged; },...overrides}};
}
const status=(args,env,d)=>runPet(['status','--connection',path.resolve('fixture-connection.json'),...args],{CODEX_THREAD_ID:thread,...env},d);

test('the host-provided CODEX_APP_RUNTIME_CLI_PATH alone selects the executable',async()=>{
  const d=deps();
  assert.deepEqual(await status([],{CODEX_APP_RUNTIME_CLI_PATH:realExe},d.value),unchanged);
  assert.deepEqual(d.seen.inspect,[realExe]);
});

test('--codex beats both environment variables and AUTOPETS_CODEX_EXECUTABLE beats the host variable',async()=>{
  const other=path.resolve('other-codex.exe'), isFile=async()=>true;
  assert.equal(await resolveCodexExecutable(realExe,{AUTOPETS_CODEX_EXECUTABLE:other,CODEX_APP_RUNTIME_CLI_PATH:other},isFile),realExe);
  assert.equal(await resolveCodexExecutable(undefined,{AUTOPETS_CODEX_EXECUTABLE:realExe,CODEX_APP_RUNTIME_CLI_PATH:other},isFile),realExe);
  const d=deps();
  await status(['--codex',realExe],{AUTOPETS_CODEX_EXECUTABLE:missingExe,CODEX_APP_RUNTIME_CLI_PATH:missingExe},d.value);
  assert.deepEqual(d.seen.inspect,[realExe]);
});

test('a missing --codex path is codex-runtime-unavailable before any runtime or bridge request',async()=>{
  const d=deps();
  // A valid host path must not silently replace the explicitly given stale one.
  await assert.rejects(status(['--codex',missingExe],{CODEX_APP_RUNTIME_CLI_PATH:realExe},d.value),error=>{
    assert.equal(error.message,'codex-runtime-unavailable');
    const failure=petFailure(error);
    assert.equal(failure.code,'codex-runtime-unavailable');
    assert.equal(failure.message,'현재 Codex 실행 파일을 찾을 수 없습니다. Codex 업데이트로 경로가 변경됐을 수 있습니다.');
    assert.equal(failure.retrySubmission,false);
    assert.doesNotMatch(JSON.stringify(failure),/OpenAI\.Codex|autopets-test|[A-Z]:\\/u);
    return true;
  });
  assert.deepEqual(d.seen,{inspect:[],connection:0,request:0});
});

test('stale, relative, directory and absent executables are refused without falling through',async()=>{
  for(const env of [{AUTOPETS_CODEX_EXECUTABLE:missingExe,CODEX_APP_RUNTIME_CLI_PATH:realExe},{CODEX_APP_RUNTIME_CLI_PATH:missingExe},
    {CODEX_APP_RUNTIME_CLI_PATH:'codex.exe'},{CODEX_APP_RUNTIME_CLI_PATH:os.tmpdir()}]) {
    const d=deps();
    await assert.rejects(status([],env,d.value),/^Error: codex-runtime-unavailable$/u);
    assert.equal(d.seen.inspect.length,0);
  }
  await assert.rejects(status([],{CODEX_APP_RUNTIME_CLI_PATH:''},deps().value),/^Error: codex-runtime-required$/u);
  assert.match(petFailure(Error('codex-runtime-required')).message,/실행 파일 경로를 받지 못했습니다/u);
  await assert.rejects(status(['--codex','codex.exe'],{},deps().value),/absolute-path-required/u);
});

test('a missing connection file stays a connection error, not a Codex error',async()=>{
  const {readConnection:_unused,...rest}=deps().value;
  const file=path.join(os.tmpdir(),`autopets-missing-${process.pid}`,'connection.json');
  await assert.rejects(runPet(['status','--codex',realExe,'--connection',file],{CODEX_THREAD_ID:thread},rest),error=>{
    const failure=petFailure(error);
    assert.equal(failure.code,'connection-unavailable');
    assert.match(failure.message,/연결 파일을 찾을 수 없어요/u);
    assert.doesNotMatch(JSON.stringify(failure),/autopets-missing/u);
    return true;
  });
});

test('a connection file whose bridge is not listening is bridge-unavailable and the token stays private',async t=>{
  const server=createServer(); await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const port=server.address().port; await new Promise(r=>server.close(r));
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'autopets-bridge-')); t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const token='secret_token_value_that_must_not_leak_0123456789';
  const file=path.join(dir,'connection.json');
  await fs.writeFile(file,JSON.stringify({version:1,token,baseUrl:`http://127.0.0.1:${port}`}));
  const {readConnection:_r,request:_q,...rest}=deps().value;
  await assert.rejects(runPet(['status','--codex',realExe,'--connection',file],{CODEX_THREAD_ID:thread},rest),error=>{
    const failure=petFailure(error);
    assert.equal(failure.code,'bridge-unavailable');
    assert.match(failure.message,/로컬 연결이 응답하지 않아요/u);
    assert.doesNotMatch(JSON.stringify(failure),new RegExp(`${token}|${port}|autopets-bridge`,'u'));
    return true;
  });
});

test('runtime failures and unknown internal errors expose only a fixed code and message',async()=>{
  const raw=`spawn ${missingExe} ENOENT Bearer abcdefghijklmnopqrstuvwxyz0123456789 C:\\Users\\someone\\connection.json`;
  for(const thrown of [Error('Runtime transport closed'),Object.assign(Error(raw),{code:'ENOENT',path:missingExe})]) {
    const d=deps({inspect:async()=>{ throw thrown; }});
    await assert.rejects(status([],{CODEX_APP_RUNTIME_CLI_PATH:realExe},d.value),error=>{
      assert.equal(error.message,'codex-runtime-failed');
      assert.equal(petFailure(error).code,'codex-runtime-failed');
      return true;
    });
    assert.equal(d.seen.connection,0);
  }
  // Known short codes from the runtime still pass through unchanged.
  await assert.rejects(status([],{CODEX_APP_RUNTIME_CLI_PATH:realExe},deps({inspect:async()=>{ throw Error('unsupported-current-task'); }}).value),/^Error: unsupported-current-task$/u);
  for(const error of [Error(raw),Error('x'.repeat(65)),{message:'token'.padEnd(80,'-')},null,'plain string']) {
    const failure=petFailure(error), text=JSON.stringify(failure);
    assert.equal(failure.code,'pet-internal-error');
    assert.equal(failure.retrySubmission,false);
    assert.match(failure.message,/세부 내용은 표시하지 않아요/u);
    assert.doesNotMatch(text,/Bearer|abcdefghij|someone|OpenAI|ENOENT|connection\.json/u);
    assert.deepEqual(Object.keys(failure).sort(),['code','message','ok','retrySubmission']);
  }
});
