/* Thailand Road Safety Intelligence Dashboard
   Pure JavaScript, HTML5 Canvas, Leaflet GIS & MarkerCluster
   Data: Ministry of Transport TRAMS Accidents & Department of Highways (DOH)
*/

const fmt = new Intl.NumberFormat('th-TH');
const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];
const WEEKDAYS = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];

// Color Palette for Highway Classification
const HIGHWAY_COLORS = {
  digit_1: '#9333ea',    // 1-digit: Purple (ทล. 1, 2, 4)
  digit_2: '#1e40af',    // 2-digit: Blue   (ทล. 12, 24, 35)
  digit_3: '#db2777',    // 3-digit: Pink   (ทล. 201, 304)
  digit_4_plus: '#64748b', // 4+ digits: Neutral Slate
  unknown: '#64748b'     // Rural/Other
};

// Global Application State
let DATA = null;          // dashboard_data.json
let ACCIDENTS = null;     // accident_summary.json
let PROVINCES_GEO = null; // provinces.geojson
let mapAssetsPromise = null;
let mapAssetsLoaded = false;

let selectedYear = 'all';           // 'all', '2023', '2024', '2025'
let selectedRegion = 'all';         // 'all' or Thai region name
let selectedProvince = 'all';       // 'all' or Thai province name
let selectedHighwayDigits = 'all';  // 'all', 'digit_1', 'digit_2', 'digit_3'
let selectedVehicle = 'all';
let selectedFatality = 'all';
const semanticFilters = { vehicle: 'all', cause: 'all', collision: 'all', weather: 'all' };
let provinceFatalityCounts = new Map();
let provinceEventCounts = new Map();
let pendingRoadHighlightId = null;

let leafletMap = null;
let currentTileLayer = null;
let labelTileLayer = null;
let roadLayer = null;
let roadHighlightLayer = null;
let pointLayer = null;
let boundaryLayer = null;
let hasMarkerCluster = false;

/* Utility Helpers */
function isValue(v) {
  return v !== null && v !== undefined && v !== '' && String(v).toLowerCase() !== 'nan';
}

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

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
    accent1: '#669BBC',
    accent2: '#C1121F',
    accent3: '#003049',
    accentWarn: '#AE1F23'
  } : {
    grid: '#e2e8f0',
    text: '#475569',
    textMuted: '#94a3b8',
    track: '#f1f5f9',
    font: '"Plus Jakarta Sans", "Prompt", sans-serif',
    accent1: '#003049',
    accent2: '#C1121F',
    accent3: '#669BBC',
    accentWarn: '#AE1F23'
  };
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

/* Data Filtering Functions */
function getFilteredRecords(ignoreSemantic = null) {
  if (!DATA?.records) return [];
  return DATA.records.filter(r => {
    if (selectedYear !== 'all' && String(r.year) !== selectedYear) return false;
    if (selectedRegion !== 'all' && r.region !== selectedRegion) return false;
    if (selectedProvince !== 'all' && r.province !== selectedProvince) return false;
    if (selectedVehicle !== 'all' && r.vehicle !== selectedVehicle) return false;
    if (selectedHighwayDigits !== 'all') {
      const code = String(r.highway_code || '');
      const digits = Number(r.highway_digits) || (/^\d+$/.test(code) ? code.length : 0);
      const target = selectedHighwayDigits === 'digit_4_plus' ? digits >= 4 : digits === Number(selectedHighwayDigits.replace('digit_', ''));
      if (!target) return false;
    }
    if (selectedFatality === 'fatal' && !(Number(r.fatalities) > 0)) return false;
    if (selectedFatality === 'nonfatal' && Number(r.fatalities) > 0) return false;
    for (const [key, value] of Object.entries(semanticFilters)) {
      if (key !== ignoreSemantic && value !== 'all' && r[key] !== value) return false;
    }
    const search = document.getElementById('road-search')?.value.trim().toLowerCase();
    if (search && !`${r.highway_code || ''} ${r.highway_code_raw || ''} ${r.road_name || ''}`.toLowerCase().includes(search)) return false;
    return true;
  });
}

function getFilteredRoads() {
  if (!DATA?.roads) return [];
  return DATA.roads.filter(road => {
    // 1. Regional and provincial spatial filter
    if (selectedProvince !== 'all') {
      if (road.province !== selectedProvince) return false;
    } else if (selectedRegion !== 'all') {
      if (road.region !== selectedRegion) return false;
    }

    // 2. Highway digit classification filter
    if (selectedHighwayDigits === 'digit_1') {
      return road.digit_type === 'digit_1';
    } else if (selectedHighwayDigits === 'digit_2') {
      return road.digit_type === 'digit_2';
    } else if (selectedHighwayDigits === 'digit_3') {
      return road.digit_type === 'digit_3';
    }
    // 'all' shows all road features with their respective colors
    return true;
  });
}

/* UI KPI Counters */
function updateHeroCounter(records) {
  const yearLabel = selectedYear === 'all' ? '2566–2568' : String(Number(selectedYear) + 543);
  let areaLabel = 'ทั่วประเทศ';
  if (selectedProvince !== 'all') {
    areaLabel = `จ.${selectedProvince}`;
  } else if (selectedRegion !== 'all') {
    areaLabel = selectedRegion;
  }
  
  setText('hero-counter-label', `ผู้เสียชีวิตสะสม (${areaLabel}) ปี ${yearLabel}`);
  const totalDeaths = records.reduce((sum, r) => sum + (Number(r.fatalities) || 0), 0);
  
  const numberEl = document.getElementById('hero-counter-number');
  if (!numberEl) return;
  numberEl.replaceChildren();
  for (const char of new Intl.NumberFormat('en-US').format(totalDeaths)) {
    const item = document.createElement('span');
    item.className = char === ',' ? 'hero-separator' : 'hero-digit';
    item.textContent = char;
    numberEl.append(item);
  }
  numberEl.setAttribute('aria-label', `${fmt.format(totalDeaths)} ราย`);

  const totalInjuries = records.reduce((sum, r) => sum + (Number(r.injuries) || 0), 0);
  setText('injury-counter-label', `ผู้บาดเจ็บสะสม (${areaLabel}) ปี ${yearLabel}`);
  const injuryNumberEl = document.getElementById('injury-counter-number');
  if (!injuryNumberEl) return;
  injuryNumberEl.replaceChildren();
  for (const char of new Intl.NumberFormat('en-US').format(totalInjuries)) {
    const item = document.createElement('span');
    item.className = char === ',' ? 'hero-separator' : 'hero-digit';
    item.textContent = char;
    injuryNumberEl.append(item);
  }
  injuryNumberEl.setAttribute('aria-label', `${fmt.format(totalInjuries)} ราย`);
}

function updateKpis(records) {
  updateHeroCounter(records);
  const totalDeaths = records.reduce((sum, r) => sum + (Number(r.fatalities) || 0), 0);
  const totalInjuries = records.reduce((sum, r) => sum + (Number(r.injuries) || 0), 0);
  const coords = records.filter(r => isValue(r.latitude) && isValue(r.longitude)).length;
  const matched = records.filter(r => r.road_status === 'matched').length;
  
  setText('kpi-deaths', fmt.format(totalDeaths));
  setText('kpi-events', fmt.format(records.length));
  setText('kpi-road-match', fmt.format(matched));
  setText('kpi-injuries', fmt.format(totalInjuries));
  setText('kpi-events-sub', `${fmt.format(records.length)} ACC_CODE ไม่ซ้ำ หลังใช้กติกาจัดการรหัสซ้ำ`);
  setText('incident-coverage', `${fmt.format(coords)} จาก ${fmt.format(records.length)} เหตุการณ์มีพิกัด (${records.length ? (100*coords/records.length).toFixed(1) : '0.0'}%)`);
  
}

/* Breadcrumb and Filter Status */
function updateBreadcrumbs() {
  const bc = document.getElementById('map-breadcrumb');
  if (!bc) return;
  bc.replaceChildren();

  // 1. Country Level
  const country = document.createElement('span');
  country.className = `crumb-item ${selectedRegion === 'all' ? 'active' : ''}`;
  country.textContent = 'ประเทศไทย';
  country.addEventListener('click', () => {
    if (selectedRegion !== 'all' || selectedProvince !== 'all') {
      selectedRegion = 'all';
      selectedProvince = 'all';
      syncFilterDropdowns();
      updateMapView(true);
      render();
    }
  });
  bc.append(country);

  // 2. Region Level
  if (selectedRegion !== 'all') {
    const sep1 = document.createElement('span');
    sep1.className = 'crumb-sep';
    sep1.textContent = '›';
    bc.append(sep1);

    const reg = document.createElement('span');
    reg.className = `crumb-item ${selectedProvince === 'all' ? 'active' : ''}`;
    reg.textContent = selectedRegion;
    reg.addEventListener('click', () => {
      if (selectedProvince !== 'all') {
        selectedProvince = 'all';
        syncFilterDropdowns();
        updateMapView(true);
        render();
      }
    });
    bc.append(reg);
  }

  // 3. Province Level
  if (selectedProvince !== 'all') {
    const sep2 = document.createElement('span');
    sep2.className = 'crumb-sep';
    sep2.textContent = '›';
    bc.append(sep2);

    const prov = document.createElement('span');
    prov.className = 'crumb-item active';
    prov.textContent = selectedProvince;
    bc.append(prov);
  }
}

