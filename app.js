/* Lot Locator — standalone version (GitHub Pages + Supabase) */
const AREAS = [
  {code:"LOT", name:"Main Lot"}, {code:"UL", name:"Used Lot"}, {code:"SD", name:"Service Drive"}, {code:"B1", name:"Service Basement"},
  {code:"R1", name:"Roof Level 1"}, {code:"R2", name:"Roof Level 2"}, {code:"SHW", name:"Showroom"},
  {code:"DET", name:"Detail / Wash"}, {code:"OUT", name:"Off-site / Out"}
];
const AREA = Object.fromEntries(AREAS.map(a=>[a.code,a]));
const TYPES = ["New","Used","Service","Loaner"];
const MODELS = ["Accord","Accord Hybrid","Civic","Civic Hatchback","Civic Si","Civic Type R","CR-V","CR-V Hybrid","HR-V","Passport","Pilot","Odyssey","Ridgeline","Prologue"];
const MAKES = ["Honda","Acura","Toyota","Lexus","Nissan","Infiniti","Mazda","Subaru","Hyundai","Kia","Ford","Chevrolet","GMC","Jeep","Ram","Dodge","Tesla","BMW","Mercedes-Benz","Audi","Volkswagen","Volvo","Mitsubishi"];
const KEY_SPOTS = ["Key machine","Key board","In the car","Sales desk","Service desk","With me"];
const STALE_MS = 3*24*3600e3;

const cfg = window.LOT_CONFIG || {};
const configured = cfg.SUPABASE_URL && !/YOUR-/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY);
const sb = configured && window.supabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

const S = {me:null, people:{}, cars:[], loaded:false, q:"", area:"", type:"", brand:"", sort:"recent", open:null, canEdit:false, readOnly:false};
const $ = id => document.getElementById(id);
const el = (tag, attrs={}, ...kids) => { const n=document.createElement(tag); for (const [k,v] of Object.entries(attrs)) { if (v==null||v===false) continue; if (k==="class") n.className=v; else if (k==="text") n.textContent=v; else if (k.startsWith("on")) n.addEventListener(k.slice(2),v); else n.setAttribute(k, v===true?"":v); } for (const c of kids.flat()) if (c!=null) n.append(c.nodeType?c:document.createTextNode(c)); return n; };
const sign = code => { const a=AREA[code]; const s=el("span",{class:"sign",text:a?code:"?"}); s.style.background = a?`var(--lv-${code})`:"var(--lv-OUT)"; return s; };
const ago = t => { if(!t) return "never"; const s=(Date.now()-t)/1000; if(s<60) return "just now"; if(s<3600) return Math.floor(s/60)+"m ago"; if(s<86400) return Math.floor(s/3600)+"h ago"; return Math.floor(s/86400)+"d ago"; };
const when = t => new Date(t).toLocaleString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
const carName = c => [c.year, c.make, c.model, c.trim].filter(Boolean).join(" ") || "Vehicle";
let toastT; const toast = m => { const t=$("toast"); t.textContent=m; t.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>t.hidden=true,2600); };
function busy(m){ const t=$("toast"); clearTimeout(toastT); if(m){ t.textContent=m; t.hidden=false; } else t.hidden=true; }
const who = id => !id ? "Someone" : (id===S.me?.id ? "You" : (S.people[id]?.name || S.people[id]?.email || "A teammate"));
const must = async q => { const {data, error} = await q; if (error) throw error; return data; };

const fromRow = r => ({id:r.id, stock:r.stock, vin:r.vin||"", year:r.year, make:r.make||"", model:r.model||"", trim:r.trim_level||"", color:r.color||"", type:r.type||"",
  area:r.area||"", spot:r.spot||"", keys:r.keys||"", note:r.note||"", updatedAt:r.updated_at?Date.parse(r.updated_at):null, updatedBy:r.updated_by, photo:r.photo_path||""});

/* ---------- photos ---------- */
const photoUrls = {}, photoTried = new Set(); let photoBusy = false;
async function ensurePhotoUrls(paths){
  const need = [...new Set(paths.filter(p=>p && !photoUrls[p] && !photoTried.has(p)))];
  need.forEach(p=>photoTried.add(p));
  if (!need.length || photoBusy) return;
  photoBusy = true;
  try{ for (let i=0;i<need.length;i+=100){ const d = await must(sb.storage.from("car-photos").createSignedUrls(need.slice(i,i+100), 60*60*12)); d.forEach(x=>{ if(x.signedUrl) photoUrls[x.path]=x.signedUrl; }); } }catch{}
  photoBusy = false; queueRender();
}
function thumb(c){
  const box = el("span",{class:"thumb","aria-hidden":"true"});
  const u = c.photo && photoUrls[c.photo];
  if (u) box.append(el("img",{src:u,alt:"",loading:"lazy"}));
  else box.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
  return box;
}
async function shrinkPhoto(file){
  const bmp = await createImageBitmap(file);
  const sc = Math.min(1, 1280/Math.max(bmp.width,bmp.height));
  const cv = document.createElement("canvas"); cv.width=Math.round(bmp.width*sc); cv.height=Math.round(bmp.height*sc);
  cv.getContext("2d").drawImage(bmp,0,0,cv.width,cv.height);
  return await new Promise(r=>cv.toBlob(r,"image/jpeg",0.8));
}
let photoCb = null;
function pickPhoto(cb){ photoCb=cb; const i=$("photoFile"); i.value=""; i.click(); }
$("photoFile").addEventListener("change", e=>{ const f=e.target.files&&e.target.files[0]; const cb=photoCb; photoCb=null; if(f&&cb) cb(f); });
async function savePhoto(c, file){
  busy("Uploading photo…");
  try{
    const blob = await shrinkPhoto(file);
    if (!blob) throw new Error("shrink");
    const path = `${c.id}/${Date.now()}.jpg`;
    const {error:upErr} = await sb.storage.from("car-photos").upload(path, blob, {contentType:"image/jpeg"});
    if (upErr) throw upErr;
    const d = await must(sb.from("cars").update({photo_path:path}).eq("id",c.id).select());
    if (!d.length) throw "denied";
    if (c.photo) sb.storage.from("car-photos").remove([c.photo]).catch(()=>{});
    upsertLocal(d[0]); busy(null); toast("Photo saved");
    if (S.open?.kind==="car" && S.open.id===c.id){ await ensurePhotoUrls([path]); openCar(c.id); }
  }catch(e){ busy(null); toast(e==="denied"||/security|permission/i.test(String(e&&e.message))?"You don't have permission to add photos. Ask a manager.":"Couldn't upload the photo. Check your connection and try again."); }
}
const detailsRow = d => ({stock:d.stock, vin:d.vin, year:d.year, make:d.make||null, model:d.model, trim_level:d.trim, color:d.color, type:d.type});

