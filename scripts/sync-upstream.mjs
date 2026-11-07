// Retrieve the original reviewed v5.12 implementation from Git history.
// Do not deploy the offline recovery copy bundled in this archive.
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, cpSync, existsSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const tmp=mkdtempSync(join(tmpdir(),'top10-reviewed-'));
const repo='https://github.com/Sensationa1/my-top10-addon.git';
const git=(args,opts={})=>execFileSync('git',args,{cwd:join(tmp,'repo'),encoding:'utf8',timeout:120000,maxBuffer:15*1024*1024,...opts});
const valid=(s)=> /version:\s*['"]5\.12\.0['"]/.test(s) &&
  s.includes('JustWatch Daily + Weekly') &&
  s.includes('SOURCE_WEIGHTS') && s.includes('POSTERSPLUS_OPTIONS') &&
  s.includes('top10_trending_movies') && s.includes('top10_trending_shows');
try {
  execFileSync('git',['clone','--branch','main',repo,join(tmp,'repo')],{stdio:'inherit',timeout:120000});
  const revs=git(['rev-list','HEAD']).trim().split('\n');
  let approved=null,source=null;
  for(const rev of revs){
    try {
      const content=git(['show',`${rev}:api/index.js`]);
      if(valid(content)){approved=rev;source=content;break;}
    }catch(_){/* File not found at this revision. */}
  }
  if(!approved)throw new Error('No reviewed v5.12 source found in upstream history. Do not deploy offline recovery source.');
  mkdirSync(resolve('api'),{recursive:true});
  writeFileSync(resolve('api/index.js'),source);
  // Copy the font assets from the same reviewed revision where possible.
  let fontFiles=[];
  try {fontFiles=git(['ls-tree','-r','--name-only',approved,'fonts']).trim().split('\n').filter(Boolean);}catch(_){}
  for(const fontFile of fontFiles){
    if(!fontFile.startsWith('fonts/')||fontFile.includes('..'))continue;
    try {
      const bytes=execFileSync('git',['show',`${approved}:${fontFile}`],{cwd:join(tmp,'repo'),timeout:30000,maxBuffer:10*1024*1024});
      const target=resolve(fontFile);
      mkdirSync(resolve('fonts'),{recursive:true});
      mkdirSync(resolve(target,'..'),{recursive:true});
      writeFileSync(target,bytes);
    }catch(e){console.warn('Could not restore font file',fontFile,e.message);}
  }
  console.log(`Reviewed upstream v5.12 source restored from ${approved.slice(0,12)}.`);
} finally {rmSync(tmp,{recursive:true,force:true});}