function updateFilterStatusBar(records, roads) {
  const chipsContainer = document.getElementById('active-chips');
  const countsEl = document.getElementById('filter-stat-counts');
  if (!chipsContainer || !countsEl) return;

  chipsContainer.replaceChildren();

  // Region chip
  if (selectedRegion !== 'all') {
    const c = document.createElement('span');
    c.className = 'active-chip chip-region';
    c.textContent = `ภาค: ${selectedRegion}`;
    chipsContainer.append(c);
  }

  // Province chip
  if (selectedProvince !== 'all') {
    const c = document.createElement('span');
    c.className = 'active-chip chip-province';
    c.textContent = `จังหวัด: ${selectedProvince}`;
    chipsContainer.append(c);
  }

  // Highway digits chip
  if (selectedHighwayDigits !== 'all') {
    const labels = {
      digit_1: 'ทางหลวง 1 หลัก (สีม่วง)',
      digit_2: 'ทางหลวง 2 หลัก (สีน้ำเงิน)',
      digit_3: 'ทางหลวง 3 หลัก (สีชมพู)'
    };
    const c = document.createElement('span');
    c.className = 'active-chip chip-digits';
    c.textContent = labels[selectedHighwayDigits] || selectedHighwayDigits;
    chipsContainer.append(c);
  }

  if (!chipsContainer.children.length) {
    const c = document.createElement('span');
    c.className = 'active-chip';
    c.textContent = 'มุมมองภาพรวมทั่วประเทศ (ทุกสายทาง)';
    chipsContainer.append(c);
  }

  const totalDeaths = records.reduce((s, r) => s + (Number(r.fatalities) || 0), 0);
  countsEl.textContent = `${fmt.format(records.length)} เหตุการณ์ (${fmt.format(totalDeaths)} เสียชีวิต) · ${fmt.format(roads.length)} ช่วงสายทาง`;
}

/* Sync Filter Dropdowns */
function syncFilterDropdowns() {
  const regSelect = document.getElementById('region-filter');
  const provSelect = document.getElementById('province-filter');
  const digitSelect = document.getElementById('highway-digit-filter');

  if (regSelect) regSelect.value = selectedRegion;
  if (digitSelect) digitSelect.value = selectedHighwayDigits;

  if (provSelect && DATA?.provinces) {
    provSelect.replaceChildren();

    const optAll = document.createElement('option');
    optAll.value = 'all';
    optAll.textContent = selectedRegion === 'all' ? 'ทุกจังหวัด (ทั่วประเทศ)' : `ทุกจังหวัดใน${selectedRegion}`;
    provSelect.append(optAll);

    // List provinces in currently selected region (or all 77 provinces)
    const provList = Object.values(DATA.provinces)
      .filter(p => selectedRegion === 'all' || p.region === selectedRegion)
      .map(p => p.province)
      .sort((a, b) => a.localeCompare(b, 'th'));

    for (const pname of provList) {
      const opt = document.createElement('option');
      opt.value = pname;
      opt.textContent = pname;
      provSelect.append(opt);
    }

    provSelect.value = selectedProvince;
  }
}

/* Map Tile Theme */
function getTileUrl(isDark) {
  return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
}

function updateMapTiles() {
  if (!leafletMap || !currentTileLayer) return;
  const isDark = document.body.dataset.theme === 'dark';
  currentTileLayer.setUrl(getTileUrl(isDark));
  labelTileLayer?.redraw();
}

/* Dynamic Viewport Fitting (fitBounds) */
function updateMapView(animate = true) {
  if (!leafletMap || !DATA) return;

  // 1. Specific Province selected
  if (selectedProvince !== 'all' && DATA.provinces?.[selectedProvince]?.bbox) {
    const bbox = DATA.provinces[selectedProvince].bbox;
    const bounds = [[bbox[1], bbox[0]], [bbox[3], bbox[2]]];
    leafletMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 13, animate });
    return;
  }

  // 2. Specific Region selected
  if (selectedRegion !== 'all' && DATA.regions?.[selectedRegion]?.bbox) {
    const bbox = DATA.regions[selectedRegion].bbox;
    const bounds = [[bbox[1], bbox[0]], [bbox[3], bbox[2]]];
    leafletMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 10, animate });
    return;
  }

  // 3. Country Level View (Thailand)
  leafletMap.fitBounds([[5.6, 97.3], [20.5, 105.7]], { padding: [20, 20], animate });
}

/* Boundary Layer Style */
function getProvinceStyle(feature) {
  const pname = feature.properties?.pro_th;
  const reg = feature.properties?.reg_th;
  const isDark = document.body.dataset.theme === 'dark';
  const maxCount = Math.max(1, ...provinceFatalityCounts.values());
  const value = provinceFatalityCounts.get(pname) || 0;
  const ratio = value / maxCount;
  const choropleth = value === 0 ? '#2E7D32' : ratio >= .75 ? '#A91B18' : ratio >= .45 ? '#FF8C00' : ratio >= .2 ? '#FFD700' : '#2E7D32';

  // Selected Province
  if (selectedProvince !== 'all') {
    if (pname === selectedProvince) {
      return {
        color: '#C1121F',
        weight: 2.8,
        opacity: 0.95,
        fillColor: choropleth,
        fillOpacity: .68
      };
    }
    // Same region
    if (selectedRegion !== 'all' && reg === selectedRegion) {
      return {
        color: isDark ? '#CEE7F3' : '#003049',
        weight: 1,
        opacity: 0.5,
        fillColor: 'transparent',
        fillOpacity: 0
      };
    }
    // Outside
    return {
      color: isDark ? '#334155' : '#e2e8f0',
      weight: 0.6,
      opacity: 0.25,
      fillColor: 'transparent',
      fillOpacity: 0
    };
  }

  // Selected Region
  if (selectedRegion !== 'all') {
    if (reg === selectedRegion) {
      return {
        color: '#003049',
        weight: 1.8,
        opacity: 0.85,
        fillColor: choropleth,
        fillOpacity: .55
      };
    }
    // Outside Region
    return {
      color: isDark ? '#1e293b' : '#f1f5f9',
      weight: 0.5,
      opacity: 0.2,
      fillColor: 'transparent',
      fillOpacity: 0
    };
  }

  // Country-level choropleth based on the currently filtered event counts.
  return {
    color: isDark ? '#CEE7F3' : '#fff',
    weight: 0.7,
    opacity: 0.9,
    fillColor: choropleth,
    fillOpacity: value ? .68 : .12
  };
}

function normalizeCategory(field, raw) {
  const text = String(raw || 'ไม่ระบุ').trim().replace(/\s+/g, ' ');
  const lower = text.toLowerCase();
  if (field === 'vehicle') {
    if (/กระบะ|ปิกอัพ|ปิคอัพ|pickup|pick-up/.test(lower)) return 'รถกระบะ';
    if (/มอเตอร์ไซค์|จักรยานยนต์|motorcycle|motorbike/.test(lower)) return 'รถจักรยานยนต์';
    if (/เก๋ง|รถยนต์นั่ง|ส่วนบุคคล|sedan/.test(lower)) return 'รถยนต์นั่งส่วนบุคคล';
    if (/บรรทุก|พ่วง|สิบล้อ|truck|trailer/.test(lower)) return 'รถบรรทุกใหญ่';
  }
  if (field === 'cause') {
    if (/ขับเร็ว|ความเร็ว|เร็วเกิน/.test(text)) return 'ขับรถเร็วเกินกำหนด';
    if (/ตัดหน้า|กระชั้นชิด/.test(text)) return 'ตัดหน้ากระชั้นชิด';
    if (/เมา|แอลกอฮอล์|สุรา/.test(text)) return 'เมาสุรา';
    if (/หลับใน|เพลีย|อ่อนล้า/.test(text)) return 'หลับใน';
  }
  return text || 'ไม่ระบุ';
}

const SEMANTIC_COLORS = ['#780000','#A91B18','#C1121F','#AE1F23','#FF8C00','#D97706','#003049','#669BBC','#9333ea','#1e40af','#db2777','#6b7280'];
function categoryEntries(records, field) {
  const counts = new Map();
  for (const r of records) {
    const label = normalizeCategory(field, r[field]);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()].sort((a,b)=>b[1]-a[1]);
}

function setSemanticFilter(field, value) {
  semanticFilters[field] = semanticFilters[field] === value ? 'all' : value;
  render();
}

function renderSemanticCharts() {
  const vehicleRecords = getFilteredRecords('vehicle');
  renderPie('semantic-vehicle', categoryEntries(vehicleRecords, 'vehicle'), 'vehicle');
  renderTreemap('semantic-cause', categoryEntries(getFilteredRecords('cause'), 'cause'), 'cause');
  renderTreemap('semantic-collision', categoryEntries(getFilteredRecords('collision'), 'collision'), 'collision');
  renderWeather(getFilteredRecords('weather'));
  renderDonut('semantic-roadtype', categoryEntries(getFilteredRecords(), 'agency'));
  const active = Object.entries(semanticFilters).filter(([,v])=>v!=='all');
  const status = document.getElementById('semantic-filter-status');
  if (status) status.hidden = active.length === 0;
  setText('semantic-filter-label', active.map(([k,v])=>`${({vehicle:'ยานพาหนะ',cause:'มูลเหตุ',collision:'ลักษณะเหตุ',weather:'สภาพอากาศ'})[k]}: ${v}`).join(' · '));
}