/* ---------- main list ---------- */
function matches(c){
  if (S.area==="NONE" ? !!c.area : (S.area && c.area!==S.area)) return false;
  if (S.type && c.type!==S.type) return false;
  if (S.brand && (c.make||"Unknown")!==S.brand) return false;
  if (!S.q) return true;
  const hay = [c.stock,c.vin,c.year,c.make,c.model,c.trim,c.color,c.spot,c.keys,c.note,AREA[c.area]?.name].join(" ").toLowerCase();
  return S.q.toLowerCase().split(/\s+/).filter(Boolean).every(w=>hay.includes(w));
}
let rq; const queueRender = () => { clearTimeout(rq); rq=setTimeout(render,120); };
function render(){
  const counts = {}; S.cars.forEach(c=>counts[c.area]=(counts[c.area]||0)+1);
  const none = S.cars.filter(c=>!c.area).length;
  $("levels").replaceChildren(...AREAS.map(a=>el("button",{class:"lvl",type:"button","aria-pressed":String(S.area===a.code),onclick:()=>{S.area=S.area===a.code?"":a.code;render();}},
      sign(a.code), el("span",{class:"t"}, el("b",{text:a.name}), el("span",{text:(counts[a.code]||0)+" car"+((counts[a.code]||0)===1?"":"s")})))),
    ...(none||S.area==="NONE" ? [el("button",{class:"lvl",type:"button","aria-pressed":String(S.area==="NONE"),onclick:()=>{S.area=S.area==="NONE"?"":"NONE";render();}},
      sign("NONE"), el("span",{class:"t"}, el("b",{text:"Not located yet"}), el("span",{text:none+" car"+(none===1?"":"s")})))] : []));
  const brands=[...new Set(S.cars.map(c=>c.make||"Unknown"))].sort();
  const bsel=$("brand"); const cur=S.brand;
  bsel.replaceChildren(el("option",{value:""},"All brands"), ...brands.map(b=>el("option",{value:b,selected:b===cur},`${b} (${S.cars.filter(c=>(c.make||"Unknown")===b).length})`)));
  bsel.hidden = brands.length<1;
  document.querySelectorAll("#filters .chip").forEach(b=>b.setAttribute("aria-pressed", String(b.dataset.type===S.type)));
  $("tools").hidden = !S.canEdit;

  const list=$("list");
  if (!S.loaded){ list.replaceChildren(); return; }
  if (!S.cars.length){
    list.replaceChildren(el("li",{class:"empty"}, el("h2",{text:"No cars on the board yet"}),
      el("p",{text:"Add a car with its stock number and where it's parked. After that, anyone who moves it taps the car and saves its new spot, so the next person knows exactly where to go."}),
      el("div",{class:"actions",style:"justify-content:center"},
        S.canEdit?el("button",{class:"btn primary",type:"button",onclick:()=>pickImport()},"⇪ Import inventory file"):null,
        el("button",{class:"btn",type:"button",onclick:()=>openForm(null)},"+ Add one car"))));
    return;
  }
  const rows = S.cars.filter(matches);
  const by = {recent:(a,b)=>(b.updatedAt||0)-(a.updatedAt||0), stale:(a,b)=>(a.updatedAt||0)-(b.updatedAt||0), stock:(a,b)=>String(a.stock).localeCompare(String(b.stock),undefined,{numeric:true})}[S.sort];
  rows.sort(by);
  if (!rows.length){
    const single = /^[A-Za-z0-9-]{3,20}$/.test(S.q) && !S.area && !S.type;
    list.replaceChildren(el("li",{class:"empty"}, el("p",{text:"No car matches that search. Check the stock number, or clear the level filter."}),
      single ? el("button",{class:"btn primary",type:"button",onclick:()=>openForm(null, preFrom(classify(S.q)))}, `+ Add ${S.q.toUpperCase()} as a new car`) : null));
    return;
  }
  ensurePhotoUrls(rows.slice(0,300).map(c=>c.photo));
  list.replaceChildren(...rows.map(c=>{
    const stale = c.updatedAt && Date.now()-c.updatedAt>STALE_MS && c.area!=="SHW";
    return el("li",{}, el("button",{class:"car withthumb",type:"button",onclick:()=>openCar(c.id)},
      thumb(c),
      el("div",{class:"id"}, el("span",{class:"stock",text:"#"+c.stock}), el("span",{class:"name",text:carName(c)}), c.type?el("span",{class:"tag",text:c.type}):null),
      el("div",{class:"loc"}, el("span",{class:"spot",text:c.spot||AREA[c.area]?.name||"Not located yet"}), sign(c.area)),
      el("div",{class:"meta"},
        c.color?el("span",{text:c.color}):null,
        c.vin?el("span",{class:"mono",text:"VIN …"+String(c.vin).slice(-6)}):null,
        c.keys?el("span",{text:"Keys: "+c.keys}):null,
        c.updatedAt ? el("span",{class:stale?"stale":null,text:(stale?"Not moved in "+ago(c.updatedAt).replace(" ago",""):"Moved "+ago(c.updatedAt))+" · "+who(c.updatedBy)})
                    : el("span",{class:"stale",text:"Not located yet · tap to set its spot"}))));
  }));
}

/* ---------- sheets ---------- */
function closeSheet(){ S.open=null; $("sheetRoot").hidden=true; $("sheetRoot").replaceChildren(); }
function showSheet(...kids){
  const sheet = el("div",{class:"sheet",role:"dialog","aria-modal":"true"}, ...kids);
  const scrim = el("div",{class:"scrim",onclick:e=>{ if(e.target===scrim) closeSheet(); }}, sheet);
  $("sheetRoot").replaceChildren(scrim); $("sheetRoot").hidden=false;
  return sheet;
}
document.addEventListener("keydown",e=>{ if(e.key==="Escape" && S.open) closeSheet(); });
function areaPicker(selected, onPick){
  const wrap = el("div",{class:"picker",role:"radiogroup","aria-label":"Area"});
  const draw = () => wrap.replaceChildren(...AREAS.map(a=>el("button",{class:"pick",type:"button",role:"radio","aria-checked":String(selected===a.code),onclick:()=>{selected=a.code;onPick(a.code);draw();}}, sign(a.code), el("span",{text:a.name}))));
  draw(); return wrap;
}
const datalist = (id, opts) => el("datalist",{id}, ...opts.map(o=>el("option",{value:o})));

function writeErr(e){
  const code = e && e.code, msg = String(e && e.message || "");
  if (code==="23505") return "That stock # is already on the board. Search for it instead.";
  if (code==="42501" || /row-level security|permission/i.test(msg) || e==="denied") return "You don't have permission for that. Ask a manager.";
  return "Couldn't save. Check your connection and try again.";
}

