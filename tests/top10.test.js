'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const path=require('node:path');

function boot(){
  const originalLoad=Module._load;
  const routes=new Map(), calls=[], requests=[];
  const state={fail:false,posterFails:true,detailsFail:false,rankSwap:false,missingImdbId:null,
    emptyTrending:false,regionExclude:[],regionalEmpty:false,noRegionalAccess:false,
    undigitalIds:[],futureDigitalIds:[],outsideDigitalIds:[],singleMarketIds:[]};
  const app={set(){return this},use(){return this},listen(){return this},get(route,handler){routes.set(route,handler);return this;}};
  const items=(type,page=1)=>Array.from({length:20},(_,i)=>{
    const n=(page-1)*20+i+1;
    return {id:(type==='tv'?10000:20000)+n,
      imdb_id:`tt${String((type==='tv'?100000:200000)+n)}`,
      title:type==='tv'?`Series ${n}`:`Film ${n}`,
      name:type==='tv'?`Series ${n}`:`Film ${n}`,
      poster_path:`/${type}_${n}.jpg`,backdrop_path:`/wide_${n}.jpg`,
      original_language:'en',genre_ids:[18],vote_average:8.1,
      release_date:'2024-04-01',first_air_date:'2024-04-01'};
  });
  const fakeApi={get:async (url,opt={})=>{
    calls.push(url);requests.push({url,params:opt.params||{}});
    if(state.fail)throw new Error('mock upstream unavailable');
    if(url.includes('postersplus.slokker.cc')&&state.posterFails)throw new Error('mock poster timeout');
    if(url.includes('image.tmdb.org'))return {data:Buffer.from('FAKEIMAGE'+'z'.repeat(4000)),headers:{'content-type':'image/jpeg'}};
    if(url.includes('/discover/')){
      if(state.noRegionalAccess)throw new Error('regional Discover offline');
      const type=url.includes('/discover/tv')?'tv':'movie';
      const page=Number(opt.params?.page||1);
      const region=opt.params?.region||opt.params?.watch_region;
      const result=(state.regionalEmpty?[]:items(type,page)).filter(item=>
        !state.regionExclude.includes(item.id) &&
        !(state.singleMarketIds.includes(item.id) && region!=='US')
      );
      return {data:{results:result}};
    }
    if(url.includes('/trending/')){
      const type=url.includes('/trending/tv/day')?'tv':'movie';
      const page=Number(opt.params?.page||1);
      const result=items(type,page);
      if(state.rankSwap && page===1)[result[0],result[1]]=[result[1],result[0]];
      if(state.missingImdbId)for(const it of result)if(it.id===state.missingImdbId)delete it.imdb_id;
      return {data:{results:state.emptyTrending?[]:result}};
    }
    const rel=url.match(/\/movie\/(\d+)\/release_dates$/);
    if(rel){
      const id=Number(rel[1]);
      const country=state.outsideDigitalIds.includes(id)?'PH':'US';
      const dt=state.futureDigitalIds.includes(id)?'2035-01-01T00:00:00Z':'2024-01-01T00:00:00Z';
      return {data:{results:[{iso_3166_1:country,release_dates:[{type:state.undigitalIds.includes(id)?3:4,release_date:dt}]}]}};
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
        images:{logos:[{file_path:'/french-logo.png',iso_639_1:'fr',vote_average:10},
          {file_path:'/english-logo.png',iso_639_1:'en',vote_average:4},
          {file_path:'/neutral-logo.png',iso_639_1:null,vote_average:8}]},
        credits:{cast:[{name:'Performer A'},{name:'Performer B'}],crew:[{job:'Director',name:'Director A'}]},
        created_by:[{name:'Creator A'}],
        videos:{results:[{site:'YouTube',type:'Trailer',official:true,key:'ABCDef12345'}]},
        origin_country:['US'],production_countries:[{iso_3166_1:'US'}]
      }};
    }
    throw new Error('Unexpected mocked URL: '+url);
  }};
  const fakeSharp=()=>({resize(){return this},composite(){return this},jpeg(){return this},png(){return this},toBuffer:async()=>Buffer.from('FAKEJPEG'+'x'.repeat(1000))});
  Module._load=function(request,parent,isMain){
    if(request==='express')return ()=>app;
    if(request==='cors')return ()=>()=>{};
    if(request==='axios')return {create:()=>fakeApi};
    if(request==='sharp')return fakeSharp;
    if(request==='@resvg/resvg-js')return {Resvg:class{render(){return {asPng:()=>Buffer.from('FAKEPNG')}}}};
    if(request==='dotenv')return {config:()=>{}};
    return originalLoad.apply(this,arguments);
  };
  process.env.TMDB_API_KEY='mock-only';
  process.env.PUBLIC_BASE_URL='https://my-top10-addon.vercel.app';
  const target=path.resolve(__dirname,'../api/index.js');
  delete require.cache[target];
  try{require(target);}finally{Module._load=originalLoad;}
  function response(){return {statusCode:200,headers:{},status(x){this.statusCode=x;return this;},set(k,v){this.headers[k]=v;return this;},setHeader(k,v){this.headers[k]=v;return this;},json(body){this.body=body;return this;},send(body){this.body=body;return this;},get(k){return this.headers[k]}};}
  async function request(pattern,params={},query={}){
    const h=routes.get(pattern);assert.ok(h,'missing route '+pattern);
    const req={params,query,get:key=>key==='host'?'my-top10-addon.vercel.app':null};
    const res=response();await h(req,res);return res;
  }
  return {request,state,calls,requests};
}
const MOVIES={type:'movie',id:'top10_trending_movies'};
const SERIES={type:'series',id:'top10_trending_shows'};