function renderPie(id, entries, field, donut=false) {
  const host=document.getElementById(id); if(!host) return;
  host.replaceChildren();
  const total=entries.reduce((s,[,v])=>s+v,0)||1;
  const donutPalette=['#C1121F','#CEE7F3','#181717'];
  const colors=entries.map((_,i)=>donut?donutPalette[i%donutPalette.length]:SEMANTIC_COLORS[i%SEMANTIC_COLORS.length]);
  let angle=0; const stops=entries.map(([name,value],i)=>{const start=angle;angle+=value/total*360;return `${colors[i]} ${start}deg ${angle}deg`;});
  const wrap=document.createElement('div');wrap.className='pie-layout';
  const pie=document.createElement('div');pie.className=donut?'donut-visual':'pie-visual';pie.style.background=stops.length?`conic-gradient(${stops.join(',')})`:'conic-gradient(#e5e7eb 0deg 360deg)';
  const legend=document.createElement('div');legend.className='chart-legend-list';
  entries.slice(0,12).forEach(([name,value],i)=>{
    const button=document.createElement('button');button.type='button';button.className='chart-legend-item';
    if(field && semanticFilters[field]===name) button.classList.add('is-selected');
    button.title=`${name}: ${fmt.format(value)} เหตุการณ์ (${(100*value/total).toFixed(1)}%)`;
    button.innerHTML=`<i style="--legend-color:${colors[i]}"></i><span>${escapeHtml(name)}</span><b>${fmt.format(value)} <small>(${(100*value/total).toFixed(1)}%)</small></b>`;
    if(field) button.addEventListener('click',()=>setSemanticFilter(field,name));
    legend.append(button);
  });
  wrap.append(pie,legend);host.append(wrap);
}

function renderDonut(id, entries) { renderPie(id,entries,null,true); }

function renderTreemap(id, entries, field) {
  const host=document.getElementById(id);if(!host)return;host.replaceChildren();
  const total=entries.reduce((s,[,n])=>s+n,0)||1;
  entries.slice(0,16).forEach(([name,value],i)=>{
    const tile=document.createElement('button');tile.type='button';tile.className='treemap-tile';
    tile.style.flexBasis=`${Math.max(13,100*value/total)}%`;tile.style.background=SEMANTIC_COLORS[i%SEMANTIC_COLORS.length];
    tile.classList.toggle('is-selected',semanticFilters[field]===name);
    tile.title=`${name}: ${fmt.format(value)} เหตุการณ์ (${(100*value/total).toFixed(1)}%)`;
    tile.innerHTML=`<span>${escapeHtml(name)}</span><b>${fmt.format(value)}</b>`;
    tile.addEventListener('click',()=>setSemanticFilter(field,name));host.append(tile);
  });
  if(!entries.length)host.textContent='ไม่มีข้อมูลในตัวกรองนี้';
}

function renderWeather(records) {
  const host=document.getElementById('semantic-weather');if(!host)return;host.replaceChildren();
  const entries=categoryEntries(records,'weather'),total=entries.reduce((s,[,v])=>s+v,0)||1;
  const iconFor=(name)=>/ฝน/.test(name)?'🌧️':/หมอก|ควัน/.test(name)?'🌫️':/แดด|แจ้ง|ปกติ|แห้ง/.test(name)?'☀️':/ลม/.test(name)?'💨':'🌤️';
  entries.slice(0,10).forEach(([name,value])=>{
    const button=document.createElement('button');button.type='button';button.className='weather-tile';
    button.classList.toggle('is-selected',semanticFilters.weather===name);
    button.title=`${name}: ${fmt.format(value)} เหตุการณ์ (${(100*value/total).toFixed(1)}%)`;
    button.innerHTML=`<span class="weather-icon">${iconFor(name)}</span><strong>${escapeHtml(name)}</strong><b>${fmt.format(value)}</b><small>${(100*value/total).toFixed(1)}%</small>`;
    button.addEventListener('click',()=>setSemanticFilter('weather',name));host.append(button);
  });
  if(!entries.length)host.textContent='ไม่มีข้อมูลในตัวกรองนี้';
}

/* Draw Map */
function drawMap(fitBounds = false) {
  if (!DATA || !leafletMap || !mapAssetsLoaded) return;

  const showRoads = document.getElementById('show-roads')?.checked ?? true;
  const showPoints = document.getElementById('show-points')?.checked ?? true;
  const showBoundary = document.getElementById('show-boundary')?.checked ?? true;

  const records = getFilteredRecords();
  provinceFatalityCounts = new Map();
  provinceEventCounts = new Map();
  for (const record of records) {
    const province = record.province || 'ไม่ระบุ';
    provinceFatalityCounts.set(province, (provinceFatalityCounts.get(province) || 0) + (Number(record.fatalities) || 0));
    provinceEventCounts.set(province, (provinceEventCounts.get(province) || 0) + 1);
  }
  const roads = getFilteredRoads();

  // 1. Update Province Boundaries Layer
  boundaryLayer.clearLayers();
  if (showBoundary && PROVINCES_GEO) {
    boundaryLayer.addData(PROVINCES_GEO);
  }

  // 2. Render source road centerlines. They remain a reference overlay and
  // are not used to infer crash counts by road segment.
  roadLayer.clearLayers();
  if (showRoads && roads.length > 0) {
    // Render 4+ digits first, then 3 digits, then 2 digits, then 1 digit on top
    const sortedRoads = [...roads].sort((a, b) => (b.digits || 99) - (a.digits || 99));

    for (const road of sortedRoads) {
      const dType = road.digit_type;
      let color = HIGHWAY_COLORS[dType] || HIGHWAY_COLORS.unknown;
      let weight = 1.6;
      let opacity = 0.65;

      if (dType === 'digit_1') {
        color = HIGHWAY_COLORS.digit_1; // #9333ea Purple
        weight = 3.6;
        opacity = 0.95;
      } else if (dType === 'digit_2') {
        color = HIGHWAY_COLORS.digit_2; // #2563eb Blue
        weight = 2.8;
        opacity = 0.92;
      } else if (dType === 'digit_3') {
        color = HIGHWAY_COLORS.digit_3; // #ec4899 Pink
        weight = 2.2;
        opacity = 0.88;
      }

      for (const line of road.lines) {
        const latlngs = line.map(([lon, lat]) => [lat, lon]);
        const poly = L.polyline(latlngs, {
          color,
          weight,
          opacity
        });

        poly.bindPopup(`
          <div style="font-family:'Plus Jakarta Sans','Prompt',sans-serif;">
            <strong style="font-size:13px;color:${color};">
              ทล. ${escapeHtml(road.highway_code || 'ไม่ระบุ')}
            </strong> · <span style="font-size:11px;color:#64748b;">${escapeHtml(road.road_code || '')}</span>
            <div style="margin-top:4px;font-size:12px;font-weight:600;">
              ${escapeHtml(road.road_name || road.highway_name || 'ไม่ระบุชื่อสายทาง')}
            </div>
            <div style="margin-top:6px;font-size:11px;line-height:1.6;color:#64748b;">
              <div><b>ประเภท:</b> <span style="color:${color};font-weight:700;">${escapeHtml(road.digit_label || 'ไม่ระบุ')}</span></div>
              <div><b>พื้นที่ของช่วงทาง:</b> จ.${escapeHtml(road.province)} (${escapeHtml(road.region)})</div>
              <div><b>เลขหลักกิโลเมตร:</b> ${escapeHtml(road.road_code || 'ไม่ระบุ')}</div>
            </div>
          </div>
        `);
        poly.addTo(roadLayer);
      }
    }
  }

  // 4. Render Fatal Incident Markers Layer
  pointLayer.clearLayers();
  if (showPoints) {
    const validPoints = records.filter(r => isValue(r.latitude) && isValue(r.longitude));
    const markers = [];
    for (const r of validPoints) {
      const latlng = [Number(r.latitude), Number(r.longitude)];
      const fatal = (Number(r.fatalities) || 0) > 0;
      const marker = hasMarkerCluster
        ? L.marker(latlng, {
            icon: L.divIcon({
              className: fatal ? 'fatality-marker' : 'accident-marker',
              html: '',
              iconSize: [10, 10],
              iconAnchor: [5, 5]
            })
          })
        : L.circleMarker(latlng, {
            radius: 3.5,
            weight: 1.5,
            color: '#ffffff',
            fillColor: fatal ? '#C1121F' : '#669BBC',
            fillOpacity: 0.88
          });

      marker.bindPopup(() => `
        <div style="font-family:'Plus Jakarta Sans','Prompt',sans-serif;">
          <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e2e8f0;padding-bottom:4px;margin-bottom:6px;">
            <strong style="color:${fatal ? '#C1121F' : '#003049'};font-size:13px;">${fatal ? 'เหตุการณ์เสียชีวิต' : 'อุบัติเหตุ'} #${escapeHtml(r.id)}</strong>
            <span style="font-size:11px;color:#64748b;">${escapeHtml(r.incident_date || 'ไม่ระบุ')} ${escapeHtml(r.incident_time || '')}</span>
          </div>
          <div style="font-size:11px;line-height:1.6;color:#334155;">
            <div><b>สถานที่:</b> จ.${escapeHtml(r.province)} (${escapeHtml(r.region)})</div>
            <div><b>สายทาง:</b> ทล. ${escapeHtml(r.highway_code || 'ไม่ระบุ')} · ${escapeHtml(r.road_name)}</div>
            <div><b>ความสูญเสีย:</b> <span style="color:#C1121F;font-weight:700;">ผู้เสียชีวิต ${fmt.format(r.fatalities || 0)} ราย</span> · บาดเจ็บ ${fmt.format(r.injuries || 0)} ราย</div>
            <div><b>ยานพาหนะ:</b> ${escapeHtml(r.vehicle)}</div>
            <div><b>ลักษณะเหตุ:</b> ${escapeHtml(r.collision)}</div>
            <div><b>มูลเหตุสันนิษฐาน:</b> ${escapeHtml(r.cause)}</div>
            <div><b>สภาพอากาศ:</b> ${escapeHtml(r.weather)}</div>
            <div><b>พิกัด:</b> ${r.latitude.toFixed(5)}, ${r.longitude.toFixed(5)}</div>
          </div>
        </div>
      `);
      markers.push(marker);
    }
    if (hasMarkerCluster) pointLayer.addLayers(markers);
    else markers.forEach(marker => pointLayer.addLayer(marker));
  }

  // 5. Empty State & Summary Check
  const emptyEl = document.getElementById('map-empty');
  const emptyDescEl = document.getElementById('map-empty-desc');
  if (emptyEl) {
    if (records.length === 0) {
      emptyEl.hidden = false;
      if (emptyDescEl) {
        const area = selectedProvince !== 'all' ? `จ.${selectedProvince}` : (selectedRegion !== 'all' ? selectedRegion : 'ประเทศไทย');
        emptyDescEl.textContent = `ไม่มีเหตุการณ์ที่ตรงกับตัวกรองใน ${area}`;
      }
    } else {
      emptyEl.hidden = true;
    }
  }

  // 6. Map Summary Text
  const summaryEl = document.getElementById('map-summary');
  if (summaryEl) {
    const validCoords = records.filter(r => isValue(r.latitude) && isValue(r.longitude)).length;
    const totalDeaths = records.reduce((s, r) => s + (Number(r.fatalities) || 0), 0);
    summaryEl.textContent = `แสดง ${fmt.format(validCoords)} เหตุการณ์มีพิกัด (${fmt.format(totalDeaths)} ผู้เสียชีวิต) · ${roads.length ? `${fmt.format(roads.length)} ช่วงถนน` : 'แนวถนนยังไม่เชื่อมเข้าหน้านี้'}`;
  }

  // 7. Dynamic Viewport Zooming
  if (fitBounds) {
    updateMapView(true);
  }

  // 8. Update Breadcrumbs & Status
  updateBreadcrumbs();
  updateFilterStatusBar(records, roads);

  // 9. Update Hotspots List
  drawHotspots(records, new Map());
}

