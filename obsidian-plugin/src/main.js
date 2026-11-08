'use strict';
const {Plugin,PluginSettingTab,Setting,ItemView,Modal,Notice}=require('obsidian');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {ClaudeClient}=require('./claude-client');
const {ClaudeSession}=require('./session');
const {buildGraph,listSources,validateKnowledge}=require('./graph');
const {VaultWriter}=require('./vault-writer');
const {startBridge}=require('./bridge');
const {extractKnowledge,listModels}=require('./local-model');

const VIEW='amberkeep-dashboard';
const DEFAULTS={rootFolder:'Amberkeep',enabled:false,autoSyncMinutes:15,localModel:'',localBaseUrl:'http://127.0.0.1:11434'};
const EMPTY=()=>({version:1,organizations:[],conversations:[],projects:[],memories:[],warnings:[],complete:false});
const bodyHash=value=>crypto.createHash('sha256').update(value).digest('hex');
function node(parent,tag,text,className){const value=document.createElement(tag);if(text!==undefined)value.textContent=text;if(className)value.className=className;parent.appendChild(value);return value;}
function button(parent,label,callback,primary=false){const value=node(parent,'button',label);if(primary)value.classList.add('mod-cta');value.addEventListener('click',()=>Promise.resolve().then(callback).catch(error=>new Notice(error.message)));return value;}
function safeRoot(value){const root=String(value).trim().replace(/\/$/,'');if(!root || root.includes('\\') || root.startsWith('/') || root.split('/').some(part=>!part || part==='.' || part==='..' || part.startsWith('.') || /[<>:"|?*\[\]#^]/.test(part)))throw new Error('Choose a normal new folder name, such as Amberkeep.');return root;}

class ConnectModal extends Modal {
  constructor(plugin){super(plugin.app);this.plugin=plugin;this.checking=false;}
  onOpen(){
    this.modalEl.classList.add('amberkeep-login-modal');
    node(this.contentEl,'h2','Connect your Claude account');
    node(this.contentEl,'p','Sign in on claude.ai below. This isolated session is separate from Claude Desktop. Standard email verification can be used if Google blocks embedded sign-in.','amberkeep-note');
    const host=node(this.contentEl,'div');
    const guest=this.plugin.session.mount(host);
    const actions=node(this.contentEl,'div',undefined,'amberkeep-actions');
    button(actions,'Check connection',()=>this.check(),true);
    node(this.contentEl,'p','Amberkeep only reads your history, projects, and memory. It does not read Desktop cookies or the macOS Keychain. If the sign-in provider refuses this embedded window, this connection cannot proceed; use a supported sign-in method.','amberkeep-note');
    this.onLoad=()=>this.check(false);
    guest.addEventListener('did-stop-loading',this.onLoad);
    this.guest=guest;
  }
  async check(notify=true){
    if(this.checking)return;this.checking=true;
    try{
      const organizations=await this.plugin.session.getJSON('/api/organizations');
      const list=Array.isArray(organizations)?organizations:(organizations?.data || organizations?.organizations);
      if(!Array.isArray(list) || !list.length)throw new Error('Sign in to a Claude account with a chat workspace first.');
      this.plugin.settings.enabled=true;await this.plugin.saveSettings();this.plugin.schedule();
      this.plugin.connected=true;this.plugin.error='';this.close();this.plugin.refresh();
      new Notice('Claude connected. Starting history sync.');this.plugin.startSync();
    }catch(error){if(notify)new Notice(error.message);}finally{this.checking=false;}
  }
  onClose(){this.guest?.removeEventListener('did-stop-loading',this.onLoad);this.plugin.session.hide();this.contentEl.empty();this.plugin.connectModal=null;}
}

class Dashboard extends ItemView {
  constructor(leaf,plugin){super(leaf);this.plugin=plugin;}
  getViewType(){return VIEW;}
  getDisplayText(){return 'Amberkeep';}
  getIcon(){return 'network';}
  async onOpen(){this.render();}
  render(){
    const p=this.plugin;const s=p.status();this.contentEl.empty();this.contentEl.classList.add('amberkeep-dashboard');
    node(this.contentEl,'div','Amberkeep · desktop preview','amberkeep-eyebrow');
    node(this.contentEl,'h1','Your conversations. Connected.');
    node(this.contentEl,'p','Sync directly from Claude, then turn your sources into a linked knowledge graph. No export email or API key.','amberkeep-subtitle');
    const actions=node(this.contentEl,'div',undefined,'amberkeep-actions');
    button(actions,p.connected?'Reconnect Claude':'Connect Claude',()=>p.connect(),!p.connected);
    const sync=button(actions,s.busy?'Working…':'Sync now',()=>p.startSync(),p.connected);sync.disabled=s.busy;
    button(actions,'Open knowledge graph',()=>p.openGraph());
    if(p.settings.localModel){const ai=button(actions,'Analyse pending locally',()=>p.startAnalysis());ai.disabled=s.busy;}
    if(s.busy)button(actions,'Cancel',()=>p.cancel());
    const stats=node(this.contentEl,'div',undefined,'amberkeep-stats');
    for(const [value,label] of [[s.conversationCount,'Conversations'],[s.sourceCount,'Knowledge sources'],[s.analysedSources,'AI-analysed sources'],[s.pendingSources,'Awaiting analysis']]){const card=node(stats,'div',undefined,'amberkeep-stat');node(card,'strong',String(value));node(card,'span',label);}
    node(this.contentEl,'div',p.progress?.message || (s.lastSync?'Last sync: '+new Date(s.lastSync).toLocaleString():'Connect Claude to begin.'),'amberkeep-progress');
    if(p.error)node(this.contentEl,'p',p.error,'amberkeep-warning');
    const panel=node(this.contentEl,'div',undefined,'amberkeep-panel');
    node(panel,'h3',p.settings.localModel?'Automatic local analysis':'Build the semantic layer with Claude Desktop');
    if(p.settings.localModel){node(panel,'p','New sources are analysed after sync using your selected local Ollama model: '+p.settings.localModel+'. Large sources stay pending if they exceed the local limit.');}
    else{
      node(panel,'p','Install the Amberkeep Desktop extension (.mcpb), select this vault, and ask Claude:');
      node(panel,'pre','Use Amberkeep to sync my history and build my knowledge graph. Read all pages of each pending source, extract grounded concepts, decisions, and relationships, then save them with exact source quotes. Continue in batches and report how many sources remain.');
      node(panel,'p','Claude analysis runs when you request it. For unattended analysis, configure a local Ollama model in Amberkeep settings.','amberkeep-note');
    }
    const details=node(this.contentEl,'div',undefined,'amberkeep-panel');
    node(details,'h3','What is connected');
    node(details,'p',`${s.projectCount} projects · ${s.nodeCount} graph notes · ${s.edgeCount} links. Topics inferred from recurring terms are labelled; AI concepts require source evidence.`);
    node(details,'p',`Destination: ${p.settings.rootFolder}/. Automatic history sync: ${p.settings.autoSyncMinutes?`every ${p.settings.autoSyncMinutes} minutes while Obsidian is open`:'off'}.`,'amberkeep-note');
    if(s.partial)node(details,'p','The last collection was partial. Previously cached sources remain available; missing data was not deleted.','amberkeep-warning');
    if(p.writeResult?.conflicts)node(details,'p',`${p.writeResult.conflicts} proposed updates need review in ${p.settings.rootFolder}/Conflicts/. Your edited notes were preserved.`,'amberkeep-warning');
    if(s.warnings.length){const list=node(details,'ul');for(const warning of s.warnings.slice(0,15))node(list,'li',String(warning),'amberkeep-note');}
    node(this.contentEl,'p','Experimental direct connection: Claude’s internal website API and embedded sign-in can change. This preview has not been validated on your real macOS account. The archive importer remains a fallback.','amberkeep-note');
  }
}

class AmberkeepSettings extends PluginSettingTab {
  constructor(app,plugin){super(app,plugin);this.plugin=plugin;}
  display(){
    const p=this.plugin;this.containerEl.empty();node(this.containerEl,'h2','Amberkeep');
    new Setting(this.containerEl).setName('Claude connection').setDesc('Separate persistent sign-in; no Desktop cookie or Keychain access.').addButton(b=>b.setButtonText('Connect Claude').onClick(()=>p.connect()));
    new Setting(this.containerEl).setName('Knowledge folder').setDesc('Managed notes stay inside this folder. Changing it creates a new graph location; old notes are not deleted.').addText(t=>t.setValue(p.settings.rootFolder).onChange(async value=>{try{const root=safeRoot(value);const writer=new VaultWriter(p.app.vault,{root});p.settings.rootFolder=root;p.writer=writer;await p.saveSettings();}catch{}}));
    new Setting(this.containerEl).setName('Automatic history sync').setDesc('Runs while Obsidian is open. Semantic analysis uses Claude Desktop on request or the configured local model.').addDropdown(d=>d.addOptions({'0':'Off','5':'Every 5 minutes','15':'Every 15 minutes','60':'Every hour'}).setValue(String(p.settings.autoSyncMinutes)).onChange(async value=>{p.settings.autoSyncMinutes=Number(value);await p.saveSettings();p.schedule();}));
    new Setting(this.containerEl).setName('Local Ollama model (optional)').setDesc('Leave empty to use Claude Desktop through MCP. Select an already installed local model to analyse sources automatically. No model is downloaded.').addText(t=>t.setPlaceholder('e.g. qwen3:4b').setValue(p.settings.localModel).onChange(async value=>{p.settings.localModel=value.trim();await p.saveSettings();}));
    new Setting(this.containerEl).setName('Local Ollama address').setDesc('Loopback addresses only. Model requests never go to a cloud provider.').addText(t=>t.setValue(p.settings.localBaseUrl).onChange(async value=>{p.settings.localBaseUrl=value.trim();await p.saveSettings();})).addButton(b=>b.setButtonText('List models').onClick(async()=>{try{const models=await listModels({baseUrl:p.settings.localBaseUrl});new Notice(JSON.stringify(models));}catch(error){new Notice(error.message);}}));
    new Setting(this.containerEl).setName('Disconnect Claude').setDesc('Stops automatic sync and this session. Clears its isolated cookie store when the desktop session API is available. Generated notes remain.').addButton(b=>b.setButtonText('Disconnect').onClick(async()=>{p.cancel();p.settings.enabled=false;await p.saveSettings();p.connected=false;const cleared=await p.session.disconnect();p.schedule();p.refresh();new Notice(cleared?'Claude disconnected; isolated session cleared.':'Disconnected. This host could not clear the isolated browser store; it may still be signed in on reconnect.');}));
    node(this.containerEl,'p','The Desktop MCP extension must be configured with this vault directory. Cookies stay in Obsidian’s isolated browser profile; snapshots and knowledge evidence are stored in the plugin directory within this vault. Vault sync/backups may include them.','amberkeep-note');
  }
}

class AmberkeepPlugin extends Plugin {
  async onload(){
    this.settings={...DEFAULTS,...await this.loadData()};this.settings.rootFolder=safeRoot(this.settings.rootFolder);
    this.snapshot=EMPTY();this.enrichments=[];this.graphIndex=[];this.connected=false;this.error='';this.progress=null;this.graphStats={};this.writeQueue=Promise.resolve();this.knowledgeQueue=Promise.resolve();
    this.registerView(VIEW,leaf=>new Dashboard(leaf,this));
    this.addRibbonIcon('network','Amberkeep',()=>this.openDashboard());
    this.addCommand({id:'open',name:'Open dashboard',callback:()=>this.openDashboard()});
    this.addCommand({id:'sync',name:'Sync Claude history',callback:()=>this.startSync()});
    this.addCommand({id:'connect',name:'Connect Claude',callback:()=>this.connect()});
    this.addCommand({id:'graph',name:'Open knowledge graph',callback:()=>this.openGraph()});
    this.addSettingTab(new AmberkeepSettings(this.app,this));
    this.statusEl=this.addStatusBarItem();this.statusEl.textContent='Amberkeep';this.statusEl.addEventListener('click',()=>this.openDashboard());
    const base=this.app.vault.adapter.getBasePath?.();
    if(!base){this.error='Amberkeep direct sync requires a desktop filesystem vault.';return;}
    this.vaultPath=fs.realpathSync(base);const directory=this.manifest.dir || this.app.vault.configDir+'/plugins/'+this.manifest.id;this.cachePath=directory+'/snapshot.json';this.knowledgePath=directory+'/knowledge.json';this.indexPath=directory+'/graph-index.json';
    try{
      if(await this.app.vault.adapter.exists(this.cachePath))this.snapshot=JSON.parse(await this.app.vault.adapter.read(this.cachePath));
      if(await this.app.vault.adapter.exists(this.knowledgePath))this.enrichments=JSON.parse(await this.app.vault.adapter.read(this.knowledgePath));
      if(await this.app.vault.adapter.exists(this.indexPath))this.graphIndex=JSON.parse(await this.app.vault.adapter.read(this.indexPath));
      if(!Array.isArray(this.enrichments))throw new Error('Knowledge cache has an invalid shape.');
      if(!Array.isArray(this.graphIndex))throw new Error('Graph index has an invalid shape.');
      if(this.snapshot.version!==1 || !['conversations','projects','memories'].every(key=>Array.isArray(this.snapshot[key])))throw new Error('Source cache has an invalid shape.');
    }catch(error){this.snapshot=EMPTY();this.enrichments=[];this.graphIndex=[];this.error='Could not read the existing Amberkeep cache. Preserve it and resolve the error before syncing.';new Notice(this.error);return;}
    this.session=new ClaudeSession(this.vaultPath);
    this.client=new ClaudeClient((apiPath,options)=>this.session.getJSON(apiPath,options));
    this.writer=new VaultWriter(this.app.vault,{root:this.settings.rootFolder});
    this.graphStats=buildGraph(this.snapshot,this.enrichments,{root:this.settings.rootFolder,pathMap:Object.fromEntries(this.graphIndex.map(item=>[item.id,item.path]))}).stats;
    try{this.bridge=await startBridge({vaultPath:this.vaultPath,handlers:{status:()=>this.status(),sync:()=>this.startSync(),cancel:()=>this.cancel(),pending:q=>this.pending(q),source:(id,q)=>this.readSource(id,q),knowledge:body=>this.saveKnowledge(body),openGraph:()=>this.openGraph()}});}catch(error){this.error='Desktop MCP connection could not start: '+error.message;}
    this.schedule();this.refresh();
    if(this.settings.enabled && this.settings.autoSyncMinutes>0)this.app.workspace.onLayoutReady(()=>this.startSync(true));
  }
  async persistJSON(path,value){const content=JSON.stringify(value);if(await this.app.vault.adapter.exists(path) && await this.app.vault.adapter.read(path)===content)return;const temporary=path+'.tmp-'+crypto.randomBytes(8).toString('hex');try{await this.app.vault.adapter.write(temporary,content);await this.app.vault.adapter.rename(temporary,path);}finally{if(await this.app.vault.adapter.exists(temporary))await this.app.vault.adapter.remove(temporary);}}
  async saveSettings(){await this.saveData(this.settings);this.refresh();}
  schedule(){if(this.timer)clearInterval(this.timer);if(this.settings.enabled && this.settings.autoSyncMinutes>0 && this.session){this.timer=setInterval(()=>{if(!this.busy())this.startSync(true);},this.settings.autoSyncMinutes*60000);}}
  busy(){return Boolean(this.syncTask || this.analysisTask);}
  sources(){if(this.sourcesSnapshot!==this.snapshot){this.sourcesSnapshot=this.snapshot;this.sourceCache=listSources(this.snapshot);}return this.sourceCache;}
  pendingSources(){const known=new Map(this.enrichments.map(item=>[item.sourceId,item.sourceHash]));return this.sources().filter(source=>known.get(source.id)!==source.hash);}
  status(){const sources=this.sources();const pending=this.pendingSources();return {version:'0.2.0',connected:this.connected,needsConnection:!this.settings.enabled || (!this.connected && !this.syncTask),busy:this.busy(),phase:this.progress?.phase || 'idle',progress:this.progress,sourceCount:sources.length,analysedSources:sources.length-pending.length,pendingSources:pending.length,conversationCount:this.snapshot.conversations?.length || 0,projectCount:this.snapshot.projects?.length || 0,nodeCount:this.graphStats.nodeCount || 0,edgeCount:this.graphStats.edgeCount || 0,lastSync:this.snapshot.fetchedAt || null,partial:this.snapshot.complete===false,warnings:this.snapshot.warnings || [],lastError:this.error,localModelConfigured:Boolean(this.settings.localModel)};}
  refresh(){if(this.statusEl)this.statusEl.textContent=this.busy()?'Amberkeep · working':`Amberkeep · ${this.pendingSources().length} pending`;for(const leaf of this.app.workspace.getLeavesOfType(VIEW))leaf.view.render();}
  async openDashboard(){let leaf=this.app.workspace.getLeavesOfType(VIEW)[0];if(!leaf){leaf=this.app.workspace.getLeaf('tab');await leaf.setViewState({type:VIEW,active:true});}this.app.workspace.revealLeaf(leaf);}
  connect(){if(this.busy()){new Notice('Cancel the current operation before reconnecting.');return;}if(!this.session){new Notice(this.error || 'Desktop connection is unavailable.');return;}if(!this.connectModal){this.connectModal=new ConnectModal(this);this.connectModal.open();}}
  startSync(automatic=false){
    if(this.busy())return {started:false,...this.status()};
    if(!this.settings.enabled){if(!automatic)this.connect();return {started:false,...this.status()};}
    if(!this.client){if(!automatic)this.connect();return {started:false,...this.status()};}
    this.error='';this.controller=new AbortController();
    this.syncTask=(async()=>{
      try{
        this.progress={phase:'sync',message:'Reading your Claude workspaces…'};this.refresh();
        const snapshot=await this.client.sync(this.snapshot,{signal:this.controller.signal,onProgress:progress=>{this.progress=progress;this.refresh();}});
        await this.persistJSON(this.cachePath,snapshot);this.snapshot=snapshot;this.connected=true;
        await this.renderGraph();
        this.progress={phase:'idle',message:`History synced: ${snapshot.conversations.length} conversations. ${this.pendingSources().length} knowledge sources await analysis.`};
      }catch(error){this.error=error.name==='AbortError'?'Sync cancelled; existing sources were kept.':error.message;if(error.status===401)this.connected=false;}
      finally{this.syncTask=null;this.refresh();if(!this.error && this.settings.localModel)this.startAnalysis();}
    })();
    this.refresh();return {started:true,...this.status()};
  }
  async renderGraph(){
    const run=this.writeQueue.catch(()=>{}).then(async()=>{
      const graph=buildGraph(this.snapshot,this.enrichments,{root:this.settings.rootFolder,pathMap:Object.fromEntries(this.graphIndex.map(item=>[item.id,item.path]))});
      const active=new Set(graph.notes.map(note=>note.id));const retired=[],keptRetired=[];
      const previousIndex=new Map(this.graphIndex.map(item=>[item.id,item]));
      for(const old of this.graphIndex){
        if(active.has(old.id) || typeof old.path!=='string' || !old.path.startsWith(this.settings.rootFolder+'/') || old.path.split('/').some(part=>part==='..'))continue;
        if(old.retired){keptRetired.push(old);continue;}
        const file=this.app.vault.getAbstractFileByPath(old.path);if(!file)continue;
        const previous=await this.app.vault.read(file);
        const match=/<!-- amberkeep:begin sha256=[a-f0-9]{64} -->\n([\s\S]*?)\n<!-- amberkeep:end -->/.exec(previous);
        if(!match)continue;
        // Keep old synthesis for audit, but its links become literal code instead
        // of silently remaining current edges in the native graph.
        const runs=match[1].match(/`+/g) || [];
        const fence='`'.repeat(Math.max(4,...runs.map(run=>run.length+1)));
        const content=match[1].startsWith('<!-- amberkeep:retired -->')?match[1]:('<!-- amberkeep:retired -->\n\n# Previous graph material\n\n#amberkeep/stale\n\nThis material is no longer supported by the current source hash or analysis. It is retained for review, not asserted as current knowledge.\n\n'+fence+'markdown\n'+match[1].replace(/<!--/g,'&lt;!--')+'\n'+fence);
        retired.push({...old,content});
      }
      const summary={created:0,updated:0,unchanged:0,conflicts:0,conflictPaths:[]};const next=[];
      for(const note of graph.notes.concat(retired)){
        const hash=bodyHash(note.content),old=previousIndex.get(note.id);
        let conflicted=false;
        if(old?.path===note.path && old.contentHash===hash && this.app.vault.getAbstractFileByPath(note.path)){summary.unchanged++;}
        else {const result=await this.writer.writeNotes([note]);for(const key of ['created','updated','unchanged','conflicts'])summary[key]+=result[key];summary.conflictPaths.push(...result.conflictPaths);conflicted=result.conflicts>0;}
        const {id,path,title,kind}=note;
        next.push({id,path,title,kind,...(!conflicted?{contentHash:hash}:(old?.contentHash?{contentHash:old.contentHash}:{})),...(active.has(id)?{}:{retired:true})});
      }
      const index=next.concat(keptRetired);await this.persistJSON(this.indexPath,index);this.graphIndex=index;this.writeResult=summary;
      this.graphStats=graph.stats;this.refresh();return graph.stats;
    });
    this.writeQueue=run;return run;
  }
  pending(query){const limit=Math.max(1,Math.min(50,Number(query.get('limit')) || 5));const all=this.pendingSources();return {total:all.length,sources:all.slice(0,limit).map(source=>({sourceId:source.id,sourceHash:source.hash,title:source.title,kind:source.kind,messageCount:source.messages.length,totalChars:source.messages.reduce((n,m)=>n+m.text.length,0)}))};}
  readSource(id,query){
    const source=this.sources().find(item=>item.id===id);if(!source)throw Object.assign(new Error('Unknown source.'),{status:404});
    const total=source.messages.reduce((n,m)=>n+m.text.length,0);
    const offset=Number(query.get('offset') || 0),limit=Number(query.get('limit') || 30000);
    if(!Number.isSafeInteger(offset) || offset<0 || offset>total || !Number.isSafeInteger(limit) || limit<1 || limit>60000)throw new Error('Invalid source page.');
    const end=Math.min(total,offset+limit);let cursor=0;const messages=[];
    for(const message of source.messages){const next=cursor+message.text.length;if(next>offset && cursor<end)messages.push({id:message.id,role:message.role,text:message.text.slice(Math.max(0,offset-cursor),Math.min(message.text.length,end-cursor))});cursor=next;}
    return {sourceId:source.id,sourceHash:source.hash,title:source.title,kind:source.kind,offset,nextOffset:end<total?end:null,done:end>=total,totalChars:total,messages};
  }
  saveKnowledge(payload){
    const run=this.knowledgeQueue.catch(()=>{}).then(async()=>{
      const source=this.sources().find(item=>item.id===payload.sourceId);if(!source)throw new Error('Unknown source.');
      const validated=validateKnowledge(payload,source);
      const next=this.enrichments.filter(item=>item.sourceId!==source.id).concat(validated);
      await this.persistJSON(this.knowledgePath,next);this.enrichments=next;
      await this.renderGraph();return {saved:true,...this.status()};
    });this.knowledgeQueue=run;return run;
  }
  startAnalysis(){
    if(this.busy())return {started:false,...this.status()};
    if(!this.settings.localModel){new Notice('Ask Claude Desktop to analyse pending sources, or select a local Ollama model.');return {started:false,...this.status()};}
    this.error='';this.controller=new AbortController();
    this.analysisTask=(async()=>{
      const pending=this.pendingSources();let done=0,failed=0,consecutiveFailures=0;
      try{for(let index=0;index<pending.length;index++){const source=pending[index];if(this.controller.signal.aborted)break;this.progress={phase:'analysis',current:index,total:pending.length,message:`Analysing source ${index+1} of ${pending.length} locally…`};this.refresh();try{const payload=await extractKnowledge(source,{model:this.settings.localModel,baseUrl:this.settings.localBaseUrl,signal:this.controller.signal});await this.saveKnowledge(payload);done++;consecutiveFailures=0;}catch(error){if(error.name==='AbortError' || error.code==='ECONNREFUSED' || /model.+not found|HTTP 404|ENOTFOUND/i.test(error.message))throw error;failed++;consecutiveFailures++;if(consecutiveFailures>=10)throw new Error('Ten sources could not be analysed. They remain pending; check the model and source limits before retrying.');}}this.progress={phase:'idle',message:`Local analysis processed ${done} sources; ${failed} need review. ${this.pendingSources().length} remain.`};}
      catch(error){this.error=error.name==='AbortError'?'Analysis cancelled; unfinished sources remain pending.':error.message;}
      finally{this.analysisTask=null;this.refresh();}
    })();this.refresh();return {started:true,...this.status()};
  }
  cancel(){this.controller?.abort();return {cancelled:true,...this.status()};}
  async openGraph(){const filter=`path:"${this.settings.rootFolder}" -tag:amberkeep/stale`;try{const leaf=this.app.workspace.getLeaf('tab');await leaf.setViewState({type:'graph',active:true,state:{search:filter}});this.app.workspace.revealLeaf(leaf);return {opened:true,folder:this.settings.rootFolder,filter};}catch{new Notice('Enable Obsidian’s Graph view core plugin first.');return {opened:false,folder:this.settings.rootFolder,filter};}}
  onunload(){this.cancel();if(this.timer)clearInterval(this.timer);this.connectModal?.close();this.session?.destroy();this.bridge?.close().catch(()=>{});}
}

module.exports=AmberkeepPlugin;
module.exports.safeRoot=safeRoot;
