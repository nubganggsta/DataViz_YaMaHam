/* Overview components share the dashboard's filtered event rows and time state. */
(() => {
  const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const fmt = new Intl.NumberFormat('th-TH');
  const unique = records => [...new Map(records.map(r => [String(r.id),r])).values()];
  const hits = new Map();
  let selectPeriod = null;
  const charts = [{id:"overview-injury-trend-chart",field:"injuries",label:"ผู้บาดเจ็บ",color:"#D97706"},{id:"overview-death-trend-chart",field:"deaths",label:"ผู้เสียชีวิต",color:"#C1121F"}];

  function buildSeries(records, granularity, filters) {
    const buckets = new Map();
    for (const year of [2023,2024,2025]) {
      if (filters.year !== 'all' && String(year) !== filters.year) continue;
      for (let month=1;month<=12;month++) {
        const quarter = Math.ceil(month/3);
        if (filters.quarter !== 'all' && String(quarter)!==filters.quarter) continue;
        if (filters.month !== 'all' && String(month)!==filters.month) continue;
        const key = granularity==='year' ? `${year}` : granularity==='quarter' ? `${year}-Q${quarter}` : `${year}-${String(month).padStart(2,'0')}`;
        if (!buckets.has(key)) buckets.set(key,{key,year,quarter,month,events:0,deaths:0,injuries:0,
          label:granularity==='year' ? `${year+543}` : granularity==='quarter' ? `Q${quarter}/${year+543}` : `${months[month-1]} ${String(year+543).slice(-2)}`});
      }
    }
    for (const r of unique(records)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.incident_date || '')) continue;
      const year=Number(r.incident_date.slice(0,4)),month=Number(r.incident_date.slice(5,7)),quarter=Math.ceil(month/3);
      const key=granularity==='year' ? `${year}` : granularity==='quarter' ? `${year}-Q${quarter}` : `${year}-${String(month).padStart(2,'0')}`;
      const bucket=buckets.get(key);
      if (bucket) {bucket.events++;bucket.deaths+=Number(r.fatalities)||0;bucket.injuries+=Number(r.injuries)||0;}
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
    selectPeriod=onSelect;
    const granularity=document.getElementById('trend-granularity')?.value || 'month';
    const series=buildSeries(records,granularity,filters);
    for (const chart of charts) drawTrend(chart,series,granularity);
    const status=document.getElementById('overview-period-status');
    if(status)status.textContent=`${filters.year==='all'?'พ.ศ. 2566–2568':`พ.ศ. ${Number(filters.year)+543}`} · ${filters.quarter==='all'?'ทุกไตรมาส':`Q${filters.quarter}`} · ${filters.month==='all'?'ทุกเดือน':months[Number(filters.month)-1]} · ผู้บาดเจ็บรวมสาหัสและเล็กน้อย · หน่วยราย · แต่ละกราฟปรับสเกลตามข้อมูล`;
  }

  function drawTrend(chart,series,granularity) {
    hits.set(chart.id,[]);
    const canvas=document.getElementById(chart.id);if(!canvas)return;
    const box=canvas.getBoundingClientRect();if(!box.width || !box.height)return;
    const ctx=canvas.getContext('2d'),dpr=window.devicePixelRatio||1,w=box.width,h=box.height;
    canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
    const dark=document.body.dataset.theme==='dark',text=dark?'#cbd5e1':'#334155',grid=dark?'#334155':'#e2e8f0';
    const pad={l:64,r:24,t:28,b:48},pw=w-pad.l-pad.r,ph=h-pad.t-pad.b;
    const maximum=Math.max(4,...series.map(p=>p[chart.field]));
    const max=Math.ceil(maximum/4)*4;
    const x=i=>series.length===1?pad.l+pw/2:pad.l+pw*i/Math.max(1,series.length-1);
    ctx.font='11px Prompt,sans-serif';ctx.textBaseline='middle';
    for(let i=0;i<=4;i++){
      const y=pad.t+ph*(1-i/4);ctx.strokeStyle=grid;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();
      ctx.fillStyle=text;ctx.textAlign='right';ctx.fillText(fmt.format(max*i/4),pad.l-8,y);
    }
    ctx.fillStyle=chart.color;ctx.textAlign='left';ctx.fillText(`${chart.label} (ราย)`,pad.l,12);
    const stride=Math.max(1,Math.ceil(series.length/Math.max(2,Math.floor(pw/82))));
    series.forEach((p,i)=>{if(i%stride===0 || i===series.length-1){ctx.fillStyle=text;ctx.textAlign='center';ctx.fillText(p.label,x(i),h-22);}});
    ctx.beginPath();ctx.strokeStyle=chart.color;ctx.lineWidth=2.5;
    series.forEach((p,i)=>{const y=pad.t+ph*(1-p[chart.field]/max);if(i===0)ctx.moveTo(x(i),y);else ctx.lineTo(x(i),y);});ctx.stroke();
    series.forEach((p,i)=>{ctx.beginPath();ctx.arc(x(i),pad.t+ph*(1-p[chart.field]/max),4,0,Math.PI*2);ctx.fillStyle=chart.color;ctx.fill();});
    hits.set(chart.id,series.map((p,i)=>({...p,x:x(i),top:pad.t,bottom:pad.t+ph,granularity})));
    canvas.setAttribute('aria-label',`แนวโน้ม${chart.label} ${series.length} ช่วงเวลา รวม ${fmt.format(series.reduce((sum,p)=>sum+p[chart.field],0))} ราย ตามตัวกรองปัจจุบัน`);
    if(!series.some(p=>p.events)){ctx.fillStyle=text;ctx.textAlign='center';ctx.fillText('ไม่มีข้อมูลตรงกับตัวกรอง',pad.l+pw/2,pad.t+ph/2);}
  }

  function bind() {
    for(const chart of charts) {
      const canvas=document.getElementById(chart.id),tooltip=document.getElementById(`${chart.id}-tooltip`);
      if(!canvas)continue;
      const find=event=>{
        const box=canvas.getBoundingClientRect(),x=event.clientX-box.left,y=event.clientY-box.top;
        const p=(hits.get(chart.id)||[]).reduce((best,p)=>!best||Math.abs(p.x-x)<Math.abs(best.x-x)?p:best,null);
        return p && y>=p.top && y<=p.bottom && Math.abs(p.x-x)<=24 ? p : null;
      };
      canvas.addEventListener('mousemove',event=>{const p=find(event);canvas.style.cursor=p?'pointer':'default';if(!tooltip)return;tooltip.hidden=!p;if(!p)return;tooltip.textContent=`${p.label}: ${chart.label} ${fmt.format(p[chart.field])} ราย — คลิกเพื่อกรองช่วงเวลานี้`;tooltip.style.left=`${Math.max(8,Math.min(canvas.clientWidth-240,p.x+10))}px`;tooltip.style.top='32px';});
      canvas.addEventListener('mouseleave',()=>{if(tooltip)tooltip.hidden=true;});
      canvas.addEventListener('click',event=>{const p=find(event);if(!p || !selectPeriod)return;if(tooltip)tooltip.hidden=true;selectPeriod({year:String(p.year),quarter:p.granularity==='year'?'all':String(p.quarter),month:p.granularity==='month'?String(p.month):'all'});});
    }
  }
  window.OverviewAnalytics={buildSeries,renderTable,render,bind};
})();
