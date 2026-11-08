#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {buildGraph,listSources,validateKnowledge}=require('../obsidian-plugin/src/graph');
const {generatedBlock}=require('../obsidian-plugin/src/vault-writer');

function buildDemo(output){
  output=path.resolve(output);
  if(fs.existsSync(output) || !fs.statSync(path.dirname(output)).isDirectory())throw new Error('Choose a new demo directory with an existing parent.');
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'../examples/knowledge-demo.json'),'utf8'));
  const sources=listSources(fixture.snapshot);
  const analyses=fixture.analyses.map(draft=>{const source=sources.find(item=>item.kind==='conversation' && item.externalId===draft.conversationId);return validateKnowledge({sourceId:source.id,sourceHash:source.hash,concepts:draft.concepts,relations:draft.relations},source);});
  const graph=buildGraph(fixture.snapshot,analyses,{root:'Amberkeep'});
  fs.mkdirSync(output);
  for(const note of graph.notes){const file=path.join(output,note.path);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,['---','amberkeep_id: '+JSON.stringify(note.id),'amberkeep_kind: '+JSON.stringify(note.kind),'title: '+JSON.stringify(note.title),'---','',generatedBlock(note.content),''].join('\n'));}
  const columns={project:0,document:0,memory:0,conversation:1,topic:2,concept:3,decision:3,question:3,person:3,tool:3};
  const rows=new Map();
  const canvasNodes=graph.nodes.map(item=>{const column=columns[item.kind] ?? 2;const row=rows.get(column) || 0;rows.set(column,row+1);return{id:item.id,type:'file',file:item.path,x:column*450,y:row*200,width:340,height:150,color:item.method==='model'?'3':(item.method==='lexical'?'5':'4')};});
  const ids=new Set(canvasNodes.map(item=>item.id));
  const canvasEdges=graph.edges.filter(edge=>ids.has(edge.from)&&ids.has(edge.to)).map((edge,index)=>({id:'edge-'+index,fromNode:edge.from,toNode:edge.to,fromSide:'right',toSide:'left',label:edge.type.replace(/_/g,' ')}));
  fs.writeFileSync(path.join(output,'Knowledge Map.canvas'),JSON.stringify({nodes:canvasNodes,edges:canvasEdges},null,2));
  fs.writeFileSync(path.join(output,'START HERE.md'),'# Amberkeep knowledge graph demo\n\n'+fixture.notice+'\n\nOpen [[Knowledge Map.canvas|the knowledge map]] or Obsidian’s Graph view to explore the linked notes. Open this directory itself as a vault; the managed notes are inside `Amberkeep/`.\n\nThe two invented conversations share SQLite and source provenance. Semantic fixtures contain exact source quotes and are checked by the same validator used for model output. Additional unanalysed sources remain explicitly pending.\n');
  fs.writeFileSync(path.join(output,'demo-report.json'),JSON.stringify({...graph.stats,notice:fixture.notice},null,2));
  return graph.stats;
}
if(require.main===module){try{const index=process.argv.indexOf('--output');if(index<0 || !process.argv[index+1])throw new Error('Usage: node tools/build_knowledge_demo.js --output NEW_DIRECTORY');console.log(JSON.stringify(buildDemo(process.argv[index+1])));}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={buildDemo};
