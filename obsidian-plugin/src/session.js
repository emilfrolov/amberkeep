'use strict';

const crypto = require('node:crypto');

// This guest never receives Node, a preload script, credentials from another
// application, or a bridge to Obsidian's filesystem.
class ClaudeSession {
  constructor(vaultPath) {
    this.partition = 'persist:amberkeep-' + crypto.createHash('sha256').update(vaultPath).digest('hex').slice(0,24);
    this.host = null;
    this.guest = null;
    this.ready = null;
    this.lastError = null;
    this.readinessTimer=null;
    this.rejectReady=null;
    this.loginHost=null;
  }

  createGuest(){
    const guest=document.createElement('webview');
    guest.setAttribute('partition',this.partition);
    guest.setAttribute('webpreferences','contextIsolation=yes,nodeIntegration=no,nodeIntegrationInSubFrames=no,sandbox=yes,webSecurity=yes,allowRunningInsecureContent=no');
    guest.className='amberkeep-login-browser';
    guest.src='https://claude.ai/';
    return guest;
  }

  ensure() {
    if (this.guest && this.guest.isConnected) return this.guest;
    this.host = document.createElement('div');
    this.host.className = 'amberkeep-session-hidden';
    const guest = this.createGuest();
    // In particular, do not set nodeintegration, preload, allowpopups, or
    // disablewebsecurity. Popups are denied by the guest's default settings.
    this.ready = new Promise((resolve,reject) => {
      this.rejectReady=reject;
      this.readinessTimer = setTimeout(() => reject(new Error('Claude sign-in window did not load. Open Connect Claude and retry.')),45000);
      guest.addEventListener('dom-ready',() => {clearTimeout(this.readinessTimer);this.readinessTimer=null; resolve();},{once:true});
      guest.addEventListener('did-fail-load',event => {
        if (event.isMainFrame && event.errorCode !== -3) {
          this.lastError = new Error('Claude could not load. Check the connection in Connect Claude.');
        }
      });
    });
    // A hidden session can fail before the user starts a request.
    this.ready.catch(() => {});
    this.host.appendChild(guest);
    document.body.appendChild(this.host);
    this.guest = guest;
    return guest;
  }

  mount(container) {
    this.ensure();
    this.loginHost?.remove();
    this.loginHost=document.createElement('div');
    this.loginHost.className='amberkeep-session-visible';
    const guest=this.createGuest();
    this.loginHost.appendChild(guest);
    container.appendChild(this.loginHost);
    return guest;
  }

  hide() {
    this.loginHost?.remove();this.loginHost=null;
  }

  async getJSON(apiPath,{signal}={}) {
    if (typeof apiPath!=='string' || !apiPath.startsWith('/api/') || apiPath.includes('\\') || apiPath.includes('#')) throw new Error('Only Claude API read paths are supported.');
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'),{name:'AbortError'});
    const guest=this.ensure();
    await this.withAbort(this.ready,signal);
    if (typeof guest.executeJavaScript!=='function') throw new Error('This Obsidian installation does not expose the desktop webview.');
    const script=`(async()=>{
      if(location.origin!=='https://claude.ai')return {status:401,error:'Sign in to Claude first.'};
      const control=new AbortController();const timer=setTimeout(()=>control.abort(),30000);
      try{const response=await fetch(${JSON.stringify(apiPath)},{method:'GET',credentials:'include',headers:{Accept:'application/json'},signal:control.signal});
        const body=await response.text();if(body.length>50000000)return {status:413,error:'Claude response is too large.'};
        let data;try{data=JSON.parse(body);}catch{return {status:response.ok?401:response.status,error:'Claude returned a sign-in or challenge page. Open Connect Claude.'};}
        return {status:response.status,data,retryAfter:response.headers.get('retry-after')};
      }catch{return {status:0,error:'Claude request failed or timed out. Open Connect Claude to check the session.'};}finally{clearTimeout(timer);}
    })()`;
    const result=await this.withAbort(guest.executeJavaScript(script),signal);
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'),{name:'AbortError'});
    if (!result || result.status<200 || result.status>=300) {
      const error=new Error(result?.error || `Claude request returned HTTP ${result?.status || 0}.`);
      error.status=result?.status || 0;
      if(result?.retryAfter) error.retryAfter=result.retryAfter;
      throw error;
    }
    return result.data;
  }

  async disconnect() {
    this.destroy();
    // Only this plugin's isolated partition is cleared, never Desktop cookies.
    let remote;
    try {remote=require('@electron/remote');} catch {return false;}
    try {await remote.session.fromPartition(this.partition).clearStorageData(); return true;} catch {return false;}
  }

  withAbort(promise,signal){
    if(!signal)return promise;
    return new Promise((resolve,reject)=>{
      const aborted=()=>reject(Object.assign(new Error('Cancelled'),{name:'AbortError'}));
      if(signal.aborted)return aborted();
      signal.addEventListener('abort',aborted,{once:true});
      Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',aborted));
    });
  }

  destroy() {
    clearTimeout(this.readinessTimer);this.readinessTimer=null;
    this.rejectReady?.(new Error('Claude session closed.'));this.rejectReady=null;
    this.loginHost?.remove();this.loginHost=null;
    this.host?.remove(); this.host=null; this.guest=null; this.ready=null;
  }
}

module.exports={ClaudeSession};