async function loadMapAssets() {
  if (mapAssetsPromise) return mapAssetsPromise;
  mapAssetsPromise = (async () => {
    const summary = document.getElementById('map-summary');
    if (summary) summary.textContent = 'กำลังโหลดขอบเขตจังหวัดและโครงข่ายถนน…';
    const [geoResponse, roadsResponse] = await Promise.all([
      fetch('data/provinces.geojson'),
      fetch('data/roads.json')
    ]);
    if (!geoResponse.ok) throw new Error(`โหลด provinces.geojson ไม่สำเร็จ (${geoResponse.status})`);
    PROVINCES_GEO = await geoResponse.json();
    DATA.roads = roadsResponse.ok ? await roadsResponse.json() : [];

    for (const feat of PROVINCES_GEO.features || []) {
      const props = feat.properties || (feat.properties = {});
      const pname = props.PROV_NAM_T || props.pro_th;
      props.pro_th = pname === 'อยุธยา' ? 'พระนครศรีอยุธยา' : pname;
      const regEn = props.REGION_6 || props.reg_th || props.reg_royin;
      const regTh = {
        North: 'ภาคเหนือ', Northeast: 'ภาคตะวันออกเฉียงเหนือ', Central: 'ภาคกลาง',
        East: 'ภาคตะวันออก', West: 'ภาคตะวันตก', South: 'ภาคใต้'
      }[regEn] || regEn;
      props.reg_th = regTh;
      if (!props.pro_th || !DATA.provinces) continue;
      const bounds = L.geoJSON(feat).getBounds();
      if (!bounds.isValid()) continue;
      const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
      DATA.provinces[props.pro_th] = {province: props.pro_th, region: regTh, bbox};
      if (!DATA.regions[regTh]) DATA.regions[regTh] = {bbox};
      else {
        const old = DATA.regions[regTh].bbox;
        DATA.regions[regTh].bbox = [Math.min(old[0],bbox[0]),Math.min(old[1],bbox[1]),Math.max(old[2],bbox[2]),Math.max(old[3],bbox[3])];
      }
    }
    const provinceRegions = Object.fromEntries((PROVINCES_GEO.features || []).map(f => [f.properties?.pro_th, f.properties?.reg_th]));
    for (const record of DATA.records || []) record.region = provinceRegions[record.province] || record.region || 'ไม่ระบุ';
    for (const road of DATA.roads || []) road.region = road.region || provinceRegions[road.province] || 'ไม่ระบุ';
    mapAssetsLoaded = true;
    syncFilterDropdowns();
    updateMapView(false);
    drawMap(false);
    window.HighwayScatter?.render(document.getElementById('highway-scatter-chart'), getFilteredRecords(), DATA.roads, highlightRoadSegment);
    if (pendingRoadHighlightId !== null) highlightRoadSegment(pendingRoadHighlightId);
  })().catch(err => {
    mapAssetsPromise = null;
    const summary = document.getElementById('map-summary');
    if (summary) summary.textContent = `โหลดชั้นข้อมูลแผนที่ไม่สำเร็จ: ${err.message}`;
    console.error('Error loading map layers:', err);
    throw err;
  });
  return mapAssetsPromise;
}

function normalizeRoadFeatureId(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(Math.trunc(numeric)) : String(value ?? '').trim();
}

function highlightRoadSegment(featureId) {
  pendingRoadHighlightId = featureId;
  if (!mapAssetsLoaded) {
    loadMapAssets().catch(() => {});
    return;
  }
  const targetId = normalizeRoadFeatureId(featureId);
  const road = (DATA?.roads || []).find(item => normalizeRoadFeatureId(item.id) === targetId);
  const summary = document.getElementById('scatter-selection');
  if (!road || !roadHighlightLayer || !leafletMap) {
    if (summary) summary.insertAdjacentHTML('beforeend', '<div class="scatter-map-note">ไม่พบ Geometry ของช่วงทางนี้ในชั้นแผนที่</div>');
    return;
  }
  roadHighlightLayer.clearLayers();
  const highlightLines = [];
  for (const line of road.lines || []) {
    const polyline = L.polyline(line.map(([lon,lat])=>[lat,lon]), {
      color: '#FFD700', weight: 7, opacity: .98, lineCap: 'round', lineJoin: 'round'
    });
    polyline.bindPopup(`<strong>ทล. ${escapeHtml(road.highway_code || 'ไม่ระบุ')}</strong><br>${escapeHtml(road.road_name || road.highway_name || 'ไม่ระบุชื่อช่วงทาง')}<br>ช่วงทาง ${escapeHtml(road.road_code || 'ไม่ระบุ')} · จ.${escapeHtml(road.province || 'ไม่ระบุ')}`);
    polyline.addTo(roadHighlightLayer);
    highlightLines.push(polyline);
  }
  if (!highlightLines.length) {
    if (summary) summary.insertAdjacentHTML('beforeend', '<div class="scatter-map-note">ช่วงทางนี้ไม่มี LineString geometry ให้แสดง</div>');
    return;
  }
  const bounds = roadHighlightLayer.getBounds();
  if (bounds.isValid()) leafletMap.fitBounds(bounds, {padding:[48,48], maxZoom:14, animate:true});
  highlightLines[0].openPopup();
}

function setupLazyMapLoading() {
  const mapSection = document.querySelector('.map-panel');
  if (!mapSection) return;
  if (!('IntersectionObserver' in window)) {
    loadMapAssets().catch(() => {});
    return;
  }
  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) {
      observer.disconnect();
      loadMapAssets().catch(() => {});
    }
  }, {rootMargin: '700px 0px'});
  observer.observe(mapSection);
}

