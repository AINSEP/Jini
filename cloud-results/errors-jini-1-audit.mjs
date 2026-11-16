// Approximation of owner-rules-audit: swallowed-error + generic-error-catch.
import ts from '/home/user/Jini/node_modules/typescript/lib/typescript.js';
import fs from 'node:fs'; import path from 'node:path';
const root=process.argv[2]; const pk=process.argv[3].split(',');
const hits=[];
function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(['node_modules','dist','coverage'].includes(e.name))continue;const f=path.join(d,e.name);if(e.isDirectory())walk(f);else if(/\.(ts|tsx)$/.test(e.name)&&!/\.d\.ts$/.test(e.name)&&!/(__tests__|\.test\.|\.spec\.)/.test(f))scan(f);}}
function scan(f){const text=fs.readFileSync(f,'utf8');const sf=ts.createSourceFile(f,text,ts.ScriptTarget.Latest,true,f.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 const line=n=>sf.getLineAndCharacterOfPosition(n.getStart()).line+1;
 const hasComment=(block)=>{const inner=text.slice(block.getStart()+1,block.getEnd()-1);return /\/\/|\/\*/.test(inner);};
 (function v(n){
  if(ts.isCatchClause(n)){const b=n.block;const name=n.variableDeclaration?.name.getText();
   if(b.statements.length===0){ if(!hasComment(b)) hits.push({file:f,line:line(n),rule:'swallowed-error'}); }
   else if(!name||!new RegExp('\\b'+name+'\\b').test(b.getText())){
     // generic: emits fixed sentence (string literal in throw/return/log/assignment)
     const t=b.getText(); if(/(throw new|console\.\w+\(|logger\.\w+\(|\.(error|warn)\(|message:|error:|reason:)/.test(t)&&/["'`][^"'`]{8,}["'`]/.test(t)) hits.push({file:f,line:line(n),rule:'generic-error-catch'});
   }}
  if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='catch'&&n.arguments[0]&&(ts.isArrowFunction(n.arguments[0])||ts.isFunctionExpression(n.arguments[0]))){const fn=n.arguments[0];if(ts.isBlock(fn.body)&&fn.body.statements.length===0&&!hasComment(fn.body))hits.push({file:f,line:line(n),rule:'swallowed-error'});}
  ts.forEachChild(n,v);})(sf);}
for(const p of pk){const d=path.join(root,'packages',p,'src');if(fs.existsSync(d))walk(d);}
fs.writeFileSync(process.argv[4],JSON.stringify(hits.map(h=>({...h,file:path.relative(root,h.file)})),null,1));
const c={};for(const h of hits){const k=h.file.split('/')[1]+' '+h.rule;c[k]=(c[k]||0)+1;}console.log(c);
