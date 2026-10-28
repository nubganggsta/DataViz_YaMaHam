/* Thailand Road Fatality Atlas · plain JavaScript, Canvas and CSS */
const fmt = new Intl.NumberFormat('th-TH');
const MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const AGE_BANDS = ['0–14','15–19','20–24','25–29','30–34','35–39','40–44','45–49','50–54','55–59','60–64','65+'];
const SEX_M = 'ชาย', SEX_F = 'หญิง';
let DATA = null, ACCIDENTS = null, selectedYear = 'all', selectedRoadType = 'all', mapZoom = 1, mapPanX = 0, mapPanY = 0, dragging = false, dragStart = null;
let mapBounds = null, leafletMap = null, roadLayer = null, pointLayer = null, hasMarkerCluster = false;

function isValue(v){ return v !== null && v !== undefined && v !== '' && String(v).toLowerCase() !== 'nan'; }
function filtered(){ return (DATA?.records || []).filter(r => selectedYear === 'all' || String(r.dead_year) === selectedYear); }
function countVal(rows, key){ return rows.reduce((n,r)=>n+(isValue(r[key])?1:0),0); }
function groupCounts(rows,key){ const m=new Map(); for(const r of rows){const v=isValue(r[key])?String(r[key]):'ไม่ระบุ';m.set(v,(m.get(v)||0)+1)} return [...m.entries()].sort((a,b)=>b[1]-a[1]); }
function setText(id,value){const e=document.getElementById(id);if(e)e.textContent=value}
function chartTheme(){return document.body.dataset.theme==='dark'?{grid:'rgba(225,236,248,.13)',text:'#b9c6d6',track:'#344b61'}:{grid:'#edf0f4',text:'#748196',track:'#f0f3f6'}}
function updateHeroCounter(rows){const yearLabel=selectedYear==='all'?'2566–2568':String(Number(selectedYear)+543);setText('hero-counter-label',`ผู้เสียชีวิตสะสมในชุดข้อมูล ปี ${yearLabel}`);const number=document.getElementById('hero-counter-number');number.replaceChildren();for(const char of new Intl.NumberFormat('en-US').format(rows.length)){const item=document.createElement('span');item.className=char===','?'hero-separator':'hero-digit';item.textContent=char;number.append(item)}number.setAttribute('aria-label',`${fmt.format(rows.length)} ราย`)}
function resizeCanvas(canvas){const rect=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1; if(!rect.width||!rect.height)return null;const w=Math.max(1,Math.round(rect.width*dpr)),h=Math.max(1,Math.round(rect.height*dpr));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);return {ctx,w:rect.width,h:rect.height,dpr}}
function roundedRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r);}

function updateKpis(rows){
  updateHeroCounter(rows);
  const coords=rows.filter(r=>isValue(r.latitude)&&isValue(r.longitude)).length;
  const matched=rows.filter(r=>r.road_status==='matched').length;
  const inc=countVal(rows,'incident_date');
  setText('kpi-deaths',fmt.format(rows.length)); setText('kpi-coords',fmt.format(coords));
  setText('kpi-coords-sub',`${rows.length?((coords/rows.length)*100).toFixed(1):'0.0'}% ของรายการที่เลือก`);
  setText('kpi-road-match',fmt.format(matched)); setText('kpi-incident',fmt.format(inc));
  const coverage=DATA.meta.records?DATA.meta.incident_dates/DATA.meta.records*100:0;
  setText('incident-coverage',`${coverage.toFixed(1)}% ครอบคลุม`);
  setText('holiday-matches',`${fmt.format(countVal(rows,'holiday_name'))} ระเบียน · Dead_Date ตรงกับวันหยุด`);
  setText('map-match-label',`${fmt.format(matched)} จับคู่ได้`);
  const traffic=rows.filter(r=>isValue(r.traffic_aadt)).length;
  setText('traffic-linked',fmt.format(traffic));
}

