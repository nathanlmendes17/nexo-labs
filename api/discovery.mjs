const SUPABASE_URL='https://csfejvcyrjuikeqzyail.supabase.co';
const PUBLIC_KEY='sb_publishable_jmdXmgA6ahnrsdAQqezt7g_CmQmKtUg';
const categories={barber:['shop','barber',['["shop"="barber"]','["shop"="hairdresser"]["hairdresser"="barber"]','["shop"="hairdresser"]["name"~"barb",i]']],fast_food:['amenity','fast_food'],ice_cream:['amenity','ice_cream',['["amenity"="ice_cream"]','["shop"="ice_cream"]']],veterinary:['amenity','veterinary'],optician:['shop','optician'],florist:['shop','florist'],car_wash:['amenity','car_wash'],butcher:['shop','butcher'],restaurant:['amenity','restaurant'],cafe:['amenity','cafe'],bar:['amenity','bar'],bakery:['shop','bakery'],hairdresser:['shop','hairdresser'],beauty:['shop','beauty'],car_repair:['shop','car_repair'],dentist:['amenity','dentist'],pharmacy:['amenity','pharmacy'],supermarket:['shop','supermarket'],clothes:['shop','clothes'],pet:['shop','pet'],hotel:['tourism','hotel'],fitness_centre:['leisure','fitness_centre']};
// Cache e intervalo são por instância; não substituem quotas globais de um produto comercial.
const cache=new Map(),requests=new Map();
export function buildQuery(city,category,contactMode='phone'){if(!/^\d{7}$/.test(String(city))||!Object.hasOwn(categories,category))throw Error('Selecione uma cidade e um ramo válidos.');if(!['phone','whatsapp','all'].includes(contactMode))throw Error('Filtro de contato inválido.');const filter=contactMode==='all'?'':contactMode==='whatsapp'?'[~"^(contact:whatsapp|whatsapp)$"~"[0-9]"]':'[~"^(contact:phone|phone|contact:mobile|mobile|contact:whatsapp|whatsapp)$"~"[0-9]"]';const [key,value,custom]=categories[category],sel=custom||[`["${key}"="${value}"]`];return `[out:json][timeout:20][maxsize:33554432];(rel["boundary"="administrative"]["IBGE:GEOCODIGO"="${city}"];rel["boundary"="administrative"]["ref:IBGE"="${city}"];)->.municipality;.municipality out ids;.municipality map_to_area->.city;(${sel.map(x=>`nwr(area.city)${x}["name"]${filter};`).join('')});out tags center 100;`;}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const send=(status,error)=>res.status(status).json({error});
  if(req.method!=='POST'){res.setHeader('Allow','POST');return send(405,'Use uma consulta pelo painel de busca.');}
  let body=req.body;try{if(typeof body==='string')body=JSON.parse(body);}catch{return send(400,'Dados da consulta inválidos.');}
  let query;try{query=buildQuery(body?.city,body?.category,body?.contactMode);}catch(error){return send(400,error.message);}
  const authorization=req.headers.authorization;
  if(typeof authorization!=='string'||!/^Bearer [\w.-]{20,8192}$/.test(authorization))return send(401,'Entre na sua conta novamente para pesquisar.');
  try{
    const auth=await fetch(SUPABASE_URL+'/auth/v1/user',{headers:{apikey:PUBLIC_KEY,Authorization:authorization},signal:AbortSignal.timeout(8000)});
    if(auth.status===401||auth.status===403)return send(401,'Sua sessão expirou. Entre novamente.');
    if(!auth.ok)return send(503,'Não foi possível confirmar sua sessão. Tente novamente em instantes.');
    const user=await auth.json();if(!user.id)return send(401,'Entre novamente na sua conta.');
    const key=body.city+':'+body.category+':'+(body.contactMode||'phone'),now=Date.now(),cached=cache.get(key);
    if(cached&&cached.expires>now)return res.status(200).json(cached.data);
    if(now-(requests.get(user.id)||0)<15000){res.setHeader('Retry-After','15');return send(429,'Aguarde 15 segundos antes de fazer outra consulta.');}
    requests.set(user.id,now);if(requests.size>500)for(const [id,time]of requests)if(now-time>60000)requests.delete(id);
    // Servidores públicos do Overpass, em ordem; se um recusar ou cair, tenta o próximo.
    const deadline=Date.now()+48000;let upstream;for(const url of ['https://overpass-api.de/api/interpreter','https://overpass.private.coffee/api/interpreter']){const left=deadline-Date.now();if(left<5000)break;try{upstream=await fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'NM-Leads/1.0 (+https://nexo-labs.vercel.app)'},body:new URLSearchParams({data:query}).toString(),signal:AbortSignal.timeout(url.includes('overpass-api.de')?Math.min(left,20000):left)});if(upstream.ok)break;}catch(error){upstream=null;}}
    if(!upstream)return send(503,'Não foi possível conectar à fonte de empresas. Tente novamente mais tarde.');
    if(upstream.status===429)return send(429,'A fonte gratuita está ocupada. Aguarde um minuto e tente novamente.');
    if(!upstream.ok)return send(503,'A fonte gratuita está indisponível no momento. Tente novamente mais tarde.');
    const data=await upstream.json();if(data.remark)return send(503,'A fonte gratuita não concluiu a consulta. Tente novamente mais tarde.');
    if(!Array.isArray(data.elements))return send(502,'A fonte enviou uma resposta inválida. Tente mais tarde.');
    const result={elements:data.elements.filter(e=>['node','way','relation'].includes(e.type)).slice(0,110)};
    if(cache.size>=100)cache.delete(cache.keys().next().value);cache.set(key,{expires:now+300000,data:result});
    return res.status(200).json(result);
  }catch(error){return send(503,error.name==='TimeoutError'||error.name==='AbortError'?'A consulta demorou demais. Tente novamente em instantes.':'Não foi possível conectar à fonte de empresas. Tente novamente mais tarde.');}
}