async function openCar(id){
  const c = S.cars.find(x=>x.id===id); if(!c) return;
  S.open = {kind:"car", id};
  let hist = [];
  try { hist = await must(sb.from("moves").select("area,spot,keys,note,moved_by,moved_at").eq("car_id",id).order("moved_at",{ascending:false}).limit(20)); } catch {}
  if (c.photo && !photoUrls[c.photo]) await ensurePhotoUrls([c.photo]);
  if (S.open?.id!==id) return;
  let area = c.area;
  const spot = el("input",{id:"p-spot",type:"text",value:c.spot||"",placeholder:"e.g. Row C, space 14 · by the ramp",autocomplete:"off"});
  const keys = el("input",{id:"p-keys",type:"text",value:c.keys||"",placeholder:"Where are the keys?",list:"keyspots",autocomplete:"off"});
  const note = el("input",{id:"p-note",type:"text",value:"",placeholder:"Optional: low fuel, needs wash, blocked in…",autocomplete:"off"});
  const err = el("div",{class:"err",role:"alert"});
  const save = el("button",{class:"btn primary",type:"button"},"Save location");
  save.onclick = async () => {
    if (!area){ err.textContent="Pick the level or area first."; return; }
    save.disabled=true; err.textContent="";
    const row = {area, spot:spot.value.trim(), keys:keys.value.trim(), note:note.value.trim(), updated_at:new Date().toISOString(), updated_by:S.me.id};
    try{
      const d = await must(sb.from("cars").update(row).eq("id",c.id).select());
      if (!d.length) throw "denied";
      upsertLocal(d[0]); closeSheet(); toast(`#${c.stock} saved at ${AREA[area].name}${row.spot?" · "+row.spot:""}`);
    }catch(e){ save.disabled=false; err.textContent = writeErr(e); }
  };
  const body = [
    el("div",{class:"sheethead"}, el("div",{}, el("span",{class:"label",text:(c.type||"Vehicle")+" · Stock #"+c.stock}), el("h2",{text:carName(c)}),
        el("div",{class:"sub"}, c.color?el("span",{text:c.color}):null, c.vin?el("span",{class:"mono",text:"VIN "+c.vin}):null)),
      el("button",{class:"x",type:"button","aria-label":"Close",onclick:closeSheet},"×")),
    c.photo && photoUrls[c.photo]
      ? el("div",{class:"photo"}, el("img",{src:photoUrls[c.photo],alt:`Photo of ${carName(c)}, stock #${c.stock}`}),
          el("button",{class:"btn",type:"button",onclick:()=>pickPhoto(f=>savePhoto(c,f))}, "Replace photo"))
      : el("button",{class:"btn addphoto",type:"button",onclick:()=>pickPhoto(f=>savePhoto(c,f))}, scanIcon2(), "Add a photo of this car"),
    el("div",{class:"now"}, sign(c.area), el("div",{}, el("b",{text:(AREA[c.area]?.name||"Not located yet")+(c.spot?" · "+c.spot:"")}),
      el("span",{text: c.updatedAt ? `Last parked ${ago(c.updatedAt)} by ${who(c.updatedBy)}${c.keys?" · Keys: "+c.keys:""}${c.note?" · "+c.note:""}` : "Not located yet. Set its spot the first time you see it."}))),
    el("div",{class:"field"}, el("span",{class:"label",text:"Where did you leave it?"}), areaPicker(area, v=>area=v)),
    el("div",{class:"field"}, el("label",{class:"label",for:"p-spot",text:"Row / space / landmark"}), spot),
    el("div",{class:"grid2"}, el("div",{class:"field"}, el("label",{class:"label",for:"p-keys",text:"Keys"}), keys, datalist("keyspots",KEY_SPOTS)),
      el("div",{class:"field"}, el("label",{class:"label",for:"p-note",text:"Note"}), note)),
    err,
    el("div",{class:"actions"}, save, el("button",{class:"btn",type:"button",onclick:()=>openForm(c)},"Edit details")),
  ];
  if (hist.length) body.push(el("div",{class:"field"}, el("span",{class:"label",text:"Recent moves"}),
    el("ul",{class:"hist"}, ...hist.map(h=>el("li",{}, sign(h.area), el("b",{text:(AREA[h.area]?.name||"?")+(h.spot?" · "+h.spot:"")}),
      el("span",{text:`${when(h.moved_at)} · ${who(h.moved_by)}${h.keys?" · Keys: "+h.keys:""}${h.note?" · "+h.note:""}`}))))));
  showSheet(...body);
}

function openForm(c, pre={}){
  const isNew = !c; c = c || {...pre};
  S.open = {kind:"form", id:c.id||null};
  let area = c.area || "";
  const f = (id,label,input)=>el("div",{class:"field"}, el("label",{class:"label",for:id,text:label}), input);
  const stock = el("input",{id:"f-stock",type:"text",value:c.stock||"",autocomplete:"off",placeholder:"e.g. H24581",class:"mono"});
  const vin = el("input",{id:"f-vin",type:"text",value:c.vin||"",autocomplete:"off",placeholder:"17 characters (optional)",maxlength:"17",class:"mono"});
  const year = el("input",{id:"f-year",type:"number",inputmode:"numeric",value:c.year||"",placeholder:String(new Date().getFullYear()+1)});
  const make = el("input",{id:"f-make",type:"text",value:c.make||(isNew?"Honda":""),list:"makes",autocomplete:"off",placeholder:"Honda"});
  const model = el("input",{id:"f-model",type:"text",value:c.model||"",list:"models",autocomplete:"off",placeholder:"CR-V"});
  const trim = el("input",{id:"f-trim",type:"text",value:c.trim||"",autocomplete:"off",placeholder:"EX-L"});
  const color = el("input",{id:"f-color",type:"text",value:c.color||"",autocomplete:"off",placeholder:"Platinum White Pearl"});
  const type = el("select",{id:"f-type"}, ...TYPES.map(t=>el("option",{value:t,selected:(c.type||"New")===t},t)));
  const spot = el("input",{id:"f-spot",type:"text",value:c.spot||"",autocomplete:"off",placeholder:"Row C, space 14"});
  const err = el("div",{class:"err",role:"alert"});
  const vinNote = el("span",{class:"hint"});
  const checkVin = () => { const v=vin.value.trim().toUpperCase();
    vinNote.textContent = !v ? "" : v.length!==17 ? `${v.length} of 17 characters` : vinCheck(v) ? "VIN looks valid" : "This VIN's check digit doesn't match. Double-check it.";
    if (v.length===17 && !year.value){ const y=vinYear(v); if(y) year.value=y; } };
  vin.addEventListener("input", checkVin); checkVin();
  const onScan = r => {
    if (!r){ toast("Couldn't read that. Get closer, avoid glare, or type it."); return; }
    if (r.vin){ vin.value=r.vin; checkVin(); }
    if (r.stock) stock.value=r.stock;
    toast(r.vin?"VIN filled in":"Stock # filled in");
  };
  const withScan = input => el("div",{class:"inrow"}, input, el("button",{class:"btn scan",type:"button","aria-label":"Scan barcode",onclick:()=>startScan(onScan)}, scanIcon()));
  const save = el("button",{class:"btn primary",type:"button"}, isNew?"Add car":"Save changes");
  save.onclick = async () => {
    const s = stock.value.trim().toUpperCase();
    if (!s){ err.textContent="Stock number is required."; stock.focus(); return; }
    if (S.cars.some(x=>String(x.stock).toUpperCase()===s && x.id!==c.id)){ err.textContent=`Stock #${s} is already on the board. Search for it instead.`; return; }
    if (isNew && !area){ err.textContent="Pick where the car is parked."; return; }
    save.disabled=true; err.textContent="";
    const details = detailsRow({stock:s, vin:vin.value.trim().toUpperCase(), year:year.value?Number(year.value):null, make:make.value.trim(), model:model.value.trim(), trim:trim.value.trim(), color:color.value.trim(), type:type.value});
    try{
      if (isNew){
        const d = await must(sb.from("cars").insert({...details, area, spot:spot.value.trim(), updated_at:new Date().toISOString(), updated_by:S.me.id}).select());
        upsertLocal(d[0]); closeSheet(); toast(`#${s} added`);
      } else {
        const d = await must(sb.from("cars").update(details).eq("id",c.id).select());
        if (!d.length) throw "denied";
        upsertLocal(d[0]); toast("Details saved"); openCar(c.id);
      }
    }catch(e){ save.disabled=false; err.textContent=writeErr(e); }
  };
  const confirmBox = el("div",{class:"confirm",hidden:true},
    el("b",{text:`Remove #${c.stock||""} from the board?`}),
    el("span",{style:"font-size:13px;color:var(--muted)",text:"Use this when the car is sold, delivered or returned. Its move history is deleted too."}),
    el("div",{class:"actions"},
      el("button",{class:"btn danger",type:"button",onclick:async()=>{ try{ const d=await must(sb.from("cars").delete().eq("id",c.id).select("id")); if(!d.length) throw "denied"; removeLocal(c.id); closeSheet(); toast(`#${c.stock} removed`);}catch(e){ err.textContent=writeErr(e);} }},"Yes, remove it"),
      el("button",{class:"btn",type:"button",onclick:()=>confirmBox.hidden=true},"Keep it")));
  showSheet(
    el("div",{class:"sheethead"}, el("div",{}, el("span",{class:"label",text:isNew?"New car on the board":"Edit details"}), el("h2",{text:isNew?"Add a car":"#"+c.stock})),
      el("button",{class:"x",type:"button","aria-label":"Close",onclick:()=>isNew?closeSheet():openCar(c.id)},"×")),
    el("div",{class:"grid2"}, f("f-stock","Stock #",withScan(stock)), f("f-type","Type",type)),
    el("div",{class:"field"}, el("label",{class:"label",for:"f-vin",text:"VIN"}), withScan(vin), vinNote),
    el("div",{class:"grid2"}, f("f-year","Year",year), f("f-make","Brand",make)),
    f("f-model","Model",model),
    datalist("makes",MAKES),
    el("div",{class:"grid2"}, f("f-trim","Trim",trim), f("f-color","Color",color)),
    datalist("models",MODELS),
    isNew ? el("div",{class:"field"}, el("span",{class:"label",text:"Where is it parked?"}), areaPicker(area,v=>area=v)) : null,
    isNew ? f("f-spot","Row / space / landmark",spot) : null,
    err,
    el("div",{class:"actions"}, save, !isNew && S.canEdit ? el("button",{class:"btn danger",type:"button",onclick:()=>confirmBox.hidden=false},"Remove…") : null),
    isNew?null:confirmBox);
}