function drawWeekday(rows){const s=resizeCanvas(document.getElementById('weekday-chart'));if(!s)return;const {ctx,w,h}=s,theme=chartTheme();ctx.clearRect(0,0,w,h);const days=['จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์','อาทิตย์'],counts=Array(7).fill(0);for(const r of rows){if(!r.death_date)continue;const date=new Date(`${r.death_date}T00:00:00Z`);if(Number.isNaN(+date))continue;counts[(date.getUTCDay()+6)%7]++}const max=Math.max(1,...counts),left=Math.min(84,w*.25),right=38,top=6,rowH=(h-12)/7,barW=w-left-right;ctx.font='10px "Noto Sans Thai",sans-serif';days.forEach((day,i)=>{const y=top+i*rowH,barH=Math.min(17,rowH*.58);ctx.fillStyle=theme.text;ctx.textAlign='right';ctx.fillText(day,left-9,y+rowH*.65);ctx.fillStyle=theme.track;roundedRect(ctx,left,y+(rowH-barH)/2,barW,barH,4);ctx.fill();ctx.fillStyle=i===5||i===6?'#ff6548':'#00a5f5';roundedRect(ctx,left,y+(rowH-barH)/2,Math.max(2,barW*counts[i]/max),barH,4);ctx.fill();ctx.fillStyle=theme.text;ctx.textAlign='left';ctx.fillText(fmt.format(counts[i]),left+barW+7,y+rowH*.65)})}

