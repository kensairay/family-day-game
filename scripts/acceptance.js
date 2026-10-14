import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(resolve(process.cwd())!==project) throw new Error('請從專案根目錄執行 npm run acceptance');
const root=join(project,'.test-artifacts');
await mkdir(root,{recursive:true});
const directory=await mkdtemp(join(root,'acceptance-'));
const env={...process.env,CLOUDFLARE_SEND_METRICS:'false',XDG_CONFIG_HOME:join(root,'config'),
  WRANGLER_LOG_PATH:join(directory,'wrangler.log'),npm_config_cache:join(root,'npm')};
const npm=process.platform==='win32' ? 'npm.cmd' : 'npm';
const commands=[
 ['rules',npm,['test']],
 ['controls-api',npm,['run','test:controls']],
 ['350-players-and-d1-recovery',npm,['run','test:integration']],
 ['existing-browser',npm,['run','test:browser']],
 ['host-controls-browser',npm,['run','test:controls:browser']],
 ['worker-dry-run',npm,['run','check']],
 ['diff-check','git',['diff','--check']]
];
const results=[];
for(const [name,executable,args] of commands) {
 console.log(`\nAcceptance: ${name}`);
 const start=Date.now(),log=join(directory,`${name}.log`);
 const code=await new Promise((resolveExit,reject)=>{
   const stream=createWriteStream(log);
   const child=spawn(executable,args,{cwd:project,env,stdio:['ignore','pipe','pipe'],shell:process.platform==='win32'});
   child.stdout.on('data',data=>{stream.write(data);process.stdout.write(data);});
   child.stderr.on('data',data=>{stream.write(data);process.stderr.write(data);});
   child.on('error',error=>{stream.end();reject(error);});
   child.on('close',code=>stream.end(()=>resolveExit(code)));
 });
 results.push({name,code,seconds:((Date.now()-start)/1000).toFixed(1),log});
 if(code!==0) break;
}
const passed=results.length===commands.length && results.every(r=>r.code===0);
const report=['# 本機驗收結果', '', `結果：${passed?'PASS':'FAIL'}（${results.filter(r=>r.code===0).length}/${commands.length}）`,
 '', '| 验收 | 退出碼 | 秒 | 紀錄 |', '|---|---:|---:|---|',
 ...results.map(r=>`| ${r.name} | ${r.code} | ${r.seconds} | [log](${r.name}.log) |`),
 '', '只使用本機測試資源；不部署、不推送、不安裝套件。',
 'Chromium 模擬與本機 350 位連線不等於真實手機／行動網路或正式平台验收。',''].join('\n');
await writeFile(join(directory,'RESULTS.md'),report);
await writeFile(join(root,'latest-acceptance.json'),JSON.stringify({passed,directory,results},null,2)+'\n');
console.log(`\n${passed?'PASS':'FAIL'}: ${join(directory,'RESULTS.md')}`);
if(!passed) process.exitCode=1;
