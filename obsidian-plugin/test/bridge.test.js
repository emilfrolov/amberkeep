'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {startBridge,connectionPath}=require('../src/bridge');

function request(port,{method='GET',route='/status',token,headers={},body}={}){
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port,path:route,method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...headers}},response=>{
      let text='';response.on('data',chunk=>text+=chunk);response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:JSON.parse(text)}));
    });req.on('error',reject);req.end(body);
  });
}
async function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'amberkeep-bridge-test-'));
  const vault=path.join(directory,'Vault');fs.mkdirSync(vault);
  const connectionDirectory=path.join(directory,'connections');
  let writes=0;
  const bridge=await startBridge({vaultPath:vault,connectionDirectory,handlers:{status:()=>({connected:true}),sync:()=>({started:true}),cancel:()=>({cancelled:true}),pending:()=>({sources:[]}),source:id=>({sourceId:id}),knowledge:()=>{writes++;return{saved:true};},openGraph:()=>({opened:true})}});
  const recordPath=connectionPath(vault,connectionDirectory);
  const record=JSON.parse(fs.readFileSync(recordPath,'utf8'));
  t.after(async()=>{await bridge.close();assert.equal(fs.existsSync(recordPath),false);fs.rmSync(directory,{recursive:true,force:true});});
  return {bridge,record,recordPath,connectionDirectory,writes:()=>writes};
}
test('the live bridge uses a private vault-specific connection and authenticated loopback route',async t=>{
  const f=await fixture(t);
  assert.match(f.record.token,/^[a-f0-9]{64}$/);
  if(process.platform!=='win32'){assert.equal(fs.statSync(f.recordPath).mode&0o777,0o600);assert.equal(fs.statSync(f.connectionDirectory).mode&0o777,0o700);}
  assert.equal((await request(f.record.port)).status,401);
  assert.equal((await request(f.record.port,{token:'f'.repeat(64)})).status,401);
  const response=await request(f.record.port,{token:f.record.token});assert.equal(response.status,200);assert.equal(response.body.connected,true);assert.equal(response.headers['access-control-allow-origin'],undefined);
});
test('browser origins and foreign Host headers cannot invoke vault writes',async t=>{
  const f=await fixture(t);
  for(const headers of [{Origin:'https://claude.ai'},{Origin:'null'},{Host:'attacker.invalid'},{'Sec-Fetch-Site':'cross-site'}]){
    assert.equal((await request(f.record.port,{method:'POST',route:'/knowledge',token:f.record.token,headers,body:'{}'})).status,403);
  }
  assert.equal(f.writes(),0);
});
test('the bridge bounds JSON and exposes only its explicit source and knowledge routes',async t=>{
  const f=await fixture(t);
  assert.equal((await request(f.record.port,{method:'POST',route:'/knowledge',token:f.record.token,body:'not json'})).status,400);
  assert.equal((await request(f.record.port,{method:'POST',route:'/knowledge',token:f.record.token,body:'x'.repeat(524289)})).status,413);
  assert.equal((await request(f.record.port,{route:'/private-files',token:f.record.token})).status,404);
  assert.deepEqual((await request(f.record.port,{route:'/sources/'+encodeURIComponent('conversation:org:source'),token:f.record.token})).body,{sourceId:'conversation:org:source'});
  assert.equal((await request(f.record.port,{method:'POST',route:'/knowledge',token:f.record.token,body:'{}'})).body.saved,true);
  assert.equal(f.writes(),1);
});
