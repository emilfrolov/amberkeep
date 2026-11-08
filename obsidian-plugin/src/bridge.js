'use strict';
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');

function connectionPath(vaultPath, connectionDirectory) {
  const canonical=fs.realpathSync(vaultPath);
  const directory=connectionDirectory || path.join(fs.realpathSync(os.homedir()),'.amberkeep','connections');
  return path.join(directory,crypto.createHash('sha256').update(canonical).digest('hex')+'.json');
}

async function startBridge({vaultPath,handlers,connectionDirectory}) {
  const token=crypto.randomBytes(32).toString('hex');
  const recordPath=connectionPath(vaultPath,connectionDirectory);
  const directory=path.dirname(recordPath);
  if(fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink())throw new Error('Connection directory cannot be a symlink.');
  const parent=path.dirname(directory);
  if(fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink())throw new Error('Connection directory parent cannot be a symlink.');
  fs.mkdirSync(directory,{recursive:true,mode:0o700});fs.chmodSync(directory,0o700);
  const server=http.createServer(async (request,response) => {
    const send=(status,value)=>{if(!response.destroyed){response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(value));}};
    const host=request.headers.host || '';
    if (!/^127\.0\.0\.1:\d+$/.test(host) || request.headers.origin || request.headers['sec-fetch-site']) return send(403,{error:'Browser access is not allowed.'});
    const supplied=request.headers.authorization || '';
    const expected='Bearer '+token;
    if (Buffer.byteLength(supplied)!==Buffer.byteLength(expected) || !crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected))) return send(401,{error:'Invalid local connection token.'});
    try {
      const url=new URL(request.url,'http://127.0.0.1');
      let body={};
      if(request.method==='POST') {
        let bytes=0;const chunks=[];
        for await(const chunk of request){bytes+=chunk.length;if(bytes>524288){send(413,{error:'Request too large.'});return;}chunks.push(chunk);}
        try{body=chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{};}catch{return send(400,{error:'Invalid JSON.'});}
      }
      const key=request.method+' '+url.pathname;
      if(key==='GET /status') return send(200,await handlers.status());
      if(key==='POST /sync') return send(200,await handlers.sync());
      if(key==='POST /cancel') return send(200,await handlers.cancel());
      if(key==='GET /pending') return send(200,await handlers.pending(url.searchParams));
      if(key==='GET /sources' || (request.method==='GET' && url.pathname.startsWith('/sources/'))) {
        return send(200,await handlers.source(decodeURIComponent(url.pathname.slice('/sources/'.length)),url.searchParams));
      }
      if(key==='POST /knowledge') return send(200,await handlers.knowledge(body));
      if(key==='POST /open-graph') return send(200,await handlers.openGraph());
      return send(404,{error:'Unknown endpoint.'});
    } catch(error) {return send(error.status || 400,{error:error.message || 'Local request failed.'});}
  });
  server.requestTimeout=15000;
  server.headersTimeout=10000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const record={port:server.address().port,token,version:1};
  try {
    // Replace an old connector record without following a pre-existing symlink.
    const temporary=recordPath+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';
    fs.writeFileSync(temporary,JSON.stringify(record),{mode:0o600,flag:'wx'});
    fs.renameSync(temporary,recordPath);
  } catch(error){server.close();throw error;}
  return {port:record.port,close:async()=>{
    try{const own=JSON.parse(fs.readFileSync(recordPath,'utf8'));if(own.token===token)fs.unlinkSync(recordPath);}catch{}
    await new Promise(resolve=>server.close(resolve));
  }};
}
module.exports={connectionPath,startBridge};