/* ---------- scanning ---------- */
const VIN_RE=/^[A-HJ-NPR-Z0-9]{17}$/;
function vinCheck(v){
  const tr={A:1,B:2,C:3,D:4,E:5,F:6,G:7,H:8,J:1,K:2,L:3,M:4,N:5,P:7,R:9,S:2,T:3,U:4,V:5,W:6,X:7,Y:8,Z:9};
  const w=[8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2]; let s=0;
  for (let i=0;i<17;i++){ const ch=v[i]; const n=/\d/.test(ch)?+ch:tr[ch]; if(n==null) return false; s+=n*w[i]; }
  const c=s%11; return v[8]===(c===10?"X":String(c));
}
function vinYear(v){
  if (!VIN_RE.test(v||"")) return null;
  const i="ABCDEFGHJKLMNPRSTVWXY".indexOf(v[9]);
  if (i>=0){ let y=2010+i; if (y>new Date().getFullYear()+1) y-=30; return y; }
  return /[1-9]/.test(v[9]) ? 2000+Number(v[9]) : null;
}
function classify(raw){
  const up=String(raw||"").toUpperCase().trim();
  let t=up.replace(/[^A-Z0-9]/g,"");
  if (t.length===18 && t[0]==="I") t=t.slice(1);
  if (VIN_RE.test(t)) return {vin:t};
  const m=t.match(/[A-HJ-NPR-Z0-9]{17}/); if (m && vinCheck(m[0])) return {vin:m[0]};
  const s=up.replace(/[^A-Z0-9-]/g,"");
  return s ? {stock:s.slice(0,20)} : null;
}
const preFrom = r => !r ? {} : r.vin ? {vin:r.vin, year:vinYear(r.vin)} : {stock:r.stock};
function scanIcon(){ const s=el("span",{style:"display:grid"}); s.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 7V4h3M18 4h3v3M21 17v3h-3M6 20H3v-3M7 8v8M10 8v8M13 8v8M17 8v8"/></svg>'; return s; }
function scanIcon2(){ const s=el("span",{style:"display:grid"}); s.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>'; return s; }
let zx=null, zxHints=null;
async function decodeBarcode(bmp){
  const Z=window.ZXing; if(!Z) return null;
  if(!zx){ zxHints=new Map(); const F=Z.BarcodeFormat;
    zxHints.set(Z.DecodeHintType.POSSIBLE_FORMATS,[F.CODE_39,F.CODE_128,F.DATA_MATRIX,F.QR_CODE,F.PDF_417]);
    zxHints.set(Z.DecodeHintType.TRY_HARDER,true); zx=new Z.MultiFormatReader(); }
  for (const max of [1400,2200,900]){
    const sc=Math.min(1,max/Math.max(bmp.width,bmp.height));
    const cv=document.createElement("canvas"); cv.width=Math.round(bmp.width*sc); cv.height=Math.round(bmp.height*sc);
    cv.getContext("2d").drawImage(bmp,0,0,cv.width,cv.height);
    const t=decodeCanvas(cv); if(t) return t;
    await new Promise(r=>setTimeout(r,0));
  }
  return null;
}
function decodeCanvas(cv){
  const Z=window.ZXing; if(!Z) return null;
  if(!zx){ zxHints=new Map(); const F=Z.BarcodeFormat;
    zxHints.set(Z.DecodeHintType.POSSIBLE_FORMATS,[F.CODE_39,F.CODE_128,F.DATA_MATRIX,F.QR_CODE,F.PDF_417]);
    zxHints.set(Z.DecodeHintType.TRY_HARDER,true); zx=new Z.MultiFormatReader(); }
  try{ const res=zx.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(cv))), zxHints); return (res&&res.getText())||null; }
  catch{ return null; }
  finally{ try{ zx.reset(); }catch{} }
}
async function makeDetector(){
  try{
    if(!("BarcodeDetector" in window)) return null;
    const have=await BarcodeDetector.getSupportedFormats();
    if(!have.includes("code_39")) return null; // door-jamb VIN barcodes are Code 39
    return new BarcodeDetector({formats:["code_39","code_128","data_matrix","qr_code","pdf417"].filter(f=>have.includes(f))});
  }catch{ return null; }
}
/* ---------- printed-VIN reader (windshield plate, door-jamb text) ---------- */
// Loaded only when a scan finds no barcode. Accepts only a 17-character VIN whose check digit is valid.
let ocrWorker=null, ocrLoading=null;
function loadScript(src){ return new Promise((ok,fail)=>{ const s=document.createElement("script"); s.src=src; s.onload=ok; s.onerror=fail; document.head.append(s); }); }
async function getOcr(){
  if (ocrWorker) return ocrWorker;
  if (!ocrLoading) ocrLoading=(async()=>{
    if (!window.Tesseract) await loadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js");
    const w=await Tesseract.createWorker("eng",1);
    await w.setParameters({tessedit_char_whitelist:"ABCDEFGHJKLMNPRSTUVWXYZ0123456789", tessedit_pageseg_mode:"6", preserve_interword_spaces:"0"});
    ocrWorker=w; return w;
  })().catch(e=>{ ocrLoading=null; throw e; });
  return ocrLoading;
}
function vinFromText(raw){
  const lines=String(raw||"").toUpperCase().split(/\n+/);
  const fix=s=>s.replace(/O/g,"0").replace(/[IL|]/g,m=>m==="L"?"L":"1").replace(/Q/g,"0");
  for (const line of [...lines, lines.join("")]){
    const t=fix(line.replace(/[^A-Z0-9|]/g,""));
    for (let i=0;i+17<=t.length;i++){ const v=t.slice(i,i+17); if (VIN_RE.test(v) && vinCheck(v)) return v; }
  }
  return null;
}
// Grayscale, stretch contrast and enlarge a crop so small plate text reads better. invert=true for light text on dark.
function prepForOcr(src, invert){
  const scale=Math.max(1, Math.min(3, 1400/src.width));
  const cv=document.createElement("canvas"); cv.width=Math.round(src.width*scale); cv.height=Math.round(src.height*scale);
  const g=cv.getContext("2d",{willReadFrequently:true}); g.imageSmoothingQuality="high"; g.drawImage(src,0,0,cv.width,cv.height);
  const im=g.getImageData(0,0,cv.width,cv.height), d=im.data; let lo=255, hi=0;
  for (let i=0;i<d.length;i+=4){ const y=(d[i]*299+d[i+1]*587+d[i+2]*114)/1000; d[i]=y; if(y<lo) lo=y; if(y>hi) hi=y; }
  const span=Math.max(1,hi-lo);
  for (let i=0;i<d.length;i+=4){ let y=(d[i]-lo)*255/span; if(invert) y=255-y; d[i]=d[i+1]=d[i+2]=y; }
  g.putImageData(im,0,0); return cv;
}
async function readVinText(cropCanvas, invert){
  const w=await getOcr();
  const {data}=await w.recognize(prepForOcr(cropCanvas, invert));
  return vinFromText(data && data.text);
}

