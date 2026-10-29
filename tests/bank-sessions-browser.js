import {spawn} from 'node:child_process';
import {withServer,HOST_KEY} from './server.js';
await withServer(url=>new Promise((resolve,reject)=>{
 const child=spawn('python',['tests/test_bank_sessions.py'],{stdio:'inherit',env:{...process.env,GAME_URL:url,GAME_HOST_KEY:HOST_KEY}});
 child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Bank/session browser test failed (${code})`)));
}));