test('retains catalog IDs, uses TMDB daily Trending as source and 9 regional Discover markets',async()=>{
  const {request,requests,calls}=boot();
  const [movies,shows]=await Promise.all([
    request('/catalog/:type/:id.json',MOVIES),request('/catalog/:type/:id.json',SERIES)
  ]);
  assert.equal(movies.statusCode,200);assert.equal(shows.statusCode,200);
  assert.equal(movies.body.metas.length,10);assert.equal(shows.body.metas.length,10);
  assert.equal(movies.body.metas[0].id,'tt200001');assert.equal(shows.body.metas[0].id,'tt100001');
  assert.ok(requests.some(r=>r.url.endsWith('/trending/movie/day')));
  assert.ok(requests.some(r=>r.url.endsWith('/trending/tv/day')));
  const movieRegions=requests.filter(r=>r.url.includes('/discover/movie')).map(r=>r.params.region);
  const tvRegions=requests.filter(r=>r.url.includes('/discover/tv')).map(r=>r.params.watch_region);
  assert.deepEqual(new Set(movieRegions),new Set(['US','GB','DE','FR','IT','ES','FI','SE','NL']));
  assert.deepEqual(new Set(tvRegions),new Set(movieRegions));
  assert.ok(requests.filter(r=>r.url.includes('/discover/movie')).every(r=>r.params.with_release_type===4));
  assert.ok(requests.filter(r=>r.url.includes('/discover/tv')).every(r=>r.params.with_watch_monetization_types));
  assert.ok(requests.some(r=>r.url.includes('/release_dates')));
  assert.ok(!requests.some(r=>r.url.includes('/tv/')&&r.url.includes('/release_dates')));
  assert.ok(calls.every(url=>!url.includes('postersplus')));
});

test('preserves Trending Today order within qualified region group and renumbers after filter',async()=>{
  const {request,state}=boot();state.rankSwap=true;state.regionExclude=[20003];
  const res=await request('/catalog/:type/:id.json',MOVIES);
  assert.equal(res.statusCode,200);assert.equal(res.body.metas[0].id,'tt200002');
  assert.equal(res.body.metas[1].id,'tt200001');
  assert.equal(res.body.metas[2].id,'tt200004');
  assert.match(res.body.metas[2].poster,/rank=3/);
  assert.ok(res.body.metas.every(m=>!m.id.includes('200003')));
});

test('strict digital-release gate rejects theatrical-only, future-digital, and non-target-region digital dates',async()=>{
  const {request,state}=boot();
  state.undigitalIds=[20001];state.futureDigitalIds=[20002];state.outsideDigitalIds=[20003];
  const res=await request('/catalog/:type/:id.json',MOVIES);
  assert.equal(res.statusCode,200);assert.equal(res.body.metas.length,10);
  assert.equal(res.body.metas[0].id,'tt200004');
  assert.match(res.body.metas[0].poster,/rank=1/);
  assert.ok(res.body.metas.every(m=>!['tt200001','tt200002','tt200003'].includes(m.id)));
});

test('single-market results only fill after multi-market, and purely nonregional entries never appear',async()=>{
  const {request,state}=boot();
  state.singleMarketIds=[20001,20002];state.regionExclude=[20003];
  const res=await request('/catalog/:type/:id.json',MOVIES);
  assert.equal(res.statusCode,200);assert.equal(res.body.metas[0].id,'tt200004');
});

