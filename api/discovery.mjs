const SUPABASE_URL='https://csfejvcyrjuikeqzyail.supabase.co';
const PUBLIC_KEY='sb_publishable_jmdXmgA6ahnrsdAQqezt7g_CmQmKtUg';
const categories={restaurant:['amenity','restaurant'],cafe:['amenity','cafe'],bar:['amenity','bar'],bakery:['shop','bakery'],hairdresser:['shop','hairdresser'],beauty:['shop','beauty'],car_repair:['shop','car_repair'],dentist:['amenity','dentist'],pharmacy:['amenity','pharmacy'],supermarket:['shop','supermarket'],clothes:['shop','clothes'],pet:['shop','pet'],hotel:['tourism','hotel'],fitness_centre:['leisure','fitness_centre']};
// Cache e intervalo são por instância; não substituem quotas globais de um produto comercial.
const cache=new Map(),requests=new Map();
export function buildQuery(city,category){if(!/^\d{7}$/.test(String(city))||!Object.hasOwn(categories,category))throw Error('Selecione uma cidade e um ramo válidos.');const [key,value]=categories[category];return `[out:json][timeout:20][maxsize:33554432];(rel["boundary"="administrative"]["IBGE:GEOCODIGO"="${city}"];rel["boundary"="administrative"]["ref:IBGE"="${city}"];)->.municipality;.municipality out ids;.municipality map_to_area->.city;nwr(area.city)["${key}"="${value}"]["name"];out tags center 100;`;}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const send=(status,error)=>res.status(status).json({error});
  if(req.method!=='POST'){res.setHeader('Allow','POST');return send(405,'Use uma consulta pelo painel de busca.');}
  let body=req.body;try{if(typeof body==='string')body=JSON.parse(body);}catch{return send(400,'Dados da consulta inválidos.');}
  let query;try{query=buildQuery(body?.city,body?.category);}catch(error){return send(400,error.message);}
  const authorization=req.headers.authorization;
  if(typeof authorization!=='string'||!/^Bearer [\w.-]{20,8192}$/.test(authorization))return send(401,'Entre na sua conta novamente para pesquisar.');
  try{
    const auth=await fetch(SUPABASE_URL+'/auth/v1/user',{headers:{apikey:PUBLIC_KEY,Authorization:authorization},signal:AbortSignal.timeout(8000)});
    if(auth.status===401||auth.status===403)return send(401,'Sua sessão expirou. Entre novamente.');
    if(!auth.ok)return send(503,'Não foi possível confirmar sua sessão. Tente novamente em instantes.');
    const user=await auth.json();if(!user.id)return send(401,'Entre novamente na sua conta.');
    const key=body.city+':'+body.category,now=Date.now(),cached=cache.get(key);
    if(cached&&cached.expires>now)return res.status(200).json(cached.data);
    if(now-(requests.get(user.id)||0)<15000){res.setHeader('Retry-After','15');return send(429,'Aguarde 15 segundos antes de fazer outra consulta.');}
    requests.set(user.id,now);if(requests.size>500)for(const [id,time]of requests)if(now-time>60000)requests.delete(id);
    const upstream=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'NM-Leads/1.0 (+https://nexo-labs.vercel.app)'},body:new URLSearchParams({data:query}).toString(),signal:AbortSignal.timeout(28000)});
    if(upstream.status===429)return send(429,'A fonte gratuita está ocupada. Aguarde um minuto e tente novamente.');
    if(!upstream.ok)return send(503,'A fonte gratuita está indisponível no momento. Tente novamente mais tarde.');
    const data=await upstream.json();if(data.remark)return send(503,'A fonte gratuita não concluiu a consulta. Tente novamente mais tarde.');
    if(!Array.isArray(data.elements))return send(502,'A fonte enviou uma resposta inválida. Tente mais tarde.');
    const result={elements:data.elements.filter(e=>['node','way','relation'].includes(e.type)).slice(0,110)};
    if(cache.size>=100)cache.delete(cache.keys().next().value);cache.set(key,{expires:now+300000,data:result});
    return res.status(200).json(result);
  }catch(error){return send(503,error.name==='TimeoutError'||error.name==='AbortError'?'A consulta demorou demais. Tente novamente em instantes.':'Não foi possível conectar à fonte de empresas. Tente novamente mais tarde.');}
}
