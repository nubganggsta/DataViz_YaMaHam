/* Overview components share the dashboard's filtered event rows and time state. */
(() => {
  const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const fmt = new Intl.NumberFormat('th-TH');
  const unique = records => [...new Map(records.map(r => [String(r.id),r])).values()];
  let hits = [], selectPeriod = null;

  function buildSeries(records, granularity, filters) {
    const buckets = new Map();
    for (const year of [2023,2024,2025]) {
      if (filters.year !== 'all' && String(year) !== filters.year) continue;
      for (let month=1;month<=12;month++) {
        const quarter = Math.ceil(month/3);
        if (filters.quarter !== 'all' && String(quarter)!==filters.quarter) continue;
        if (filters.month !== 'all' && String(month)!==filters.month) continue;
        const key = granularity==='year' ? `${year}` : granularity==='quarter' ? `${year}-Q${quarter}` : `${year}-${String(month).padStart(2,'0')}`;
        if (!buckets.has(key)) buckets.set(key,{key,year,quarter,month,events:0,deaths:0,
          label:granularity==='year' ? `${year+543}` : granularity==='quarter' ? `Q${quarter}/${year+543}` : `${months[month-1]} ${String(year+543).slice(-2)}`});
      }
    }
    for (const r of unique(records)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.incident_date || '')) continue;
      const year=Number(r.incident_date.slice(0,4)),month=Number(r.incident_date.slice(5,7)),quarter=Math.ceil(month/3);
      const key=granularity==='year' ? `${year}` : granularity==='quarter' ? `${year}-Q${quarter}` : `${year}-${String(month).padStart(2,'0')}`;
      const bucket=buckets.get(key);
      if (bucket) {bucket.events++;bucket.deaths+=Number(r.fatalities)||0;}
    }
    return [...buckets.values()];
  }

  function renderTable(records) {
    const host=document.getElementById('incident-year-table');if(!host)return;
    const grouped=new Map();
    for(const r of unique(records)) {
      const year=String(r.year || 'ไม่ระบุ');
      if(!grouped.has(year))grouped.set(year,{events:0,deaths:0,severe:0,minor:0,injuries:0,vehicles:0,coordinates:0});
      const t=grouped.get(year);t.events++;t.deaths+=Number(r.fatalities)||0;t.severe+=Number(r.injuries_severe)||0;
      t.minor+=Number(r.injuries_minor)||0;t.injuries+=Number(r.injuries)||0;
      if(r.vehicle && r.vehicle!=='ไม่ระบุ')t.vehicles++;
      if(r.latitude!=null && r.longitude!=null)t.coordinates++;
    }
    host.replaceChildren();
    for(const [year,t] of [...grouped.entries()].sort(([a],[b])=>a.localeCompare(b))) {
      const tr=document.createElement('tr');
      const values=[year==='ไม่ระบุ'?year:`พ.ศ. ${Number(year)+543}`,fmt.format(t.events),fmt.format(t.deaths),fmt.format(t.severe),fmt.format(t.minor),fmt.format(t.injuries),fmt.format(t.vehicles),`${fmt.format(t.coordinates)} (${(100*t.coordinates/t.events).toFixed(1)}%)`];
      values.forEach(value=>{const td=document.createElement('td');td.textContent=value;tr.append(td);});host.append(tr);
    }
    if(!grouped.size){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=8;td.textContent='ไม่มีข้อมูลตรงกับตัวกรอง';tr.append(td);host.append(tr);}
  }

  function render(records, filters, onSelect) {
    renderTable(records);
    const canvas=document.getElementById('overview-trend-chart');if(!canvas)return;
    selectPeriod=onSelect;
    const granularity=document.getElementById('trend-granularity')?.value || 'month';
    const series=buildSeries(records,granularity,filters);
    const box=canvas.getBoundingClientRect();if(!box.width || !box.height)return;
    const ctx=canvas.getContext('2d'),dpr=window.devicePixelRatio||1,w=box.width,h=box.height;
    canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
    const dark=document.body.dataset.theme==='dark',text=dark?'#cbd5e1':'#334155',grid=dark?'#334155':'#e2e8f0';
    const pad={l:64,r:64,t:28,b:48},pw=w-pad.l-pad.r,ph=h-pad.t-pad.b;
    const maxE=Math.max(1,...series.map(p=>p.events)),maxD=Math.max(1,...series.map(p=>p.deaths));
    const x=i=>series.length===1?pad.l+pw/2:pad.l+pw*i/Math.max(1,series.length-1);
    ctx.font='11px Prompt,sans-serif';ctx.textBaseline='middle';
    for(let i=0;i<=4;i++){
      const y=pad.t+ph*(1-i/4);ctx.strokeStyle=grid;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();
      ctx.fillStyle=text;ctx.textAlign='right';ctx.fillText(fmt.format(Math.round(maxE*i/4)),pad.l-8,y);
      ctx.textAlign='left';ctx.fillText(fmt.format(Math.round(maxD*i/4)),w-pad.r+8,y);
    }
    ctx.fillStyle='#C1121F';ctx.textAlign='left';ctx.fillText('อุบัติเหตุ (ครั้ง)',pad.l,12);
    ctx.fillStyle='#D97706';ctx.textAlign='right';ctx.fillText('ผู้เสียชีวิต (ราย)',w-pad.r,12);
    const stride=Math.max(1,Math.ceil(series.length/Math.max(2,Math.floor(pw/82))));
    series.forEach((p,i)=>{if(i%stride===0 || i===series.length-1){ctx.fillStyle=text;ctx.textAlign='center';ctx.fillText(p.label,x(i),h-22);}});
    for(const [field,max,color] of [['events',maxE,'#C1121F'],['deaths',maxD,'#D97706']]){
      ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=2.5;
      series.forEach((p,i)=>{const y=pad.t+ph*(1-p[field]/max);if(i===0)ctx.moveTo(x(i),y);else ctx.lineTo(x(i),y);});ctx.stroke();
      series.forEach((p,i)=>{ctx.beginPath();ctx.arc(x(i),pad.t+ph*(1-p[field]/max),4,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();});
    }
    hits=series.map((p,i)=>({...p,x:x(i),top:pad.t,bottom:pad.t+ph,granularity}));
    canvas.setAttribute('aria-label',`แนวโน้มอุบัติเหตุและผู้เสียชีวิต ${series.length} ช่วงเวลา ตามตัวกรองปัจจุบัน`);
    const status=document.getElementById('overview-period-status');
    if(status)status.textContent=`${filters.year==='all'?'พ.ศ. 2566–2568':`พ.ศ. ${Number(filters.year)+543}`} · ${filters.quarter==='all'?'ทุกไตรมาส':`Q${filters.quarter}`} · ${filters.month==='all'?'ทุกเดือน':months[Number(filters.month)-1]} · ${fmt.format(unique(records).length)} เหตุการณ์ · กราฟใช้แกนซ้าย/ขวาคนละสเกล`;
  }

  function bind() {
    const canvas=document.getElementById('overview-trend-chart'),tooltip=document.getElementById('overview-trend-tooltip');
    if(!canvas)return;
    const find=event=>{
      const box=canvas.getBoundingClientRect(),x=event.clientX-box.left,y=event.clientY-box.top;
      const p=hits.reduce((best,p)=>!best||Math.abs(p.x-x)<Math.abs(best.x-x)?p:best,null);
      return p && y>=p.top && y<=p.bottom && Math.abs(p.x-x)<=24 ? p : null;
    };
    canvas.addEventListener('mousemove',event=>{const p=find(event);canvas.style.cursor=p?'pointer':'default';if(!tooltip)return;tooltip.hidden=!p;if(!p)return;tooltip.textContent=`${p.label}: ${fmt.format(p.events)} ครั้ง · ผู้เสียชีวิต ${fmt.format(p.deaths)} ราย — คลิกเพื่อกรองช่วงเวลานี้`;tooltip.style.left=`${Math.max(8,Math.min(canvas.clientWidth-240,p.x+10))}px`;tooltip.style.top='32px';});
    canvas.addEventListener('mouseleave',()=>{if(tooltip)tooltip.hidden=true;});
    canvas.addEventListener('click',event=>{const p=find(event);if(!p || !selectPeriod)return;if(tooltip)tooltip.hidden=true;selectPeriod({year:String(p.year),quarter:p.granularity==='year'?'all':String(p.quarter),month:p.granularity==='month'?String(p.month):'all'});});
  }
  window.OverviewAnalytics={buildSeries,renderTable,render,bind};
})();
