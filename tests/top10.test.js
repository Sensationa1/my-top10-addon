'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

function boot() {
  const originalLoad = Module._load;
  const routes = new Map();
  const calls = [];
  const requests = [];
  const state = {fail:false,posterFails:true,detailsFail:false,rankSwap:false,mixedGenres:false,missingImdbId:null,emptyTrending:false, invalidDigitalIds:new Set(), futureDigitalIds:new Set(), theatricalOnlyIds:new Set(), taggedAnimeIds:new Set(), keywordFailures:new Set(), includeCyberpunk:false};
  const app={
    set(){return this;},use(){return this;},listen(){return this;},
    get(route,handler){routes.set(route,handler);return this;}
  };
  const makeItems=(type,page=1)=>Array.from({length:20},(_,i)=>{
    const n=(page-1)*20+i+1;
    return {id:(type==='tv'?10000:20000)+n,
      imdb_id:`tt${String((type==='tv'?100000:200000)+n)}`,
      title: type==='tv'?`Series ${n}`:`Film ${n}`,
      name: type==='tv'?`Series ${n}`:`Film ${n}`,
      poster_path:`/${type}_${n}.jpg`,backdrop_path:`/wide_${n}.jpg`,
      original_language:'en',genre_ids:[18],vote_average:8.1,
      release_date:'2024-04-01',first_air_date:'2024-04-01'};
  });
  const fakeApi={get:async(url,opt={})=>{
    calls.push(url); requests.push({url,params:opt.params||{}});
    if(state.fail)throw new Error('mock upstream unavailable');
    if(url.includes('postersplus.slokker.cc') && state.posterFails)throw new Error('mock poster timeout');
    if(url.includes('image.tmdb.org'))return {data:Buffer.from('FAKEIMAGE'+'z'.repeat(4000)),headers:{'content-type':'image/jpeg'}};
    if(url.includes('/trending/')) {
      const type=url.includes('/trending/tv/day')?'tv':'movie';
      const page=Number(opt.params?.page||1);
      const items=makeItems(type,page);
      if(state.rankSwap && page===1) [items[0],items[1]]=[items[1],items[0]];
      if(state.mixedGenres && page===1){
        items[0].release_date='2031-02-01';state.futureDigitalIds.add(items[0].id);
        items[1].original_language='ja';items[1].genre_ids=[16];
        items[2].original_language='zh';items[2].genre_ids=[10762];
        items[3].original_language='en';items[3].genre_ids=[16]; // Western animation allowed
        items[4].original_language='en';items[4].genre_ids=[16];state.taggedAnimeIds.add(items[4].id);
      }
      if(state.includeCyberpunk && type==='tv' && page===1) {
        items[0].original_language='ja';items[0].genre_ids=[16]; // Exclude
        items[1].id=105248;items[1].imdb_id='tt12590266';items[1].original_language='ja';items[1].genre_ids=[16];items[1].name='Cyberpunk: Edgerunners';
        items[2].genre_ids=[16];items[2].original_language='en';state.taggedAnimeIds.add(items[2].id);
        items[3].genre_ids=[16];items[3].original_language='en'; // Ordinary western animation
      }
      if(state.missingImdbId){
        const item=items.find(it=>it.id===state.missingImdbId);
        if(item)delete item.imdb_id;
      }
      return {data:{results:state.emptyTrending?[]:items,total_pages:5}};
    }
    if(url.includes('/release_dates')) {
      const id=Number(url.match(/\/movie\/(\d+)\/release_dates/)?.[1]);
      if(state.invalidDigitalIds.has(id))throw new Error('release date lookup failed');
      const entry=state.theatricalOnlyIds.has(id)?{type:3,release_date:'2024-03-01T00:00:00Z'}:
        {type:4,release_date:state.futureDigitalIds.has(id)?'2032-03-01T00:00:00Z':'2024-03-01T00:00:00Z'};
      return {data:{results:[{iso_3166_1:'CA',release_dates:[entry]}]}};
    }
    if(url.includes('/keywords')){
      const id=Number(url.match(/\/(?:movie|tv)\/(\d+)\/keywords/)?.[1]);
      if(state.keywordFailures.has(id))throw new Error('keyword service down');
      return {data:{keywords:state.taggedAnimeIds.has(id)?[{id:210024,name:'anime'}]:[]}};
    }
    if(url.includes('/external_ids')){
      const id=Number(url.match(/\/(?:movie|tv)\/(\d+)\/external_ids/)?.[1]);
      return {data:{imdb_id:id===state.missingImdbId?null:'tt11111111'}};
    }
    const details=url.match(/\/(movie|tv)\/(\d+)$/);
    if(details){
      if(state.detailsFail)throw new Error('simulated TMDB detail timeout');
      const id=Number(details[2]);
      return {data:{
        id,title:`TMDB Film ${id}`,name:`TMDB Series ${id}`,overview:`Official TMDB overview ${id}`,
        backdrop_path:`/tmdb-background-${id}.jpg`,original_language:'en',
        release_date:'2023-01-09',first_air_date:'2023-01-09',last_air_date:'2025-03-17',in_production:false,
        episode_run_time:[46],runtime:123,genres:[{id:18,name:'Drama'},{id:9648,name:'Mystery'}],
        images:{logos:[
          {file_path:'/french-logo.png',iso_639_1:'fr',vote_average:10},
          {file_path:'/english-logo.png',iso_639_1:'en',vote_average:4},
          {file_path:'/neutral-logo.png',iso_639_1:null,vote_average:8}
        ]},
        credits:{cast:[{name:'Performer A'},{name:'Performer B'}],crew:[{job:'Director',name:'Director A'}]},
        created_by:[{name:'Creator A'}],
        videos:{results:[{site:'YouTube',type:'Trailer',official:true,key:'ABCDef12345'}]},
        origin_country:['US'],production_countries:[{iso_3166_1:'US'}]
      }};
    }
    throw new Error('unexpected mock URL '+url);
  }};
  const fakeSharp=()=>({resize(){return this},composite(){return this},jpeg(){return this},png(){return this},toBuffer:async()=>Buffer.from('FAKEJPEG'+'x'.repeat(1000))});
  Module._load=function(request,parent,isMain){
    if(request==='express')return ()=>app;
    if(request==='cors')return ()=>()=>{};
    if(request==='axios')return {create:()=>fakeApi};
    if(request==='sharp')return fakeSharp;
    if(request==='@resvg/resvg-js')return {Resvg:class{render(){return {asPng:()=>Buffer.from('FAKEPNG')};}}};
    if(request==='dotenv')return {config:()=>{}};
    return originalLoad.apply(this,arguments);
  };
  process.env.TMDB_API_KEY='mock-only';
  process.env.PUBLIC_BASE_URL='https://my-top10-addon.vercel.app';
  const target=path.resolve(__dirname,'../api/index.js');
  delete require.cache[target];
  try{require(target);}finally{Module._load=originalLoad;}
  function response(){return {statusCode:200,headers:{},status(x){this.statusCode=x;return this;},set(k,v){this.headers[k]=v;return this;},setHeader(k,v){this.headers[k]=v;return this;},json(body){this.body=body;return this;},send(body){this.body=body;return this;},get(k){return this.headers[k]}};}
  async function request(pathPattern,params={},query={}){
    const h=routes.get(pathPattern);
    assert.ok(h,'missing route '+pathPattern);
    const req={params,query,get:(key)=>key==='host'?'my-top10-addon.vercel.app':null};
    const res=response();await h(req,res);return res;
  }
  return {request,state,calls,requests};
}

