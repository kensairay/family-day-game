import {withServer,HOST_KEY} from './server.js';
import {spawn} from 'node:child_process';
await withServer(async url=>await new Promise((resolve,reject)=>{
 const child=spawn('python',['tests/test_private_flow.py'],{stdio:'inherit',env:{...process.env,GAME_URL:url,GAME_HOST_KEY:HOST_KEY}});
 child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`browser test failed: ${code}`)));
}));
