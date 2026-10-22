/* Thailand Road Fatality Atlas · plain JavaScript, Canvas and CSS */
const fmt = new Intl.NumberFormat('th-TH');
const MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const AGE_BANDS = ['0–14','15–19','20–24','25–29','30–34','35–39','40–44','45–49','50–54','55–59','60–64','65+'];
const SEX_M = 'ชาย', SEX_F = 'หญิง';
let DATA = null, selectedYear = 'all', selectedRoadType = 'all', mapZoom = 1, mapPanX = 0, mapPanY = 0, dragging = false, dragStart = null;
let mapBounds = null, leafletMap = null, roadLayer = null, pointLayer = null;

function isValue(v){ return v !== null && v !== undefined && v !== '' && String(v).toLowerCase() !== 'nan'; }
function filtered(){ return (DATA?.records || []).filter(r => selectedYear === 'all' || String(r.dead_year) === selectedYear); }
function countVal(rows, key){ return rows.reduce((n,r)=>n+(isValue(r[key])?1:0),0); }
function groupCounts(rows,key){ const m=new Map(); for(const r of rows){const v=isValue(r[key])?String(r[key]):'ไม่ระบุ';m.set(v,(m.get(v)||0)+1)} return [...m.entries()].sort((a,b)=>b[1]-a[1]); }
function setText(id,value){const e=document.getElementById(id);if(e)e.textContent=value}
function resizeCanvas(canvas){const rect=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1; if(!rect.width||!rect.height)return null;const w=Math.max(1,Math.round(rect.width*dpr)),h=Math.max(1,Math.round(rect.height*dpr));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);return {ctx,w:rect.width,h:rect.height,dpr}}
function roundedRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r);}

function updateKpis(rows){
  const coords=rows.filter(r=>isValue(r.latitude)&&isValue(r.longitude)).length;
  const matched=rows.filter(r=>r.road_status==='matched').length;
  const inc=countVal(rows,'incident_date');
  setText('kpi-deaths',fmt.format(rows.length)); setText('kpi-coords',fmt.format(coords));
  setText('kpi-coords-sub',`${rows.length?((coords/rows.length)*100).toFixed(1):'0.0'}% ของรายการที่เลือก`);
  setText('kpi-road-match',fmt.format(matched)); setText('kpi-incident',fmt.format(inc));
  const coverage=DATA.meta.records?DATA.meta.incident_dates/DATA.meta.records*100:0;
  setText('incident-coverage',`${coverage.toFixed(1)}% ครอบคลุม`);
  setText('holiday-matches',DATA.meta.incident_dates?`${fmt.format(DATA.meta.holiday_matches)} ระเบียนตรงกับวันหยุด`:'ยังจับคู่ไม่ได้ · ไม่มีวันเกิดเหตุ');
  setText('map-match-label',`${fmt.format(matched)} จับคู่ได้`);
  const traffic=rows.filter(r=>isValue(r.traffic_aadt)).length;
  setText('traffic-linked',fmt.format(traffic));
}