const MOVIES={type:'movie',id:'top10_trending_movies'};
const SERIES={type:'series',id:'top10_trending_shows'};

test('both unchanged catalog IDs use global TMDB Trending Today and no regional Discover',async()=>{
  const {request,requests,calls}=boot();
  const [movies,shows]=await Promise.all([
    request('/catalog/:type/:id.json',MOVIES),request('/catalog/:type/:id.json',SERIES)
  ]);
  assert.equal(movies.statusCode,200);assert.equal(shows.statusCode,200);
  assert.equal(movies.body.metas.length,10);assert.equal(shows.body.metas.length,10);
  assert.equal(movies.body.metas[0].id,'tt200001');assert.equal(shows.body.metas[0].id,'tt100001');
  assert.match(movies.body.metas[9].poster,/rank=10/);
  assert.ok(requests.some(x=>x.url.endsWith('/trending/movie/day')));
  assert.ok(requests.some(x=>x.url.endsWith('/trending/tv/day')));
  assert.ok(requests.every(x=>!x.url.includes('/discover/')));
  assert.ok(requests.some(x=>x.url.includes('/release_dates')));
  assert.ok(calls.every(url=>!url.includes('postersplus')),'catalog does not wait for poster rendering');
});

test('TMDB daily ordering is kept with contiguous visual rank numbers',async()=>{
  const {request,state}=boot();state.rankSwap=true;
  const res=await request('/catalog/:type/:id.json',MOVIES);
  assert.equal(res.body.metas[0].id,'tt200002');assert.equal(res.body.metas[1].id,'tt200001');
  assert.match(res.body.metas[0].poster,/rank=1/);assert.match(res.body.metas[1].poster,/rank=2/);
  assert.equal(res.body.metas.at(-1).id,'tt200010');
});

