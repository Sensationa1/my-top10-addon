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
  const state = {fail:false, posterFails:true, digitalReleaseForId:null, useDiscover:false, showSingleMarketHit:false, detailsFail:false};
  const app={
    set(){return this;},use(){return this;},listen(){return this;},
    get(route, handler){routes.set(route,handler);return this;}
  };
  const makeItems=(type,page)=>Array.from({length:15},(_,i)=>{
    const n=(page-1)*15+i+1;
    return {id:(type==='tv'?10000:20000)+n,tmdb_id:(type==='tv'?10000:20000)+n,
      imdb_id:`tt${String((type==='tv'?100000:200000)+n)}`,
      title: type==='tv'?`Series ${n}`:`Film ${n}`,
      name:type==='tv'?`Series ${n}`:`Film ${n}`,
      poster_path:`/${type}_${n}.jpg`,backdrop_path:`/wide_${n}.jpg`,
      original_language:'en',genre_ids:[18],vote_average:8.1,release_date:'2024-04-01',first_air_date:'2024-04-01'};
  });
  const fakeApi={get:async(url,opt={})=>{
    calls.push(url); requests.push({url, params:opt.params||{}});
    if(state.fail)throw new Error('mock upstream unavailable');
    if(url.includes('postersplus.slokker.cc') && state.posterFails)throw new Error('mock poster timeout');
    if(url.includes('image.tmdb.org'))return {data:Buffer.from('FAKEIMAGE'+'z'.repeat(4000)),headers:{'content-type':'image/jpeg'}};
    if(url.includes('/release_dates')) {
      const id=Number(url.match(/\/movie\/(\d+)\/release_dates/)?.[1]||0);
      const info=state.digitalReleaseForId?.(id);
      return {data:{results:[{release_dates:info === undefined ? [{type:4,release_date:'2024-04-01T00:00:00'}] : info}]}};
    }
    if(url.includes('/discover/movie') || url.includes('/discover/tv')) {
      const type = url.includes('/discover/movie') ? 'movie' : 'tv';
      const page = Number(opt.params?.page||1);
      // All regional markets have the same widely available titles.
      // Optionally insert a #1 US-only title to prove that it does not
      // beat shows that appear in many countries.
      const items = (page>=3 && state.useDiscover)
        ? Array.from({length:15},(_,i)=>{
          const n=30000+(page-3)*15+i+1;
          return {id:n,tmdb_id:n,imdb_id:`tt${400000+n}`,title:`Digital film ${n}`,
            poster_path:'/img.jpg',release_date:'2024-01-01',original_language:'en',genre_ids:[18]};
        })
        : makeItems(type,page);
      if (state.showSingleMarketHit && page===1 && (opt.params?.region==='US' || opt.params?.watch_region==='US')) {
        items.unshift({id:99000,tmdb_id:99000,imdb_id:'tt990000',
          title:'Only US film',name:'Only US show',poster_path:'/img.jpg',
          release_date:'2024-01-01',first_air_date:'2024-01-01',genre_ids:[18],original_language:'en'});
      }
      return {data:{results:items}};
    }
    if(url.includes('/external_ids'))return {data:{imdb_id:'tt11111111'}};
    const details=url.match(/\/(movie|tv)\/(\d+)$/);
    if(details){
      if(state.detailsFail)throw new Error('simulated TMDB detail timeout');
      const tv=details[1]==='tv';
      const id=Number(details[2]);
      return {data:{
        id, title:`TMDB Film ${id}`,name:`TMDB Series ${id}`,overview:`Official TMDB overview ${id}`,
        backdrop_path:`/tmdb-background-${id}.jpg`,original_language:'en',
        release_date:'2023-01-09', first_air_date:'2023-01-09',last_air_date:'2025-03-17',in_production:false,
        episode_run_time:[46],runtime:123, genres:[{id:18,name:'Drama'},{id:9648,name:'Mystery'}],
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
    if(request==='@resvg/resvg-js')return {Resvg: class{render(){return {asPng:()=>Buffer.from('FAKEPNG')};}}};
    if(request==='dotenv')return {config:()=>{}};
    return originalLoad.apply(this,arguments);
  };
  process.env.TMDB_API_KEY='mock-only';
  process.env.PUBLIC_BASE_URL='https://my-top10-addon.vercel.app';
  const target=path.resolve(__dirname,'../api/index.js');
  delete require.cache[target];
  try {require(target);} finally {Module._load=originalLoad;}
  function response(){
    return {statusCode:200,headers:{},status(x){this.statusCode=x;return this;},set(k,v){this.headers[k]=v;return this;},setHeader(k,v){this.headers[k]=v;return this;},json(body){this.body=body;return this;},send(body){this.body=body;return this;},get(k){return this.headers[k]}};
  }
  async function request(pathPattern, params={},query={}) {
    const h=routes.get(pathPattern);
    assert.ok(h,'missing route '+pathPattern);
    const req={params,query,get:(key)=>key==='host'?'my-top10-addon.vercel.app':null};
    const res=response();
    await h(req,res);
    return res;
  }
  return {request,state,calls,requests};
}

test('movie and series catalogs load independently without posters and retain IDs',async()=>{
  const {request,calls}=boot();
  const [movies,shows]=await Promise.all([
    request('/catalog/:type/:id.json',{type:'movie',id:'top10_trending_movies'}),
    request('/catalog/:type/:id.json',{type:'series',id:'top10_trending_shows'})
  ]);
  assert.equal(movies.statusCode,200);
  assert.equal(shows.statusCode,200);
  assert.equal(movies.body.metas.length,10);
  assert.equal(shows.body.metas.length,10);
  assert.equal(movies.body.metas[0].id,'tt200001');
  assert.equal(shows.body.metas[0].id,'tt100001');
  assert.match(shows.body.metas[0].poster,/rank=1/);
  assert.match(movies.body.metas[9].poster,/rank=10/);
  assert.ok(calls.every(url=>!url.includes('postersplus')),'catalog must not wait for poster service');
});

test('repeated concurrent calls share the same catalog build',async()=>{
  const {request,calls}=boot();
  const options={type:'series',id:'top10_trending_shows'};
  const many=await Promise.all(Array.from({length:5},()=>request('/catalog/:type/:id.json',options)));
  assert.ok(many.every(r=>r.statusCode===200 && r.body.metas.length===10));
  const count=calls.filter(u=>u.includes('/discover/tv')).length;
  assert.equal(count,18,'only one 9-market x 2-page TMDB fetch for concurrent requests');
});

test('uncached upstream failure is 503 and never caches an empty catalog as success',async()=>{
  const {request,state}=boot();
  state.fail=true;
  const fail=await request('/catalog/:type/:id.json',{type:'movie',id:'top10_trending_movies'});
  assert.equal(fail.statusCode,503);
  assert.equal(fail.headers['Cache-Control'],'no-store');
  assert.equal(fail.body.error,'Catalog temporarily unavailable. Retry soon.');
  state.fail=false;
  const success=await request('/catalog/:type/:id.json',{type:'movie',id:'top10_trending_movies'});
  assert.equal(success.statusCode,200);
  assert.equal(success.body.metas.length,10);
});

test('Posters+ failure still creates ranked JPEG with TMDB fallback',async()=>{
  const {request,calls}=boot();
  const res=await request('/api/poster',{}, {id:'tt200001',rank:'1',type:'movie',tmdb:'20001',g:'DRAMA',r:'8.1',n:'Film 1',p:'https://image.tmdb.org/t/p/w1280/movie_1.jpg'});
  assert.equal(res.statusCode,200);
  assert.equal(res.headers['Content-Type'],'image/jpeg');
  assert.ok(calls.some(url=>url.includes('postersplus.slokker.cc')));
  assert.ok(calls.some(url=>url.includes('image.tmdb.org')));
  assert.match(res.headers['Cache-Control'],/s-maxage=900/);
});


test('strict digital gate excludes theatrical-only, future digital, and unknown digital dates', async()=>{
  const {request,state}=boot();
  // 20001 theatrical-only, 20002 future digital, 20003 missing digital,
  // 20004 already digital and should be the rank #1 card.
  state.digitalReleaseForId=(id)=>{
    if(id===20001)return [{type:3,release_date:'2024-04-01T00:00:00'}];
    if(id===20002)return [{type:4,release_date:'2030-04-01T00:00:00'}];
    if(id===20003)return [];
    return undefined;
  };
  const result=await request('/catalog/:type/:id.json',{type:'movie',id:'top10_trending_movies'});
  assert.equal(result.statusCode,200);
  assert.equal(result.body.metas.length,10);
  assert.equal(result.body.metas[0].id,'tt200004');
  assert.ok(result.body.metas.every(m=>!['tt200001','tt200002','tt200003'].includes(m.id)));
  assert.match(result.body.metas[0].poster,/rank=1/);
});

test('discover digital-only backup fills missing slots without allowing theatrical titles',async()=>{
  const {request,state,calls}=boot();
  state.digitalReleaseForId=id=>id<30000 ? [{type:3,release_date:'2024-02-01'}] : [{type:4,release_date:'2024-02-01'}];
  state.useDiscover=true;
  const result=await request('/catalog/:type/:id.json',{type:'movie',id:'top10_trending_movies'});
  assert.equal(result.statusCode,200);
  assert.equal(result.body.metas.length,10);
  assert.ok(result.body.metas.every(m=>m.id.startsWith('tt430')));
  assert.ok(calls.some(u=>u.includes('/discover/movie')));
  assert.ok(!calls.some(u=>u.includes('/trending/')));
});

test('no verified digital releases returns retryable 503 rather than unreleased movies',async()=>{
  const {request,state}=boot();
  state.digitalReleaseForId=()=>[{type:3,release_date:'2024-02-01'}];
  const result=await request('/catalog/:type/:id.json',{type:'movie',id:'top10_trending_movies'});
  assert.equal(result.statusCode,503);
  assert.equal(result.headers['Cache-Control'],'no-store');
});


test('all nine US/European markets are fetched with genuinely regional TMDB filters',async()=>{
  const {request,requests}=boot();
  const movies=await request('/catalog/:type/:id.json',{type:'movie',id:'top10_trending_movies'});
  const shows=await request('/catalog/:type/:id.json',{type:'series',id:'top10_trending_shows'});
  assert.equal(movies.statusCode,200);
  assert.equal(shows.statusCode,200);
  assert.ok(!requests.some(r=>r.url.includes('/trending/')));
  const movieCalls=requests.filter(r=>r.url.includes('/discover/movie'));
  const tvCalls=requests.filter(r=>r.url.includes('/discover/tv'));
  assert.deepEqual([...new Set(movieCalls.map(r=>r.params.region))].sort(),['DE','ES','FI','FR','GB','IT','NL','SE','US']);
  assert.deepEqual([...new Set(tvCalls.map(r=>r.params.watch_region))].sort(),['DE','ES','FI','FR','GB','IT','NL','SE','US']);
  assert.ok(movieCalls.every(r=>r.params.with_release_type===4 && !!r.params['release_date.lte']));
  assert.ok(tvCalls.every(r=>r.params.with_watch_monetization_types==='flatrate|free|ads'));
});

test('a US-only popular hit ranks behind a title found across US and Europe',async()=>{
  const {request,state}=boot();
  state.showSingleMarketHit=true;
  const result=await request('/catalog/:type/:id.json',{type:'series',id:'top10_trending_shows'});
  assert.equal(result.statusCode,200);
  assert.equal(result.body.metas.length,10);
  assert.equal(result.body.metas[0].id,'tt100001');
  assert.ok(result.body.metas.every(it=>it.id!=='tt990000'));
});


test('TMDB detail enrichment attaches English clearlogos, original backdrops and rich movie metadata',async()=>{
  const {request,requests}=boot();
  const result=await request('/catalog/:type/:id.json',{type:'movie',id:'top10_trending_movies'});
  assert.equal(result.statusCode,200);
  const meta=result.body.metas[0];
  assert.equal(meta.name,'Film 1','catalog title remains from regional chart');
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
  assert.match(meta.poster,/v=v560-us-europe-markets/,'poster artwork is preserved');
  const detailCalls=requests.filter(r=>/^https:\/\/api\.themoviedb\.org\/3\/movie\/\d+$/.test(r.url));
  assert.equal(detailCalls.length,10,'one detail call per selected movie');
  assert.ok(detailCalls.every(r=>r.params.append_to_response==='images,credits,videos'));
  assert.ok(detailCalls.every(r=>r.params.include_image_language.includes('en,null')));
});

test('TMDB series detail metadata uses proper TV year range, creators and episode runtime',async()=>{
  const {request}=boot();
  const result=await request('/catalog/:type/:id.json',{type:'series',id:'top10_trending_shows'});
  assert.equal(result.statusCode,200);
  const meta=result.body.metas[0];
  assert.equal(meta.logo,'https://image.tmdb.org/t/p/original/english-logo.png');
  assert.equal(meta.runtime,'46 min');
  assert.equal(meta.releaseInfo,'2023-2025');
  assert.deepEqual(meta.director,['Creator A']);
  assert.equal(meta.type,'series');
  assert.match(meta.poster,/rank=1/);
});

test('TMDB metadata failures keep a complete Top 10 and original Discover backdrop',async()=>{
  const {request,state}=boot();
  state.detailsFail=true;
  const result=await request('/catalog/:type/:id.json',{type:'movie',id:'top10_trending_movies'});
  assert.equal(result.statusCode,200);
  assert.equal(result.body.metas.length,10);
  assert.equal(result.body.metas[0].background,'https://image.tmdb.org/t/p/original/wide_1.jpg');
  assert.equal(result.body.metas[0].releaseInfo,'2024');
  assert.deepEqual(result.body.metas[0].genres,['Drama']);
  assert.ok(result.body.metas.every(m=>typeof m.poster==='string' && m.id.startsWith('tt')));
});