let scanCb=null;
function photoScan(cb){ scanCb=cb; const i=$("cam"); i.value=""; i.click(); }
function startScan(cb){ if(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) openScanner(cb); else photoScan(cb); }

/* Live camera scanner: reads continuously from the video, inside the on-screen box. */
async function openScanner(cb){
  const video=el("video",{playsinline:true,autoplay:true,muted:true}); video.muted=true;
  const hint=el("div",{class:"sc-hint",role:"status",text:"Starting camera…"});
  const torchBtn=el("button",{class:"btn",type:"button",hidden:true},"Flashlight");
  let stream=null, running=true, timer=null, last=null, lastCount=0;
  const close=(result)=>{ running=false; clearTimeout(timer); if(stream) stream.getTracks().forEach(t=>t.stop()); root.remove(); document.removeEventListener("keydown",onKey); if(result) cb(result); };
  const onKey=e=>{ if(e.key==="Escape") close(null); };
  const root=el("div",{class:"scanner",role:"dialog","aria-modal":"true","aria-label":"Barcode scanner"},
    video,
    el("div",{class:"sc-frame"}, el("div",{class:"sc-box"}, el("span",{class:"sc-line"}))),
    el("div",{class:"sc-top"}, el("button",{class:"x",type:"button","aria-label":"Close scanner",onclick:()=>close(null)},"×")),
    el("div",{class:"sc-bottom"}, hint,
      el("div",{class:"actions",style:"justify-content:center"}, torchBtn,
        el("button",{class:"btn",type:"button",onclick:()=>{ close(null); photoScan(cb); }},"Use a photo instead"))));
  document.body.append(root); document.addEventListener("keydown",onKey);
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:false, video:{facingMode:{ideal:"environment"}, width:{ideal:1920}, height:{ideal:1080}}});
  }catch(e){
    hint.textContent = e && e.name==="NotAllowedError"
      ? "Camera access is blocked. Allow the camera for this site in your browser settings, or use a photo instead."
      : "Couldn't start the camera. Use a photo instead.";
    return;
  }
  if(!running){ stream.getTracks().forEach(t=>t.stop()); return; }
  video.srcObject=stream; try{ await video.play(); }catch{}
  const track=stream.getVideoTracks()[0];
  try{
    const caps=(track.getCapabilities&&track.getCapabilities())||{};
    if(caps.focusMode && caps.focusMode.includes("continuous")) await track.applyConstraints({advanced:[{focusMode:"continuous"}]});
    if(caps.torch){ torchBtn.hidden=false; let on=false;
      torchBtn.onclick=async()=>{ on=!on; try{ await track.applyConstraints({advanced:[{torch:on}]}); torchBtn.textContent=on?"Flashlight off":"Flashlight"; }catch{} }; }
  }catch{}
  hint.textContent="Hold the VIN barcode, printed VIN or stock tag inside the box";
  const detector=await makeDetector();
  const cv=document.createElement("canvas"), ctx=cv.getContext("2d",{willReadFrequently:true});
  let n=0;
  const tick=async()=>{
    if(!running) return;
    if(video.readyState>=2 && video.videoWidth){
      // Cycle: straight crop, crop turned +5°, crop turned -5°, whole frame. Hands are rarely level.
      const vw=video.videoWidth, vh=video.videoHeight, mode=n++%4, full=(mode===3);
      const cw=full?vw:Math.round(vw*0.9), ch=full?vh:Math.round(Math.min(vh, cw*0.4));
      cv.width=cw; cv.height=ch;
      const ang=mode===1?5:mode===2?-5:0;
      ctx.setTransform(1,0,0,1,cw/2,ch/2); ctx.rotate(ang*Math.PI/180); ctx.drawImage(video,-vw/2,-vh/2); ctx.setTransform(1,0,0,1,0,0);
      let text=null;
      try{ text = detector ? ((await detector.detect(cv))[0]||{}).rawValue||null : decodeCanvas(cv); }catch{}
      if(!text && detector && n%6===0) text=decodeCanvas(cv);
      const r=text?classify(text):null;
      if(r){
        const key=r.vin||r.stock;
        if(key===last) lastCount++; else { last=key; lastCount=1; }
        // A VIN with a valid check digit is accepted at once; anything else must read the same twice.
        if((r.vin && vinCheck(r.vin)) || lastCount>=2){ try{ navigator.vibrate&&navigator.vibrate(80); }catch{} hint.textContent="Got it: "+key; close(r); return; }
      }
    }
    timer=setTimeout(tick, detector?60:100);
  };
  tick();

  // No barcode after a moment? Also read printed text (windshield VIN plate, door-jamb label) alongside the barcode reader.
  const ocrCv=document.createElement("canvas"), octx=ocrCv.getContext("2d",{willReadFrequently:true});
  const succeed=v=>{ if(!running) return; try{ navigator.vibrate&&navigator.vibrate(80); }catch{} hint.textContent="Got it: "+v; close({vin:v}); };
  setTimeout(async()=>{
    if(!running) return;
    try{ await getOcr(); }catch{ return; }   // text reading unavailable: barcode scanning carries on
    if(!running) return;
    hint.textContent="Reading barcode or printed VIN. Fill the box with the VIN.";
    let k=0;
    while(running){
      if(video.readyState>=2 && video.videoWidth){
        const vw=video.videoWidth, vh=video.videoHeight, cw=Math.round(vw*0.9), ch=Math.round(Math.min(vh, cw*0.4));
        ocrCv.width=cw; ocrCv.height=ch; octx.drawImage(video,Math.round((vw-cw)/2),Math.round((vh-ch)/2),cw,ch,0,0,cw,ch);
        let v=null; try{ v=await readVinText(ocrCv, (k++%2)===1); }catch{}
        if(v){ succeed(v); return; }
      } else await new Promise(r=>setTimeout(r,150));
    }
  }, 1200);
}
$("cam").addEventListener("change", async e=>{
  const f=e.target.files&&e.target.files[0]; const cb=scanCb; scanCb=null; if(!f||!cb) return;
  busy("Reading barcode…");
  let bmp; try{ bmp=await createImageBitmap(f); }catch{ busy(null); toast("Couldn't open that photo. Try again."); return; }
  const txt=await decodeBarcode(bmp);
  busy(null); cb(txt?classify(txt):null);
});
function findCar(r){
  if(!r) return null;
  if(r.vin){ const c=S.cars.find(c=>String(c.vin||"").toUpperCase()===r.vin); if(c) return c; }
  if(r.stock){ const c=S.cars.find(c=>String(c.stock||"").toUpperCase()===r.stock); if(c) return c; }
  return null;
}
function scanLookup(){ startScan(r=>{ const c=findCar(r); if(c){ openCar(c.id); toast(`Found #${c.stock}`); } else showScanResult(r); }); }
function showScanResult(r){
  S.open={kind:"scan"};
  const value = r ? (r.vin||r.stock) : null;
  showSheet(
    el("div",{class:"sheethead"}, el("div",{}, el("span",{class:"label",text:r?(r.vin?"VIN scanned":"Stock # scanned"):"Scan"}), el("h2",{text:r?"Not on the board yet":"Couldn't read a barcode"})),
      el("button",{class:"x",type:"button","aria-label":"Close",onclick:closeSheet},"×")),
    r ? el("div",{class:"found",text:value}) : el("p",{class:"hint",style:"margin:0",text:"Fill the photo with the barcode and avoid glare. The driver's door-jamb sticker, the VIN plate at the base of the windshield, or the stock tag on the keys work best."}),
    r?.vin && !vinCheck(r.vin) ? el("div",{class:"err",text:"The check digit doesn't match, so this VIN may be misread. Compare it with the car before saving."}) : null,
    r?.vin ? el("span",{class:"hint",text:`Model year ${vinYear(r.vin)||"unknown"} from the VIN.`}) : null,
    el("div",{class:"actions"},
      r ? el("button",{class:"btn primary",type:"button",onclick:()=>openForm(null,preFrom(r))},"Add this car") : null,
      el("button",{class:"btn",type:"button",onclick:scanLookup},"Scan again"),
      el("button",{class:"btn ghost",type:"button",onclick:()=>{ closeSheet(); $("q").value=value||""; S.q=value||""; render(); $("q").focus(); }},"Type it instead")));
}