/* Hotspots Ranking List */
function drawHotspots(records, counts) {
  const list = document.getElementById('hotspots-list');
  const tag = document.getElementById('hotspots-tag');
  if (!list) return;

  if (tag) {
    let t = 'จัดอันดับตามตัวกรอง';
    if (selectedProvince !== 'all') t = `จ.${selectedProvince}`;
    else if (selectedRegion !== 'all') t = selectedRegion;
    tag.textContent = t;
  }

  list.replaceChildren();

  if (!DATA?.roads || !counts.size) {
    list.innerHTML = '<div style="padding:16px;grid-column:1/-1;text-align:center;color:var(--ink-muted);">ยังไม่แสดงสถิติระดับช่วงทาง จนกว่าจะตรวจสอบการจับคู่เหตุการณ์กับโครงข่ายถนนแล้ว</div>';
    return;
  }

  const features = new Map(DATA.roads.map(r => [String(r.id), r]));
  
  // Filter roads according to current filters
  const validRoadIds = new Set(getFilteredRoads().map(r => String(r.id)));

  const ranked = [...counts.entries()]
    .filter(([id]) => validRoadIds.has(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (!ranked.length) {
    list.innerHTML = '<div style="padding:16px;grid-column:1/-1;text-align:center;color:var(--ink-muted);">ไม่มีช่วงทางหลวงที่มีผู้เสียชีวิตในพื้นที่และประเภทเลขที่เลือก</div>';
    return;
  }

  let rankNum = 1;
  for (const [id, count] of ranked) {
    const road = features.get(id);
    if (!road) continue;

    const row = document.createElement('div');
    row.className = 'hotspot-row';

    const rankEl = document.createElement('div');
    rankEl.className = `hotspot-rank ${rankNum <= 3 ? `rank-${rankNum}` : ''}`;
    rankEl.textContent = rankNum;

    const title = document.createElement('strong');
    title.textContent = `ทล. ${road.highway_code || 'ไม่ระบุ'}`;
    title.style.color = HIGHWAY_COLORS[road.digit_type] || 'inherit';

    const name = document.createElement('span');
    name.textContent = `${road.road_name || road.highway_name || 'ไม่ระบุชื่อ'} (${road.province})`;
    name.title = name.textContent;

    const value = document.createElement('b');
    value.textContent = `${fmt.format(count)} ราย`;

    row.append(rankEl, title, name, value);
    list.append(row);
    rankNum++;
  }
}

/* Map Setup */
function setupMap() {
  if (!window.L) {
    throw new Error('โหลด Leaflet ไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต');
  }

  leafletMap = L.map('road-map', {
    preferCanvas: true,
    scrollWheelZoom: true,
    zoomControl: true
  }).setView([13.736717, 100.523186], 6);

  const isDark = document.body.dataset.theme === 'dark';
  currentTileLayer = L.tileLayer(getTileUrl(isDark), {
    maxZoom: 19,
    attribution: 'Imagery &copy; <a href="https://www.esri.com/" target="_blank">Esri</a>, Maxar, Earthstar Geographics and contributors'
  }).addTo(leafletMap);
  labelTileLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    opacity: 0.96,
    attribution: 'Transportation labels &copy; <a href="https://www.esri.com/" target="_blank">Esri</a>'
  }).addTo(leafletMap);

  // 1. Boundary Layer (GeoJSON)
  boundaryLayer = L.geoJSON(null, {
    style: getProvinceStyle,
    onEachFeature: (feature, layer) => {
      const pname = feature.properties?.pro_th;
      const reg = feature.properties?.reg_th;
      
      layer.bindTooltip(() => `<strong>${escapeHtml(pname)}</strong> (${escapeHtml(reg)})<br>${fmt.format(provinceFatalityCounts.get(pname)||0)} ผู้เสียชีวิต · ${fmt.format(provinceEventCounts.get(pname)||0)} เหตุการณ์`, {
        sticky: true,
        direction: 'top',
        className: 'province-tooltip'
      });

      layer.on('click', () => {
        if (pname && DATA?.provinces?.[pname]) {
          selectedProvince = pname;
          selectedRegion = DATA.provinces[pname].region;
          syncFilterDropdowns();
          updateMapView(true);
          render();
        }
      });
    }
  }).addTo(leafletMap);

  // 2. Road Network Layer (Polyline)
  roadLayer = L.layerGroup().addTo(leafletMap);
  roadHighlightLayer = L.layerGroup().addTo(leafletMap);

  // 3. Fatality Points Layer (MarkerCluster)
  hasMarkerCluster = typeof L.markerClusterGroup === 'function';
  pointLayer = hasMarkerCluster
    ? L.markerClusterGroup({
        chunkedLoading: true,
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        maxClusterRadius: 40
      })
    : L.layerGroup();
  pointLayer.addTo(leafletMap);

  // Listeners for UI toggles
  document.getElementById('show-roads')?.addEventListener('change', () => drawMap(false));
  document.getElementById('show-points')?.addEventListener('change', () => drawMap(false));
  document.getElementById('show-boundary')?.addEventListener('change', () => drawMap(false));

  // Region Filter Change
  document.getElementById('region-filter')?.addEventListener('change', e => {
    selectedRegion = e.target.value;
    selectedProvince = 'all'; // Clear previous province
    syncFilterDropdowns();
    updateMapView(true);
    render();
  });

  // Province Filter Change
  document.getElementById('province-filter')?.addEventListener('change', e => {
    selectedProvince = e.target.value;
    if (selectedProvince !== 'all' && DATA?.provinces?.[selectedProvince]) {
      // Auto-assign corresponding region
      selectedRegion = DATA.provinces[selectedProvince].region;
    }
    syncFilterDropdowns();
    updateMapView(true);
    render();
  });

  // Highway Digit Filter Change (Does NOT reset region/province zoom!)
  document.getElementById('highway-digit-filter')?.addEventListener('change', e => {
    selectedHighwayDigits = e.target.value;
    render();
  });

  // Reset Filters Button
  document.getElementById('map-reset')?.addEventListener('click', () => {
    selectedRegion = 'all';
    selectedProvince = 'all';
    selectedHighwayDigits = 'all';
    syncFilterDropdowns();
    updateMapView(true);
    render();
  });
}

/* Charts & TRAMS Visualizations */
function summarizeFilteredRecords(records) {
  const monthly = Array(12).fill(0), weekdays = Array(7).fill(0), hours = Array(12).fill(0);
  const counts = Object.fromEntries(['provinces','vehicle','cause','collision','weather','road_type'].map(k => [k, new Map()]));
  const inc = (map, key, n = 1) => map.set(key || 'ไม่ระบุ', (map.get(key || 'ไม่ระบุ') || 0) + n);
  for (const r of records) {
    if (r.incident_date) {
      const d = new Date(`${r.incident_date}T00:00:00Z`);
      if (!Number.isNaN(+d)) { monthly[d.getUTCMonth()]++; weekdays[(d.getUTCDay()+6)%7]++; }
    }
    const h = Number.parseInt(String(r.incident_time || '').slice(0,2), 10);
    if (Number.isFinite(h) && h >= 0 && h < 24) hours[Math.floor(h/2)]++;
    inc(counts.provinces, r.province);
    inc(counts.vehicle, r.vehicle);
    inc(counts.cause, r.cause);
    inc(counts.collision, r.collision);
    inc(counts.weather, r.weather);
    inc(counts.road_type, r.agency);
  }
  const pairs = map => [...map.entries()].sort((a,b)=>b[1]-a[1]);
  return {events:records.length, fatalities:records.reduce((s,r)=>s+(Number(r.fatalities)||0),0),
    fatal_events:records.filter(r=>(Number(r.fatalities)||0)>0).length,
    serious:records.reduce((s,r)=>s+(Number(r.injuries_severe)||0),0),
    minor:records.reduce((s,r)=>s+(Number(r.injuries_minor)||0),0),
    injuries:records.reduce((s,r)=>s+(Number(r.injuries)||0),0),
    vehicles:records.filter(r=>r.vehicle&&r.vehicle!=='ไม่ระบุ').length,
    coordinates:records.filter(r=>isValue(r.latitude)&&isValue(r.longitude)).length,
    monthly,weekdays,hours,provinces:pairs(counts.provinces).map(([p,n])=>[p,n,records.filter(r=>r.province===p).reduce((s,r)=>s+(Number(r.fatalities)||0),0),records.filter(r=>r.province===p).reduce((s,r)=>s+(Number(r.injuries)||0),0)]),
    vehicle:pairs(counts.vehicle),cause:pairs(counts.cause),collision:pairs(counts.collision),weather:pairs(counts.weather),road_type:pairs(counts.road_type)};
}