function drawTrend(rows){
  const canvas=document.getElementById('trend-chart'),s=resizeCanvas(canvas);if(!s)return;const {ctx,w,h}=s;ctx.clearRect(0,0,w,h);
  const pad={l:42,r:12,t:14,b:29},cw=w-pad.l-pad.r,ch=h-pad.t-pad.b;
  const years=['2023','2024','2025'],colors=['#ffc83d','#00a5f5','#31c48d'];
  const values=Object.fromEntries(years.map(y=>[y,Array(12).fill(0)]));
  for(const r of rows){if(!r.death_date)continue;const d=new Date(`${r.death_date}T00:00:00Z`);if(Number.isNaN(+d))continue;const y=String(d.getUTCFullYear());if(values[y])values[y][d.getUTCMonth()]++}
  const max=Math.max(1,...years.flatMap(y=>values[y]));
  const theme=chartTheme();ctx.strokeStyle=theme.grid;ctx.lineWidth=1;ctx.fillStyle=theme.text;ctx.font='9px "Noto Sans Thai",sans-serif';ctx.textAlign='right';
  for(let i=0;i<=4;i++){const y=pad.t+ch*i/4;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();ctx.fillText(fmt.format(Math.round(max*(1-i/4))),pad.l-8,y+3)}
  MONTHS.forEach((m,i)=>{if(i%2===0||i===11){ctx.textAlign='center';ctx.fillText(m,pad.l+cw*i/11,h-8)}});
  years.forEach((yr,yi)=>{if(selectedYear!=='all'&&selectedYear!==yr)return;ctx.beginPath();ctx.lineWidth=2;ctx.strokeStyle=colors[yi];ctx.lineJoin='round';values[yr].forEach((v,i)=>{const x=pad.l+cw*i/11,y=pad.t+ch-(v/max)*ch;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();values[yr].forEach((v,i)=>{const x=pad.l+cw*i/11,y=pad.t+ch-(v/max)*ch;ctx.fillStyle=colors[yi];ctx.beginPath();ctx.arc(x,y,2.3,0,Math.PI*2);ctx.fill()})});
  const lg=document.getElementById('trend-legend');lg.innerHTML='';years.forEach((yr,i)=>{if(selectedYear!=='all'&&selectedYear!==yr)return;const item=document.createElement('span');item.className='legend-year';item.innerHTML=`<i style="background:${colors[i]}"></i>พ.ศ. ${Number(yr)+543}`;lg.appendChild(item)});
}

function ageBand(age){const n=Number(age);if(!Number.isFinite(n)||n<0)return null;if(n<15)return 0;if(n<19)return 1;if(n<25)return 2;if(n<36)return 3;if(n<61)return 4;return 5}
function drawAgeIcon(ctx,x,y,size,stage,color){
  const heights=[.56,.68,.77,.86,1,.94],scale=size*heights[stage],cx=x,base=y+size*.42;
  ctx.save();ctx.fillStyle=color;ctx.strokeStyle=color;ctx.lineWidth=Math.max(1.6,size*.12);ctx.lineCap='round';ctx.lineJoin='round';
  ctx.beginPath();ctx.arc(cx,base-scale*.88,scale*.13,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.moveTo(cx,base-scale*.70);ctx.lineTo(cx,base-scale*.35);ctx.moveTo(cx,base-scale*.60);ctx.lineTo(cx-scale*.25,base-scale*.42);ctx.moveTo(cx,base-scale*.60);ctx.lineTo(cx+scale*.25,base-scale*.42);ctx.moveTo(cx,base-scale*.35);ctx.lineTo(cx-scale*.2,base);ctx.moveTo(cx,base-scale*.35);ctx.lineTo(cx+scale*.2,base);ctx.stroke();ctx.restore();
}
function drawPyramid(rows){
  const s=resizeCanvas(document.getElementById('pyramid-chart'));if(!s)return;const {ctx,w,h}=s;ctx.clearRect(0,0,w,h);
  const bands=[['1–14',0,15],['15–18',15,19],['19–24',19,25],['25–35',25,36],['36–60',36,61],['60+',61,Infinity]],m=Array(6).fill(0),f=Array(6).fill(0);
  for(const r of rows){const age=Number(r.age);if(!Number.isFinite(age)||age<0)continue;const i=bands.findIndex((b,j)=>age>=b[1]&&age<b[2]);if(i<0)continue;if(r.sex===SEX_M)m[i]++;else if(r.sex===SEX_F)f[i]++}
  const max=Math.max(1,...m,...f),mid=w*.5,top=4,rowH=(h-8)/6,gap=Math.min(52,w*.17),half=Math.max(10,Math.min(w*.23,125,mid-gap-38)),theme=chartTheme();
  ctx.font='9px "Noto Sans Thai",sans-serif';ctx.strokeStyle=theme.grid;ctx.beginPath();ctx.moveTo(mid,top);ctx.lineTo(mid,h-top);ctx.stroke();
  bands.forEach((band,i)=>{const y=top+i*rowH,barH=Math.min(18,rowH*.43),center=y+rowH*.53,mw=m[i]/max*half,fw=f[i]/max*half;ctx.fillStyle='#00a5f5';roundedRect(ctx,mid-gap-mw,center-barH/2,mw,barH,4);ctx.fill();ctx.fillStyle='#ed4ee0';roundedRect(ctx,mid+gap,center-barH/2,fw,barH,4);ctx.fill();drawAgeIcon(ctx,mid,center-rowH*.12,Math.min(18,rowH*.5),i,document.body.dataset.theme==='dark'?'#dbe8f5':'#66758a');ctx.fillStyle=theme.text;ctx.textAlign='center';ctx.font='9px "Noto Sans Thai",sans-serif';ctx.fillText(`${band[0]} ปี`,mid,center+rowH*.3);ctx.font='8px "Noto Sans Thai",sans-serif';ctx.fillStyle='#00a5f5';ctx.textAlign='right';ctx.fillText(fmt.format(m[i]),mid-gap-mw-4,center+3);ctx.fillStyle='#ed4ee0';ctx.textAlign='left';ctx.fillText(fmt.format(f[i]),mid+gap+fw+4,center+3)})
}

function drawBars(canvasId, rows, key, color, limit=8){
  const s=resizeCanvas(document.getElementById(canvasId));if(!s)return;const {ctx,w,h}=s;ctx.clearRect(0,0,w,h);
  const items=groupCounts(rows,key).filter(x=>x[0]!=='ไม่ระบุ').slice(0,limit);if(!items.length){ctx.fillStyle='#94a0ae';ctx.font='11px sans-serif';ctx.textAlign='center';ctx.fillText('ไม่มีข้อมูล',w/2,h/2);return}
  const left=Math.min(150,w*.43),right=44,rowH=Math.min(28,(h-8)/items.length),max=items[0][1],barW=w-left-right,theme=chartTheme();
  ctx.font='9px "Noto Sans Thai",sans-serif';
  items.forEach(([label,value],i)=>{const y=5+i*rowH;ctx.fillStyle=theme.text;ctx.textAlign='right';const shown=label.length>22?label.slice(0,21)+'…':label;ctx.fillText(shown,left-9,y+rowH*.65);ctx.fillStyle=theme.track;roundedRect(ctx,left,y+rowH*.23,barW,rowH*.52,4);ctx.fill();ctx.fillStyle=color;roundedRect(ctx,left,y+rowH*.23,Math.max(2,barW*value/max),rowH*.52,4);ctx.fill();ctx.fillStyle=theme.text;ctx.textAlign='left';ctx.fillText(fmt.format(value),left+barW+7,y+rowH*.65)});
}

function selectedAccidentYears(){
  if(!ACCIDENTS)return [];
  return Object.entries(ACCIDENTS.years).filter(([year])=>selectedYear==='all'||year===selectedYear);
}
function accidentTotal(key){return selectedAccidentYears().reduce((sum,[,data])=>sum+(Number(data[key])||0),0)}
function aggregateAccidentList(key, valueIndex=1){
  const totals=new Map();
  for(const [,data] of selectedAccidentYears())for(const item of data[key]||[]){const name=String(item[0]||'ไม่ระบุ');totals.set(name,(totals.get(name)||0)+(Number(item[valueIndex])||0))}
  return [...totals.entries()].sort((a,b)=>b[1]-a[1]);
}
function updateAccidentDashboard(){
  if(!ACCIDENTS)return;
  setText('incident-events',fmt.format(accidentTotal('events')));
  setText('incident-fatalities',fmt.format(accidentTotal('fatalities')));
  setText('incident-serious',fmt.format(accidentTotal('serious')));
  setText('incident-injuries',fmt.format(accidentTotal('injuries')));
  drawIncidentMonthly();drawIncidentHours();drawIncidentWeekdays();
  drawAccidentBars('incident-province-chart',aggregateAccidentList('provinces',1),'#00a5f5',12);
  drawAccidentBars('incident-cause-chart',aggregateAccidentList('cause'),'#ed9b47',10);
  drawAccidentBars('incident-collision-chart',aggregateAccidentList('collision'),'#bf7fbb',10);
  drawAccidentBars('incident-vehicle-chart',aggregateAccidentList('vehicle'),'#31aa86',10);
  drawAccidentBars('incident-weather-chart',aggregateAccidentList('weather'),'#00a5f5',10);
  drawAccidentBars('incident-roadtype-chart',aggregateAccidentList('road_type'),'#7665bd',6);
  const deathCounts=new Map();for(const row of DATA.records){const year=String(row.dead_year);deathCounts.set(year,(deathCounts.get(year)||0)+1)}
  const body=document.getElementById('incident-year-table');body.replaceChildren();
  for(const [year,data] of Object.entries(ACCIDENTS.years)){
    const row=document.createElement('tr');if(selectedYear===year)row.className='selected-year-row';
    const values=[`พ.ศ. ${Number(year)+543}`,fmt.format(deathCounts.get(year)||0),fmt.format(data.events),fmt.format(data.fatalities),fmt.format(data.serious),fmt.format(data.minor),`${fmt.format(data.coordinates)} (${(data.coordinates/data.events*100).toFixed(1)}%)`];
    for(const value of values){const cell=document.createElement('td');cell.textContent=value;row.append(cell)}body.append(row);
  }
}
function drawIncidentMonthly(){
  const s=resizeCanvas(document.getElementById('incident-month-chart'));if(!s)return;
  const {ctx,w,h}=s,years=selectedAccidentYears(),theme=chartTheme(),colors={2023:'#ffc83d',2024:'#00a5f5',2025:'#31c48d'},pad={l:37,r:12,t:12,b:28},cw=w-pad.l-pad.r,ch=h-pad.t-pad.b;
  ctx.clearRect(0,0,w,h);const max=Math.max(1,...years.flatMap(([,d])=>d.monthly));
  ctx.font='9px "Noto Sans Thai",sans-serif';ctx.textAlign='right';ctx.fillStyle=theme.text;ctx.strokeStyle=theme.grid;
  for(let i=0;i<=4;i++){const y=pad.t+ch*i/4;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();ctx.fillText(fmt.format(Math.round(max*(1-i/4))),pad.l-5,y+3)}
  MONTHS.forEach((month,i)=>{const x=pad.l+cw*i/11;ctx.textAlign='center';ctx.fillStyle=theme.text;ctx.fillText(month,x,h-7)});
  for(const [year,data] of years){ctx.beginPath();ctx.strokeStyle=colors[year]||'#e96654';ctx.lineWidth=2;data.monthly.forEach((value,i)=>{const x=pad.l+cw*i/11,y=pad.t+ch-(value/max)*ch;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();data.monthly.forEach((value,i)=>{const x=pad.l+cw*i/11,y=pad.t+ch-(value/max)*ch;ctx.fillStyle=colors[year]||'#e96654';ctx.beginPath();ctx.arc(x,y,2.5,0,Math.PI*2);ctx.fill()})}
  const legend=document.getElementById('incident-month-legend');legend.replaceChildren();for(const [year] of years){const item=document.createElement('span');item.className='legend-year';item.innerHTML=`<i style="background:${colors[year]||'#e96654'}"></i>พ.ศ. ${Number(year)+543}`;legend.append(item)}
}
function drawIncidentHours(){
  const s=resizeCanvas(document.getElementById('incident-hour-chart'));if(!s)return;
  const {ctx,w,h}=s,theme=chartTheme(),hours=Array(12).fill(0);for(const [,data] of selectedAccidentYears())data.hours.forEach((n,i)=>hours[i]+=Number(n)||0);
  ctx.clearRect(0,0,w,h);const max=Math.max(1,...hours),left=36,right=8,top=9,bottom=28,barW=(w-left-right)/12;
  for(let i=0;i<12;i++){const x=left+i*barW+2,bh=(h-top-bottom)*hours[i]/max,y=h-bottom-bh;ctx.fillStyle=theme.track;roundedRect(ctx,x,top,Math.max(2,barW-4),h-top-bottom,4);ctx.fill();ctx.fillStyle='#ed9b47';roundedRect(ctx,x,y,Math.max(2,barW-4),bh,4);ctx.fill();ctx.fillStyle=theme.text;ctx.font='8px "Noto Sans Thai",sans-serif';ctx.textAlign='center';ctx.fillText(String(i*2).padStart(2,'0'),x+barW/2,h-12)}
}
function drawIncidentWeekdays(){
  const s=resizeCanvas(document.getElementById('incident-weekday-chart'));if(!s)return;
  const {ctx,w,h}=s,days=['จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์','อาทิตย์'],counts=Array(7).fill(0),theme=chartTheme();
  for(const [,data] of selectedAccidentYears())data.weekdays.forEach((n,i)=>counts[i]+=Number(n)||0);
  ctx.clearRect(0,0,w,h);const max=Math.max(1,...counts),left=Math.min(90,w*.3),right=45,top=6,rowH=(h-12)/7,barW=w-left-right;
  ctx.font='9px "Noto Sans Thai",sans-serif';days.forEach((day,i)=>{const y=top+i*rowH,bh=Math.min(17,rowH*.58);ctx.fillStyle=theme.text;ctx.textAlign='right';ctx.fillText(day,left-8,y+rowH*.65);ctx.fillStyle=theme.track;roundedRect(ctx,left,y+(rowH-bh)/2,barW,bh,4);ctx.fill();ctx.fillStyle=i>=5?'#ed9b47':'#00a5f5';roundedRect(ctx,left,y+(rowH-bh)/2,Math.max(2,barW*counts[i]/max),bh,4);ctx.fill();ctx.fillStyle=theme.text;ctx.textAlign='left';ctx.fillText(fmt.format(counts[i]),left+barW+7,y+rowH*.65)});
}
function drawAccidentBars(canvasId,entries,color,limit=10){
  const s=resizeCanvas(document.getElementById(canvasId));if(!s)return;const {ctx,w,h}=s,theme=chartTheme();ctx.clearRect(0,0,w,h);
  const items=entries.filter(([name])=>name!=='ไม่ระบุ').slice(0,limit);if(!items.length){ctx.fillStyle=theme.text;ctx.font='11px sans-serif';ctx.textAlign='center';ctx.fillText('ไม่มีข้อมูล',w/2,h/2);return}
  const left=Math.min(160,w*.46),right=48,rowH=Math.min(25,(h-8)/items.length),max=Math.max(1,items[0][1]),barW=w-left-right;ctx.font='9px "Noto Sans Thai",sans-serif';
  items.forEach(([name,value],i)=>{const y=4+i*rowH,short=name.length>22?name.slice(0,21)+'…':name;ctx.fillStyle=theme.text;ctx.textAlign='right';ctx.fillText(short,left-8,y+rowH*.66);ctx.fillStyle=theme.track;roundedRect(ctx,left,y+rowH*.22,barW,rowH*.52,4);ctx.fill();ctx.fillStyle=color;roundedRect(ctx,left,y+rowH*.22,Math.max(2,barW*value/max),rowH*.52,4);ctx.fill();ctx.fillStyle=theme.text;ctx.textAlign='left';ctx.fillText(fmt.format(value),left+barW+7,y+rowH*.66)});
}

function updateQuality(rows){
  const missingAge=rows.length-countVal(rows,'age'),missingCause=rows.length-countVal(rows,'cause'),coords=rows.filter(r=>isValue(r.latitude)&&isValue(r.longitude)).length;
  const matched=rows.filter(r=>r.road_status==='matched').length,traffic=rows.filter(r=>isValue(r.traffic_aadt)).length;
  const notes=[
    `RTDDI: ${fmt.format(rows.length-countVal(rows,'incident_date'))} ระเบียนไม่มี Date Rec; วิเคราะห์วันเวลาเกิดเหตุจาก TRAMS แยกอีกส่วน · ปฏิทินวันหยุดจับกับ Dead_Date`,
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
  if(showPoints){for(const r of rows){const latlng=[Number(r.latitude),Number(r.longitude)];const point=hasMarkerCluster?L.marker(latlng,{icon:L.divIcon({className:'fatality-marker',html:'',iconSize:[10,10],iconAnchor:[5,5]})}):L.circleMarker(latlng,{radius:3,weight:1,color:'#fff',fillColor:'#e76b59',fillOpacity:.8});point.bindPopup(`<strong>ระเบียน ${escapeHtml(r.id)}</strong><br>วันเสียชีวิต: ${escapeHtml(r.death_date||'ไม่ระบุ')}<br>พาหนะ: ${escapeHtml(r.vehicle||'ไม่ระบุ')}<br>รหัสสาเหตุ: ${escapeHtml(r.cause||'ไม่ระบุ')}<br>ถนน: ${escapeHtml(r.highway_code||'ไม่จับคู่')} · ${escapeHtml(r.road_name||'')}<br>ระยะจากแนวถนน: ${isValue(r.road_distance_m)?`${escapeHtml(r.road_distance_m)} ม.`:'ไม่จับคู่'}<br>พิกัด: ${Number(r.latitude).toFixed(5)}, ${Number(r.longitude).toFixed(5)}`);pointLayer.addLayer(point)}}
  const matched=rows.filter(r=>r.road_status==='matched').length,clusterNote=hasMarkerCluster?'จัดกลุ่มจุดแล้ว':'ไม่พบปลั๊กอินจัดกลุ่ม · แสดงจุดรายรายการ';setText('map-summary',`${fmt.format(rows.length)} จุดมีพิกัดในตัวกรอง · ${fmt.format(matched)} จับคู่แนวถนนได้ภายใน 100 ม. · ${fmt.format(visibleRoads().length)} ช่วงเส้นทางที่แสดง · ${clusterNote}`);document.getElementById('map-empty').hidden=rows.length>0;drawHotspots(rows,roadDeaths);
}

function drawHotspots(rows,counts){const list=document.getElementById('hotspots-list');if(!list)return;const features=new Map(DATA.roads.map(r=>[String(r.id),r]));const ranked=[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);list.innerHTML='';if(!ranked.length){list.textContent='ยังไม่มีพิกัดที่จับคู่กับแนวถนนในตัวกรองนี้';return}for(const [id,count] of ranked){const road=features.get(id);if(!road|| (selectedRoadType!=='all'&&routeType(road.highway_code)!==selectedRoadType))continue;const row=document.createElement('div');row.className='hotspot-row';const title=document.createElement('strong');title.textContent=`ทางหลวง ${road.highway_code||'ไม่ระบุ'} · ${road.road_code||'ไม่ระบุ'}`;const name=document.createElement('span');name.textContent=road.road_name||road.road_class_name||'ไม่ระบุชื่อช่วงทาง';const value=document.createElement('b');value.textContent=`${fmt.format(count)} ราย`;row.append(title,name,value);list.append(row)}if(!list.children.length)list.textContent='ไม่มีช่วงทางในชั้นที่เลือก'}

function csvEscape(v){const x=(v===null||v===undefined)?'':String(v);return '"'+x.replaceAll('"','""')+'"'}
function exportCsv(){const rows=filtered();const cols=['id','dead_year','death_date','incident_date','incident_time','age','sex','vehicle','cause','latitude','longitude','road_status','road_distance_m','highway_code','highway_name','road_code','road_name','km_start','km_end','traffic_aadt','traffic_years','holiday_name','festival'];const csv='\ufeff'+[cols.join(','),...rows.map(r=>cols.map(k=>csvEscape(r[k])).join(','))].join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`road-fatalities-${selectedYear==='all'?'all':Number(selectedYear)+543}.csv`;a.click();URL.revokeObjectURL(url)}
function render(){const rows=filtered();updateKpis(rows);drawTrend(rows);drawWeekday(rows);drawPyramid(rows);drawBars('vehicle-chart',rows,'vehicle','#ff5a0a',8);drawBars('cause-chart',rows,'cause','#06b5bd',8);updateQuality(rows);updateAccidentDashboard();drawMap()}

function setupMap(){if(!window.L){throw new Error('โหลด Leaflet ไม่สำเร็จ กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วเปิดหน้าเว็บใหม่')}leafletMap=L.map('road-map',{preferCanvas:true,scrollWheelZoom:true}).setView([13.736717,100.523186],6);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(leafletMap);roadLayer=L.layerGroup().addTo(leafletMap);hasMarkerCluster=typeof L.markerClusterGroup==='function';pointLayer=hasMarkerCluster?L.markerClusterGroup({chunkedLoading:true,showCoverageOnHover:false,spiderfyOnMaxZoom:true}):L.layerGroup();pointLayer.addTo(leafletMap);document.getElementById('show-roads').addEventListener('change',()=>{if(leafletMap.hasLayer(roadLayer))roadLayer.remove();if(document.getElementById('show-roads').checked)roadLayer.addTo(leafletMap);drawMap()});document.getElementById('show-points').addEventListener('change',()=>{if(leafletMap.hasLayer(pointLayer))pointLayer.remove();if(document.getElementById('show-points').checked)pointLayer.addTo(leafletMap);drawMap()});document.getElementById('road-type-filter').addEventListener('change',e=>{selectedRoadType=e.target.value;drawMap()});document.getElementById('map-reset').addEventListener('click',()=>leafletMap.setView([13.736717,100.523186],6))}

async function boot(){try{setupMap();document.getElementById('year-filter').addEventListener('change',e=>{selectedYear=e.target.value;render()});document.getElementById('export-csv').addEventListener('click',exportCsv);const themeButton=document.getElementById('theme-toggle');themeButton.addEventListener('click',()=>{const dark=document.body.dataset.theme!=='dark';document.body.dataset.theme=dark?'dark':'light';themeButton.textContent=dark?'☀ โหมดสว่าง':'☾ โหมดมืด';localStorage.setItem('road-dashboard-theme',dark?'dark':'light');render();setTimeout(()=>leafletMap.invalidateSize(),50)});const savedTheme=localStorage.getItem('road-dashboard-theme');if(savedTheme)document.body.dataset.theme=savedTheme;themeButton.textContent=document.body.dataset.theme==='dark'?'☀ โหมดสว่าง':'☾ โหมดมืด';window.addEventListener('resize',()=>render());const [deathResponse,accidentResponse]=await Promise.all([fetch('data/dashboard_data.json'),fetch('data/accident_summary.json')]);if(!deathResponse.ok)throw new Error(`โหลดข้อมูลผู้เสียชีวิตไม่สำเร็จ (${deathResponse.status})`);if(!accidentResponse.ok)throw new Error(`โหลดข้อมูลอุบัติเหตุไม่สำเร็จ (${accidentResponse.status})`);[DATA,ACCIDENTS]=await Promise.all([deathResponse.json(),accidentResponse.json()]);document.getElementById('data-note').classList.toggle('note-critical',DATA.meta.incident_dates===0);render()}catch(err){const next=location.protocol==='file:'?'เปิดจาก file:// จะอ่าน JSON ไม่ได้ ให้ปิดหน้านี้แล้วรัน .\\run_dashboard.ps1 จากโฟลเดอร์โปรเจกต์ จากนั้นเข้า http://127.0.0.1:8000':'เปิดด้วย .\\run_dashboard.ps1 หรือ node server.js และเชื่อมต่ออินเทอร์เน็ตสำหรับแผนที่พื้นหลัง';document.getElementById('data-note').innerHTML=`<div class="note-icon">!</div><div><strong>โหลด Dashboard ไม่สำเร็จ</strong><p>${err.message} · ${next}</p></div>`;console.error(err)}}
document.addEventListener('DOMContentLoaded',boot);