/* ---------- inventory import (managers) ---------- */
const FIELDS=[{k:"stock",label:"Stock # (required)"},{k:"vin",label:"VIN"},{k:"year",label:"Year"},{k:"make",label:"Brand / Make"},{k:"model",label:"Model"},{k:"trim",label:"Trim"},{k:"color",label:"Color"},{k:"type",label:"New / Used"}];
const PREFS={stock:[/^stock\s*(#|no\.?|num(ber)?)?$/i,/stock|^stk/i], vin:[/^vin$/i,/vin|serial/i], year:[/^(model\s*)?(year|yr)$/i,/^my$/i,/year/i],
  make:[/^make$/i,/^(brand|manufacturer|mfr)$/i,/make|brand/i], model:[/^model$/i,/model\s*(desc|description|name)/i,/^model(?!.*(year|code|no|#))/i], trim:[/trim/i,/series|style/i],
  color:[/ext.*colou?r|exterior/i,/^colou?r$/i,/colou?r/i], type:[/new.*used|^n\s*\/\s*u$/i,/^(type|status|class|category|n\/u|nu)$/i]};
function guessMap(headers){
  const m={}, used=new Set();
  for (const f of FIELDS){ m[f.k]=null; for (const re of PREFS[f.k]){ const i=headers.findIndex((h,ix)=>!used.has(ix)&&re.test(h)); if(i>=0){ m[f.k]=i; used.add(i); break; } } }
  return m;
}
async function parseFile(file){
  if(!window.XLSX) throw new Error("The spreadsheet reader didn't load. Check your connection and reload the page.");
  const wb=XLSX.read(await file.arrayBuffer(),{type:"array"});
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:"",raw:false,blankrows:false});
  let h=rows.slice(0,25).findIndex(r=>r.some(c=>/stock|stk|\bvin\b/i.test(String(c))));
  if(h<0) h=0;
  return {headers:(rows[h]||[]).map((c,i)=>String(c).trim()||`Column ${i+1}`), rows:rows.slice(h+1).filter(r=>r.some(c=>String(c).trim()))};
}
function normType(v){ const s=String(v||"").trim().toUpperCase(); if(!s) return null; if(/^N/.test(s)) return "New"; if(/^(U|C|P)/.test(s)) return "Used"; if(/^L/.test(s)) return "Loaner"; if(/^S/.test(s)) return "Service"; return null; }
function buildRecords(p,map,defType){
  const out=new Map(); let skipped=0;
  for (const r of p.rows){
    const g=k=>map[k]==null?"":String(r[map[k]]??"").trim();
    const stock=g("stock").toUpperCase().replace(/[^A-Z0-9-]/g,"");
    if(!stock || /^(TOTAL|COUNT)/.test(stock)){ skipped++; continue; }
    let vin=g("vin").toUpperCase().replace(/[^A-Z0-9]/g,""); if(vin.length===18&&vin[0]==="I") vin=vin.slice(1);
    let year=parseInt(g("year"),10); if(!(year>1980&&year<2100)) year=vinYear(vin);
    let make=g("make").toLowerCase().replace(/(^|[\s-])\w/g,m=>m.toUpperCase()); // "HONDA" -> "Honda"
    if(!make && /^(1HG|2HG|3HG|5FN|5J6|7FA|19X|JHM|SHH|3CZ|2HK|5KB|JHL)/.test(vin)) make="Honda";
    out.set(stock,{stock, vin, year:year||null, make, model:g("model"), trim:g("trim"), color:g("color"), type:normType(g("type"))||defType});
  }
  return {recs:[...out.values()], skipped};
}
async function runPool(jobs,n,onDone){
  let i=0;
  const worker=async()=>{ while(i<jobs.length){ const job=jobs[i++]; let ok=false;
    for (let a=0;a<3&&!ok;a++){ try{ await job(); ok=true; }catch(e){ if(e==="denied") break; await new Promise(r=>setTimeout(r,800*(a+1))); } }
    onDone(ok); } };
  await Promise.all(Array.from({length:n},worker));
}
function pickImport(){ const i=$("importFile"); i.value=""; i.click(); }
$("importFile").addEventListener("change", e=>{ const f=e.target.files&&e.target.files[0]; if(f) openImport(f); });
async function openImport(file){
  busy("Reading "+file.name+"…");
  let p; try{ p=await parseFile(file); }catch(e){ busy(null); toast(e.message||"Couldn't read that file. Save it as .xlsx or .csv and try again."); return; }
  busy(null);
  if(!p.rows.length){ toast("That file has no inventory rows."); return; }
  S.open={kind:"import"};
  const map=guessMap(p.headers);
  const defType=el("select",{id:"m-deftype"}, ...["New","Used"].map(t=>el("option",{value:t},t)));
  const selects=FIELDS.map(f=>{ const s=el("select",{id:"m-"+f.k}, el("option",{value:""},"Not in file"), ...p.headers.map((h,i)=>el("option",{value:String(i),selected:map[f.k]===i},h)));
    s.onchange=()=>{ map[f.k]=s.value===""?null:+s.value; refresh(); };
    return el("div",{class:"field"}, el("label",{class:"label",for:"m-"+f.k,text:f.label}), s); });
  const summary=el("div",{class:"notice",style:"color:var(--ink)"}), preview=el("ul",{class:"preview"});
  const rm=el("input",{type:"checkbox",id:"m-remove"}), rmText=el("span"), rmRow=el("label",{class:"check",for:"m-remove"}, rm, rmText);
  const prog=el("div",{class:"hint",role:"status"}), err=el("div",{class:"err",role:"alert"});
  const go=el("button",{class:"btn primary",type:"button"},"Import");
  let built, missing=[];
  const refresh=()=>{
    built=buildRecords(p,map,defType.value);
    const bySt=new Set(S.cars.map(c=>String(c.stock).toUpperCase()));
    const fresh=built.recs.filter(r=>!bySt.has(r.stock)).length;
    const inFile=new Set(built.recs.map(r=>r.stock));
    missing=S.cars.filter(c=>(c.type==="New"||c.type==="Used")&&!inFile.has(String(c.stock).toUpperCase()));
    summary.textContent = map.stock==null ? "Pick which column holds the stock number." :
      `${built.recs.length} cars found: ${fresh} new to the board, ${built.recs.length-fresh} already on it (details refreshed, locations kept).${built.skipped?` ${built.skipped} rows skipped with no stock #.`:""}`;
    rmText.textContent = `Also remove the ${missing.length} New/Used car${missing.length===1?"":"s"} on the board that aren't in this file (sold or wholesaled). Service and loaner cars are never removed.`;
    rmRow.hidden = !missing.length || map.stock==null;
    preview.replaceChildren(...built.recs.slice(0,4).map(r=>el("li",{text:`#${r.stock} · ${[r.year,r.make,r.model,r.trim].filter(Boolean).join(" ")||"(no model)"}${r.color?" · "+r.color:""} · ${r.type}${r.vin?" · VIN …"+r.vin.slice(-6):""}`})));
    go.disabled = map.stock==null || !built.recs.length;
    go.textContent = `Import ${built.recs.length} cars`;
  };
  defType.onchange=refresh;
  go.onclick=async()=>{
    go.disabled=true; err.textContent=""; selects.forEach(s=>s.querySelector("select").disabled=true);
    const bySt=new Map(S.cars.map(c=>[String(c.stock).toUpperCase(),c]));
    let added=0, updated=0, removed=0, failed=0, done=0;
    const inserts=[], jobs=[];
    for (const r of built.recs){
      const ex=bySt.get(r.stock);
      if (ex){
        const upd={};
        for (const [k,col] of [["vin","vin"],["year","year"],["make","make"],["model","model"],["trim","trim_level"],["color","color"]]) if(r[k] && r[k]!==ex[k]) upd[col]=r[k];
        if (map.type!=null && r.type!==ex.type && (ex.type==="New"||ex.type==="Used")) upd.type=r.type;
        if (Object.keys(upd).length) jobs.push(async()=>{ const d=await must(sb.from("cars").update(upd).eq("id",ex.id).select()); if(!d.length) throw "denied"; upsertLocal(d[0]); updated++; });
      } else inserts.push(detailsRow(r));
    }
    for (let i=0;i<inserts.length;i+=500){ const chunk=inserts.slice(i,i+500);
      jobs.push(async()=>{ const d=await must(sb.from("cars").upsert(chunk,{onConflict:"stock",ignoreDuplicates:true}).select()); d.forEach(upsertLocal); added+=d.length; }); }
    if (rm.checked){ const ids=missing.map(c=>c.id);
      for (let i=0;i<ids.length;i+=200){ const chunk=ids.slice(i,i+200);
        jobs.push(async()=>{ const d=await must(sb.from("cars").delete().in("id",chunk).select("id")); d.forEach(x=>removeLocal(x.id)); removed+=d.length; }); } }
    if (!jobs.length){ prog.textContent="Everything in this file already matches the board. Nothing to change."; return; }
    await runPool(jobs,4,ok=>{ done++; if(!ok) failed++; prog.textContent=`Saving ${done} of ${jobs.length}…`; });
    prog.textContent=`Done. ${added} added, ${updated} updated${removed?`, ${removed} removed`:""}.`;
    if (failed) err.textContent = `${failed} batch${failed===1?"":"es"} didn't save. Import the same file again to finish; cars already added won't be duplicated.`;
    render(); toast(`Imported: ${added} added, ${updated} updated`);
  };
  showSheet(
    el("div",{class:"sheethead"}, el("div",{}, el("span",{class:"label",text:"Import inventory"}), el("h2",{text:file.name})), el("button",{class:"x",type:"button","aria-label":"Close",onclick:closeSheet},"×")),
    el("p",{class:"hint",style:"margin:0",text:"Match each field to a column in your file. New cars arrive as \"Not located yet\" until someone sets their spot. Re-import any time: cars are matched by stock #, and locations are never overwritten."}),
    el("div",{class:"mapgrid"}, ...selects, el("div",{class:"field"}, el("label",{class:"label",for:"m-deftype",text:"Type when the file doesn't say"}), defType)),
    summary, preview, rmRow, err, prog,
    el("div",{class:"actions"}, go, el("button",{class:"btn",type:"button",onclick:closeSheet},"Close")));
  refresh();
}

/* ---------- team (managers) ---------- */
async function openTeam(){
  S.open={kind:"team"};
  await loadPeople();
  const list=el("ul",{class:"hist"});
  const draw=()=>{
    const ppl=Object.values(S.people).sort((a,b)=>(a.role==="pending"?0:1)-(b.role==="pending"?0:1) || String(a.name||a.email).localeCompare(String(b.name||b.email)));
    list.replaceChildren(...ppl.map(p=>{
      const sel=el("select",{"aria-label":"Role for "+(p.name||p.email), disabled:p.id===S.me.id}, ...[["pending","Waiting for approval"],["staff","Staff"],["manager","Manager"]].map(([v,t])=>el("option",{value:v,selected:p.role===v},t)));
      sel.onchange=async()=>{ sel.disabled=true; try{ const d=await must(sb.from("profiles").update({role:sel.value}).eq("id",p.id).select()); if(!d.length) throw "denied"; S.people[p.id]=d[0]; toast(`${p.name||p.email} is now ${sel.options[sel.selectedIndex].text.toLowerCase()}`);}catch(e){ toast(writeErr(e)); sel.value=p.role; } sel.disabled=false; draw(); };
      return el("li",{style:"grid-template-columns:minmax(0,1fr) auto;align-items:center"},
        el("div",{style:"min-width:0;display:flex;flex-direction:column"}, el("b",{text:(p.name||"(no name)")+(p.id===S.me.id?" (you)":"")}), el("span",{text:p.email||""})),
        sel);
    }));
  };
  draw();
  showSheet(
    el("div",{class:"sheethead"}, el("div",{}, el("span",{class:"label",text:"Managers only"}), el("h2",{text:"Team"})), el("button",{class:"x",type:"button","aria-label":"Close",onclick:closeSheet},"×")),
    el("p",{class:"hint",style:"margin:0",text:"New people sign up with the app link, then show here as \"Waiting for approval.\" Set them to Staff to let them find and park cars. Managers can also import inventory, remove cars and approve people."}),
    list);
}

/* ---------- data ---------- */
function upsertLocal(row){ const c=fromRow(row); const i=S.cars.findIndex(x=>x.id===c.id); if(i>=0) S.cars[i]=c; else S.cars.push(c); queueRender(); }
function removeLocal(id){ S.cars=S.cars.filter(c=>c.id!==id); queueRender(); }
async function loadPeople(){ try{ const d=await must(sb.from("profiles").select("id,name,email,role")); S.people=Object.fromEntries(d.map(p=>[p.id,p])); }catch{} }
async function loadCars(){
  const all=[]; for (let from=0;;from+=1000){ const d=await must(sb.from("cars").select("*").order("stock").range(from,from+999)); all.push(...d); if(d.length<1000) break; }
  S.cars=all.map(fromRow); S.loaded=true; render();
}
function setStatus(msg, warn){ const s=$("status"); s.hidden=!msg; s.className="notice"+(warn?" warn":""); if(msg) s.textContent=msg; }

/* ---------- auth screens ---------- */
function showAuthCard(...kids){ $("app").hidden=true; $("auth").hidden=false; $("authCard").replaceChildren(...kids); }
function authField(id,label,type,attrs={}){ return el("div",{class:"field"}, el("label",{class:"label",for:id,text:label}), el("input",{id,type,...attrs})); }
function showSignIn(mode="signin", msg=""){
  const isUp = mode==="signup";
  const err=el("div",{class:"err",role:"alert",text:msg&&!msg.startsWith("✓")?msg:""});
  const ok=msg.startsWith("✓")?el("div",{class:"notice",text:msg.slice(1).trim()}):null;
  const btn=el("button",{class:"btn primary",type:"submit"}, isUp?"Create account":"Sign in");
  const form=el("form",{class:"authform"},
    isUp?authField("a-name","Your name","text",{autocomplete:"name",required:true}):null,
    authField("a-email","Work email","email",{autocomplete:"email",required:true}),
    authField("a-pass","Password","password",{autocomplete:isUp?"new-password":"current-password",required:true,minlength:"8"}),
    ok, err, btn);
  form.addEventListener("submit", async e=>{
    e.preventDefault(); btn.disabled=true; err.textContent="";
    const email=$("a-email").value.trim(), password=$("a-pass").value;
    try{
      if (isUp){
        const {data,error}=await sb.auth.signUp({email,password,options:{data:{name:$("a-name").value.trim()},emailRedirectTo:location.origin+location.pathname}});
        if (error) throw error;
        if (data.session) return enter(data.session);
        return showSignIn("signin","✓ Check your email and tap the confirmation link, then sign in.");
      }
      const {data,error}=await sb.auth.signInWithPassword({email,password});
      if (error) throw error;
      enter(data.session);
    }catch(e2){ btn.disabled=false; err.textContent = /invalid login/i.test(e2.message) ? "Wrong email or password." : /already registered/i.test(e2.message) ? "That email already has an account. Sign in instead." : (e2.message||"Something went wrong. Try again."); }
  });
  showAuthCard(
    el("div",{class:"brandrow"}, el("div",{class:"mark","aria-hidden":"true"},"P"), el("div",{class:"brand"},"Lot Locator", el("small",{text:"Where every car on the property was last parked"}))),
    el("h2",{text:isUp?"Create your account":"Sign in"}),
    form,
    el("div",{class:"actions"},
      el("button",{class:"btn ghost",type:"button",onclick:()=>showSignIn(isUp?"signin":"signup")}, isUp?"I already have an account":"New here? Create an account"),
      isUp?null:el("button",{class:"btn ghost",type:"button",onclick:showForgot},"Forgot password?")));
}
function showForgot(){
  const err=el("div",{class:"err",role:"alert"}), btn=el("button",{class:"btn primary",type:"submit"},"Send reset link");
  const form=el("form",{class:"authform"}, authField("a-email","Work email","email",{autocomplete:"email",required:true}), err, btn);
  form.addEventListener("submit", async e=>{ e.preventDefault(); btn.disabled=true;
    const {error}=await sb.auth.resetPasswordForEmail($("a-email").value.trim(),{redirectTo:location.origin+location.pathname});
    if (error){ btn.disabled=false; err.textContent=error.message; return; }
    showSignIn("signin","✓ If that email has an account, a reset link is on its way. No email after a few minutes? Ask a manager."); });
  showAuthCard(el("h2",{text:"Reset your password"}), form, el("button",{class:"btn ghost",type:"button",onclick:()=>showSignIn()},"Back to sign in"));
}
function showNewPassword(){
  const err=el("div",{class:"err",role:"alert"}), btn=el("button",{class:"btn primary",type:"submit"},"Save new password");
  const form=el("form",{class:"authform"}, authField("a-pass","New password","password",{autocomplete:"new-password",required:true,minlength:"8"}), err, btn);
  form.addEventListener("submit", async e=>{ e.preventDefault(); btn.disabled=true;
    const {data,error}=await sb.auth.updateUser({password:$("a-pass").value});
    if (error){ btn.disabled=false; err.textContent=error.message; return; }
    const {data:{session}}=await sb.auth.getSession(); toast("Password saved"); enter(session); });
  showAuthCard(el("h2",{text:"Choose a new password"}), form);
}
function showPending(){
  showAuthCard(el("h2",{text:"Waiting for approval"}),
    el("p",{class:"hint",text:`You're signed in as ${S.me?.email||"your account"}. A manager needs to approve you before you can see the lot. Let them know you've signed up.`}),
    el("div",{class:"actions"}, el("button",{class:"btn primary",type:"button",onclick:async()=>{ const {data:{session}}=await sb.auth.getSession(); enter(session); }},"Check again"),
      el("button",{class:"btn ghost",type:"button",onclick:signOut},"Sign out")));
}
async function signOut(){ await sb.auth.signOut(); location.reload(); }

/* ---------- entering the app ---------- */
let channel=null, entered=false;
async function enter(session){
  if (!session) return showSignIn();
  let prof=null;
  for (let a=0;a<3&&!prof;a++){ try{ prof=(await must(sb.from("profiles").select("*").eq("id",session.user.id).limit(1)))[0]; }catch{} if(!prof) await new Promise(r=>setTimeout(r,800)); }
  if (!prof){ return showSignIn("signin","Your account isn't set up yet. Ask a manager to check the database setup."); }
  S.me=prof;
  if (prof.role==="pending") return showPending();
  if (entered) return;
  entered=true;
  S.canEdit = prof.role==="manager";
  $("auth").hidden=true; $("app").hidden=false;
  $("me").replaceChildren(el("span",{text:prof.name||prof.email}), el("button",{class:"btn ghost",type:"button",style:"height:32px;padding:0 8px",onclick:signOut},"Sign out"));
  setStatus("Loading the lot…");
  await loadPeople();
  try{ await loadCars(); setStatus(""); }catch{ setStatus("Couldn't load the lot. Check your connection and reload the page.", true); }
  channel = sb.channel("cars-live").on("postgres_changes",{event:"*",schema:"public",table:"cars"}, async payload=>{
    if (payload.eventType==="DELETE") removeLocal(payload.old.id); else { upsertLocal(payload.new); if (payload.new.updated_by && !S.people[payload.new.updated_by]) { await loadPeople(); queueRender(); } }
  }).subscribe(status=>{ if (status==="CHANNEL_ERROR"||status==="TIMED_OUT") setStatus("Live updates paused. Pull down or reload to refresh.", true); else if (status==="SUBSCRIBED" && S.loaded) setStatus(""); });
  document.addEventListener("visibilitychange",()=>{ if (document.visibilityState==="visible" && !S.open) loadCars().catch(()=>{}); });
}

/* ---------- controls + boot ---------- */
$("q").addEventListener("input",e=>{S.q=e.target.value.trim();render();});
$("sort").addEventListener("change",e=>{S.sort=e.target.value;render();});
$("brand").addEventListener("change",e=>{S.brand=e.target.value;render();});
$("filters").addEventListener("click",e=>{const b=e.target.closest(".chip"); if(!b) return; S.type=b.dataset.type; render();});
$("addBtn").addEventListener("click",()=>openForm(null));
$("scanBtn").addEventListener("click", scanLookup);
$("importBtn").addEventListener("click", pickImport);
$("teamBtn").addEventListener("click", openTeam);
setInterval(()=>{ if(S.loaded && !S.open) render(); }, 60000);

(async()=>{
  if (!sb){ showAuthCard(el("h2",{text:"Almost there"}), el("p",{class:"hint",text:"This copy of Lot Locator isn't connected to a database yet. Open config.js and paste in your Supabase project URL and anon key (see README.md)."})); return; }
  sb.auth.onAuthStateChange((ev)=>{ if (ev==="PASSWORD_RECOVERY") showNewPassword(); });
  if (/type=recovery/.test(location.hash)) return; // onAuthStateChange shows the new-password form
  const {data:{session}} = await sb.auth.getSession();
  if (session) enter(session); else showSignIn();
})();
