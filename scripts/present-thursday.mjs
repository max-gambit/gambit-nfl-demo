import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';
import {parseEnv} from 'node:util';
import {execFileSync, spawn} from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const apiPort=Number(process.env.NYG_DEMO_SERVER_PORT??8791);
const clientPort=Number(process.env.NYG_DEMO_CLIENT_PORT??5174);
if(![apiPort,clientPort].every(p=>Number.isInteger(p)&&p>1024&&p<65536)||apiPort===clientPort)throw new Error('Choose distinct local demo ports.');
const serverFile=resolve(root,'server/.env');
if(!existsSync(serverFile))throw new Error('Add the existing private model configuration to server/.env before starting this checkout.');
let database;
try{database=JSON.parse(execFileSync(resolve(root,'node_modules/.bin/supabase'),['status','--output','json'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}));}
catch{throw new Error('The local Supabase runtime is unavailable. Start the existing local database, then retry; no data was reset.');}
if(!database.API_URL||!database.ANON_KEY||!database.SERVICE_ROLE_KEY||!['localhost','127.0.0.1','[::1]'].includes(new URL(database.API_URL).hostname))throw new Error('This launcher requires a local Supabase database.');
for(const port of [apiPort,clientPort]){
 try{await fetch('http://localhost:'+port,{signal:AbortSignal.timeout(800)});throw new Error('PORT_IN_USE');}
 catch(error){if(error.message==='PORT_IN_USE')throw new Error('Port '+port+' is already in use. Stop the existing demo terminal or select different NYG_DEMO ports.');}
}
const api='http://localhost:'+apiPort;
const client='http://localhost:'+clientPort;
const children=[];
let stopping=false;
const stop=(code=0)=>{
 if(stopping)return;stopping=true;
 for(const child of children)if(child.pid){try{process.kill(-child.pid,'SIGTERM');}catch{}}
 setTimeout(()=>process.exit(code),150);
};
const start=(args,cwd,env)=>{
 const child=spawn(process.execPath,args,{cwd,env,stdio:'inherit',detached:true});
 children.push(child);child.on('error',()=>stop(1));child.on('exit',code=>{if(!stopping)stop(code??1);});
};
start([resolve(root,'server/node_modules/tsx/dist/cli.mjs'),'src/index.ts'],resolve(root,'server'),{
 ...process.env,...parseEnv(readFileSync(serverFile,'utf8')),PORT:String(apiPort),CLIENT_ORIGIN:client,
 SUPABASE_URL:database.API_URL,SUPABASE_SERVICE_ROLE_KEY:database.SERVICE_ROLE_KEY,DISABLE_MONITOR_SCHEDULER:'true',
});
start([resolve(root,'node_modules/vite/bin/vite.js'),'--port',String(clientPort),'--strictPort'],root,{
 ...process.env,VITE_SERVER_URL:api,VITE_SUPABASE_URL:database.API_URL,VITE_SUPABASE_ANON_KEY:database.ANON_KEY,
});
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
for(let attempt=0;attempt<30&&!stopping;attempt++){
 try{const [a,b]=await Promise.all([fetch(api+'/health'),fetch(client)]);if(a.ok&&b.ok){console.log('\nGiants rehearsal ready: '+client+'\nLocal data is preserved. Press Ctrl-C to stop this launch.');break;}}catch{}
 await new Promise(resolve=>setTimeout(resolve,500));
 if(attempt===29){console.error('The demo did not become ready.');stop(1);}
}
