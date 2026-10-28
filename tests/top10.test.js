'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

function boot() {
  const originalLoad = Module._load;
  const routes = new Map();
  const calls = [];
  const state = {fail:false, posterFails:true, digitalReleaseForId:null, useDiscover:false};
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
    calls.push(url);
    if(state.fail)throw new Error('mock upstream unavailable');
    if(url.includes('postersplus.slokker.cc') && state.posterFails)throw new Error('mock poster timeout');
    if(url.includes('image.tmdb.org'))return {data:Buffer.from('FAKEIMAGE'+'z'.repeat(4000)),headers:{'content-type':'image/jpeg'}};
    if(url.includes('/trending/')){
      const m=url.match(/\/trending\/(tv|movie)\//);
      return {data:{results:makeItems(m[1],opt.params?.page||1)}};
    }
    if(url.includes('/release_dates')) {
      const id=Number(url.match(/\/movie\/(\d+)\/release_dates/)?.[1]||0);
      const info=state.digitalReleaseForId?.(id);
      return {data:{results:[{release_dates:info === undefined ? [{type:4,release_date:'2024-04-01T00:00:00'}] : info}]}};
    }
    if(url.includes('/discover/movie')) {
      if(!state.useDiscover) return {data:{results:[]}};
      const page=Number(opt.params?.page||1);
      return {data:{results:Array.from({length:16},(_,i)=>{
        const n=page*100+i;
        return {id:30000+n,tmdb_id:30000+n,imdb_id:`tt${400000+n}`,title:`Digital film ${n}`,poster_path:'/img.jpg',release_date:'2024-01-01',original_language:'en',genre_ids:[18]};
      })}};
    }
    if(url.includes('/external_ids'))return {data:{imdb_id:'tt11111111'}};
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
  return {request,state,calls};
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
  const count=calls.filter(u=>u.includes('/trending/tv/day')).length;
  assert.equal(count,2,'only one 2-page TMDB fetch for concurrent requests');
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
  assert.ok(result.body.metas.every(m=>m.id.startsWith('tt400')));
  assert.ok(calls.some(u=>u.includes('/discover/movie')));
});

test('no verified digital releases returns retryable 503 rather than unreleased movies',async()=>{
  const {request,state}=boot();
  state.digitalReleaseForId=()=>[{type:3,release_date:'2024-02-01'}];
  const result=await request('/catalog/:type/:id.json',{type:'movie',id:'top10_trending_movies'});
  assert.equal(result.statusCode,503);
  assert.equal(result.headers['Cache-Control'],'no-store');
});
