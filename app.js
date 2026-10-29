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
  digit_2: '#2563eb',    // 2-digit: Blue   (ทล. 12, 24, 35)
  digit_3: '#ec4899',    // 3-digit: Pink   (ทล. 201, 304)
  digit_4_plus: '#64748b', // 4+ digits: Neutral Slate
  unknown: '#64748b'     // Rural/Other
};

// Global Application State
let DATA = null;          // dashboard_data.json
let ACCIDENTS = null;     // accident_summary.json
let PROVINCES_GEO = null; // provinces.geojson

let selectedYear = 'all';           // 'all', '2023', '2024', '2025'
let selectedRegion = 'all';         // 'all' or Thai region name
let selectedProvince = 'all';       // 'all' or Thai province name
let selectedHighwayDigits = 'all';  // 'all', 'digit_1', 'digit_2', 'digit_3'

let leafletMap = null;
let currentTileLayer = null;
let roadLayer = null;
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
function getFilteredRecords() {
  if (!DATA?.records) return [];
  return DATA.records.filter(r => {
    if (selectedYear !== 'all' && String(r.year) !== selectedYear) return false;
    if (selectedRegion !== 'all' && r.region !== selectedRegion) return false;
    if (selectedProvince !== 'all' && r.province !== selectedProvince) return false;
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
  
  const trafficCount = records.filter(r => isValue(r.traffic_aadt)).length;
  setText('traffic-linked', fmt.format(trafficCount));
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
  return isDark
    ? 'https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
}

function updateMapTiles() {
  if (!leafletMap || !currentTileLayer) return;
  const isDark = document.body.dataset.theme === 'dark';
  currentTileLayer.setUrl(getTileUrl(isDark));
}

/* Dynamic Viewport Fitting (fitBounds) */
function updateMapView(animate = true) {
  if (!leafletMap || !DATA) return;

  // 1. Specific Province selected
  if (selectedProvince !== 'all' && DATA.provinces?.[selectedProvince]) {
    const bbox = DATA.provinces[selectedProvince].bbox;
    const bounds = [[bbox[1], bbox[0]], [bbox[3], bbox[2]]];
    leafletMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 13, animate });
    return;
  }

  // 2. Specific Region selected
  if (selectedRegion !== 'all' && DATA.regions?.[selectedRegion]) {
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

  // Selected Province
  if (selectedProvince !== 'all') {
    if (pname === selectedProvince) {
      return {
        color: '#38bdf8',
        weight: 2.8,
        opacity: 0.95,
        fillColor: '#38bdf8',
        fillOpacity: isDark ? 0.15 : 0.08
      };
    }
    // Same region
    if (selectedRegion !== 'all' && reg === selectedRegion) {
      return {
        color: isDark ? '#475569' : '#cbd5e1',
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
        color: '#38bdf8',
        weight: 1.8,
        opacity: 0.85,
        fillColor: '#38bdf8',
        fillOpacity: isDark ? 0.08 : 0.04
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

  // Country Level
  return {
    color: isDark ? '#38bdf8' : '#0284c7',
    weight: 0.8,
    opacity: 0.45,
    fillColor: isDark ? '#38bdf8' : '#0284c7',
    fillOpacity: 0.02
  };
}

/* Draw Map */
function drawMap(fitBounds = false) {
  if (!DATA || !leafletMap) return;

  const showRoads = document.getElementById('show-roads')?.checked ?? true;
  const showPoints = document.getElementById('show-points')?.checked ?? true;
  const showBoundary = document.getElementById('show-boundary')?.checked ?? true;

  const records = getFilteredRecords();
  const roads = getFilteredRoads();

  // 1. Update Province Boundaries Layer
  boundaryLayer.clearLayers();
  if (showBoundary && PROVINCES_GEO) {
    boundaryLayer.addData(PROVINCES_GEO);
  }

  // 2. Count fatalities per road feature id
  const roadDeaths = new Map();
  for (const r of records) {
    if (r.road_status === 'matched' && isValue(r.road_feature_id)) {
      const id = String(r.road_feature_id);
      roadDeaths.set(id, (roadDeaths.get(id) || 0) + (Number(r.fatalities) || 1));
    }
  }

  // 3. Render Roads Layer
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

      const fatalitiesCount = roadDeaths.get(String(road.id)) || 0;

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
              <div><b>พื้นที่:</b> จ.${escapeHtml(road.province)} (${escapeHtml(road.region)})</div>
              <div><b>ผู้เสียชีวิตที่จับคู่ได้:</b> <b style="color:#ef4444;">${fmt.format(fatalitiesCount)} ราย</b></div>
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
    for (const r of validPoints) {
      const latlng = [Number(r.latitude), Number(r.longitude)];
      const marker = hasMarkerCluster
        ? L.marker(latlng, {
            icon: L.divIcon({
              className: 'fatality-marker',
              html: '',
              iconSize: [10, 10],
              iconAnchor: [5, 5]
            })
          })
        : L.circleMarker(latlng, {
            radius: 3.5,
            weight: 1.5,
            color: '#ffffff',
            fillColor: '#f43f5e',
            fillOpacity: 0.88
          });

      marker.bindPopup(`
        <div style="font-family:'Plus Jakarta Sans','Prompt',sans-serif;">
          <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e2e8f0;padding-bottom:4px;margin-bottom:6px;">
            <strong style="color:#ef4444;font-size:13px;">อุบัติเหตุ #${escapeHtml(r.id)}</strong>
            <span style="font-size:11px;color:#64748b;">${escapeHtml(r.incident_date || 'ไม่ระบุ')} ${escapeHtml(r.incident_time || '')}</span>
          </div>
          <div style="font-size:11px;line-height:1.6;color:#334155;">
            <div><b>สถานที่:</b> จ.${escapeHtml(r.province)} (${escapeHtml(r.region)})</div>
            <div><b>สายทาง:</b> ทล. ${escapeHtml(r.highway_code || 'ไม่ระบุ')} · ${escapeHtml(r.road_name)}</div>
            <div><b>ความสูญเสีย:</b> <span style="color:#ef4444;font-weight:700;">ผู้เสียชีวิต ${fmt.format(r.fatalities)} ราย</span> · บาดเจ็บ ${fmt.format(r.injuries)} ราย</div>
            <div><b>ยานพาหนะ:</b> ${escapeHtml(r.vehicle)}</div>
            <div><b>ลักษณะเหตุ:</b> ${escapeHtml(r.collision)}</div>
            <div><b>มูลเหตุสันนิษฐาน:</b> ${escapeHtml(r.cause)}</div>
            <div><b>สภาพอากาศ:</b> ${escapeHtml(r.weather)}</div>
            <div><b>พิกัด:</b> ${r.latitude.toFixed(5)}, ${r.longitude.toFixed(5)}</div>
          </div>
        </div>
      `);
      pointLayer.addLayer(marker);
    }
  }

  // 5. Empty State & Summary Check
  const emptyEl = document.getElementById('map-empty');
  const emptyDescEl = document.getElementById('map-empty-desc');
  if (emptyEl) {
    if (roads.length === 0 && showRoads) {
      emptyEl.hidden = false;
      if (emptyDescEl) {
        const area = selectedProvince !== 'all' ? `จ.${selectedProvince}` : (selectedRegion !== 'all' ? selectedRegion : 'ประเทศไทย');
        emptyDescEl.textContent = `ไม่พบแนวเส้นทางหลวงตามประเภทที่เลือกใน ${area} โดยแผนที่ยังคงขอบเขตพื้นที่เดิมไว้`;
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
    summaryEl.textContent = `แสดง ${fmt.format(validCoords)} จุดพิกัด (${fmt.format(totalDeaths)} ผู้เสียชีวิต) · ${fmt.format(roads.length)} ช่วงทางหลวง · จัดกลุ่ม Cluster เรียบร้อย`;
  }

  // 7. Dynamic Viewport Zooming
  if (fitBounds) {
    updateMapView(true);
  }

  // 8. Update Breadcrumbs & Status
  updateBreadcrumbs();
  updateFilterStatusBar(records, roads);

  // 9. Update Hotspots List
  drawHotspots(records, roadDeaths);
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
    list.innerHTML = '<div style="padding:16px;grid-column:1/-1;text-align:center;color:var(--ink-muted);">ไม่มีข้อมูลอุบัติเหตุที่จับคู่กับแนวทางหลวงในเงื่อนไขนี้</div>';
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
    subdomains: 'abcd',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank">CARTO</a>'
  }).addTo(leafletMap);

  // 1. Boundary Layer (GeoJSON)
  boundaryLayer = L.geoJSON(null, {
    style: getProvinceStyle,
    onEachFeature: (feature, layer) => {
      const pname = feature.properties?.pro_th;
      const reg = feature.properties?.reg_th;
      
      layer.bindTooltip(`<strong>${escapeHtml(pname)}</strong> (${escapeHtml(reg)})`, {
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
    drawMap(false);
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
function selectedAccidentYears() {
  if (!ACCIDENTS?.years) return [];
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
      grad.addColorStop(0, '#f43f5e');
      grad.addColorStop(1, '#fb7185');
    } else {
      grad.addColorStop(0, theme.accent1);
      grad.addColorStop(1, '#38bdf8');
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
  const colors = { '2023': '#f59e0b', '2024': '#0284c7', '2025': '#10b981' };

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
  setText('incident-serious', fmt.format(accidentTotal('serious')));
  setText('incident-injuries', fmt.format(accidentTotal('injuries')));

  drawIncidentMonthly();
  drawIncidentHours();
  drawIncidentWeekdays();

  drawBars('incident-province-chart', aggregateAccidentList('provinces', 1), '#0284c7', 12);
  drawBars('incident-cause-chart', aggregateAccidentList('cause'), '#f59e0b', 10);
  drawBars('incident-collision-chart', aggregateAccidentList('collision'), '#8b5cf6', 10);
  drawBars('incident-vehicle-chart', aggregateAccidentList('vehicle'), '#10b981', 10);
  drawBars('incident-weather-chart', aggregateAccidentList('weather'), '#0284c7', 10);
  drawBars('incident-roadtype-chart', aggregateAccidentList('road_type'), '#8b5cf6', 6);

  // Vehicles & Dynamics Section (Section 03)
  drawBars('vehicle-chart', aggregateAccidentList('vehicle'), '#10b981', 8);
  drawBars('incident-collision-chart-2', aggregateAccidentList('collision'), '#ec4899', 8);
  drawBars('cause-chart', aggregateAccidentList('cause'), '#f59e0b', 8);
  drawBars('incident-weather-chart-2', aggregateAccidentList('weather'), '#0284c7', 8);

  // Annual Summary Table
  const body = document.getElementById('incident-year-table');
  if (body) {
    body.replaceChildren();
    for (const [year, data] of Object.entries(ACCIDENTS.years)) {
      const row = document.createElement('tr');
      if (selectedYear === year) row.className = 'selected-year-row';
      const values = [
        `พ.ศ. ${Number(year) + 543}`,
        fmt.format(data.events),
        fmt.format(data.fatalities),
        fmt.format(data.serious),
        fmt.format(data.minor),
        fmt.format(data.injuries),
        fmt.format(data.vehicles),
        `${fmt.format(data.coordinates)} (${((data.coordinates / data.events) * 100).toFixed(1)}%)`
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
    ctx.fillStyle = isPeak ? '#f43f5e' : theme.accentWarn;
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
    ctx.fillStyle = isWeekend ? '#f43f5e' : theme.accent3;
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

  const notes = [
    `ข้อมูลอุบัติเหตุ: ใช้ระบบ TRAMS กระทรวงคมนาคม ครอบคลุม 71,508 เหตุการณ์ และเหตุการณ์เสียชีวิต 7,601 เหตุการณ์ (${fmt.format(DATA?.meta?.total_fatalities || 8884)} รายเสียชีวิต)`,
    `พิกัดภูมิศาสตร์: พิกัดเหตุการณ์จริง 99.9% อยู่ในขอบเขตประเทศไทย และจับคู่โครงข่าย DOH ได้ ${fmt.format(DATA?.meta?.road_matches || 6669)} รายการ (ระยะ ≤ 100 ม.)`,
    `การจำแนกเลขทางหลวง: ทางหลวง 1 หลัก (สีม่วง), 2 หลัก (สีน้ำเงิน), 3 หลัก (สีชมพู) ตามจำนวนหลักจริงของรหัสสายทาง DOH`,
    `ขอบเขตพื้นที่: รองรับการกรองตาม 6 ภูมิภาคและ 77 จังหวัดตามมาตรฐานราชบัณฑิตยสภา พร้อมคำนวณ Bounding Box ซูมพอดีตาม geometry จริง`
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
    'road_status', 'road_distance_m', 'matched_highway_code', 'traffic_aadt'
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
  updateKpis(records);
  drawTrend(records);
  drawWeekday(records);
  updateQuality(records);
  updateAccidentDashboard();
  drawMap(false);
}

/* Interactive Canvas Tooltip Setup */
function setupChartTooltips() {
  const tooltip = document.getElementById('canvas-tooltip');
  if (!tooltip) return;

  const canvasIds = [
    'trend-chart', 'weekday-chart', 'vehicle-chart', 'cause-chart',
    'incident-collision-chart-2', 'incident-weather-chart-2',
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

/* Navigation Scroll Spy */
function setupQuickNav() {
  const sections = ['overview', 'time', 'incidents', 'people', 'roads']
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

    // Fetch datasets in parallel
    const [dashboardResponse, accidentResponse, geoResponse] = await Promise.all([
      fetch('data/dashboard_data.json'),
      fetch('data/accident_summary.json'),
      fetch('data/provinces.geojson')
    ]);

    if (!dashboardResponse.ok) throw new Error(`โหลดข้อมูล dashboard_data.json ไม่สำเร็จ (${dashboardResponse.status})`);
    if (!accidentResponse.ok) throw new Error(`โหลดข้อมูล accident_summary.json ไม่สำเร็จ (${accidentResponse.status})`);

    DATA = await dashboardResponse.json();
    ACCIDENTS = await accidentResponse.json();

    if (geoResponse.ok) {
      PROVINCES_GEO = await geoResponse.json();
      // Normalize province names in geojson
      for (const feat of PROVINCES_GEO.features || []) {
        if (feat.properties?.pro_th === 'อยุธยา') {
          feat.properties.pro_th = 'พระนครศรีอยุธยา';
        }
        const regEn = feat.properties?.reg_royin;
        const regTh = {
          North: 'ภาคเหนือ',
          Northeast: 'ภาคตะวันออกเฉียงเหนือ',
          Central: 'ภาคกลาง',
          East: 'ภาคตะวันออก',
          West: 'ภาคตะวันตก',
          South: 'ภาคใต้'
        }[regEn] || regEn;
        feat.properties.reg_th = regTh;
      }
    }

    syncFilterDropdowns();
    updateMapView(false);
    render();
  } catch (err) {
    const noteEl = document.getElementById('data-note');
    if (noteEl) {
      noteEl.innerHTML = `<div class="note-icon">!</div><div><strong>โหลด Dashboard ไม่สำเร็จ</strong><p>${err.message}</p></div>`;
    }
    console.error('Error booting dashboard:', err);
  }
}

document.addEventListener('DOMContentLoaded', boot);
