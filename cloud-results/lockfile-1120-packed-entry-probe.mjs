const core = ['./errors/idioms','./errors/sentences','./errors/bindings','./errors/catalog','./errors/reporter','./errors/approved-cause','./errors/disclosure','./errors/error-id','./errors/testing','./model-facing-tool-errors'].map(s=>'@jini-ai/core'+s.slice(1));
const list = [
 ...['./presentation/html','./presentation/page-head','./forms/result-query','./forms/result-flash','./themes/preview/refresh','./media/cover-image','./themes/token-aliases','./seo/cover-image'].map(s=>'@jini-ai/cms'+s.slice(1)),
 '@jini-ai/http-kit/range','@jini-ai/devops/backup/plan-store','@jini-ai/devops/backup/push-jobs', ...core];
let bad=0;
for (const s of list) {
  try { const m = await import(s); const r = import.meta.resolve(s); console.log('OK  ', s, Object.keys(m).length+' exports', r.includes('/node_modules/@jini-ai/')?'(tarball)':'(?)'); }
  catch (e) { bad++; console.log('FAIL', s, e.code||'', String(e.message).split('\n')[0]); }
}
const admin = JSON.parse((await import('node:fs')).readFileSync('node_modules/@jini-ai/admin/package.json','utf8'));
for (const k of Object.keys(admin.exports)) { const s='@jini-ai/admin'+k.slice(1); try { await import(s); } catch(e){ if(!/react|Cannot find package '(react|react-dom)/.test(e.message)) { bad++; console.log('FAIL', s, e.code, String(e.message).split('\n')[0]); } else console.log('SKIP(peer)', s, String(e.message).split('\n')[0].slice(0,90)); } }
console.log('admin deps core range:', admin.dependencies['@jini-ai/core']);
console.log('failures:', bad);