function selectedAccidentYears() {
  if (!ACCIDENTS?.years) return [];
  if (selectedRegion !== 'all' || selectedProvince !== 'all' || selectedVehicle !== 'all' || selectedFatality !== 'all' || selectedHighwayDigits !== 'all' || Object.values(semanticFilters).some(v=>v!=='all') || document.getElementById('road-search')?.value.trim()) {
    const selected = getFilteredRecords();
    const year = selectedYear === 'all' ? 'รวม' : selectedYear;
    return [[year, summarizeFilteredRecords(selected)]];
  }
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

/* Chart 1: Weekday Accidents */
function drawWeekday(records) {
  const canvas = document.getElementById('weekday-chart');
  const s = resizeCanvas(canvas);
  if (!s) return;
  const { ctx, w, h } = s, theme = chartTheme();
  ctx.clearRect(0, 0, w, h);

  const counts = Array(7).fill(0);
  for (const r of records) {
    if (!r.incident_date) continue;
    const date = new Date(`${r.incident_date}T00:00:00Z`);
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
  WEEKDAYS.forEach((day, i) => {
    const y = top + i * rowH;
    const barH = Math.min(18, rowH * 0.55);
    const val = counts[i];
    const isWeekend = i === 5 || i === 6;

    ctx.fillStyle = isWeekend ? (document.body.dataset.theme === 'dark' ? '#fda4af' : '#e11d48') : theme.text;
    ctx.textAlign = 'right';
    ctx.fillText(day, left - 10, y + rowH * 0.62);

    ctx.fillStyle = theme.track;
    roundedRect(ctx, left, y + (rowH - barH) / 2, barW, barH, 5);
    ctx.fill();

    const fillW = Math.max(3, barW * val / max);
    const grad = ctx.createLinearGradient(left, 0, left + fillW, 0);
    if (isWeekend) {
      grad.addColorStop(0, '#780000');
      grad.addColorStop(1, '#C1121F');
    } else {
      grad.addColorStop(0, theme.accent1);
      grad.addColorStop(1, '#669BBC');
    }
    ctx.fillStyle = grad;
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
      html: `<strong>วัน${WEEKDAYS[idx]}</strong>
        <div class="tt-item"><span>จำนวนเหตุการณ์:</span> <span class="tt-val">${fmt.format(val)} เหตุการณ์</span></div>
        <div class="tt-item"><span>สัดส่วนในสัปดาห์:</span> <span class="tt-val">${pct}%</span></div>`
    };
  };
}

/* Chart 2: Monthly Trend */
function drawTrend(records) {
  const canvas = document.getElementById('trend-chart');
  const s = resizeCanvas(canvas);
  if (!s) return;
  const { ctx, w, h } = s;
  ctx.clearRect(0, 0, w, h);

  const pad = { l: 48, r: 16, t: 16, b: 32 };
  const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
  const years = ['2023', '2024', '2025'];
  const colors = { '2023': '#003049', '2024': '#669BBC', '2025': '#A91B18' };

  const values = Object.fromEntries(years.map(y => [y, Array(12).fill(0)]));
  for (const r of records) {
    if (!r.incident_date) continue;
    const d = new Date(`${r.incident_date}T00:00:00Z`);
    if (Number.isNaN(+d)) continue;
    const y = String(d.getUTCFullYear());
    if (values[y]) values[y][d.getUTCMonth()]++;
  }

  const max = Math.max(1, ...years.flatMap(y => values[y]));
  const theme = chartTheme();

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

  MONTHS.forEach((m, i) => {
    ctx.textAlign = 'center';
    ctx.fillStyle = theme.text;
    ctx.font = `600 10px ${theme.font}`;
    ctx.fillText(m, pad.l + cw * i / 11, h - 10);
  });

  years.forEach(yr => {
    if (selectedYear !== 'all' && selectedYear !== yr) return;
    const color = colors[yr];
    const valArr = values[yr];

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

  const lg = document.getElementById('trend-legend');
  if (lg) {
    lg.replaceChildren();
    years.forEach(yr => {
      if (selectedYear !== 'all' && selectedYear !== yr) return;
      const item = document.createElement('span');
      item.className = 'legend-year';
      item.innerHTML = `<i style="background:${colors[yr]}"></i>พ.ศ. ${Number(yr) + 543}`;
      lg.appendChild(item);
    });
  }

  canvas._chartTooltipHandler = (mx, my) => {
    if (mx < pad.l - 10 || mx > w - pad.r + 10) return null;
    const mIdx = Math.min(11, Math.max(0, Math.round(((mx - pad.l) / cw) * 11)));
    let lines = `<strong>เดือน${MONTHS_FULL[mIdx]}</strong>`;
    years.forEach(yr => {
      if (selectedYear !== 'all' && selectedYear !== yr) return;
      const c = colors[yr];
      const count = values[yr][mIdx];
      lines += `<div class="tt-item"><span style="color:${c}">● พ.ศ. ${Number(yr) + 543}:</span> <span class="tt-val">${fmt.format(count)} เหตุการณ์</span></div>`;
    });
    return { html: lines };
  };
}

function drawWeekdayHour(records) {
  const canvas = document.getElementById('weekday-hour-chart');
  const s = resizeCanvas(canvas);
  if (!s) return;
  const { ctx, w, h } = s, theme = chartTheme();
  ctx.clearRect(0, 0, w, h);
  const cells = Array.from({length:7},()=>Array(24).fill(0));
  const dayTotals = Array(7).fill(0), hourTotals = Array(24).fill(0);
  for (const r of records) {
    if (!r.incident_date) continue;
    const date = new Date(`${r.incident_date}T00:00:00Z`);
    const hour = Number.parseInt(String(r.incident_time || '').slice(0,2),10);
    if (Number.isNaN(+date) || !Number.isFinite(hour) || hour<0 || hour>23) continue;
    const day=(date.getUTCDay()+6)%7; cells[day][hour]++; dayTotals[day]++; hourTotals[hour]++;
  }
  const max=Math.max(1,...cells.flat()), pad={l:74,r:48,t:24,b:34};
  const cw=(w-pad.l-pad.r)/25, ch=(h-pad.t-pad.b)/8;
  const totalBackground = document.body.dataset.theme === 'dark' ? '#374151' : '#e5e7eb';
  ctx.font=`600 8px ${theme.font}`; ctx.textAlign='center'; ctx.textBaseline='middle';
  for(let i=0;i<24;i++){ctx.fillStyle=theme.textMuted;ctx.fillText(String(i).padStart(2,'0'),pad.l+(i+.5)*cw,12);}
  ctx.fillText('รวม',pad.l+24.5*cw,12);
  WEEKDAYS.forEach((day,y)=>{
    ctx.textAlign='right';ctx.fillStyle=theme.text;ctx.fillText(day,pad.l-8,pad.t+(y+.5)*ch);
    for(let x=0;x<25;x++){
      const v=x===24?dayTotals[y]:cells[y][x],alpha=x===24?.18+.82*v/Math.max(1,...dayTotals):.12+.88*v/max;
      {
        ctx.fillStyle=x===24?totalBackground:heatColor(alpha);
        ctx.fillRect(pad.l+x*cw+1,pad.t+y*ch+1,Math.max(1,cw-2),Math.max(1,ch-2));
      }
      if(cw>22){ctx.fillStyle=x!==24&&alpha>.84?'#fff':theme.text;ctx.textAlign='center';ctx.fillText(fmt.format(v),pad.l+(x+.5)*cw,pad.t+(y+.5)*ch);}
    }
  });
  ctx.textAlign='right';ctx.fillStyle=theme.text;ctx.fillText('รวม',pad.l-8,pad.t+7.5*ch);
  for(let x=0;x<25;x++){
    const v=x===24?dayTotals.reduce((a,b)=>a+b,0):hourTotals[x];
    ctx.fillStyle=totalBackground;ctx.fillRect(pad.l+x*cw+1,pad.t+7*ch+1,Math.max(1,cw-2),Math.max(1,ch-2));
    ctx.fillStyle=theme.text;ctx.textAlign='center';ctx.fillText(fmt.format(v),pad.l+(x+.5)*cw,pad.t+7.5*ch);
  }
}

function heatColor(t){
  const stops=[[255,215,0],[255,140,0],[169,27,24]],v=Math.max(0,Math.min(.999,t))*2,i=Math.floor(v),f=v-i,a=stops[i],b=stops[i+1];
  return `rgb(${a.map((c,j)=>Math.round(c+(b[j]-c)*f)).join(',')})`;
}

/* Horizontal Bar Chart Generator */
function drawBars(canvasId, items, color, maxItems = 8) {
  const canvas = document.getElementById(canvasId);
  const s = resizeCanvas(canvas);
  if (!s) return;
  const { ctx, w, h } = s, theme = chartTheme();
  ctx.clearRect(0, 0, w, h);

  const topItems = items.slice(0, maxItems);
  if (!topItems.length) {
    ctx.fillStyle = theme.textMuted;
    ctx.textAlign = 'center';
    ctx.font = `500 12px ${theme.font}`;
    ctx.fillText('ไม่มีข้อมูลในตัวกรองนี้', w / 2, h / 2);
    return;
  }

  const max = Math.max(1, ...topItems.map(x => x[1]));
  const total = items.reduce((a, b) => a + b[1], 0) || 1;
  const left = Math.min(125, w * 0.36);
  const right = 50;
  const top = 10;
  const rowH = (h - 20) / topItems.length;
  const barW = Math.max(10, w - left - right);

  ctx.font = `600 10.5px ${theme.font}`;
  topItems.forEach(([name, val], i) => {
    const y = top + i * rowH;
    const barH = Math.min(17, rowH * 0.58);

    ctx.fillStyle = theme.text;
    ctx.textAlign = 'right';
    let truncated = name;
    if (ctx.measureText(truncated).width > left - 12) {
      while (truncated.length > 2 && ctx.measureText(truncated + '…').width > left - 12) {
        truncated = truncated.slice(0, -1);
      }
      truncated += '…';
    }
    ctx.fillText(truncated, left - 8, y + rowH * 0.62);

    ctx.fillStyle = theme.track;
    roundedRect(ctx, left, y + (rowH - barH) / 2, barW, barH, 4);
    ctx.fill();

    const fillW = Math.max(3, barW * val / max);
    ctx.fillStyle = color;
    roundedRect(ctx, left, y + (rowH - barH) / 2, fillW, barH, 4);
    ctx.fill();

    ctx.fillStyle = theme.text;
    ctx.textAlign = 'left';
    ctx.font = `700 10px ${theme.font}`;
    ctx.fillText(fmt.format(val), left + fillW + 6, y + rowH * 0.62);
  });

  canvas._chartTooltipHandler = (mx, my) => {
    if (my < top || my > h - 10) return null;
    const idx = Math.floor((my - top) / rowH);
    if (idx < 0 || idx >= topItems.length) return null;
    const [name, val] = topItems[idx];
    const pct = ((val / total) * 100).toFixed(1);
    return {
      html: `<strong>${escapeHtml(name)}</strong>
        <div class="tt-item"><span>จำนวน:</span> <span class="tt-val">${fmt.format(val)} รายการ</span></div>
        <div class="tt-item"><span>สัดส่วน:</span> <span class="tt-val">${pct}%</span></div>`
    };
  };
}

/* Update TRAMS Dashboard Section */
function updateAccidentDashboard() {
  if (!ACCIDENTS) return;
  setText('incident-events', fmt.format(accidentTotal('events')));
  setText('incident-fatalities', fmt.format(accidentTotal('fatalities')));
  setText('incident-fatal-events', fmt.format(accidentTotal('fatal_events')));
  setText('incident-serious', fmt.format(accidentTotal('serious')));
  setText('incident-injuries', fmt.format(accidentTotal('injuries')));

  const filteredRecords = getFilteredRecords();
  renderSemanticCharts();
  drawAnnualTrend(filteredRecords);
  window.HighwayScatter?.render(document.getElementById('highway-scatter-chart'), filteredRecords, DATA?.roads || [], highlightRoadSegment);

  // Annual Summary Table
  const body = document.getElementById('incident-year-table');
  if (body) {
    body.replaceChildren();
    const filteredByYear = new Map();
    for (const record of getFilteredRecords()) {
      const year=String(record.year || 'ไม่ระบุ');
      if(!filteredByYear.has(year))filteredByYear.set(year,{events:0,fatalities:0,serious:0,minor:0,injuries:0,vehicles:0,coordinates:0});
      const row=filteredByYear.get(year);row.events++;row.fatalities+=Number(record.fatalities)||0;
      row.serious+=Number(record.injuries_severe)||0;row.minor+=Number(record.injuries_minor)||0;
      row.injuries+=Number(record.injuries)||0;if(isValue(record.vehicle))row.vehicles++;
      if(isValue(record.latitude)&&isValue(record.longitude))row.coordinates++;
    }
    for (const [year, data] of [...filteredByYear.entries()].sort(([a],[b])=>a.localeCompare(b))) {
      const row = document.createElement('tr');
      if (selectedYear === year) row.className = 'selected-year-row';
      const coordinatePct = data.events ? (data.coordinates / data.events) * 100 : 0;
      const values = [
        year === 'ไม่ระบุ' ? year : `พ.ศ. ${Number(year) + 543}`,
        fmt.format(data.events),
        fmt.format(data.fatalities),
        fmt.format(data.serious),
        fmt.format(data.minor),
        fmt.format(data.injuries),
        fmt.format(data.vehicles),
        `${fmt.format(data.coordinates)} (${coordinatePct.toFixed(1)}%)`
      ];
      for (const val of values) {
        const cell = document.createElement('td');
        cell.textContent = val;
        row.append(cell);
      }
      body.append(row);
    }
  }
}

function drawAnnualTrend(records) {
  const canvas=document.getElementById('annual-trend-chart'), s=resizeCanvas(canvas);
  if(!s)return;
  const {ctx,w,h}=s,theme=chartTheme();ctx.clearRect(0,0,w,h);
  const years=['2023','2024','2025'],events=Object.fromEntries(years.map(y=>[y,0])),deaths=Object.fromEntries(years.map(y=>[y,0]));
  for(const r of records){const y=String(r.year);if(!Object.hasOwn(events,y))continue;events[y]++;deaths[y]+=Math.max(0,Number(r.fatalities)||0);}
  const maxE=Math.max(1,...Object.values(events)),maxD=Math.max(1,...Object.values(deaths));
  const pad={l:56,r:58,t:22,b:42},cw=w-pad.l-pad.r,ch=h-pad.t-pad.b, x=i=>pad.l+cw*i/Math.max(1,years.length-1);
  ctx.font=`10px ${theme.font}`;ctx.lineWidth=1;ctx.strokeStyle=theme.grid;ctx.fillStyle=theme.textMuted;
  for(let i=0;i<=4;i++){
    const ratio=i/4,y=pad.t+ch*(1-ratio);ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();
    ctx.textAlign='right';ctx.fillText(fmt.format(Math.round(maxE*ratio)),pad.l-8,y);
    ctx.textAlign='left';ctx.fillText(fmt.format(Math.round(maxD*ratio)),w-pad.r+8,y);
  }
  years.forEach((year,i)=>{ctx.textAlign='center';ctx.fillStyle=theme.text;ctx.fillText(`พ.ศ. ${Number(year)+543}`,x(i),h-15);});
  const series=[{values:events,max:maxE,color:'#C1121F'},{values:deaths,max:maxD,color:'#FF8C00'}];
  for(const line of series){
    ctx.beginPath();ctx.strokeStyle=line.color;ctx.lineWidth=3;ctx.lineJoin='round';
    years.forEach((year,i)=>{const y=pad.t+ch*(1-line.values[year]/line.max);if(i===0)ctx.moveTo(x(i),y);else ctx.lineTo(x(i),y);});ctx.stroke();
    years.forEach((year,i)=>{const y=pad.t+ch*(1-line.values[year]/line.max);ctx.beginPath();ctx.arc(x(i),y,5,0,Math.PI*2);ctx.fillStyle=line.color;ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();});
  }
  if(canvas){canvas.title=years.map(y=>`พ.ศ. ${Number(y)+543}: ${fmt.format(events[y])} เหตุการณ์, ${fmt.format(deaths[y])} ผู้เสียชีวิต`).join('\n');}
}

function drawIncidentMonthly() {
  const canvas = document.getElementById('incident-month-chart');
  const s = resizeCanvas(canvas);
  if (!s) return;
  const { ctx, w, h } = s, theme = chartTheme();
  ctx.clearRect(0, 0, w, h);

  const months = Array(12).fill(0);
  for (const [, d] of selectedAccidentYears()) {
    (d.monthly || []).forEach((v, i) => months[i] += v);
  }

  const max = Math.max(1, ...months);
  const pad = { l: 40, r: 12, t: 16, b: 24 };
  const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
  const barW = Math.max(4, (cw / 12) * 0.65);
  const step = cw / 12;

  ctx.strokeStyle = theme.grid;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t + ch);
  ctx.lineTo(w - pad.r, pad.t + ch);
  ctx.stroke();

  months.forEach((v, i) => {
    const x = pad.l + i * step + (step - barW) / 2;
    const barH = (v / max) * ch;
    const y = pad.t + ch - barH;

    ctx.fillStyle = theme.accent1;
    roundedRect(ctx, x, y, barW, barH, 3);
    ctx.fill();

    ctx.fillStyle = theme.textMuted;
    ctx.font = `600 9.5px ${theme.font}`;
    ctx.textAlign = 'center';
    ctx.fillText(MONTHS[i], x + barW / 2, h - 8);
  });
}

function drawIncidentHours() {
  const canvas = document.getElementById('incident-hour-chart');
  const s = resizeCanvas(canvas);
  if (!s) return;
  const { ctx, w, h } = s, theme = chartTheme();
  ctx.clearRect(0, 0, w, h);

  const hours = Array(12).fill(0);
  for (const [, d] of selectedAccidentYears()) {
    (d.hours || []).forEach((v, i) => hours[i] += v);
  }

  const labels = ['00-02','02-04','04-06','06-08','08-10','10-12','12-14','14-16','16-18','18-20','20-22','22-24'];
  const max = Math.max(1, ...hours);
  const pad = { l: 40, r: 12, t: 16, b: 24 };
  const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
  const step = cw / 12;
  const barW = Math.max(4, step * 0.65);

  hours.forEach((v, i) => {
    const x = pad.l + i * step + (step - barW) / 2;
    const barH = (v / max) * ch;
    const y = pad.t + ch - barH;

    const isPeak = i >= 8 && i <= 10;
    ctx.fillStyle = isPeak ? '#C1121F' : theme.accentWarn;
    roundedRect(ctx, x, y, barW, barH, 3);
    ctx.fill();

    ctx.fillStyle = theme.textMuted;
    ctx.font = `600 8.5px ${theme.font}`;
    ctx.textAlign = 'center';
    ctx.fillText(labels[i], x + barW / 2, h - 8);
  });
}

function drawIncidentWeekdays() {
  const canvas = document.getElementById('incident-weekday-chart');
  const s = resizeCanvas(canvas);
  if (!s) return;
  const { ctx, w, h } = s, theme = chartTheme();
  ctx.clearRect(0, 0, w, h);

  const days = Array(7).fill(0);
  for (const [, d] of selectedAccidentYears()) {
    (d.weekdays || []).forEach((v, i) => days[i] += v);
  }

  const max = Math.max(1, ...days);
  const pad = { l: 40, r: 12, t: 16, b: 24 };
  const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
  const step = cw / 7;
  const barW = Math.max(6, step * 0.55);

  days.forEach((v, i) => {
    const x = pad.l + i * step + (step - barW) / 2;
    const barH = (v / max) * ch;
    const y = pad.t + ch - barH;

    const isWeekend = i === 5 || i === 6;
    ctx.fillStyle = isWeekend ? '#C1121F' : theme.accent3;
    roundedRect(ctx, x, y, barW, barH, 4);
    ctx.fill();

    ctx.fillStyle = theme.textMuted;
    ctx.font = `600 10px ${theme.font}`;
    ctx.textAlign = 'center';
    ctx.fillText(WEEKDAYS[i], x + barW / 2, h - 8);
  });
}

/* Quality & Metadata Section */
function updateQuality(records) {
  const ul = document.getElementById('quality-list');
  if (!ul) return;

  const q = DATA?.quality || {};
  const notes = [
    `ไฟล์ต้นทาง: ${fmt.format(DATA?.meta?.source_rows || 0)} แถว × ${fmt.format(DATA?.meta?.source_columns || 0)} คอลัมน์; นับหนึ่งเหตุการณ์ต่อ ACC_CODE ได้ ${fmt.format(DATA?.meta?.event_count || records.length)} รหัสไม่ซ้ำ`,
    `ตรวจรหัสซ้ำ: พบ ${fmt.format(q.duplicate_id_groups || 0)} กลุ่ม ACC_CODE ซ้ำ; ${fmt.format(q.duplicate_conflict_groups || 0)} กลุ่มมีวันเวลา/พื้นที่/พิกัด/ยอดผู้บาดเจ็บหรือเสียชีวิตขัดแย้งกัน กติกาเลือกแถวที่ยอดผู้สูญเสียรวมสูงสุด และควรตรวจสอบก่อนใช้เป็นสถิติทางการ`,
    `คุณภาพข้อมูล: ไม่มีพิกัด ${fmt.format(q.coordinate_missing || 0)}; พิกัดผิดช่วง/ศูนย์ ${fmt.format(q.coordinate_invalid || 0)}; พิกัดนอกกรอบประเทศไทย ${fmt.format(q.coordinate_outside_thailand || 0)}; วันที่หาย/อ่านไม่ได้ ${fmt.format((q.date_missing || 0)+(q.date_invalid || 0))}; ค่าเสียชีวิตหาย ${fmt.format(q.fatality_missing || 0)}; ช่องบาดเจ็บหาย ${fmt.format(q.injury_value_missing || 0)}; ยอดบาดเจ็บไม่ตรง ${fmt.format(q.injury_total_mismatch || 0)}`,
    `ชั้น GIS: โหลดแนวเส้นจริง ${fmt.format(DATA?.meta?.road_features || DATA?.roads?.length || 0)} ช่วงจาก GeoPackage และขอบเขตจังหวัด ${fmt.format(DATA?.meta?.province_features || 0)} จังหวัดจาก DDPM ใน EPSG:4326`,
    `การกรองช่วงถนนตามจังหวัด/ภาคอิงจังหวัดของจุดกึ่งกลางของ feature; geometry ไม่ได้ถูกตัดที่เส้นเขตจังหวัด และไม่ใช้เป็นผลจัดอันดับอุบัติเหตุ`,
    `การจับคู่ถนนในไฟล์ joined เดิม ${fmt.format(DATA?.meta?.road_matches || 0)} รายการเป็นผลเดิมบางส่วน จึงไม่ใช้สรุปผู้เสียชีวิตตามถนน`,
    `การวิเคราะห์เป็นสถิติเชิงพรรณนา ไม่ยืนยันเหตุและผล; เปรียบเทียบรายปีด้วยความระมัดระวัง เพราะความครบถ้วนและระยะเวลารายงานอาจต่างกัน`
  ];

  ul.replaceChildren();
  for (const note of notes) {
    const li = document.createElement('li');
    li.textContent = note;
    ul.appendChild(li);
  }
}

/* Export CSV */
function csvEscape(v) {
  const x = (v === null || v === undefined) ? '' : String(v);
  return '"' + x.replaceAll('"', '""') + '"';
}

function exportCsv() {
  const records = getFilteredRecords();
  const cols = [
    'id', 'year', 'incident_date', 'incident_time', 'province', 'region',
    'highway_code', 'highway_digits', 'digit_label', 'road_name', 'agency',
    'fatalities', 'injuries', 'injuries_severe', 'injuries_minor',
    'vehicle', 'cause', 'collision', 'weather', 'latitude', 'longitude',
    'road_status', 'road_distance_m', 'matched_highway_code'
  ];

  const csv = '\ufeff' + [cols.join(','), ...records.map(r => cols.map(k => csvEscape(r[k])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  const yearSuffix = selectedYear === 'all' ? 'all' : Number(selectedYear) + 543;
  const areaSuffix = selectedProvince !== 'all' ? `-${selectedProvince}` : (selectedRegion !== 'all' ? `-${selectedRegion}` : '');
  a.download = `trams-fatalities-${yearSuffix}${areaSuffix}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* Global Render Trigger */
function render() {
  const records = getFilteredRecords();
  if (pendingRoadHighlightId !== null && !records.some(record => normalizeRoadFeatureId(record.road_feature_id) === normalizeRoadFeatureId(pendingRoadHighlightId))) {
    roadHighlightLayer?.clearLayers();
    pendingRoadHighlightId = null;
  }
  updateKpis(records);
  drawWeekdayHour(records);
  updateQuality(records);
  updateAccidentDashboard();
  drawMap(false);
}

/* Interactive Canvas Tooltip Setup */
function setupChartTooltips() {
  const tooltip = document.getElementById('canvas-tooltip');
  if (!tooltip) return;

  const canvasIds = ['weekday-hour-chart'];

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

/* Navigation Scroll Spy */
function setupQuickNav() {
  const sections = ['overview', 'time', 'people', 'roads']
    .map(id => document.getElementById(id))
    .filter(Boolean);

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

function setupScrollReveal() {
  const cards = document.querySelectorAll('.chart-panel, .hotspots-panel');
  if (!('IntersectionObserver' in window)) {
    cards.forEach(card => card.classList.add('is-visible'));
    return;
  }
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }
  }, { threshold: 0.12 });
  cards.forEach(card => { card.classList.add('animated-chart-card'); observer.observe(card); });
}

/* Application Bootstrapping */
async function boot() {
  try {
    setupMap();
    setupChartTooltips();
    setupQuickNav();
    setupScrollReveal();

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

    // Fetch datasets in parallel
    const [dashboardResponse, accidentResponse] = await Promise.all([
      fetch('data/dashboard_data.json'),
      fetch('data/accident_summary.json')
    ]);

    if (!dashboardResponse.ok) throw new Error(`โหลดข้อมูล dashboard_data.json ไม่สำเร็จ (${dashboardResponse.status})`);
    if (!accidentResponse.ok) throw new Error(`โหลดข้อมูล accident_summary.json ไม่สำเร็จ (${accidentResponse.status})`);

    DATA = await dashboardResponse.json();
    ACCIDENTS = await accidentResponse.json();
    DATA.roads = [];
    for (const record of DATA.records || []) {
      for (const field of ['vehicle','cause','collision','weather']) record[field] = normalizeCategory(field, record[field]);
    }

    const populate = (id, values, label) => {
      const select = document.getElementById(id);
      if (!select) return;
      for (const value of [...new Set(values.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'th'))) {
        const option = document.createElement('option'); option.value = value; option.textContent = value; select.append(option);
      }
      select.setAttribute('aria-label', label);
    };
    populate('vehicle-filter', DATA.records.map(r=>r.vehicle), 'กรองตามประเภทยานพาหนะ');
    const rerender = () => render();
    document.getElementById('vehicle-filter')?.addEventListener('change', e => { selectedVehicle=e.target.value; rerender(); });
    document.getElementById('fatality-filter')?.addEventListener('change', e => { selectedFatality=e.target.value; rerender(); });
    document.getElementById('clear-semantic-filters')?.addEventListener('click', () => {
      for (const key of Object.keys(semanticFilters)) semanticFilters[key] = 'all';
      render();
    });
    document.getElementById('road-search')?.addEventListener('input', rerender);
    document.getElementById('reset-filters')?.addEventListener('click', () => {
      selectedYear='all'; selectedRegion='all'; selectedProvince='all'; selectedHighwayDigits='all';
      selectedVehicle='all'; selectedFatality='all';
      for (const key of Object.keys(semanticFilters)) semanticFilters[key] = 'all';
      for (const id of ['year-filter','region-filter','province-filter','highway-digit-filter','vehicle-filter','fatality-filter']) {
        const el=document.getElementById(id); if (el) el.value='all';
      }
      const search=document.getElementById('road-search'); if(search) search.value='';
      syncFilterDropdowns(); updateMapView(true); render();
    });

    syncFilterDropdowns();
    updateMapView(false);
    render();
    setupLazyMapLoading();
  } catch (err) {
    const noteEl = document.getElementById('data-note');
    if (noteEl) {
      noteEl.innerHTML = `<div class="note-icon">!</div><div><strong>โหลด Dashboard ไม่สำเร็จ</strong><p>${err.message}</p></div>`;
    }
    console.error('Error booting dashboard:', err);
  }
}

document.addEventListener('DOMContentLoaded', boot);
