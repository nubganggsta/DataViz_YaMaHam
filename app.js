/* Thailand Road Safety Intelligence Dashboard · Plain JavaScript, Canvas & Leaflet */
const fmt = new Intl.NumberFormat('th-TH');
const MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const MONTHS_FULL = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const AGE_BANDS = ['0–14','15–19','20–24','25–29','30–34','35–39','40–44','45–49','50–54','55–59','60–64','65+'];
const SEX_M = 'ชาย', SEX_F = 'หญิง';

/* Human-readable ICD-10 Death Certificate Mapping */
const ICD10_DICT = {
  'V892': { code: 'V89.2', label: 'V892 ยานยนต์ไม่ระบุประเภท', desc: 'อุบัติเหตุยานยนต์ไม่ระบุประเภท (ลงในมรณบัตรเมื่อไม่ได้ระบุรถคู่กรณี)', group: 'ยานยนต์ทั่วไป' },
  'Y349': { code: 'Y34.9', label: 'Y349 เหตุการณ์ไม่ระบุเจตนา', desc: 'เหตุการณ์ที่ไม่สามารถระบุเจตนาแน่ชัดในมรณบัตร', group: 'ไม่ระบุเจตนา' },
  'V299': { code: 'V29.9', label: 'V299 จยย. ประสบอุบัติเหตุ', desc: 'ผู้ขับขี่/ซ้อนท้ายรถจักรยานยนต์ ประสบอุบัติเหตุจราจรทั่วไป', group: 'จักรยานยนต์' },
  'X599': { code: 'X59.9', label: 'X599 อุบัติเหตุไม่ระบุปัจจัย', desc: 'การสัมผัสปัจจัยอุบัติเหตุไม่ระบุรายละเอียด', group: 'อุบัติเหตุทั่วไป' },
  'V234': { code: 'V23.4', label: 'V234 จยย. ชนรถยนต์/กระบะ', desc: 'ผู้ขับขี่ จยย. ชนกับรถยนต์นั่ง/กระบะ/รถตู้', group: 'จักรยานยนต์' },
  'V284': { code: 'V28.4', label: 'V284 จยย. ล้มเอง/ตกถนน', desc: 'ผู้ขับขี่ จยย. เสียหลักล้มเอง/พลิกคว่ำ (ไม่ชนคันอื่น)', group: 'จักรยานยนต์' },
  'V499': { code: 'V49.9', label: 'V499 ในรถยนต์นั่ง (ทั่วไป)', desc: 'ผู้ประสบเหตุในรถยนต์นั่ง ในอุบัติเหตุจราจร', group: 'รถยนต์' },
  'V099': { code: 'V09.9', label: 'V099 คนเดินเท้าประสบอุบัติเหตุ', desc: 'คนเดินเท้าประสบอุบัติเหตุจราจร (ทั่วไป)', group: 'คนเดินเท้า' },
  'V289': { code: 'V28.9', label: 'V289 จยย. ล้มเอง (ไม่ระบุคน)', desc: 'จยย. ล้มเอง/ตกถนน ไม่ระบุว่าเป็นคนขับหรือคนซ้อน', group: 'จักรยานยนต์' },
  'V239': { code: 'V23.9', label: 'V239 จยย. ชนรถยนต์/กระบะ', desc: 'จยย. ชนรถยนต์/กระบะ ไม่ระบุคนขับหรือคนซ้อน', group: 'จักรยานยนต์' },
  'V224': { code: 'V22.4', label: 'V224 จยย. ชน จยย./สามล้อ', desc: 'ผู้ขับขี่ จยย. ชนกับจักรยานยนต์ด้วยกันหรือรถสามล้อ', group: 'จักรยานยนต์' },
  'V274': { code: 'V27.4', label: 'V274 จยย. ชนเสาไฟ/ต้นไม้', desc: 'ผู้ขับขี่ จยย. ชนเสาไฟ ต้นไม้ หรือสิ่งกีดขวางข้างทาง', group: 'จักรยานยนต์' },
  'V294': { code: 'V29.4', label: 'V294 จยย. ชนยานพาหนะอื่น', desc: 'ผู้ขับขี่ จยย. ชนกับยานพาหนะอื่นในการจราจร', group: 'จักรยานยนต์' },
  'V244': { code: 'V24.4', label: 'V244 จยย. ชนรถบรรทุก/บัส', desc: 'ผู้ขับขี่ จยย. ชนกับรถบรรทุกหนักหรือรถโดยสาร', group: 'จักรยานยนต์' },
  'V031': { code: 'V03.1', label: 'V031 คนเดินเท้าถูกรถชน', desc: 'คนเดินเท้าถูกรถยนต์นั่ง/กระบะ/ตู้ชนบนทางหลวง', group: 'คนเดินเท้า' },
  'V039': { code: 'V03.9', label: 'V039 คนเดินเท้าถูกรถชน', desc: 'คนเดินเท้าถูกรถยนต์/กระบะชน (ทั่วไป)', group: 'คนเดินเท้า' },
  'V279': { code: 'V27.9', label: 'V279 จยย. ชนสิ่งกีดขวาง', desc: 'จยย. ชนสิ่งกีดขวาง ไม่ระบุคนขับหรือคนซ้อน', group: 'จักรยานยนต์' },
  'V249': { code: 'V24.9', label: 'V249 จยย. ชนรถบรรทุก', desc: 'จยย. ชนรถบรรทุกหนัก/บัส ไม่ระบุคนขับหรือคนซ้อน', group: 'จักรยานยนต์' },
  'V235': { code: 'V23.5', label: 'V235 คนซ้อน จยย. ชนรถยนต์', desc: 'คนซ้อนท้าย จยย. ชนกับรถยนต์นั่ง/กระบะ/ตู้', group: 'จักรยานยนต์' },
  'V429': { code: 'V42.9', label: 'V429 รถยนต์ชน 2-3 ล้อ', desc: 'รถยนต์นั่งประสบเหตุชนกับรถ 2 หรือ 3 ล้อ', group: 'รถยนต์' },
  'V229': { code: 'V22.9', label: 'V229 จยย. ชนกับ จยย.', desc: 'จยย. ชนกับ จยย. ด้วยกัน ไม่ระบุคนขับหรือคนซ้อน', group: 'จักรยานยนต์' },
  'V489': { code: 'V48.9', label: 'V489 รถยนต์พลิกคว่ำเอง', desc: 'รถยนต์นั่งตกถนน/พลิกคว่ำเอง (ไม่ชนคันอื่น)', group: 'รถยนต์' },
  'V029': { code: 'V02.9', label: 'V029 คนเดินเท้าถูก จยย.ชน', desc: 'คนเดินเท้าถูกรถ 2 หรือ 3 ล้อชน', group: 'คนเดินเท้า' },
  'V479': { code: 'V47.9', label: 'V479 รถยนต์ชนสิ่งกีดขวาง', desc: 'รถยนต์นั่งชนเสาไฟ ต้นไม้ หรือสิ่งกีดขวาง', group: 'รถยนต์' },
  'V021': { code: 'V02.1', label: 'V021 คนเดินเท้าถูก จยย.ชน', desc: 'คนเดินเท้าถูก จยย. ชนขณะเดินหรือข้ามถนน', group: 'คนเดินเท้า' },
  'V285': { code: 'V28.5', label: 'V285 คนซ้อน จยย. ล้มเอง', desc: 'คนซ้อนท้าย จยย. ประสบเหตุล้มเอง/เสียหลัก', group: 'จักรยานยนต์' },
  'V475': { code: 'V47.5', label: 'V475 ในรถยนต์ชนเสา/ต้นไม้', desc: 'ผู้โดยสารในรถยนต์นั่งชนสิ่งกีดขวาง/เสาไฟ', group: 'รถยนต์' },
  'V091': { code: 'V09.1', label: 'V091 คนเดินเท้าถูกชน', desc: 'คนเดินเท้าประสบอุบัติเหตุทางถนน', group: 'คนเดินเท้า' },
  'V849': { code: 'V84.9', label: 'V849 รถเกษตร/รถพิเศษ', desc: 'อุบัติเหตุยานพาหนะพิเศษหรือรถเพื่อการเกษตร', group: 'ยานพาหนะพิเศษ' },
  'V204': { code: 'V20.4', label: 'V204 จยย. ชนคน/สัตว์', desc: 'ผู้ขับขี่ จยย. ชนคนเดินเท้าหรือสัตว์บนถนน', group: 'จักรยานยนต์' }
};

