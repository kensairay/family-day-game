import {spawn, execFileSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
export const HOST_KEY = 'local-integration-host-only';
export async function withServer(run, {archiveReady = true} = {}) {
  const directory=await mkdtemp(join(tmpdir(),'family-day-tests-'));
  const cli='node_modules/wrangler/bin/wrangler.js';
  const env={...process.env,CLOUDFLARE_SEND_METRICS:'false'};
  const url='http://localhost:8790';
  let server, output='';
  async function stop() {
    if(server && server.exitCode===null) {
      const exited=new Promise(resolve=>server.once('exit',resolve));
      try{process.kill(-server.pid,'SIGTERM');}catch{}
      await Promise.race([exited,delay(3000)]);
    }
  }
  async function start() {
    server=spawn(process.execPath,[cli,'dev','--local','--port','8790','--persist-to',directory,'--var',`HOST_KEY:${HOST_KEY}`],{env,detached:true,stdio:['ignore','pipe','pipe']});
    for(const stream of [server.stdout,server.stderr]) stream.on('data',buffer=>{output+=buffer.toString();});
    for(let i=0;i<120;i++) {
      if(server.exitCode!==null) throw new Error('Local worker exited');
      try{const r=await fetch(url+'/api/config');if(r.ok)return;}catch{}
      await delay(250);
    }
    throw new Error('Local worker did not start');
  }
  function migrateArchive() {
    execFileSync(process.execPath,[cli,'d1','migrations','apply','family-day-game','--local','--persist-to',directory],{env,stdio:'pipe'});
  }
  try {
    if (archiveReady) migrateArchive();
    await start();
    return await run(url,{
      restart:async()=>{await stop();await start();},
      restoreArchive:async()=>{await stop();migrateArchive();await start();}
    });
  } catch(error) {console.error(output.slice(-5000));throw error;}
  finally {await stop();await rm(directory,{recursive:true,force:true});}
}