test('digital release gate skips missing, theatrical-only and future digital movies',async()=>{
  const {request,state,requests}=boot();
  state.invalidDigitalIds.add(20001);
  state.futureDigitalIds.add(20002);
  state.theatricalOnlyIds.add(20003);
  const res=await request('/catalog/:type/:id.json',MOVIES);
  assert.equal(res.statusCode,200);assert.equal(res.body.metas.length,10);
  assert.equal(res.body.metas[0].id,'tt200004');
  assert.equal(res.body.metas[9].id,'tt200013');
  assert.match(res.body.metas[0].poster,/rank=1/);
  assert.match(res.body.metas.at(-1).poster,/rank=10/);
  assert.ok(requests.some(x=>x.url.includes('/movie/20001/release_dates')));
});

test('movie anime gate rejects Japanese and anime-tagged animation but keeps Western animation',async()=>{
  const {request,state}=boot();state.mixedGenres=true;
  const res=await request('/catalog/:type/:id.json',MOVIES);
  assert.equal(res.statusCode,200);assert.equal(res.body.metas.length,10);
  const ids=res.body.metas.map(m=>m.id);
  assert.ok(!ids.includes('tt200001')); // future-only digital
  assert.ok(!ids.includes('tt200002')); // Japanese anime
  assert.ok(!ids.includes('tt200005')); // animation explicitly keyword-tagged anime
  assert.ok(ids.includes('tt200004')); // non-anime Western animation
  assert.ok(ids.includes('tt200003')); // non-anime non-English title
});

test('TV anime excluded with the sole explicit Cyberpunk: Edgerunners exception',async()=>{
  const {request,state}=boot();state.includeCyberpunk=true;
  const res=await request('/catalog/:type/:id.json',SERIES);
  const ids=res.body.metas.map(x=>x.id);
  assert.equal(res.statusCode,200);assert.equal(ids.length,10);
  assert.ok(!ids.includes('tt100001'));
  assert.ok(ids.includes('tt12590266'));
  assert.ok(!ids.includes('tt100003'));
  assert.ok(ids.includes('tt100004')); // Western animation permitted
  assert.match(res.body.metas.find(x=>x.id==='tt12590266').poster,/rank=1/);
});

test('unknown animated title keywords fail closed rather than admit anime',async()=>{
  const {request,state}=boot();
  state.keywordFailures.add(10001);
  state.mixedGenres=false;
  // Add an animated entry via explicit test state mutation in the mock
  state.includeCyberpunk=true;
  state.keywordFailures.add(10004);
  const res=await request('/catalog/:type/:id.json',SERIES);
  assert.ok(!res.body.metas.some(m=>m.id==='tt100004'));
});

test('missing IMDb ID skips title and fills from the next daily-trending rank',async()=>{
  const {request,state}=boot();state.missingImdbId=20001;
  const res=await request('/catalog/:type/:id.json',MOVIES);
  assert.equal(res.statusCode,200);assert.equal(res.body.metas.length,10);
  assert.equal(res.body.metas[0].id,'tt200002');
  assert.match(res.body.metas[0].poster,/rank=1/);
  assert.equal(res.body.metas.at(-1).id,'tt200011');
});

test('fetches later TMDB Trending Today pages when first has too few eligible titles',async()=>{
  const {request,state,requests}=boot();
  for(let id=20001;id<=20016;id++)state.theatricalOnlyIds.add(id);
  const res=await request('/catalog/:type/:id.json',MOVIES);
  assert.equal(res.statusCode,200);assert.equal(res.body.metas.length,10);
  assert.equal(res.body.metas[0].id,'tt200017');
  assert.equal(res.body.metas.at(-1).id,'tt200026');
  assert.ok(requests.some(x=>x.url.endsWith('/trending/movie/day')&&x.params.page===2));
  assert.ok(requests.every(x=>!x.url.includes('/discover/')));
});

test('simultaneous catalog reads share one upstream TMDB trending call',async()=>{
  const {request,calls}=boot();
  const many=await Promise.all(Array.from({length:5},()=>request('/catalog/:type/:id.json',SERIES)));
  assert.ok(many.every(r=>r.statusCode===200 && r.body.metas.length===10));
  assert.equal(calls.filter(url=>url.endsWith('/trending/tv/day')).length,1);
});

