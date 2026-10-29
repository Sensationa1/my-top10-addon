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
  const state = {fail:false,posterFails:true,detailsFail:false,rankSwap:false,mixedGenres:false,missingImdbId:null,emptyTrending:false};
  const app={
    set(){return this;},use(){return this;},listen(){return this;},
    get(route,handler){routes.set(route,handler);return this;}
  };
  const makeItems=(type)=>Array.from({length:20},(_,i)=>{
    const n=i+1;
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
      const items=makeItems(type);
      if(state.rankSwap) [items[0],items[1]]=[items[1],items[0]];
      if(state.mixedGenres){
        items[0].release_date='2031-02-01'; // theatrical / future release is still official rank 1
        items[1].original_language='ja';items[1].genre_ids=[16];
        items[2].original_language='zh';items[2].genre_ids=[10762];
      }
      if(state.missingImdbId) {
        const item=items.find(it=>it.id===state.missingImdbId);
        if(item) delete item.imdb_id;
      }
      return {data:{results:state.emptyTrending?[]:items}};
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

test('both unchanged catalog IDs use the corresponding official TMDB daily trending charts',async()=>{
  const {request,requests,calls}=boot();
  const [movies,shows]=await Promise.all([
    request('/catalog/:type/:id.json',MOVIES),request('/catalog/:type/:id.json',SERIES)
  ]);
  assert.equal(movies.statusCode,200);assert.equal(shows.statusCode,200);
  assert.equal(movies.body.metas.length,10);assert.equal(shows.body.metas.length,10);
  assert.equal(movies.body.metas[0].id,'tt200001');assert.equal(shows.body.metas[0].id,'tt100001');
  assert.match(movies.body.metas[9].poster,/rank=10/);
  assert.match(shows.body.metas[0].poster,/rank=1/);
  assert.ok(requests.some(x=>x.url.endsWith('/trending/movie/day')));
  assert.ok(requests.some(x=>x.url.endsWith('/trending/tv/day')));
  assert.ok(requests.every(x=>!x.url.includes('/discover/') && !x.url.includes('/release_dates')));
  assert.ok(calls.every(url=>!url.includes('postersplus')),'catalog does not wait for poster rendering');
});

test('preserves TMDB Top 10 order and native rank numbers, including re-ordered chart',async()=>{
  const {request,state}=boot();state.rankSwap=true;
  const res=await request('/catalog/:type/:id.json',MOVIES);
  assert.equal(res.body.metas[0].id,'tt200002');assert.equal(res.body.metas[1].id,'tt200001');
  assert.match(res.body.metas[0].poster,/rank=1/);assert.match(res.body.metas[1].poster,/rank=2/);
  assert.equal(res.body.metas.at(-1).id,'tt200010');
});

test('no region/language/genre or digital-release filtering silently changes the TMDB Top 10',async()=>{
  const {request,state,requests}=boot();state.mixedGenres=true;
  const res=await request('/catalog/:type/:id.json',MOVIES);
  assert.equal(res.statusCode,200);assert.equal(res.body.metas.length,10);
  assert.equal(res.body.metas[0].id,'tt200001');
  assert.equal(res.body.metas[1].id,'tt200002');
  assert.equal(res.body.metas[2].id,'tt200003');
  assert.ok(!requests.some(x=>x.url.includes('/release_dates')));
});

test('missing IMDb ID never substitutes TMDB rank 11 or silently renumbers later cards',async()=>{
  const {request,state}=boot();state.missingImdbId=20001;
  const res=await request('/catalog/:type/:id.json',MOVIES);
  assert.equal(res.statusCode,200);assert.equal(res.body.metas.length,9);
  assert.equal(res.body.metas[0].id,'tt200002');
  assert.match(res.body.metas[0].poster,/rank=2/);
  assert.equal(res.body.metas.at(-1).id,'tt200010');
});

test('simultaneous catalog reads share one upstream trending call',async()=>{
  const {request,calls}=boot();
  const many=await Promise.all(Array.from({length:5},()=>request('/catalog/:type/:id.json',SERIES)));
  assert.ok(many.every(r=>r.statusCode===200 && r.body.metas.length===10));
  assert.equal(calls.filter(url=>url.endsWith('/trending/tv/day')).length,1);
});

test('upstream trending failure returns retryable 503 and does not cache empty data',async()=>{
  const {request,state}=boot();state.fail=true;
  const failed=await request('/catalog/:type/:id.json',MOVIES);
  assert.equal(failed.statusCode,503);assert.equal(failed.headers['Cache-Control'],'no-store');
  assert.equal(failed.body.error,'Catalog temporarily unavailable. Retry soon.');
  state.fail=false;
  const restored=await request('/catalog/:type/:id.json',MOVIES);
  assert.equal(restored.statusCode,200);assert.equal(restored.body.metas.length,10);
});

test('empty TMDB Trending response fails safely',async()=>{
  const {request,state}=boot();state.emptyTrending=true;
  const res=await request('/catalog/:type/:id.json',SERIES);
  assert.equal(res.statusCode,503);
});

test('poster source still uses Posters+ preset and TMDB art fallback',async()=>{
  const {request,calls}=boot();
  const res=await request('/api/poster',{}, {id:'tt200001',rank:'1',type:'movie',tmdb:'20001',g:'DRAMA',r:'8.1',n:'Film 1',p:'https://image.tmdb.org/t/p/w1280/movie_1.jpg'});
  assert.equal(res.statusCode,200);assert.equal(res.headers['Content-Type'],'image/jpeg');
  assert.ok(calls.some(url=>url.includes('postersplus.slokker.cc')));
  assert.ok(calls.some(url=>url.includes('image.tmdb.org')));
  assert.match(res.headers['Cache-Control'],/s-maxage=900/);
});

test('TMDB details enrich movies with clearlogos, original backdrops, and metadata',async()=>{
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
  assert.equal(meta.released,'2023-01-09T00:00:00.000Z');
  assert.deepEqual(meta.trailers,[{source:'ABCDef12345',type:'Trailer'}]);
  assert.match(meta.poster,/v=v580-tmdb-trending-today/);
  const detailCalls=requests.filter(r=>/^https:\/\/api\.themoviedb\.org\/3\/movie\/\d+$/.test(r.url));
  assert.equal(detailCalls.length,10);
  assert.ok(detailCalls.every(r=>r.params.append_to_response==='images,credits,videos'));
  assert.ok(detailCalls.every(r=>r.params.include_image_language.includes('en,null')));
});

test('TMDB series details preserve title logo and proper year/creator/runtime fields',async()=>{
  const {request}=boot();const res=await request('/catalog/:type/:id.json',SERIES);
  const meta=res.body.metas[0];
  assert.equal(meta.logo,'https://image.tmdb.org/t/p/original/english-logo.png');
  assert.equal(meta.runtime,'46 min');
  assert.equal(meta.releaseInfo,'2023-2025');
  assert.deepEqual(meta.director,['Creator A']);
  assert.equal(meta.type,'series');
});

test('TMDB details failures keep original trending order and chart backdrops',async()=>{
  const {request,state}=boot();state.detailsFail=true;
  const res=await request('/catalog/:type/:id.json',MOVIES);
  assert.equal(res.statusCode,200);assert.equal(res.body.metas.length,10);
  assert.equal(res.body.metas[0].background,'https://image.tmdb.org/t/p/original/wide_1.jpg');
  assert.equal(res.body.metas[0].releaseInfo,'2024');
  assert.deepEqual(res.body.metas[0].genres,['Drama']);
  assert.ok(res.body.metas.every(m=>typeof m.poster==='string'));
});

test('status correctly identifies official TMDB Trending Today source',async()=>{
  const {request}=boot();const res=await request('/api/status');
  assert.equal(res.statusCode,200);
  assert.equal(res.body.version,'5.8.0');
  assert.equal(res.body.rankingSource,'TMDB Trending Today');
  assert.equal(res.body.digitalReleaseStrict,false);
});