test('series are region-restricted but not gated by film digital release status',async()=>{
  const {request,state,requests}=boot();state.regionExclude=[10001];
  const res=await request('/catalog/:type/:id.json',SERIES);
  assert.equal(res.statusCode,200);assert.equal(res.body.metas[0].id,'tt100002');
  assert.ok(!requests.some(r=>r.url.includes('/release_dates')));
});

test('IMDb ID missing is skipped while eligible later trending titles fill the 10 slots',async()=>{
  const {request,state}=boot();state.missingImdbId=20001;
  const res=await request('/catalog/:type/:id.json',MOVIES);
  assert.equal(res.statusCode,200);assert.equal(res.body.metas.length,10);
  assert.equal(res.body.metas[0].id,'tt200002');
  assert.match(res.body.metas[0].poster,/rank=1/);
});

test('cached concurrent catalog requests share refresh work',async()=>{
  const {request,calls}=boot();
  const rows=await Promise.all(Array.from({length:5},()=>request('/catalog/:type/:id.json',SERIES)));
  assert.ok(rows.every(r=>r.statusCode===200 && r.body.metas.length===10));
  assert.equal(calls.filter(url=>url.endsWith('/trending/tv/day')).length,3);
});

test('unavailable regional checks never fall back to global Trending',async()=>{
  const {request,state}=boot();state.noRegionalAccess=true;
  const res=await request('/catalog/:type/:id.json',SERIES);
  assert.equal(res.statusCode,503);assert.equal(res.headers['Cache-Control'],'no-store');
  state.noRegionalAccess=false;
  const restored=await request('/catalog/:type/:id.json',SERIES);
  assert.equal(restored.statusCode,200);
});

test('unavailable Trending fails safely without caching empty results',async()=>{
  const {request,state}=boot();state.emptyTrending=true;
  const res=await request('/catalog/:type/:id.json',MOVIES);
  assert.equal(res.statusCode,503);
  state.emptyTrending=false;
  assert.equal((await request('/catalog/:type/:id.json',MOVIES)).statusCode,200);
});

test('poster rendering remains based on original Posters+ instance',async()=>{
  const {request,calls}=boot();
  const res=await request('/api/poster',{}, {id:'tt200001',rank:'1',type:'movie',tmdb:'20001',g:'DRAMA',r:'8.1',n:'Film 1',p:'https://image.tmdb.org/t/p/w1280/movie_1.jpg'});
  assert.equal(res.statusCode,200);assert.equal(res.headers['Content-Type'],'image/jpeg');
  assert.ok(calls.some(url=>url.includes('postersplus.slokker.cc')));
  assert.ok(calls.some(url=>url.includes('image.tmdb.org')));
});

test('TMDB metadata/backdrops/logos/cast/runtime/trailers are retained',async()=>{
  const {request,requests}=boot();
  const res=await request('/catalog/:type/:id.json',MOVIES);
  const m=res.body.metas[0];
  assert.equal(m.logo,'https://image.tmdb.org/t/p/original/english-logo.png');
  assert.equal(m.background,'https://image.tmdb.org/t/p/original/tmdb-background-20001.jpg');
  assert.equal(m.description,'Official TMDB overview 20001');
  assert.deepEqual(m.genres,['Drama','Mystery']);
  assert.equal(m.runtime,'123 min');
  assert.deepEqual(m.cast,['Performer A','Performer B']);
  assert.deepEqual(m.director,['Director A']);
  assert.deepEqual(m.trailers,[{source:'ABCDef12345',type:'Trailer'}]);
  assert.match(m.poster,/v=v590-daily-regional-digital/);
  assert.ok(requests.some(r=>r.params.append_to_response==='images,credits,videos'));
});

test('TMDB enrichment failure retains fallback backdrop and film fields',async()=>{
  const {request,state}=boot();state.detailsFail=true;
  const res=await request('/catalog/:type/:id.json',MOVIES);
  assert.equal(res.statusCode,200);
  assert.equal(res.body.metas[0].background,'https://image.tmdb.org/t/p/original/wide_1.jpg');
  assert.equal(res.body.metas[0].releaseInfo,'2024');
});

test('status identifies filtered trending chart and confirms digital strictness',async()=>{
  const {request}=boot();const res=await request('/api/status');
  assert.equal(res.body.version,'5.9.0');
  assert.equal(res.body.digitalReleaseStrict,true);
  assert.match(res.body.rankingSource,/Trending Today/);
  assert.equal(res.body.regions.length,9);
});
