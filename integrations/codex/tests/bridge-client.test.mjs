import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { requestJson } from '../skills/autopets/scripts/bridge-client.mjs';
import { runPet, petFailure } from '../skills/autopets/scripts/pet.mjs';
import path from 'node:path';

async function fixture(t, status, body) {
  const requests=[];
  const server=createServer(async (req,res)=>{
    const chunks=[];
    for await(const chunk of req) chunks.push(chunk);
    requests.push({path:req.url,body:Buffer.concat(chunks).toString('utf8')});
    res.writeHead(status,{'Content-Type':'application/json'});
    res.end(body);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  return {connection:{baseUrl:`http://127.0.0.1:${server.address().port}`,token:'test-token'},requests};
}

test('full installed-app slots reach the caller without retrying or replacing a connection',async t=>{
  const f=await fixture(t,409,JSON.stringify({error:'slots-full'}));
  const cwd=path.resolve('fixture');
  await assert.rejects(runPet(['connect','--codex',path.resolve('codex.exe'),'--connection',path.resolve('connection.json'),
    '--pet','saved-pet','--pet-revision','1'],{CODEX_THREAD_ID:'11111111-1111-4111-8111-111111111111'},
  {cwd,realpath:async v=>v,inspect:async()=>({node:{cwd},models:[]}),readConnection:async()=>f.connection}),error=>{
    assert.equal(error.code,'slots-full'); assert.equal(error.status,409);
    const failure=petFailure(error);
    assert.equal(failure.retrySubmission,false);
    assert.match(failure.message,/연결을 하나 해제/);
    return true;
  });
  assert.equal(f.requests.length,1);
  assert.equal(JSON.parse(f.requests[0].body).operation,'connect');
});

test('only an exact capacity code at the expected endpoint and status may leave the bridge',async t=>{
  const cases=[
    [409,'/v1/pet-link',JSON.stringify({error:'private task contents / user path'})],
    [409,'/v1/pet-link',JSON.stringify({error:'slots-full / private task contents'})],
    [409,'/v1/pet-link',JSON.stringify({error:'slots-full',detail:'x'.repeat(5000)})],
    [409,'/v1/pet-link','{malformed'],
    [409,'/v1/pet-link','["slots-full"]'],
    [401,'/v1/pet-link',JSON.stringify({error:'slots-full'})],
    [409,'/v1/events',JSON.stringify({error:'slots-full'})],
  ];
  for(const [status,endpoint,body] of cases) {
    const f=await fixture(t,status,body);
    await assert.rejects(requestJson(f.connection,endpoint,{operation:'connect'}),error=>{
      assert.equal(error.code,'bridge-rejected'); assert.equal(error.status,status);
      assert.deepEqual(petFailure(error),{ok:false,code:'bridge-rejected',retrySubmission:false});
      return true;
    });
    assert.equal(f.requests.length,1);
  }
});

test('successful responses keep their existing bounded JSON contract',async t=>{
  const valid=await fixture(t,200,JSON.stringify({ok:true,link:null}));
  assert.deepEqual(await requestJson(valid.connection,'/v1/pet-link',{operation:'read'}),{ok:true,link:null});
  const oversized=await fixture(t,200,JSON.stringify({ok:true,detail:'x'.repeat(5000)}));
  await assert.rejects(requestJson(oversized.connection,'/v1/pet-link',{}),{code:'response-size'});
});
