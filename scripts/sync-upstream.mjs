// Copies the exact upstream source into the Netlify build without editing ranking/poster logic.
// The packaged local index.js is an older offline-recovery copy. This build MUST
// download current upstream code or fail, rather than accidentally deploy older logic.
import {execFileSync} from 'node:child_process';
import {mkdtempSync, cpSync, existsSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const repo='https://github.com/Sensationa1/my-top10-addon.git';
const tmp=mkdtempSync(join(tmpdir(),'top10-upstream-'));
try {
  execFileSync('git',['clone','--depth','1','--branch','main',repo,join(tmp,'repo')],{stdio:'inherit',timeout:120000});
  const source=join(tmp,'repo','api','index.js');
  if(!existsSync(source))throw new Error('Upstream api/index.js is missing');
  const content=readFileSync(source,'utf8');
  if(!content.includes("version: '5.12.0'") && !content.includes('version: "5.12.0"')){
    throw new Error('Unexpected upstream version; review before deploying.');
  }
  cpSync(source,resolve('api/index.js'));
  if(existsSync(join(tmp,'repo','fonts'))){
    cpSync(join(tmp,'repo','fonts'),resolve('fonts'),{recursive:true,force:true});
  }
  console.log('Synchronized upstream v5.12.0 source successfully.');
} finally {rmSync(tmp,{recursive:true,force:true});}
