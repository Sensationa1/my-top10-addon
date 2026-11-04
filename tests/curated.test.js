'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const path=require('node:path');
function boot(){
  const routes=new Map();const calls=[];
  const state={badMini:new Set(),badDigital:new Set(),badVotes:new Set(),noJustWatch:false,noMdblist:false,noPosters:false,posterCalls:0};
  const app={set(){return this},use(){return this},listen(){return this},get(route,fn){routes.set(route,fn);return this}};
  const ids=(prefix,count=55)=>Array.from({length:count},(_,i)=>({tmdb_id:prefix+i}));
  const fakeApi={get:async(url,opt={})=>{
    calls.push({url,params:opt.params||{}});
    if(url.includes('postersplus.slokker.cc')){
      state.posterCalls++;if(state.noPosters)throw Error('posters down');
      return {data:Buffer.from('FAKEJPEG'+'.'.repeat(5000)),headers:{'content-type':'image/jpeg'}};
    }
    if(url.includes('image.tmdb.org'))return {data:Buffer.from('FAKEIMAGE'+'.'.repeat(5000)),headers:{'content-type':'image/jpeg'}};
    if(url.includes('justwatch/streaming-charts')){
      if(state.noJustWatch)throw Error('justwatch unavailable');
      return {data:{results:ids(url.includes('/show')?10001:20001)}};
    }
    if(url.includes('/lists/linaspurinis/')){
      if(state.noMdblist)throw Error('lists unavailable');
      return {data:ids(url.includes('shows')?10001:20001)};
    }
    if(/\/(movie|tv)\/popular/.test(url))return {data:{results:ids(url.includes('/tv/')?10001:20001,40).map(row=>({id:row.tmdb_id}))}};
    const detail=url.match(/\/(movie|tv)\/(\d+)$/);
    if(detail){
      const id=Number(detail[2]); const mini=state.badMini.has(id);
      return {data:{id,title:`Film ${id}`,name:`Series ${id}`,overview:'Official overview',
        vote_count:state.badVotes.has(id)?10:1500,vote_average:8.1,
        imdb_id:`tt${id}`,external_ids:{imdb_id:`tt${id}`},
        poster_path:`/poster_${id}.jpg`,backdrop_path:`/back_${id}.jpg`,
        release_date:'2025-03-01',first_air_date:'2023-04-01',
        number_of_seasons:mini?1:3,number_of_episodes:mini?6:30,
        status:mini?'Ended':'Returning Series',type:mini?'Miniseries':'Scripted',
        release_dates:{results:[{release_dates:[{type:4,release_date:state.badDigital.has(id)?'2099-01-01':'2025-03-05'}]}]},
        images:{logos:[]},genres:[{id:18,name:'Drama'}],credits:{cast:[],crew:[]},original_language:'en'}
      };
    }
    if(url.includes('api.mdblist.com/tmdb/'))return {data:{imdb_rating:8.1}};
    if(url.includes('/external_ids'))return {data:{imdb_id:'tt99999999'}};
    if(url.includes('/release_dates'))return {data:{results:[]}};
    if(url.includes('/keywords'))return {data:{keywords:[]}};
    throw Error('unexpected request '+url);
  }};
  const fakeSharp=()=>({resize(){return this},composite(){return this},jpeg(){return this},png(){return this},toBuffer:async()=>Buffer.from('JPEGTEST')});
  const originalLoad=Module._load;
  Module._load=function(name){
    if(name==='express')return ()=>app;
    if(name==='cors')return ()=>()=>{};
    if(name==='axios')return {create:()=>fakeApi};
    if(name==='sharp')return fakeSharp;
    if(name==='@resvg/resvg-js')return {Resvg:class{render(){return {asPng:()=>Buffer.from('FONTPNG')}}}};
    if(name==='dotenv')return {config:()=>{}};
    return originalLoad.apply(this,arguments);
  };
  process.env.TMDB_API_KEY='test-tmdb-key';
  process.env.MDBLIST_API_KEY='test-mdblist-key';
  process.env.PUBLIC_BASE_URL='https://unit-test.example';
  delete process.env.POSTERSPLUS_POSTER_TEMPLATE;
  const target=path.resolve(__dirname,'../api/index.js');delete require.cache[target];
  try{require(target)}finally{Module._load=originalLoad}
  async function request(route,params={},query={}){
    const fn=routes.get(route);assert.ok(fn);
    const req={params,query,get:key=>key==='host'?'unit-test.example':null};
    const res={statusCode:200,headers:{},set(k,v){this.headers[k]=v;return this},get(k){return this.headers[k]},status(v){this.statusCode=v;return this},send(v){this.body=v;return this},json(v){this.body=v;return this},redirect(code,url){this.statusCode=code;this.body=url;return this}};
    await fn(req,res);return res;
  }
  return {request,state,calls};
}
const movie={type:'movie',id:'top10_trending_movies'};
const series={type:'series',id:'top10_trending_shows'};
test('JustWatch daily + weekly and MDBList popularity drive Top 10, never TMDB trending',async()=>{
  const {request,calls}=boot();
  const [a,b]=await Promise.all([request('/catalog/:type/:id.json',movie),request('/catalog/:type/:id.json',series)]);
  assert.equal(a.statusCode,200);assert.equal(b.statusCode,200);
  assert.equal(a.body.metas.length,10);assert.equal(b.body.metas.length,10);
  assert.equal(a.body.metas[0].id,'tt20001');assert.equal(b.body.metas[0].id,'tt10001');
  assert.ok(calls.some(x=>x.url.includes('/justwatch/streaming-charts/movie')&&x.params.period==='daily'));
  assert.ok(calls.some(x=>x.url.includes('/justwatch/streaming-charts/show')&&x.params.period==='weekly'));
  assert.ok(calls.some(x=>x.url.includes('/lists/linaspurinis/most-popular-shows-top-50/items')));
  assert.ok(!calls.some(x=>x.url.includes('/trending/')));
});
test('miniseries and unknown titles are excluded; ranks stay contiguous',async()=>{
  const {request,state}=boot();state.badMini.add(10001);state.badVotes.add(10002);
  const out=await request('/catalog/:type/:id.json',series);
  assert.equal(out.statusCode,200);assert.equal(out.body.metas.length,10);
  assert.ok(!out.body.metas.some(x=>x.id==='tt10001'||x.id==='tt10002'));
  assert.equal(out.body.metas[0].id,'tt10003');
  assert.match(out.body.metas.at(-1).poster,/rank=10/);
});
test('movies not available digitally are excluded',async()=>{
  const {request,state}=boot();state.badDigital.add(20001);
  const out=await request('/catalog/:type/:id.json',movie);
  assert.equal(out.statusCode,200);assert.equal(out.body.metas[0].id,'tt20002');
});
test('Posters+ uses user configuration and no keys leak into clients',async()=>{
  const {request,calls}=boot();
  const out=await request('/api/poster',{},{id:'tt20001',rank:'1',type:'movie',tmdb:'20001',g:'DRAMA',r:'8.1',n:'Test Film'});
  assert.equal(out.statusCode,200);
  const poster=calls.find(x=>x.url.startsWith('https://postersplus.slokker.cc/poster?'));
  assert.ok(poster);const url=new URL(poster.url);
  assert.equal(url.searchParams.get('imdb_id'),'tt20001');
  assert.equal(url.searchParams.get('tmdb_id'),'20001');
  assert.equal(url.searchParams.get('stremio_id'),'tt20001');
  assert.equal(url.searchParams.get('pc'),'stremio_tv_nuvio');
  assert.equal(url.searchParams.get('bg1'),'below_logo:1:network,studio:24:0.074');
  assert.equal(url.searchParams.get('tmdb_key'),'test-tmdb-key');
  assert.ok(!JSON.stringify(out).includes('test-tmdb-key'));
  assert.ok(!JSON.stringify(out).includes('test-mdblist-key'));
});
test('if Posters+ fails, existing TMDB artwork fallback still works',async()=>{
  const {request,state,calls}=boot();state.noPosters=true;
  const out=await request('/api/poster',{},{id:'tt20001',rank:'1',type:'movie',tmdb:'20001',g:'DRAMA',r:'8.1',n:'Test Film',p:'https://image.tmdb.org/t/p/w780/1.jpg'});
  assert.equal(out.statusCode,200);assert.ok(calls.some(x=>x.url.includes('image.tmdb.org')));
});
test('temporary MDBList failure degrades to popular without 503',async()=>{
  const {request,state,calls}=boot();state.noJustWatch=true;state.noMdblist=true;
  const out=await request('/catalog/:type/:id.json',movie);
  assert.equal(out.statusCode,200);assert.equal(out.body.metas.length,10);
  assert.ok(calls.some(x=>x.url.includes('/movie/popular')));
});
test('status labels source and excludes miniseries',async()=>{
  const {request}=boot();const out=await request('/api/status');
  assert.equal(out.body.posterSource,'Posters+');assert.equal(out.body.excludesMiniseries,true);
  assert.match(out.body.rankingSource,/JustWatch/);
});
