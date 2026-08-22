import {spawnSync} from 'node:child_process';import {existsSync} from 'node:fs';import {join} from 'node:path';
const run=(cmd,args,cwd=process.cwd())=>{const r=spawnSync(cmd,args,{cwd,stdio:'inherit',shell:process.platform==='win32'});if(r.status)process.exit(r.status??1)};
run('npm',['run','build']);run('npx',['electron-builder','--win','dir','--x64']);
const candidates=[process.env.MAKENSIS,join(process.env.HOME||'', '.cache/electron-builder/nsis/nsis-3.0.4.1/linux/makensis'),'makensis'].filter(Boolean);const exe=candidates.find(x=>x==='makensis'||existsSync(x));if(!exe)throw Error('NSIS makensis was not found');run(exe,['installer.nsi'],join(process.cwd(),'build'));