let DATA = null, ACCIDENTS = null;
let selectedYear = 'all', selectedRoadType = 'all';
let leafletMap = null, currentTileLayer = null, roadLayer = null, pointLayer = null, hasMarkerCluster = false;

/* Helper Utilities */
function isValue(v) { return v !== null && v !== undefined && v !== '' && String(v).toLowerCase() !== 'nan'; }
function filtered() { return (DATA?.records || []).filter(r => selectedYear === 'all' || String(r.dead_year) === selectedYear); }
function countVal(rows, key) { return rows.reduce((n, r) => n + (isValue(r[key]) ? 1 : 0), 0); }
function groupCounts(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const v = isValue(r[key]) ? String(r[key]) : 'ไม่ระบุ';
    m.set(v, (m.get(v) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
function setText(id, value) { const e = document.getElementById(id); if (e) e.textContent = value; }

function hexToRgba(hex, alpha) {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const num = parseInt(c, 16);
  return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
}

function chartTheme() {
  const dark = document.body.dataset.theme === 'dark';
  return dark ? {
    grid: 'rgba(255, 255, 255, 0.08)',
    text: '#94a3b8',
    textMuted: '#64748b',
    track: 'rgba(255, 255, 255, 0.05)',
    font: '"Plus Jakarta Sans", "Prompt", sans-serif',
    accent1: '#38bdf8',
    accent2: '#fb7185',
    accent3: '#34d399',
    accentWarn: '#fbbf24'
  } : {
    grid: '#e2e8f0',
    text: '#475569',
    textMuted: '#94a3b8',
    track: '#f1f5f9',
    font: '"Plus Jakarta Sans", "Prompt", sans-serif',
    accent1: '#0284c7',
    accent2: '#f43f5e',
    accent3: '#10b981',
    accentWarn: '#f59e0b'
  };
}

function updateHeroCounter(rows) {
  const yearLabel = selectedYear === 'all' ? '2566–2568' : String(Number(selectedYear) + 543);
  setText('hero-counter-label', `ผู้เสียชีวิตสะสมในชุดข้อมูล ปี ${yearLabel}`);
  const number = document.getElementById('hero-counter-number');
  if (!number) return;
  number.replaceChildren();
  for (const char of new Intl.NumberFormat('en-US').format(rows.length)) {
    const item = document.createElement('span');
    item.className = char === ',' ? 'hero-separator' : 'hero-digit';
    item.textContent = char;
    number.append(item);
  }
  number.setAttribute('aria-label', `${fmt.format(rows.length)} ราย`);
}

function resizeCanvas(canvas) {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (!rect.width || !rect.height) return null;
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: rect.width, h: rect.height, dpr };
}

function roundedRect(ctx, x, y, w, h, r) {
  if (w <= 0 || h <= 0) return;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  } else {
    ctx.rect(x, y, w, h);
  }
}

/* Overview KPIs */
function updateKpis(rows) {
  updateHeroCounter(rows);
  const coords = rows.filter(r => isValue(r.latitude) && isValue(r.longitude)).length;
  const matched = rows.filter(r => r.road_status === 'matched').length;
  const inc = countVal(rows, 'incident_date');
  
  setText('kpi-deaths', fmt.format(rows.length));
  setText('kpi-coords', fmt.format(coords));
  setText('kpi-coords-sub', `${rows.length ? ((coords / rows.length) * 100).toFixed(1) : '0.0'}% ของรายการที่เลือก`);
  setText('kpi-road-match', fmt.format(matched));
  setText('kpi-incident', fmt.format(inc));
  
  const coverage = DATA?.meta?.records ? (DATA.meta.incident_dates / DATA.meta.records * 100) : 0;
  setText('incident-coverage', `${coverage.toFixed(1)}% มี Date Rec`);
  setText('holiday-matches', `${fmt.format(countVal(rows, 'holiday_name'))} ระเบียน · Dead_Date ตรงกับวันหยุดราชการ`);
  setText('map-match-label', `${fmt.format(matched)} จับคู่ได้`);
  
  const traffic = rows.filter(r => isValue(r.traffic_aadt)).length;
  setText('traffic-linked', fmt.format(traffic));
}

/* Chart 1: Weekday Fatalities */
function drawWeekday(rows) {
  const canvas = document.getElementById('weekday-chart');
  const s = resizeCanvas(canvas);
  if (!s) return;
  const { ctx, w, h } = s, theme = chartTheme();
  ctx.clearRect(0, 0, w, h);
  
  const days = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
  const counts = Array(7).fill(0);
  for (const r of rows) {
    if (!r.death_date) continue;
    const date = new Date(`${r.death_date}T00:00:00Z`);
    if (Number.isNaN(+date)) continue;
    counts[(date.getUTCDay() + 6) % 7]++;
  }
  
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  const max = Math.max(1, ...counts);
  const left = Math.min(84, w * 0.24);
  const right = 48;
  const top = 10;
  const rowH = (h - 20) / 7;
  const barW = Math.max(10, w - left - right);
  
  ctx.font = `600 11px ${theme.font}`;
  days.forEach((day, i) => {
    const y = top + i * rowH;
    const barH = Math.min(18, rowH * 0.55);
    const val = counts[i];
    const pct = ((val / total) * 100).toFixed(1);
    const isWeekend = i === 5 || i === 6;
    
    // Day Label
    ctx.fillStyle = isWeekend ? (document.body.dataset.theme === 'dark' ? '#fda4af' : '#e11d48') : theme.text;
    ctx.textAlign = 'right';
    ctx.fillText(day, left - 10, y + rowH * 0.62);
    
    // Background Track
    ctx.fillStyle = theme.track;
    roundedRect(ctx, left, y + (rowH - barH) / 2, barW, barH, 5);
    ctx.fill();
    
    // Active Bar with Gradient
    const fillW = Math.max(3, barW * val / max);
    const grad = ctx.createLinearGradient(left, 0, left + fillW, 0);
    if (isWeekend) {
      grad.addColorStop(0, '#f43f5e');
      grad.addColorStop(1, '#fb7185');
    } else {
      grad.addColorStop(0, theme.accent1);
      grad.addColorStop(1, '#38bdf8');
    }
    ctx.fillStyle = grad;
    roundedRect(ctx, left, y + (rowH - barH) / 2, fillW, barH, 5);
    ctx.fill();
    
    // Value Label
    ctx.fillStyle = theme.text;
    ctx.textAlign = 'left';
    ctx.font = `700 10px ${theme.font}`;
    ctx.fillText(fmt.format(val), left + fillW + 6, y + rowH * 0.62);
  });
  
  // Tooltip handler
  canvas._chartTooltipHandler = (mx, my) => {
    if (my < top || my > h - 10) return null;
    const idx = Math.floor((my - top) / rowH);
    if (idx < 0 || idx >= 7) return null;
    const val = counts[idx];
    const pct = ((val / total) * 100).toFixed(1);
    return {
      html: `<strong>วัน${days[idx]}</strong>
        <div class="tt-item"><span>จำนวนผู้เสียชีวิต:</span> <span class="tt-val">${fmt.format(val)} ราย</span></div>
        <div class="tt-item"><span>สัดส่วนในสัปดาห์:</span> <span class="tt-val">${pct}%</span></div>`
    };
  };
}

/* Chart 2: Monthly Trend (RTDDI) */
function drawTrend(rows) {
  const canvas = document.getElementById('trend-chart');
  const s = resizeCanvas(canvas);
  if (!s) return;
  const { ctx, w, h } = s;
  ctx.clearRect(0, 0, w, h);
  
  const pad = { l: 48, r: 16, t: 16, b: 32 };
  const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
  const years = ['2023', '2024', '2025'];
  const colors = {
    '2023': '#f59e0b',
    '2024': '#0284c7',
    '2025': '#10b981'
  };
  
  const values = Object.fromEntries(years.map(y => [y, Array(12).fill(0)]));
  for (const r of rows) {
    if (!r.death_date) continue;
    const d = new Date(`${r.death_date}T00:00:00Z`);
    if (Number.isNaN(+d)) continue;
    const y = String(d.getUTCFullYear());
    if (values[y]) values[y][d.getUTCMonth()]++;
  }
  
  const max = Math.max(1, ...years.flatMap(y => values[y]));
  const theme = chartTheme();
  
  // Grid Lines & Y-axis labels
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  ctx.fillStyle = theme.textMuted;
  ctx.font = `500 10px ${theme.font}`;
  ctx.textAlign = 'right';
  
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + ch * i / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(w - pad.r, y);
    ctx.stroke();
    ctx.fillText(fmt.format(Math.round(max * (1 - i / 4))), pad.l - 8, y + 3);
  }
  
  // Month X-axis labels
  MONTHS.forEach((m, i) => {
    ctx.textAlign = 'center';
    ctx.fillStyle = theme.text;
    ctx.font = `600 10px ${theme.font}`;
    ctx.fillText(m, pad.l + cw * i / 11, h - 10);
  });
  
  // Plot each year
  years.forEach(yr => {
    if (selectedYear !== 'all' && selectedYear !== yr) return;
    const color = colors[yr];
    const valArr = values[yr];
    
    // Subtle Area Fill under curve
    ctx.beginPath();
    valArr.forEach((v, i) => {
      const x = pad.l + cw * i / 11;
      const y = pad.t + ch - (v / max) * ch;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(pad.l + cw, pad.t + ch);
    ctx.lineTo(pad.l, pad.t + ch);
    ctx.closePath();
    
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ch);
    grad.addColorStop(0, hexToRgba(color, 0.25));
    grad.addColorStop(1, hexToRgba(color, 0.01));
    ctx.fillStyle = grad;
    ctx.fill();
    
    // Line Stroke
    ctx.beginPath();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = color;
    ctx.lineJoin = 'round';
    valArr.forEach((v, i) => {
      const x = pad.l + cw * i / 11;
      const y = pad.t + ch - (v / max) * ch;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    
    // Data Point Dots
    valArr.forEach((v, i) => {
      const x = pad.l + cw * i / 11;
      const y = pad.t + ch - (v / max) * ch;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  });
  
  // Update Legend
  const lg = document.getElementById('trend-legend');
  if (lg) {
    lg.innerHTML = '';
    years.forEach(yr => {
      if (selectedYear !== 'all' && selectedYear !== yr) return;
      const item = document.createElement('span');
      item.className = 'legend-year';
      item.innerHTML = `<i style="background:${colors[yr]}"></i>พ.ศ. ${Number(yr) + 543}`;
      lg.appendChild(item);
    });
  }
  
  // Tooltip handler
  canvas._chartTooltipHandler = (mx, my) => {
    if (mx < pad.l - 10 || mx > w - pad.r + 10) return null;
    const mIdx = Math.min(11, Math.max(0, Math.round(((mx - pad.l) / cw) * 11)));
    let lines = `<strong>เดือน${MONTHS_FULL[mIdx]}</strong>`;
    years.forEach(yr => {
      if (selectedYear !== 'all' && selectedYear !== yr) return;
      const c = colors[yr];
      const count = values[yr][mIdx];
      lines += `<div class="tt-item"><span style="color:${c}">● พ.ศ. ${Number(yr) + 543}:</span> <span class="tt-val">${fmt.format(count)} ราย</span></div>`;
    });
    return { html: lines };
  };
}

/* Chart 3: Demographics Pyramid (Age x Sex) */
function drawPyramid(rows) {
  const canvas = document.getElementById('pyramid-chart');
  const s = resizeCanvas(canvas);
  if (!s) return;
  const { ctx, w, h } = s;
  ctx.clearRect(0, 0, w, h);
  
  const bands = [
    ['0–14', 0, 15],
    ['15–18', 15, 19],
    ['19–24', 19, 25],
    ['25–35', 25, 36],
    ['36–60', 36, 61],
    ['60+', 61, Infinity]
  ];
  const m = Array(6).fill(0), f = Array(6).fill(0);
  
  for (const r of rows) {
    const age = Number(r.age);
    if (!Number.isFinite(age) || age < 0) continue;
    const i = bands.findIndex(b => age >= b[1] && age < b[2]);
    if (i < 0) continue;
    if (r.sex === SEX_M) m[i]++;
    else if (r.sex === SEX_F) f[i]++;
  }
  
  const max = Math.max(1, ...m, ...f);
  const mid = w * 0.5;
  const top = 8;
  const rowH = (h - 16) / 6;
  const gap = Math.min(48, w * 0.16);
  const half = Math.max(20, Math.min(w * 0.28, 140, mid - gap - 38));
  const theme = chartTheme();
  
  // Center Division Line
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(mid, top);
  ctx.lineTo(mid, h - top);
  ctx.stroke();
  
  bands.forEach((band, i) => {
    const y = top + i * rowH;
    const barH = Math.min(18, rowH * 0.52);
    const center = y + rowH * 0.5;
    const mw = (m[i] / max) * half;
    const fw = (f[i] / max) * half;
    
    // Male Bar (Left)
    ctx.fillStyle = theme.accent1;
    roundedRect(ctx, mid - gap - mw, center - barH / 2, mw, barH, 4);
    ctx.fill();
    
    // Female Bar (Right)
    ctx.fillStyle = theme.accent2;
    roundedRect(ctx, mid + gap, center - barH / 2, fw, barH, 4);
    ctx.fill();
    
    // Center Age Label
    ctx.fillStyle = theme.text;
    ctx.textAlign = 'center';
    ctx.font = `700 11px ${theme.font}`;
    ctx.fillText(band[0], mid, center + 4);
    
    // Male Count
    ctx.font = `600 10px ${theme.font}`;
    ctx.fillStyle = theme.accent1;
    ctx.textAlign = 'right';
    ctx.fillText(fmt.format(m[i]), mid - gap - mw - 6, center + 3.5);
    
    // Female Count
    ctx.fillStyle = theme.accent2;
    ctx.textAlign = 'left';
    ctx.fillText(fmt.format(f[i]), mid + gap + fw + 6, center + 3.5);
  });
  
  // Tooltip handler
  canvas._chartTooltipHandler = (mx, my) => {
    if (my < top || my > h - top) return null;
    const idx = Math.floor((my - top) / rowH);
    if (idx < 0 || idx >= 6) return null;
    const tot = m[idx] + f[idx];
    return {
      html: `<strong>ช่วงอายุ: ${bands[idx][0]} ปี</strong>
        <div class="tt-item"><span style="color:${theme.accent1}">● ชาย:</span> <span class="tt-val">${fmt.format(m[idx])} (${tot ? ((m[idx]/tot)*100).toFixed(1) : 0}%)</span></div>
        <div class="tt-item"><span style="color:${theme.accent2}">● หญิง:</span> <span class="tt-val">${fmt.format(f[idx])} (${tot ? ((f[idx]/tot)*100).toFixed(1) : 0}%)</span></div>
        <div class="tt-item"><span>รวม:</span> <span class="tt-val">${fmt.format(tot)} ราย</span></div>`
    };
  };
}

/* Generic Horizontal Bar Chart (RTDDI) */
function drawBars(canvasId, rows, key, color, limit = 8) {
  const canvas = document.getElementById(canvasId);
  const s = resizeCanvas(canvas);
  if (!s) return;
  const { ctx, w, h } = s;
  ctx.clearRect(0, 0, w, h);
  const theme = chartTheme();
  
  const items = groupCounts(rows, key).filter(x => x[0] !== 'ไม่ระบุ').slice(0, limit);
  if (!items.length) {
    ctx.fillStyle = theme.textMuted;
    ctx.font = `500 12px ${theme.font}`;
    ctx.textAlign = 'center';
    ctx.fillText('ไม่มีข้อมูลในตัวกรองนี้', w / 2, h / 2);
    return;
  }
  
  const isCause = key === 'cause';
  const total = items.reduce((a, b) => a + b[1], 0) || 1;
  const left = isCause ? Math.min(185, w * 0.48) : Math.min(150, w * 0.42);
  const right = 48;
  const rowH = Math.min(28, (h - 10) / items.length);
  const max = items[0][1];
  const barW = Math.max(10, w - left - right);
  
  ctx.font = `600 10px ${theme.font}`;
  items.forEach(([label, value], i) => {
    const y = 5 + i * rowH;
    const barH = rowH * 0.52;
    
    // Label
    ctx.fillStyle = theme.text;
    ctx.textAlign = 'right';
    let shownText = label;
    if (isCause && ICD10_DICT[label]) {
      shownText = ICD10_DICT[label].label;
    }
    const maxChars = isCause ? 26 : 22;
    const shown = shownText.length > maxChars ? shownText.slice(0, maxChars - 1) + '…' : shownText;
    ctx.fillText(shown, left - 10, y + rowH * 0.64);
    
    // Background Track
    ctx.fillStyle = theme.track;
    roundedRect(ctx, left, y + (rowH - barH) / 2, barW, barH, 4);
    ctx.fill();
    
    // Active Bar
    const fillW = Math.max(3, barW * value / max);
    ctx.fillStyle = color;
    roundedRect(ctx, left, y + (rowH - barH) / 2, fillW, barH, 4);
    ctx.fill();
    
    // Value Label
    ctx.fillStyle = theme.text;
    ctx.textAlign = 'left';
    ctx.font = `700 10px ${theme.font}`;
    ctx.fillText(fmt.format(value), left + fillW + 6, y + rowH * 0.64);
  });
  
  canvas._chartTooltipHandler = (mx, my) => {
    const idx = Math.floor((my - 5) / rowH);
    if (idx < 0 || idx >= items.length) return null;
    const [label, val] = items[idx];
    const pct = ((val / total) * 100).toFixed(1);
    
    if (isCause && ICD10_DICT[label]) {
      const icd = ICD10_DICT[label];
      return {
        html: `<strong>${icd.code}: ${icd.desc}</strong>
          <div class="tt-item"><span>หมวดกลุ่ม:</span> <span class="tt-val">${icd.group}</span></div>
          <div class="tt-item"><span>รหัสมรณบัตร:</span> <span class="tt-val">${label}</span></div>
          <div class="tt-item"><span>จำนวน:</span> <span class="tt-val">${fmt.format(val)} ราย</span></div>
          <div class="tt-item"><span>สัดส่วนในกลุ่มรหัส:</span> <span class="tt-val">${pct}%</span></div>`
      };
    }
    
    return {
      html: `<strong>${label}</strong>
        <div class="tt-item"><span>จำนวน:</span> <span class="tt-val">${fmt.format(val)} ราย</span></div>
        <div class="tt-item"><span>สัดส่วน:</span> <span class="tt-val">${pct}%</span></div>`
    };
  };
}

/* TRAMS Data Aggregation */
function selectedAccidentYears() {
  if (!ACCIDENTS) return [];
  return Object.entries(ACCIDENTS.years).filter(([year]) => selectedYear === 'all' || year === selectedYear);
}
function accidentTotal(key) {
  return selectedAccidentYears().reduce((sum, [, data]) => sum + (Number(data[key]) || 0), 0);
}
function aggregateAccidentList(key, valueIndex = 1) {
  const totals = new Map();
  for (const [, data] of selectedAccidentYears()) {
    for (const item of data[key] || []) {
      const name = String(item[0] || 'ไม่ระบุ');
      totals.set(name, (totals.get(name) || 0) + (Number(item[valueIndex]) || 0));
    }
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]);
}

/* Update TRAMS UI */
function updateAccidentDashboard() {
  if (!ACCIDENTS) return;
  setText('incident-events', fmt.format(accidentTotal('events')));
  setText('incident-fatalities', fmt.format(accidentTotal('fatalities')));
  setText('incident-serious', fmt.format(accidentTotal('serious')));
  setText('incident-injuries', fmt.format(accidentTotal('injuries')));
  
  drawIncidentMonthly();
  drawIncidentHours();
  drawIncidentWeekdays();
  
  drawAccidentBars('incident-province-chart', aggregateAccidentList('provinces', 1), '#0284c7', 12);
  drawAccidentBars('incident-cause-chart', aggregateAccidentList('cause'), '#f59e0b', 10);
  drawAccidentBars('incident-collision-chart', aggregateAccidentList('collision'), '#8b5cf6', 10);
  drawAccidentBars('incident-vehicle-chart', aggregateAccidentList('vehicle'), '#10b981', 10);
  drawAccidentBars('incident-weather-chart', aggregateAccidentList('weather'), '#0284c7', 10);
  drawAccidentBars('incident-roadtype-chart', aggregateAccidentList('road_type'), '#8b5cf6', 6);
  
  // Annual comparison table
  const deathCounts = new Map();
  if (DATA?.records) {
    for (const row of DATA.records) {
      const year = String(row.dead_year);
      deathCounts.set(year, (deathCounts.get(year) || 0) + 1);
    }
  }
  const body = document.getElementById('incident-year-table');
  if (body) {
    body.replaceChildren();
    for (const [year, data] of Object.entries(ACCIDENTS.years)) {
      const row = document.createElement('tr');
      if (selectedYear === year) row.className = 'selected-year-row';
      const values = [
        `พ.ศ. ${Number(year) + 543}`,
        fmt.format(deathCounts.get(year) || 0),
        fmt.format(data.events),
        fmt.format(data.fatalities),
        fmt.format(data.serious),
        fmt.format(data.minor),
        `${fmt.format(data.coordinates)} (${(data.coordinates / data.events * 100).toFixed(1)}%)`
      ];
      for (const value of values) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      body.append(row);
    }
  }
}

/* TRAMS Chart: Monthly Incidents */
function drawIncidentMonthly() {
  const canvas = document.getElementById('incident-month-chart');
  const s = resizeCanvas(canvas);
  if (!s) return;
  const { ctx, w, h } = s;
  const years = selectedAccidentYears();
  const theme = chartTheme();
  const colors = { 2023: '#f59e0b', 2024: '#0284c7', 2025: '#10b981' };
  const pad = { l: 48, r: 16, t: 16, b: 32 };
  const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
  
  ctx.clearRect(0, 0, w, h);
  const max = Math.max(1, ...years.flatMap(([, d]) => d.monthly));
  
  ctx.font = `500 10px ${theme.font}`;
  ctx.textAlign = 'right';
  ctx.fillStyle = theme.textMuted;
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + ch * i / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(w - pad.r, y);
    ctx.stroke();
    ctx.fillText(fmt.format(Math.round(max * (1 - i / 4))), pad.l - 8, y + 3);
  }
  
  MONTHS.forEach((month, i) => {
    const x = pad.l + cw * i / 11;
    ctx.textAlign = 'center';
    ctx.fillStyle = theme.text;
    ctx.font = `600 10px ${theme.font}`;
    ctx.fillText(month, x, h - 10);
  });
  
  for (const [year, data] of years) {
    const col = colors[year] || '#f43f5e';
    
    // Area fill
    ctx.beginPath();
    data.monthly.forEach((value, i) => {
      const x = pad.l + cw * i / 11;
      const y = pad.t + ch - (value / max) * ch;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(pad.l + cw, pad.t + ch);
    ctx.lineTo(pad.l, pad.t + ch);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ch);
    grad.addColorStop(0, hexToRgba(col, 0.22));
    grad.addColorStop(1, hexToRgba(col, 0.01));
    ctx.fillStyle = grad;
    ctx.fill();
    
    // Line
    ctx.beginPath();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    data.monthly.forEach((value, i) => {
      const x = pad.l + cw * i / 11;
      const y = pad.t + ch - (value / max) * ch;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    
    // Dots
    data.monthly.forEach((value, i) => {
      const x = pad.l + cw * i / 11;
      const y = pad.t + ch - (value / max) * ch;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  }
  
  const legend = document.getElementById('incident-month-legend');
  if (legend) {
    legend.replaceChildren();
    for (const [year] of years) {
      const item = document.createElement('span');
      item.className = 'legend-year';
      item.innerHTML = `<i style="background:${colors[year] || '#f43f5e'}"></i>พ.ศ. ${Number(year) + 543}`;
      legend.append(item);
    }
  }
  
  canvas._chartTooltipHandler = (mx, my) => {
    if (mx < pad.l - 10 || mx > w - pad.r + 10) return null;
    const mIdx = Math.min(11, Math.max(0, Math.round(((mx - pad.l) / cw) * 11)));
    let lines = `<strong>เดือน${MONTHS_FULL[mIdx]} (TRAMS)</strong>`;
    for (const [year, data] of years) {
      const col = colors[year] || '#f43f5e';
      const count = data.monthly[mIdx];
      lines += `<div class="tt-item"><span style="color:${col}">● พ.ศ. ${Number(year) + 543}:</span> <span class="tt-val">${fmt.format(count)} เหตุการณ์</span></div>`;
    }
    return { html: lines };
  };
}

/* TRAMS Chart: 2-Hour Interval Incident Hours */
function drawIncidentHours() {
  const canvas = document.getElementById('incident-hour-chart');
  const s = resizeCanvas(canvas);
  if (!s) return;
  const { ctx, w, h } = s, theme = chartTheme();
  const hours = Array(12).fill(0);
  for (const [, data] of selectedAccidentYears()) {
    data.hours.forEach((n, i) => hours[i] += Number(n) || 0);
  }
  
  ctx.clearRect(0, 0, w, h);
  const max = Math.max(1, ...hours);
  const left = 38, right = 12, top = 14, bottom = 30;
  const barW = (w - left - right) / 12;
  const peakIdx = hours.indexOf(max);
  
  for (let i = 0; i < 12; i++) {
    const x = left + i * barW + 2;
    const bh = (h - top - bottom) * hours[i] / max;
    const y = h - bottom - bh;
    const wBar = Math.max(3, barW - 4);
    
    // Background track
    ctx.fillStyle = theme.track;
    roundedRect(ctx, x, top, wBar, h - top - bottom, 4);
    ctx.fill();
    
    // Bar fill
    const isPeak = i === peakIdx;
    ctx.fillStyle = isPeak ? '#f43f5e' : '#f59e0b';
    roundedRect(ctx, x, y, wBar, bh, 4);
    ctx.fill();
    
    // Hour label
    ctx.fillStyle = isPeak ? (document.body.dataset.theme === 'dark' ? '#fda4af' : '#e11d48') : theme.textMuted;
    ctx.font = `600 10px ${theme.font}`;
    ctx.textAlign = 'center';
    const label = `${String(i * 2).padStart(2, '0')}`;
    ctx.fillText(label, x + wBar / 2, h - 10);
  }
  
  canvas._chartTooltipHandler = (mx, my) => {
    if (mx < left || mx > w - right) return null;
    const idx = Math.floor((mx - left) / barW);
    if (idx < 0 || idx >= 12) return null;
    const startH = String(idx * 2).padStart(2, '0');
    const endH = String((idx + 1) * 2).padStart(2, '0');
    const val = hours[idx];
    const isPeak = idx === peakIdx;
    return {
      html: `<strong>ช่วงเวลา ${startH}:00 - ${endH}:00 น.</strong>
        <div class="tt-item"><span>จำนวนเหตุการณ์:</span> <span class="tt-val">${fmt.format(val)} เหตุการณ์</span></div>
        ${isPeak ? '<div style="color:#f43f5e;font-weight:700;margin-top:3px;">★ ช่วงเวลาที่เกิดเหตุมากที่สุด</div>' : ''}`
    };
  };
}

/* TRAMS Chart: Incident Weekdays */
function drawIncidentWeekdays() {
  const canvas = document.getElementById('incident-weekday-chart');
  const s = resizeCanvas(canvas);
  if (!s) return;
  const { ctx, w, h } = s;
  const days = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
  const counts = Array(7).fill(0);
  const theme = chartTheme();
  
  for (const [, data] of selectedAccidentYears()) {
    data.weekdays.forEach((n, i) => counts[i] += Number(n) || 0);
  }
  
  ctx.clearRect(0, 0, w, h);
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  const max = Math.max(1, ...counts);
  const left = Math.min(84, w * 0.24);
  const right = 48;
  const top = 10;
  const rowH = (h - 20) / 7;
  const barW = Math.max(10, w - left - right);
  
  ctx.font = `600 11px ${theme.font}`;
  days.forEach((day, i) => {
    const y = top + i * rowH;
    const barH = Math.min(18, rowH * 0.55);
    const val = counts[i];
    const isWeekend = i >= 5;
    
    ctx.fillStyle = isWeekend ? (document.body.dataset.theme === 'dark' ? '#fda4af' : '#e11d48') : theme.text;
    ctx.textAlign = 'right';
    ctx.fillText(day, left - 10, y + rowH * 0.62);
    
    ctx.fillStyle = theme.track;
    roundedRect(ctx, left, y + (rowH - barH) / 2, barW, barH, 5);
    ctx.fill();
    
    const fillW = Math.max(3, barW * val / max);
    ctx.fillStyle = isWeekend ? '#f43f5e' : '#f59e0b';
    roundedRect(ctx, left, y + (rowH - barH) / 2, fillW, barH, 5);
    ctx.fill();
    
    ctx.fillStyle = theme.text;
    ctx.textAlign = 'left';
    ctx.font = `700 10px ${theme.font}`;
    ctx.fillText(fmt.format(val), left + fillW + 6, y + rowH * 0.62);
  });
  
  canvas._chartTooltipHandler = (mx, my) => {
    if (my < top || my > h - 10) return null;
    const idx = Math.floor((my - top) / rowH);
    if (idx < 0 || idx >= 7) return null;
    const val = counts[idx];
    const pct = ((val / total) * 100).toFixed(1);
    return {
      html: `<strong>วัน${days[idx]} (TRAMS)</strong>
        <div class="tt-item"><span>จำนวนเหตุการณ์:</span> <span class="tt-val">${fmt.format(val)} ครั้ง</span></div>
        <div class="tt-item"><span>สัดส่วน:</span> <span class="tt-val">${pct}%</span></div>`
    };
  };
}

/* TRAMS Generic Horizontal Bars */
function drawAccidentBars(canvasId, entries, color, limit = 10) {
  const canvas = document.getElementById(canvasId);
  const s = resizeCanvas(canvas);
  if (!s) return;
  const { ctx, w, h } = s, theme = chartTheme();
  ctx.clearRect(0, 0, w, h);
  
  const items = entries.filter(([name]) => name !== 'ไม่ระบุ').slice(0, limit);
  if (!items.length) {
    ctx.fillStyle = theme.textMuted;
    ctx.font = `500 12px ${theme.font}`;
    ctx.textAlign = 'center';
    ctx.fillText('ไม่มีข้อมูลในตัวกรองนี้', w / 2, h / 2);
    return;
  }
  
  const total = items.reduce((a, b) => a + b[1], 0) || 1;
  const left = Math.min(160, w * 0.44);
  const right = 48;
  const rowH = Math.min(26, (h - 10) / items.length);
  const max = Math.max(1, items[0][1]);
  const barW = Math.max(10, w - left - right);
  
  ctx.font = `600 10px ${theme.font}`;
  items.forEach(([name, value], i) => {
    const y = 5 + i * rowH;
    const barH = rowH * 0.52;
    const short = name.length > 22 ? name.slice(0, 21) + '…' : name;
    
    ctx.fillStyle = theme.text;
    ctx.textAlign = 'right';
    ctx.fillText(short, left - 10, y + rowH * 0.65);
    
    ctx.fillStyle = theme.track;
    roundedRect(ctx, left, y + (rowH - barH) / 2, barW, barH, 4);
    ctx.fill();
    
    const fillW = Math.max(3, barW * value / max);
    ctx.fillStyle = color;
    roundedRect(ctx, left, y + (rowH - barH) / 2, fillW, barH, 4);
    ctx.fill();
    
    ctx.fillStyle = theme.text;
    ctx.textAlign = 'left';
    ctx.font = `700 10px ${theme.font}`;
    ctx.fillText(fmt.format(value), left + fillW + 6, y + rowH * 0.65);
  });
  
  canvas._chartTooltipHandler = (mx, my) => {
    const idx = Math.floor((my - 5) / rowH);
    if (idx < 0 || idx >= items.length) return null;
    const [name, val] = items[idx];
    const pct = ((val / total) * 100).toFixed(1);
    return {
      html: `<strong>${name}</strong>
        <div class="tt-item"><span>จำนวน:</span> <span class="tt-val">${fmt.format(val)} รายการ</span></div>
        <div class="tt-item"><span>สัดส่วน:</span> <span class="tt-val">${pct}%</span></div>`
    };
  };
}

/* Quality & Metadata Section */
function updateQuality(rows) {
  const missingAge = rows.length - countVal(rows, 'age');
  const missingCause = rows.length - countVal(rows, 'cause');
  const coords = rows.filter(r => isValue(r.latitude) && isValue(r.longitude)).length;
  const matched = rows.filter(r => r.road_status === 'matched').length;
  const traffic = rows.filter(r => isValue(r.traffic_aadt)).length;
  
  const notes = [
    `RTDDI: ${fmt.format(rows.length - countVal(rows, 'incident_date'))} ระเบียนไม่มี Date Rec (วันเกิดเหตุ); ให้วิเคราะห์วันเวลาเกิดเหตุจากระบบ TRAMS ด้านบนแทน · ปฏิทินวันหยุดจับคู่กับ Dead_Date`,
    `พิกัดภูมิศาสตร์: มีพิกัด ${fmt.format(coords)} รายการ (${rows.length ? ((coords / rows.length) * 100).toFixed(1) : '0.0'}%); จับคู่แนวถนน DOH ได้ ${fmt.format(matched)} รายการในระยะ ≤ 100 ม.`,
    `ความสมบูรณ์: ไม่ระบุอายุ ${fmt.format(missingAge)} รายการ · ไม่ระบุรหัส Cause_Code ${fmt.format(missingCause)} รายการ`,
    `อุปกรณ์ความปลอดภัย: หมวกนิรภัยและเข็มขัดนิรภัยไม่มีการบันทึกค่าในชุดข้อมูล จึงไม่อนุมานว่าไม่ใช้อุปกรณ์`,
    `ปริมาณจราจร: ${fmt.format(traffic)} รายการมี AADT จากรหัส highway_code ที่ตรงกัน ใช้เป็นบริบทสายทางเท่านั้น`
  ];
  const ul = document.getElementById('quality-list');
  if (ul) {
    ul.innerHTML = '';
    for (const note of notes) {
      const li = document.createElement('li');
      li.textContent = note;
      ul.appendChild(li);
    }
  }
}

/* Road Network & GIS Map */
function routeType(code) {
  const digits = String(code ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (digits.length === 1) return 'primary';
  if (digits.length >= 2 && digits.length <= 4) return 'secondary';
  return 'other';
}
function visibleRoads() {
  return (DATA?.roads || []).filter(r => selectedRoadType === 'all' || routeType(r.highway_code) === selectedRoadType);
}
function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function getTileUrl(isDark) {
  return isDark
    ? 'https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
}

function updateMapTiles() {
  if (!leafletMap || !currentTileLayer) return;
  const isDark = document.body.dataset.theme === 'dark';
  currentTileLayer.setUrl(getTileUrl(isDark));
}

function drawMap() {
  if (!DATA || !leafletMap) return;
  roadLayer.clearLayers();
  pointLayer.clearLayers();
  
  const showRoads = document.getElementById('show-roads')?.checked ?? true;
  const showPoints = document.getElementById('show-points')?.checked ?? true;
  const rows = filtered().filter(r => isValue(r.latitude) && isValue(r.longitude));
  
  const roadDeaths = new Map();
  for (const r of rows) {
    if (r.road_status === 'matched' && isValue(r.road_feature_id)) {
      const id = String(r.road_feature_id);
      roadDeaths.set(id, (roadDeaths.get(id) || 0) + 1);
    }
  }
  
  if (showRoads) {
    for (const road of visibleRoads()) {
      const n = roadDeaths.get(String(road.id)) || 0;
      const color = n >= 10 ? '#ef4444' : n >= 4 ? '#f59e0b' : n > 0 ? '#10b981' : '#475569';
      for (const line of road.lines) {
        const latlngs = line.map(([lon, lat]) => [lat, lon]);
        L.polyline(latlngs, {
          color,
          weight: n >= 10 ? 3.5 : n >= 4 ? 2.6 : n > 0 ? 1.8 : 1,
          opacity: n ? 0.9 : 0.4
        }).bindPopup(`<strong>ทางหลวง ${escapeHtml(road.highway_code || 'ไม่ระบุ')} · ${escapeHtml(road.road_code || '')}</strong><br>${escapeHtml(road.road_name || road.road_class_name || 'ไม่ระบุชื่อ')}<br>จุดผู้เสียชีวิตที่จับคู่ได้: <b>${fmt.format(n)} ราย</b>`).addTo(roadLayer);
      }
    }
  }
  
  if (showPoints) {
    for (const r of rows) {
      const latlng = [Number(r.latitude), Number(r.longitude)];
      const point = hasMarkerCluster
        ? L.marker(latlng, { icon: L.divIcon({ className: 'fatality-marker', html: '', iconSize: [10, 10], iconAnchor: [5, 5] }) })
        : L.circleMarker(latlng, { radius: 3, weight: 1, color: '#fff', fillColor: '#f43f5e', fillOpacity: 0.85 });
      
      point.bindPopup(`<strong>ระเบียนผู้เสียชีวิต #${escapeHtml(r.id)}</strong><br>
        <b>วันเสียชีวิต:</b> ${escapeHtml(r.death_date || 'ไม่ระบุ')}<br>
        <b>ยานพาหนะ:</b> ${escapeHtml(r.vehicle || 'ไม่ระบุ')}<br>
        <b>รหัสสาเหตุ:</b> ${escapeHtml(r.cause || 'ไม่ระบุ')}<br>
        <b>แนวถนน DOH:</b> ${escapeHtml(r.highway_code || 'ไม่จับคู่')} · ${escapeHtml(r.road_name || '')}<br>
        <b>ระยะห่างจากถนน:</b> ${isValue(r.road_distance_m) ? `${escapeHtml(r.road_distance_m)} ม.` : 'ไม่จับคู่'}<br>
        <b>พิกัด:</b> ${Number(r.latitude).toFixed(5)}, ${Number(r.longitude).toFixed(5)}`);
      pointLayer.addLayer(point);
    }
  }
  
  const matched = rows.filter(r => r.road_status === 'matched').length;
  const clusterNote = hasMarkerCluster ? 'จัดกลุ่ม Marker Cluster สำเร็จ' : 'แสดงจุดรายบุคคล';
  setText('map-summary', `${fmt.format(rows.length)} จุดมีพิกัดในตัวกรอง · จับคู่แนวถนนได้ ${fmt.format(matched)} รายการ (≤ 100 ม.) · ${fmt.format(visibleRoads().length)} ช่วงสายทาง · ${clusterNote}`);
  const emptyEl = document.getElementById('map-empty');
  if (emptyEl) emptyEl.hidden = rows.length > 0;
  
  drawHotspots(rows, roadDeaths);
}

/* Top 10 Dangerous Highway Hotspots */
function drawHotspots(rows, counts) {
  const list = document.getElementById('hotspots-list');
  if (!list) return;
  const features = new Map(DATA.roads.map(r => [String(r.id), r]));
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  list.innerHTML = '';
  
  if (!ranked.length) {
    list.innerHTML = '<div style="padding:16px;grid-column:1/-1;text-align:center;color:var(--ink-muted);">ยังไม่มีพิกัดที่จับคู่กับแนวถนนในตัวกรองนี้</div>';
    return;
  }
  
  let rankNum = 1;
  for (const [id, count] of ranked) {
    const road = features.get(id);
    if (!road || (selectedRoadType !== 'all' && routeType(road.highway_code) !== selectedRoadType)) continue;
    
    const row = document.createElement('div');
    row.className = 'hotspot-row';
    
    const rankEl = document.createElement('div');
    rankEl.className = `hotspot-rank ${rankNum <= 3 ? `rank-${rankNum}` : ''}`;
    rankEl.textContent = rankNum;
    
    const title = document.createElement('strong');
    title.textContent = `ทล. ${road.highway_code || 'ไม่ระบุ'}`;
    
    const name = document.createElement('span');
    name.textContent = road.road_name || road.road_class_name || 'ไม่ระบุชื่อช่วงทาง';
    name.title = name.textContent;
    
    const value = document.createElement('b');
    value.textContent = `${fmt.format(count)} ราย`;
    
    row.append(rankEl, title, name, value);
    list.append(row);
    rankNum++;
  }
  
  if (!list.children.length) {
    list.innerHTML = '<div style="padding:16px;grid-column:1/-1;text-align:center;color:var(--ink-muted);">ไม่มีช่วงทางในชั้นทางหลวงที่เลือก</div>';
  }
}

/* CSV Export */
function csvEscape(v) {
  const x = (v === null || v === undefined) ? '' : String(v);
  return '"' + x.replaceAll('"', '""') + '"';
}
function exportCsv() {
  const rows = filtered();
  const cols = [
    'id', 'dead_year', 'death_date', 'incident_date', 'incident_time', 'age', 'sex', 'vehicle', 'cause',
    'latitude', 'longitude', 'road_status', 'road_distance_m', 'highway_code', 'highway_name',
    'road_code', 'road_name', 'km_start', 'km_end', 'traffic_aadt', 'traffic_years', 'holiday_name', 'festival'
  ];
  const csv = '\ufeff' + [cols.join(','), ...rows.map(r => cols.map(k => csvEscape(r[k])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `road-fatalities-${selectedYear === 'all' ? 'all' : Number(selectedYear) + 543}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* Render Everything */
function render() {
  const rows = filtered();
  updateKpis(rows);
  drawTrend(rows);
  drawWeekday(rows);
  drawPyramid(rows);
  drawBars('vehicle-chart', rows, 'vehicle', '#f43f5e', 8);
  drawBars('cause-chart', rows, 'cause', '#0284c7', 8);
  updateQuality(rows);
  updateAccidentDashboard();
  drawMap();
}

/* Map Initialization */
function setupMap() {
  if (!window.L) {
    throw new Error('โหลด Leaflet ไม่สำเร็จ กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วเปิดหน้าเว็บใหม่');
  }
  leafletMap = L.map('road-map', { preferCanvas: true, scrollWheelZoom: true }).setView([13.736717, 100.523186], 6);
  const isDark = document.body.dataset.theme === 'dark';
  currentTileLayer = L.tileLayer(getTileUrl(isDark), {
    maxZoom: 19,
    subdomains: 'abcd',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank">CARTO</a>'
  }).addTo(leafletMap);
  
  roadLayer = L.layerGroup().addTo(leafletMap);
  hasMarkerCluster = typeof L.markerClusterGroup === 'function';
  pointLayer = hasMarkerCluster
    ? L.markerClusterGroup({ chunkedLoading: true, showCoverageOnHover: false, spiderfyOnMaxZoom: true })
    : L.layerGroup();
  pointLayer.addTo(leafletMap);
  
  document.getElementById('show-roads')?.addEventListener('change', () => {
    if (leafletMap.hasLayer(roadLayer)) roadLayer.remove();
    if (document.getElementById('show-roads').checked) roadLayer.addTo(leafletMap);
    drawMap();
  });
  document.getElementById('show-points')?.addEventListener('change', () => {
    if (leafletMap.hasLayer(pointLayer)) pointLayer.remove();
    if (document.getElementById('show-points').checked) pointLayer.addTo(leafletMap);
    drawMap();
  });
  document.getElementById('road-type-filter')?.addEventListener('change', e => {
    selectedRoadType = e.target.value;
    drawMap();
  });
  document.getElementById('map-reset')?.addEventListener('click', () => {
    leafletMap.setView([13.736717, 100.523186], 6);
  });
}

/* Global Interactive Tooltip Listener */
function setupChartTooltips() {
  const tooltip = document.getElementById('canvas-tooltip');
  if (!tooltip) return;
  
  const canvasIds = [
    'trend-chart', 'weekday-chart', 'pyramid-chart', 'vehicle-chart', 'cause-chart',
    'incident-month-chart', 'incident-hour-chart', 'incident-weekday-chart',
    'incident-province-chart', 'incident-cause-chart', 'incident-collision-chart',
    'incident-vehicle-chart', 'incident-weather-chart', 'incident-roadtype-chart'
  ];
  
  for (const id of canvasIds) {
    const canvas = document.getElementById(id);
    if (!canvas) continue;
    
    canvas.addEventListener('mousemove', e => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const info = canvas._chartTooltipHandler ? canvas._chartTooltipHandler(mx, my) : null;
      
      if (info && info.html) {
        tooltip.innerHTML = info.html;
        tooltip.hidden = false;
        const ttW = tooltip.offsetWidth || 180;
        const ttH = tooltip.offsetHeight || 60;
        let left = e.clientX + 14;
        let top = e.clientY + 14;
        if (left + ttW > window.innerWidth - 12) left = e.clientX - ttW - 12;
        if (top + ttH > window.innerHeight - 12) top = e.clientY - ttH - 12;
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
      } else {
        tooltip.hidden = true;
      }
    });
    
    canvas.addEventListener('mouseleave', () => {
      tooltip.hidden = true;
    });
  }
}

/* Setup Quick Navigation Active Highlight */
function setupQuickNav() {
  const links = document.querySelectorAll('.quick-nav-pill, .rail-link');
  const sections = ['overview', 'time', 'incidents', 'people', 'roads'].map(id => document.getElementById(id)).filter(Boolean);
  
  window.addEventListener('scroll', () => {
    const scrollPos = window.scrollY + 200;
    let currentId = 'overview';
    for (const sec of sections) {
      if (sec.offsetTop <= scrollPos) {
        currentId = sec.id;
      }
    }
    document.querySelectorAll('.rail-link').forEach(link => {
      link.classList.toggle('active', link.getAttribute('href') === `#${currentId}`);
    });
    document.querySelectorAll('.quick-nav-pill').forEach(pill => {
      pill.classList.toggle('active', pill.getAttribute('href') === `#${currentId}`);
    });
  }, { passive: true });
}

/* Application Bootstrapping */
async function boot() {
  try {
    setupMap();
    setupChartTooltips();
    setupQuickNav();
    
    document.getElementById('year-filter')?.addEventListener('change', e => {
      selectedYear = e.target.value;
      render();
    });
    
    document.getElementById('export-csv')?.addEventListener('click', exportCsv);
    
    const themeButton = document.getElementById('theme-toggle');
    const updateThemeButton = () => {
      const isDark = document.body.dataset.theme === 'dark';
      if (themeButton) {
        themeButton.textContent = isDark ? '☀ โหมดสว่าง' : '☾ โหมดมืด';
      }
    };
    
    themeButton?.addEventListener('click', () => {
      const isDark = document.body.dataset.theme !== 'dark';
      document.body.dataset.theme = isDark ? 'dark' : 'light';
      localStorage.setItem('road-dashboard-theme', isDark ? 'dark' : 'light');
      updateThemeButton();
      updateMapTiles();
      render();
      setTimeout(() => leafletMap?.invalidateSize(), 50);
    });
    
    const savedTheme = localStorage.getItem('road-dashboard-theme');
    if (savedTheme) document.body.dataset.theme = savedTheme;
    updateThemeButton();
    updateMapTiles();
    
    window.addEventListener('resize', () => render());
    
    const [deathResponse, accidentResponse] = await Promise.all([
      fetch('data/dashboard_data.json'),
      fetch('data/accident_summary.json')
    ]);
    
    if (!deathResponse.ok) throw new Error(`โหลดข้อมูลผู้เสียชีวิตไม่สำเร็จ (${deathResponse.status})`);
    if (!accidentResponse.ok) throw new Error(`โหลดข้อมูลอุบัติเหตุไม่สำเร็จ (${accidentResponse.status})`);
    
    [DATA, ACCIDENTS] = await Promise.all([deathResponse.json(), accidentResponse.json()]);
    
    document.getElementById('data-note')?.classList.toggle('note-critical', DATA.meta.incident_dates === 0);
    render();
  } catch (err) {
    const next = location.protocol === 'file:'
      ? 'เปิดจาก file:// จะอ่าน JSON ไม่ได้ ให้เปิดด้วย .\\run_dashboard.ps1 จากโฟลเดอร์โปรเจกต์ จากนั้นเข้า http://127.0.0.1:8000'
      : 'กรุณาตรวจสอบว่าเซิร์ฟเวอร์เปิดอยู่ที่ http://127.0.0.1:8000 และเชื่อมต่ออินเทอร์เน็ต';
    const noteEl = document.getElementById('data-note');
    if (noteEl) {
      noteEl.innerHTML = `<div class="note-icon">!</div><div><strong>โหลด Dashboard ไม่สำเร็จ</strong><p>${err.message} · ${next}</p></div>`;
    }
    console.error(err);
  }
}

document.addEventListener('DOMContentLoaded', boot);
