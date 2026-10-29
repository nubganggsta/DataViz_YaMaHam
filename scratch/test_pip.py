import sys
import sqlite3
import json
import struct
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
data_dir = Path(r'c:\Users\Lenovo Slim5i\OneDrive\Documents\Codex\DataViz_YaMaHam\data')
gpkg_path = next(data_dir.glob('*.gpkg'))
geojson_path = data_dir / "provinces.geojson"

with open(geojson_path, 'r', encoding='utf-8') as f:
    prov_data = json.load(f)

# Ray casting point-in-polygon
def point_in_poly(x, y, poly_rings):
    # poly_rings: outer ring is poly_rings[0], holes are poly_rings[1:]
    # Check outer ring
    outer = poly_rings[0]
    inside = False
    n = len(outer)
    p1x, p1y = outer[0]
    for i in range(1, n + 1):
        p2x, p2y = outer[i % n]
        if y > min(p1y, p2y):
            if y <= max(p1y, p2y):
                if x <= max(p1x, p2x):
                    if p1y != p2y:
                        xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                    if p1x == p2x or x <= xinters:
                        inside = not inside
        p1x, p1y = p2x, p2y
    if not inside:
        return False
    # Check holes
    for hole in poly_rings[1:]:
        in_hole = False
        n = len(hole)
        p1x, p1y = hole[0]
        for i in range(1, n + 1):
            p2x, p2y = hole[i % n]
            if y > min(p1y, p2y):
                if y <= max(p1y, p2y):
                    if x <= max(p1x, p2x):
                        if p1y != p2y:
                            xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                        if p1x == p2x or x <= xinters:
                            in_hole = not in_hole
            p1x, p1y = p2x, p2y
        if in_hole:
            return False
    return True

# Pre-parse province polygons and bboxes
prov_geoms = []
for feat in prov_data['features']:
    props = feat['properties']
    pname = props['pro_th']
    if pname == 'อยุธยา':
        pname = 'พระนครศรีอยุธยา'
    geom = feat['geometry']
    gtype = geom['type']
    coords = geom['coordinates']
    
    # Calculate bbox
    minx, miny, maxx, maxy = float('inf'), float('inf'), float('-inf'), float('-inf')
    
    polys = []
    if gtype == 'Polygon':
        polys.append(coords)
        for ring in coords:
            for pt in ring:
                minx, miny = min(minx, pt[0]), min(miny, pt[1])
                maxx, maxy = max(maxx, pt[0]), max(maxy, pt[1])
    elif gtype == 'MultiPolygon':
        polys.extend(coords)
        for poly in coords:
            for ring in poly:
                for pt in ring:
                    minx, miny = min(minx, pt[0]), min(miny, pt[1])
                    maxx, maxy = max(maxx, pt[0]), max(maxy, pt[1])
    prov_geoms.append({
        'province': pname,
        'region': props['reg_royin'],
        'bbox': (minx, miny, maxx, maxy),
        'polys': polys
    })

def find_province_for_point(lon, lat):
    for pg in prov_geoms:
        b = pg['bbox']
        if not (b[0] <= lon <= b[2] and b[1] <= lat <= b[3]):
            continue
        for poly in pg['polys']:
            if point_in_poly(lon, lat, poly):
                return pg['province'], pg['region']
    return None, None

def parse_wkb_first_point(blob: bytes):
    if not blob or blob[:2] != b"GP":
        return None
    flags = blob[3]
    endian = "<" if flags & 1 else ">"
    envelope_code = (flags >> 1) & 7
    envelope_doubles = {0: 0, 1: 4, 2: 6, 3: 6, 4: 8}.get(envelope_code, 0)
    pos = 8 + envelope_doubles * 8
    byte_order = "<" if blob[pos] == 1 else ">"
    geom_type = struct.unpack_from(byte_order + "I", blob, pos + 1)[0]
    base_type = geom_type % 1000
    pos += 5
    if base_type == 2:  # LineString
        pos += 4
        x, y = struct.unpack_from(byte_order + "dd", blob, pos)
        return (x, y)
    elif base_type == 5:  # MultiLineString
        pos += 4
        # inner linestring
        pos += 5
        pos += 4
        x, y = struct.unpack_from(byte_order + "dd", blob, pos)
        return (x, y)
    return None

conn = sqlite3.connect(f'file:{gpkg_path.as_posix()}?mode=ro', uri=True)
c = conn.cursor()
c.execute("SELECT fid, highway_code, road_name, spatial_data FROM hods_road_cl_line_2568 WHERE district_name IS NULL OR district_name LIKE '%พิเศษระหว่างเมือง%'")
unmatched_rows = c.fetchall()
print(f"Testing point-in-poly on {len(unmatched_rows)} unmatched road features...")

matched_count = 0
for fid, hcode, rname, blob in unmatched_rows:
    pt = parse_wkb_first_point(blob)
    if pt:
        prov, reg = find_province_for_point(pt[0], pt[1])
        if prov:
            matched_count += 1
            # print(f"FID {fid} ({hcode} - {rname}): {prov} ({reg})")

print(f"Successfully matched by coordinates: {matched_count} / {len(unmatched_rows)}")
conn.close()
