import sys
import sqlite3
import json
import re
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
data_dir = Path(r'c:\Users\Lenovo Slim5i\OneDrive\Documents\Codex\DataViz_YaMaHam\data')
gpkg_path = next(data_dir.glob('*.gpkg'))

# Load province geojson from local cache or download
geojson_path = data_dir / "provinces.geojson"
if not geojson_path.exists():
    import urllib.request
    url = 'https://raw.githubusercontent.com/chingchai/OpenGISData-Thailand/master/provinces.geojson'
    print("Downloading provinces.geojson...")
    with urllib.request.urlopen(url, timeout=30) as res:
        geojson_path.write_bytes(res.read())
    print("Saved provinces.geojson!")

with open(geojson_path, 'r', encoding='utf-8') as f:
    prov_data = json.load(f)

# Normalize province names in geojson
PROV_REGIONS = {}
PROV_EN = {}
PROV_BOUNDS = {}
for feat in prov_data['features']:
    props = feat['properties']
    pname = props['pro_th']
    if pname == 'อยุธยา':
        pname = 'พระนครศรีอยุธยา'
        props['pro_th'] = pname
    reg = props['reg_royin']
    PROV_REGIONS[pname] = reg
    PROV_EN[pname] = props['pro_en']

print(f"Loaded {len(PROV_REGIONS)} provinces.")

# Test matching district_name to province
conn = sqlite3.connect(f'file:{gpkg_path.as_posix()}?mode=ro', uri=True)
c = conn.cursor()
c.execute("SELECT fid, district_name, highway_code, road_name FROM hods_road_cl_line_2568")
rows = c.fetchall()

def extract_province_from_district(d_name):
    if not d_name:
        return None
    d = d_name.strip()
    if d == 'ขท.ธนบุรี' or d == 'ขท.กรุงเทพ':
        return 'กรุงเทพมหานคร'
    if d == 'ขท.อยุธยา':
        return 'พระนครศรีอยุธยา'
    m = re.match(r'^ขท\.([^\d\(\s]+)', d)
    if m:
        candidate = m.group(1).strip()
        if candidate in PROV_REGIONS:
            return candidate
        # Try substring
        for p in PROV_REGIONS:
            if candidate.startswith(p) or p.startswith(candidate):
                return p
    return None

matched_provs = {}
unmatched = []
for fid, d_name, hcode, rname in rows:
    prov = extract_province_from_district(d_name)
    if prov:
        matched_provs[fid] = prov
    else:
        unmatched.append((fid, d_name, hcode, rname))

print(f"Matched by district_name: {len(matched_provs)} / {len(rows)}")
print(f"Unmatched: {len(unmatched)}")
print("Sample unmatched:", unmatched[:10])

conn.close()