test('upstream trending failure returns retryable 503 and does not cache empty data',async()=>{
  const {request,state}=boot();state.fail=true;
  const failed=await request('/catalog/:type/:id.json',MOVIES);
  assert.equal(failed.statusCode,503);assert.equal(failed.headers['Cache-Control'],'no-store');
  state.fail=false;
  const restored=await request('/catalog/:type/:id.json',MOVIES);
  assert.equal(restored.statusCode,200);assert.equal(restored.body.metas.length,10);
});

test('empty TMDB Trending Today response fails safely',async()=>{
  const {request,state}=boot();state.emptyTrending=true;
  const res=await request('/catalog/:type/:id.json',SERIES);
  assert.equal(res.statusCode,503);
});

test('poster source retains last confirmed Posters+ preset and TMDB fallback',async()=>{
  const {request,calls}=boot();
  const res=await request('/api/poster',{}, {id:'tt200001',rank:'1',type:'movie',tmdb:'20001',g:'DRAMA',r:'8.1',n:'Film 1',p:'https://image.tmdb.org/t/p/w1280/movie_1.jpg'});
  assert.equal(res.statusCode,200);assert.equal(res.headers['Content-Type'],'image/jpeg');
  assert.ok(calls.some(url=>url.includes('postersplus.slokker.cc')));
  assert.ok(calls.some(url=>url.includes('bg1=0.9%2C0.075%2Cr%3A4%3Anetwork')));
  assert.ok(calls.some(url=>url.includes('image.tmdb.org')));
});

test('TMDB details enrich movies with logos, original backdrops and metadata',async()=>{
  const {request,requests}=boot();
  const res=await request('/catalog/:type/:id.json',MOVIES);
  const meta=res.body.metas[0];
  assert.equal(meta.name,'Film 1');
  assert.equal(meta.description,'Official TMDB overview 20001');
  assert.equal(meta.background,'https://image.tmdb.org/t/p/original/tmdb-background-20001.jpg');
  assert.equal(meta.logo,'https://image.tmdb.org/t/p/original/english-logo.png');
  assert.deepEqual(meta.genres,['Drama','Mystery']);
  assert.deepEqual(meta.cast,['Performer A','Performer B']);
  assert.deepEqual(meta.director,['Director A']);
  assert.equal(meta.runtime,'123 min');
  assert.equal(meta.releaseInfo,'2023');
  assert.deepEqual(meta.trailers,[{source:'ABCDef12345',type:'Trailer'}]);
  assert.match(meta.poster,/v=v5100-tmdb-today-digital-noanime/);
  const detailCalls=requests.filter(r=>/^https:\/\/api\.themoviedb\.org\/3\/movie\/\d+$/.test(r.url));
  assert.equal(detailCalls.length,10);
  assert.ok(detailCalls.every(r=>r.params.append_to_response==='images,credits,videos'));
});

test('TMDB series details preserve logos and TV metadata',async()=>{
  const {request}=boot();const res=await request('/catalog/:type/:id.json',SERIES);
  const meta=res.body.metas[0];
  assert.equal(meta.logo,'https://image.tmdb.org/t/p/original/english-logo.png');
  assert.equal(meta.runtime,'46 min');
  assert.equal(meta.releaseInfo,'2023-2025');
  assert.deepEqual(meta.director,['Creator A']);
  assert.equal(meta.type,'series');
});

test('TMDB detail failures still retain poster URLs and chart backdrops',async()=>{
  const {request,state}=boot();state.detailsFail=true;
  const res=await request('/catalog/:type/:id.json',MOVIES);
  assert.equal(res.statusCode,200);assert.equal(res.body.metas.length,10);
  assert.equal(res.body.metas[0].background,'https://image.tmdb.org/t/p/original/wide_1.jpg');
  assert.deepEqual(res.body.metas[0].genres,['Drama']);
});

test('status exposes the selected filters and unchanged catalog IDs',async()=>{
  const {request}=boot();const status=await request('/api/status');
  assert.equal(status.statusCode,200);
  assert.equal(status.body.version,'5.10.0');
  assert.equal(status.body.rankingSource,'TMDB Trending Today — filtered');
  assert.equal(status.body.digitalReleaseStrict,true);
  assert.equal(status.body.animeExcluded,true);
  assert.equal(status.body.regionalFilter,false);
  const manifest=await request('/manifest.json');
  assert.equal(manifest.body.catalogs[0].id,'top10_trending_shows');
  assert.equal(manifest.body.catalogs[1].id,'top10_trending_movies');
});