function drawTrend(rows){
  const canvas=document.getElementById('trend-chart'),s=resizeCanvas(canvas);if(!s)return;const {ctx,w,h}=s;ctx.clearRect(0,0,w,h);
  const pad={l:42,r:12,t:14,b:29},cw=w-pad.l-pad.r,ch=h-pad.t-pad.b;
  const years=['2023','2024','2025'],colors=['#e97a66','#4f8bc4','#38a18a'];
  const values=Object.fromEntries(years.map(y=>[y,Array(12).fill(0)]));
  for(const r of rows){if(!r.death_date)continue;const d=new Date(`${r.death_date}T00:00:00Z`);if(Number.isNaN(+d))continue;const y=String(d.getUTCFullYear());if(values[y])values[y][d.getUTCMonth()]++}
  const max=Math.max(1,...years.flatMap(y=>values[y]));
  ctx.strokeStyle='#edf0f4';ctx.lineWidth=1;ctx.fillStyle='#9aa5b1';ctx.font='9px "Noto Sans Thai",sans-serif';ctx.textAlign='right';
  for(let i=0;i<=4;i++){const y=pad.t+ch*i/4;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();ctx.fillText(fmt.format(Math.round(max*(1-i/4))),pad.l-8,y+3)}
  MONTHS.forEach((m,i)=>{if(i%2===0||i===11){ctx.textAlign='center';ctx.fillText(m,pad.l+cw*i/11,h-8)}});
  years.forEach((yr,yi)=>{if(selectedYear!=='all'&&selectedYear!==yr)return;ctx.beginPath();ctx.lineWidth=2;ctx.strokeStyle=colors[yi];ctx.lineJoin='round';values[yr].forEach((v,i)=>{const x=pad.l+cw*i/11,y=pad.t+ch-(v/max)*ch;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();values[yr].forEach((v,i)=>{const x=pad.l+cw*i/11,y=pad.t+ch-(v/max)*ch;ctx.fillStyle=colors[yi];ctx.beginPath();ctx.arc(x,y,2.3,0,Math.PI*2);ctx.fill()})});
  const lg=document.getElementById('trend-legend');lg.innerHTML='';years.forEach((yr,i)=>{if(selectedYear!=='all'&&selectedYear!==yr)return;const item=document.createElement('span');item.className='legend-year';item.innerHTML=`<i style="background:${colors[i]}"></i>พ.ศ. ${Number(yr)+543}`;lg.appendChild(item)});
}

function ageBand(age){const n=Number(age);if(!Number.isFinite(n)||n<0)return null;if(n<15)return 0;if(n<20)return 1;if(n<25)return 2;if(n<30)return 3;if(n<35)return 4;if(n<40)return 5;if(n<45)return 6;if(n<50)return 7;if(n<55)return 8;if(n<60)return 9;if(n<65)return 10;return 11}
function drawPyramid(rows){
  const s=resizeCanvas(document.getElementById('pyramid-chart'));if(!s)return;const {ctx,w,h}=s;ctx.clearRect(0,0,w,h);
  const m=Array(12).fill(0),f=Array(12).fill(0);for(const r of rows){const i=ageBand(r.age);if(i===null)continue;if(r.sex===SEX_M)m[i]++;else if(r.sex===SEX_F)f[i]++}
  const max=Math.max(1,...m,...f),mid=w*.5,top=12,rowH=(h-22)/12,half=Math.min(w*.36,180);
  ctx.font='9px "Noto Sans Thai",sans-serif';
  for(let i=0;i<12;i++){const y=top+i*rowH,barH=Math.max(5,rowH*.56),mw=m[i]/max*half,fw=f[i]/max*half;ctx.fillStyle='#4481be';roundedRect(ctx,mid-mw-2,y+(rowH-barH)/2,mw,barH,3);ctx.fill();ctx.fillStyle='#bf7fbb';roundedRect(ctx,mid+2,y+(rowH-barH)/2,fw,barH,3);ctx.fill();ctx.textAlign='center';ctx.fillStyle='#758296';ctx.fillText(AGE_BANDS[i],mid,y+rowH*.72)}
  ctx.strokeStyle='#d8e0e8';ctx.beginPath();ctx.moveTo(mid,8);ctx.lineTo(mid,h-8);ctx.stroke();
}

function drawBars(canvasId, rows, key, color, limit=8){
  const s=resizeCanvas(document.getElementById(canvasId));if(!s)return;const {ctx,w,h}=s;ctx.clearRect(0,0,w,h);
  const items=groupCounts(rows,key).filter(x=>x[0]!=='ไม่ระบุ').slice(0,limit);if(!items.length){ctx.fillStyle='#94a0ae';ctx.font='11px sans-serif';ctx.textAlign='center';ctx.fillText('ไม่มีข้อมูล',w/2,h/2);return}
  const left=Math.min(150,w*.43),right=44,rowH=Math.min(28,(h-8)/items.length),max=items[0][1],barW=w-left-right;
  ctx.font='9px "Noto Sans Thai",sans-serif';
  items.forEach(([label,value],i)=>{const y=5+i*rowH;ctx.fillStyle='#69788b';ctx.textAlign='right';const shown=label.length>22?label.slice(0,21)+'…':label;ctx.fillText(shown,left-9,y+rowH*.65);ctx.fillStyle='#f0f3f6';roundedRect(ctx,left,y+rowH*.23,barW,rowH*.52,4);ctx.fill();ctx.fillStyle=color;roundedRect(ctx,left,y+rowH*.23,Math.max(2,barW*value/max),rowH*.52,4);ctx.fill();ctx.fillStyle='#58687d';ctx.textAlign='left';ctx.fillText(fmt.format(value),left+barW+7,y+rowH*.65)});
}

function drawVehicleCause(rows){const s=resizeCanvas(document.getElementById('vehicle-cause-chart'));if(!s)return;const {ctx,w,h}=s;ctx.clearRect(0,0,w,h);const causes=['V','W','X','Y','Other'],colors=['#3e78bc','#36a18b','#df9b42','#bd7fbb','#9ba6b2'],vehicles=groupCounts(rows,'vehicle').filter(([v])=>v!=='ไม่ระบุ').slice(0,6),totals=new Map();for(const r of rows){const vehicle=String(r.vehicle||'ไม่ระบุ');if(!vehicles.some(([v])=>v===vehicle))continue;const code=String(r.cause||'').toUpperCase(),key=/^[VWXY]/.test(code)?code[0]:'Other';if(!totals.has(vehicle))totals.set(vehicle,Object.fromEntries(causes.map(c=>[c,0])));totals.get(vehicle)[key]++}const legend=document.getElementById('crash-legend');legend.innerHTML='';causes.forEach((c,i)=>{const item=document.createElement('span');item.className='legend-year';item.innerHTML=`<i style="background:${colors[i]}"></i>${c==='Other'?'อื่น/ไม่ทราบ':c}`;legend.append(item)});if(!vehicles.length){ctx.fillStyle='#94a0ae';ctx.font='11px sans-serif';ctx.textAlign='center';ctx.fillText('ไม่มีข้อมูล',w/2,h/2);return}const left=Math.min(130,w*.38),right=34,rowH=(h-8)/vehicles.length,max=Math.max(1,...vehicles.map(([v])=>Math.max(...Object.values(totals.get(v)||{})))),barW=w-left-right;ctx.font='9px "Noto Sans Thai",sans-serif';vehicles.forEach(([vehicle],i)=>{const y=4+i*rowH,label=vehicle.length>17?vehicle.slice(0,16)+'…':vehicle;ctx.fillStyle='#69788b';ctx.textAlign='right';ctx.fillText(label,left-7,y+rowH*.65);const subH=Math.max(2,Math.min(5,rowH*.16));causes.forEach((cause,j)=>{const count=totals.get(vehicle)?.[cause]||0,yy=y+j*(subH+1);ctx.fillStyle='#f0f3f6';roundedRect(ctx,left,yy,barW,subH,2);ctx.fill();if(count){ctx.fillStyle=colors[j];roundedRect(ctx,left,yy,Math.max(1,barW*count/max),subH,2);ctx.fill()}})})}

function updateQuality(rows){
  const missingAge=rows.length-countVal(rows,'age'),missingCause=rows.length-countVal(rows,'cause'),coords=rows.filter(r=>isValue(r.latitude)&&isValue(r.longitude)).length;
  const matched=rows.filter(r=>r.road_status==='matched').length,traffic=rows.filter(r=>isValue(r.traffic_aadt)).length;
  const notes=[
    `วันเกิดเหตุ: ${fmt.format(rows.length-countVal(rows,'incident_date'))} รายการไม่มี Date Rec จึงยังวิเคราะห์เวลาและเทศกาลจากวันเกิดเหตุไม่ได้`,
    `พิกัด: ${fmt.format(coords)} รายการมีพิกัด (${rows.length?((coords/rows.length)*100).toFixed(1):'0.0'}%); จับคู่เส้นถนนได้ ${fmt.format(matched)} รายการภายใน 100 เมตร`,
    `อายุ: ${fmt.format(missingAge)} รายการไม่ระบุอายุ · Cause_Code: ${fmt.format(missingCause)} รายการไม่ระบุรหัส`,
    `อุปกรณ์นิรภัย: หมวกและเข็มขัดไม่มีค่าในข้อมูลทุกแถว จึงไม่อนุมานการไม่ใช้`,
    `ปริมาณจราจร: ${fmt.format(traffic)} รายการมี AADT จากรหัส highway_code ที่จับคู่ได้; ค่านี้ไม่ใช่อัตราความเสี่ยง`
  ];const ul=document.getElementById('quality-list');ul.innerHTML='';for(const note of notes){const li=document.createElement('li');li.textContent=note;ul.appendChild(li)}
}

function routeType(code){const digits=String(code??'').replace(/\D/g,'').replace(/^0+/,'');if(digits.length===1)return 'primary';if(digits.length>=2&&digits.length<=4)return 'secondary';return 'other'}
function visibleRoads(){return DATA.roads.filter(r=>selectedRoadType==='all'||routeType(r.highway_code)===selectedRoadType)}
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function drawMap(){
  if(!DATA||!leafletMap)return;roadLayer.clearLayers();pointLayer.clearLayers();
  const showRoads=document.getElementById('show-roads').checked,showPoints=document.getElementById('show-points').checked;
  const rows=filtered().filter(r=>isValue(r.latitude)&&isValue(r.longitude));
  const roadDeaths=new Map();for(const r of rows){if(r.road_status==='matched'&&isValue(r.road_feature_id)){const id=String(r.road_feature_id);roadDeaths.set(id,(roadDeaths.get(id)||0)+1)}}
  if(showRoads){for(const road of visibleRoads()){const n=roadDeaths.get(String(road.id))||0,color=n>=10?'#d84e45':n>=4?'#ed9b47':n>0?'#59a992':'#6f8da0';for(const line of road.lines){const latlngs=line.map(([lon,lat])=>[lat,lon]);L.polyline(latlngs,{color,weight:n>=10?3.4:n>=4?2.6:n>0?1.8:1,opacity:n?0.9:.38}).bindPopup(`<strong>ทางหลวง ${escapeHtml(road.highway_code||'ไม่ระบุ')} · ${escapeHtml(road.road_code||'')}</strong><br>${escapeHtml(road.road_name||road.road_class_name||'ไม่ระบุชื่อ')}<br>จุดผู้เสียชีวิตที่จับคู่ได้: ${fmt.format(n)} ราย`).addTo(roadLayer)}}}
  if(showPoints){for(const r of rows){const point=L.marker([Number(r.latitude),Number(r.longitude)],{icon:L.divIcon({className:'fatality-marker',html:'',iconSize:[10,10],iconAnchor:[5,5]})});point.bindPopup(`<strong>ระเบียน ${escapeHtml(r.id)}</strong><br>วันเสียชีวิต: ${escapeHtml(r.death_date||'ไม่ระบุ')}<br>พาหนะ: ${escapeHtml(r.vehicle||'ไม่ระบุ')}<br>รหัสสาเหตุ: ${escapeHtml(r.cause||'ไม่ระบุ')}<br>ถนน: ${escapeHtml(r.highway_code||'ไม่จับคู่')} · ${escapeHtml(r.road_name||'')}<br>ระยะจากแนวถนน: ${isValue(r.road_distance_m)?`${escapeHtml(r.road_distance_m)} ม.`:'ไม่จับคู่'}<br>พิกัด: ${Number(r.latitude).toFixed(5)}, ${Number(r.longitude).toFixed(5)}`);pointLayer.addLayer(point)}}
  const matched=rows.filter(r=>r.road_status==='matched').length;setText('map-summary',`${fmt.format(rows.length)} จุดมีพิกัดในตัวกรอง · ${fmt.format(matched)} จับคู่แนวถนนได้ภายใน 100 ม. · ${fmt.format(visibleRoads().length)} ช่วงเส้นทางที่แสดง`);document.getElementById('map-empty').hidden=rows.length>0;drawHotspots(rows,roadDeaths);
}

function drawHotspots(rows,counts){const list=document.getElementById('hotspots-list');if(!list)return;const features=new Map(DATA.roads.map(r=>[String(r.id),r]));const ranked=[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);list.innerHTML='';if(!ranked.length){list.textContent='ยังไม่มีพิกัดที่จับคู่กับแนวถนนในตัวกรองนี้';return}for(const [id,count] of ranked){const road=features.get(id);if(!road|| (selectedRoadType!=='all'&&routeType(road.highway_code)!==selectedRoadType))continue;const row=document.createElement('div');row.className='hotspot-row';const title=document.createElement('strong');title.textContent=`ทางหลวง ${road.highway_code||'ไม่ระบุ'} · ${road.road_code||'ไม่ระบุ'}`;const name=document.createElement('span');name.textContent=road.road_name||road.road_class_name||'ไม่ระบุชื่อช่วงทาง';const value=document.createElement('b');value.textContent=`${fmt.format(count)} ราย`;row.append(title,name,value);list.append(row)}if(!list.children.length)list.textContent='ไม่มีช่วงทางในชั้นที่เลือก'}

function csvEscape(v){const x=(v===null||v===undefined)?'':String(v);return '"'+x.replaceAll('"','""')+'"'}
function exportCsv(){const rows=filtered();const cols=['id','dead_year','death_date','incident_date','incident_time','age','sex','vehicle','cause','latitude','longitude','road_status','road_distance_m','highway_code','highway_name','road_code','road_name','km_start','km_end','traffic_aadt','traffic_years','holiday_name','festival'];const csv='\ufeff'+[cols.join(','),...rows.map(r=>cols.map(k=>csvEscape(r[k])).join(','))].join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`road-fatalities-${selectedYear==='all'?'all':Number(selectedYear)+543}.csv`;a.click();URL.revokeObjectURL(url)}
function render(){const rows=filtered();updateKpis(rows);drawTrend(rows);drawPyramid(rows);drawBars('vehicle-chart',rows,'vehicle','#e97d65',8);drawVehicleCause(rows);drawBars('cause-chart',rows,'cause','#4b94a1',8);updateQuality(rows);drawMap()}

function setupMap(){if(!window.L){throw new Error('โหลด Leaflet ไม่สำเร็จ กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วเปิดหน้าเว็บใหม่')}leafletMap=L.map('road-map',{preferCanvas:true,scrollWheelZoom:true}).setView([13.736717,100.523186],6);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(leafletMap);roadLayer=L.layerGroup().addTo(leafletMap);pointLayer=L.markerClusterGroup({chunkedLoading:true,showCoverageOnHover:false,spiderfyOnMaxZoom:true}).addTo(leafletMap);document.getElementById('show-roads').addEventListener('change',()=>{if(leafletMap.hasLayer(roadLayer))roadLayer.remove();if(document.getElementById('show-roads').checked)roadLayer.addTo(leafletMap);drawMap()});document.getElementById('show-points').addEventListener('change',()=>{if(leafletMap.hasLayer(pointLayer))pointLayer.remove();if(document.getElementById('show-points').checked)pointLayer.addTo(leafletMap);drawMap()});document.getElementById('road-type-filter').addEventListener('change',e=>{selectedRoadType=e.target.value;drawMap()});document.getElementById('map-reset').addEventListener('click',()=>leafletMap.setView([13.736717,100.523186],6))}

async function boot(){try{setupMap();document.getElementById('year-filter').addEventListener('change',e=>{selectedYear=e.target.value;render()});document.getElementById('export-csv').addEventListener('click',exportCsv);const themeButton=document.getElementById('theme-toggle');themeButton.addEventListener('click',()=>{const dark=document.body.dataset.theme!=='dark';document.body.dataset.theme=dark?'dark':'light';themeButton.textContent=dark?'☀ โหมดสว่าง':'☾ โหมดมืด';localStorage.setItem('road-dashboard-theme',dark?'dark':'light');setTimeout(()=>leafletMap.invalidateSize(),50)});const savedTheme=localStorage.getItem('road-dashboard-theme');if(savedTheme){document.body.dataset.theme=savedTheme;themeButton.textContent=savedTheme==='dark'?'☀ โหมดสว่าง':'☾ โหมดมืด'}window.addEventListener('resize',()=>render());const res=await fetch('data/dashboard_data.json');if(!res.ok)throw new Error(`โหลดข้อมูลไม่สำเร็จ (${res.status})`);DATA=await res.json();document.getElementById('data-note').classList.toggle('note-critical',DATA.meta.incident_dates===0);render()}catch(err){document.getElementById('data-note').innerHTML=`<div class="note-icon">!</div><div><strong>โหลด Dashboard ไม่สำเร็จ</strong><p>${err.message} · ใช้ <code>node server.js</code> สำหรับเปิดเว็บในเครื่อง และเชื่อมต่ออินเทอร์เน็ตสำหรับแผนที่พื้นหลัง</p></div>`;console.error(err)}}
document.addEventListener('DOMContentLoaded',boot);
