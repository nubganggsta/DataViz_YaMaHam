/* TRAMS matched-road scatter plot. This classic-script module keeps the chart
   independent from the dashboard and uses only real, deduplicated event rows. */
(() => {
  const palette = {
    'ภาคเหนือ': '#003049',
    'ภาคตะวันออกเฉียงเหนือ': '#669BBC',
    'ภาคกลาง': '#C1121F',
    'ภาคตะวันออก': '#FF8C00',
    'ภาคตะวันตก': '#9333ea',
    'ภาคใต้': '#1e40af',
    'ไม่ระบุ': '#6b7280',
    'หลายภาค': '#64748b'
  };
  const numberFormat = new Intl.NumberFormat('th-TH');
  let points = [];
  let currentRoads = [];
  let currentRecords = [];
  let selectedId = null;
  let plot = null;
  let onSelectRoad = null;

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function featureId(value) {
    if (value === null || value === undefined || value === '') return '';
    const ref = String(value).trim();
    return /^\d+(?:\.0+)?$/.test(ref) ? String(Number(ref)) : ref;
  }

  function groupRecords(records, roads = []) {
    const roadsById = new Map((roads || []).map(road => [featureId(road.id), road]));
    const grouped = new Map();
    const eventRoads = new Map();
    for (const row of records || []) {
      if (row.road_status !== 'matched' || !featureId(row.road_feature_id) || row.id == null || row.id === '') continue;
      const eventId=String(row.id);
      if(!eventRoads.has(eventId))eventRoads.set(eventId,new Set());
      eventRoads.get(eventId).add(featureId(row.road_feature_id));
    }
    const seen = new Set();
    for (const row of records || []) {
      if (row.road_status !== 'matched' || !row.road_feature_id) continue;
      const id = featureId(row.road_feature_id);
      if (!id) continue;
      const eventId = String(row.id ?? '');
      if (!eventId || seen.has(eventId) || eventRoads.get(eventId)?.size !== 1) continue;
      seen.add(eventId);
      let group = grouped.get(id);
      if (!group) {
        const road = roadsById.get(id);
        group = {
          id, eventIds: new Set(), provinces: new Set(), regions: new Set(), events: 0, deaths: 0,
          highway: road?.highway_code || row.matched_highway_code || row.highway_code || 'ไม่ระบุ',
          name: road?.road_name || road?.highway_name || row.road_name || 'ไม่ระบุชื่อช่วงทาง',
          section: `${road?.road_code || 'ไม่ระบุรหัสช่วงทาง'} · Geometry ID ${id}`,
          province: road?.province || row.province || 'ไม่ระบุ', region: road?.region || row.region || 'ไม่ระบุ'
        };
        grouped.set(id, group);
      }
      if (!eventId || group.eventIds.has(eventId)) continue;
      group.provinces.add(row.province || 'ไม่ระบุ');
      group.regions.add(row.region || 'ไม่ระบุ');
      group.eventIds.add(eventId);
      group.events += 1;
      group.deaths += Math.max(0, Number(row.fatalities) || 0);
    }
    return [...grouped.values()].map(({ eventIds, provinces, regions, ...group }) => ({...group,
      province:[...provinces].sort().join(' / '),region:regions.size===1?[...regions][0]:'หลายภาค',
      regionDetails:[...regions].sort().join(' / ')}))
      .filter(group => group.events > 0)
      .sort((a, b) => a.id.localeCompare(b.id, undefined, {numeric: true}));
  }

  function legendFor(data) {
    const host = document.getElementById('scatter-legend');
    if (!host) return;
    host.replaceChildren();
    const regions = [...new Set(data.map(point => point.region))].sort((a, b) => a.localeCompare(b, 'th'));
    for (const region of regions) {
      const item = document.createElement('span');
      item.className = 'scatter-legend-item';
      item.innerHTML = `<i style="--scatter-color:${palette[region] || palette['ไม่ระบุ']}"></i>${esc(region)}`;
      host.append(item);
    }
    if (!regions.length) host.textContent = 'ไม่มีช่วงทางที่จับคู่ได้ในตัวกรองนี้';
  }

  function tooltipHtml(point) {
    return `<strong>${String(point.id).startsWith('drr:')?'ทางหลวงชนบท':'ทางหลวง'} ${esc(point.highway)}</strong>` +
      `<div>ชื่อสายทาง: ${esc(point.name)}</div>` +
      `<div>ช่วงทางอ้างอิง: ${esc(point.section)}</div>` +
      `<div>จังหวัด: ${esc(point.province)} · ${esc(point.regionDetails)}</div>` +
      `<div>อุบัติเหตุ: ${numberFormat.format(point.events)} ครั้ง</div>` +
      `<div>ผู้เสียชีวิต: ${numberFormat.format(point.deaths)} ราย</div>`;
  }

  function render(canvas, records, roads, selectRoad) {
    if (!canvas) return;
    onSelectRoad = selectRoad;
    currentRecords = records || [];
    currentRoads = roads || [];
    points = groupRecords(records, roads);
    if (selectedId && !points.some(point => point.id === selectedId)) {
      selectedId = null;
      const selection = document.getElementById('scatter-selection');
      if (selection) selection.replaceChildren();
    }
    legendFor(points);
    const picker=document.getElementById('scatter-segment-picker');
    if(picker){
      picker.replaceChildren();
      const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='เลือก Geometry เพื่อดูรายละเอียด (ใช้ได้เมื่อจุดซ้อนกัน)';picker.append(placeholder);
      for(const point of points){const option=document.createElement('option');option.value=point.id;option.textContent=`${point.highway} · ${point.province} · ID ${point.id} · ${numberFormat.format(point.events)} ครั้ง / ${numberFormat.format(point.deaths)} ราย`;picker.append(option);}
      picker.value=selectedId || '';picker.disabled=!points.length;
    }
    const coverage=document.getElementById('scatter-coverage');
    if(coverage)coverage.textContent=`${numberFormat.format(points.length)} Geometry · ${numberFormat.format(points.reduce((sum,p)=>sum+p.events,0))} เหตุการณ์ไม่ซ้ำที่ใช้ได้ / ${numberFormat.format(new Set(currentRecords.map(r=>r.id)).size)} เหตุการณ์ตามตัวกรอง · ${numberFormat.format(points.reduce((sum,p)=>sum+p.deaths,0))} ผู้เสียชีวิต`;
    const selection=document.getElementById('scatter-selection');
    if(selection && selectedId){const selected=points.find(p=>p.id===selectedId);if(selected)selection.innerHTML=tooltipHtml(selected);}
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = window.devicePixelRatio || 1;
    const width = rect.width, height = rect.height;
    const bitmapW = Math.max(1, Math.round(width * dpr));
    const bitmapH = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== bitmapW || canvas.height !== bitmapH) {
      canvas.width = bitmapW;
      canvas.height = bitmapH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const dark = document.body.dataset.theme === 'dark';
    const text = dark ? '#cbd5e1' : '#385365';
    const grid = dark ? 'rgba(255,255,255,.12)' : 'rgba(0,48,73,.15)';
    if(!points.length){plot=null;ctx.fillStyle=text;ctx.font='13px Prompt,sans-serif';ctx.textAlign='center';ctx.fillText('ไม่มีเหตุการณ์ที่จับคู่ถนนได้ตามตัวกรองนี้',width/2,height/2);return;}
    const pad = {l: 58, r: 22, t: 18, b: 46};
    const plotW = width - pad.l - pad.r, plotH = height - pad.t - pad.b;
    plot = {pad, plotW, plotH, width, height};

    const maxX = Math.max(1, ...points.map(p => p.events));
    const maxY = Math.max(1, ...points.map(p => p.deaths));
    const niceMax = value => Math.max(4, Math.ceil(value / 4) * 4);
    const xMax = niceMax(maxX), yMax = niceMax(maxY);
    plot.xMax = xMax; plot.yMax = yMax;

    ctx.font = '10px Prompt, sans-serif';
    ctx.lineWidth = 1;
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const ratio = i / 4;
      const y = pad.t + plotH * (1 - ratio);
      ctx.strokeStyle = grid;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(width - pad.r, y); ctx.stroke();
      ctx.fillStyle = text; ctx.textAlign = 'right';
      ctx.fillText(numberFormat.format(Math.round(yMax * ratio)), pad.l - 8, y);
      const x = pad.l + plotW * ratio;
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + plotH); ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillText(numberFormat.format(Math.round(xMax * ratio)), x, pad.t + plotH + 13);
    }
    ctx.fillStyle = text; ctx.font = '11px Prompt, sans-serif';
    ctx.textAlign = 'center'; ctx.fillText('จำนวนเหตุการณ์ไม่ซ้ำ (ครั้ง)', pad.l + plotW / 2, height - 8);
    ctx.save(); ctx.translate(13, pad.t + plotH / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText('ผู้เสียชีวิตรวม (ราย)', 0, 0); ctx.restore();

    for (const point of points) {
      point.x = pad.l + (point.events / xMax) * plotW;
      point.y = pad.t + plotH - (point.deaths / yMax) * plotH;
      point.radius = Math.min(8, 3 + Math.sqrt(point.events) * .55);
      ctx.beginPath(); ctx.arc(point.x, point.y, point.radius, 0, Math.PI * 2);
      ctx.fillStyle = palette[point.region] || palette['ไม่ระบุ'];
      ctx.globalAlpha = .76; ctx.fill(); ctx.globalAlpha = 1;
      if (point.id === selectedId) {
        ctx.beginPath(); ctx.arc(point.x, point.y, point.radius + 3, 0, Math.PI * 2);
        ctx.strokeStyle = '#FF8C00'; ctx.lineWidth = 2.5; ctx.stroke();
      }
    }
  }

  function nearestPoint(x, y) {
    if (!plot) return null;
    let best = null, bestDistance = 13 * 13;
    for (const point of points) {
      const dx = x - point.x, dy = y - point.y, distance = dx * dx + dy * dy;
      if (distance <= bestDistance) { best = point; bestDistance = distance; }
    }
    return best;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('highway-scatter-chart');
    const tooltip = document.getElementById('scatter-tooltip');
    const selection = document.getElementById('scatter-selection');
    if (!canvas) return;
    document.getElementById('scatter-segment-picker')?.addEventListener('change',event=>{
      const point=points.find(point=>point.id===event.target.value);if(!point)return;
      selectedId=point.id;render(canvas,currentRecords,currentRoads,onSelectRoad);
      if(typeof onSelectRoad==='function')onSelectRoad(point.id);
    });
    canvas.addEventListener('mousemove', event => {
      const box = canvas.getBoundingClientRect();
      const point = nearestPoint(event.clientX - box.left, event.clientY - box.top);
      canvas.style.cursor = point ? 'pointer' : 'default';
      if (!tooltip || !point) { if (tooltip) tooltip.hidden = true; return; }
      tooltip.innerHTML = tooltipHtml(point);
      tooltip.hidden = false;
      tooltip.style.left = `${Math.max(8,Math.min(box.width - 250, event.clientX - box.left + 12))}px`;
      tooltip.style.top = `${Math.max(8, event.clientY - box.top - 18)}px`;
    });
    canvas.addEventListener('mouseleave', () => { if (tooltip) tooltip.hidden = true; });
    canvas.addEventListener('click', event => {
      const box = canvas.getBoundingClientRect();
      const point = nearestPoint(event.clientX - box.left, event.clientY - box.top);
      if (!point) return;
      selectedId = point.id;
      if (selection) selection.innerHTML = tooltipHtml(point);
      render(canvas, currentRecords, currentRoads, onSelectRoad);
      if (typeof onSelectRoad === 'function') onSelectRoad(point.id);
    });
  });

  window.HighwayScatter = { render, groupRecords };
})();
