import json
import math
import re
import sqlite3
import struct
import sys
import time
from datetime import datetime
from functools import lru_cache
from pathlib import Path

import pandas as pd

sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(r'c:\Users\Lenovo Slim5i\OneDrive\Documents\Codex\DataViz_YaMaHam')
DATA_DIR = ROOT / 'data'
TRAMS_CSV = DATA_DIR / 'accidents_2023_2025.csv'
HOLIDAYS_CSV = DATA_DIR / 'thai_holidays_2566_2568.csv'
ROADS_GPKG = next(DATA_DIR.glob('*.gpkg'))
PROVINCES_GEOJSON = DATA_DIR / 'provinces.geojson'
TRAFFIC_XLSX = DATA_DIR / 'สถิติปริมาณจราจร.xlsx'

print("Using:")
print("TRAMS:", TRAMS_CSV.name)
print("ROADS:", ROADS_GPKG.name)
print("PROVINCES:", PROVINCES_GEOJSON.name)

# 1. Load province boundaries and create lookup
with open(PROVINCES_GEOJSON, 'r', encoding='utf-8') as f:
    prov_data = json.load(f)

REG_MAP = {
    'North': 'ภาคเหนือ',
    'Northeast': 'ภาคตะวันออกเฉียงเหนือ',
    'Central': 'ภาคกลาง',
    'East': 'ภาคตะวันออก',
    'West': 'ภาคตะวันตก',
    'South': 'ภาคใต้'
}

PROV_INFO = {}
PROV_BY_REGION = {th: [] for th in REG_MAP.values()}
PROV_GEOMS = []

def point_in_poly(x, y, poly_rings):
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

for feat in prov_data['features']:
    props = feat['properties']
    pname = props['pro_th']
    if pname == 'อยุธยา':
        pname = 'พระนครศรีอยุธยา'
        props['pro_th'] = pname
    reg_en = props['reg_royin']
    reg_th = REG_MAP.get(reg_en, reg_en)
    props['reg_th'] = reg_th
    
    geom = feat['geometry']
    gtype = geom['type']
    coords = geom['coordinates']
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
                    
    bbox = [round(minx, 5), round(miny, 5), round(maxx, 5), round(maxy, 5)]
    PROV_INFO[pname] = {
        'province': pname,
        'province_en': props['pro_en'],
        'region': reg_th,
        'region_en': reg_en,
        'bbox': bbox,
        'lat': props.get('lat'),
        'lon': props.get('lon')
    }
    PROV_BY_REGION[reg_th].append(pname)
    PROV_GEOMS.append({
        'province': pname,
        'region': reg_th,
        'bbox': (minx, miny, maxx, maxy),
        'polys': polys
    })

# Compute region bboxes
REGION_INFO = {}
for reg_th, pnames in PROV_BY_REGION.items():
    rminx = min(PROV_INFO[p]['bbox'][0] for p in pnames)
    rminy = min(PROV_INFO[p]['bbox'][1] for p in pnames)
    rmaxx = max(PROV_INFO[p]['bbox'][2] for p in pnames)
    rmaxy = max(PROV_INFO[p]['bbox'][3] for p in pnames)
    REGION_INFO[reg_th] = {
        'region': reg_th,
        'provinces': sorted(pnames),
        'bbox': [round(rminx, 5), round(rminy, 5), round(rmaxx, 5), round(rmaxy, 5)]
    }

print(f"Loaded {len(PROV_INFO)} provinces across {len(REGION_INFO)} regions.")

# Highway digit classification helper
def classify_highway_code(code_val: object):
    """
    Classify highway code into 1 digit (purple), 2 digits (blue), 3 digits (pink), 4+ digits, or unknown.
    Clean string, handle zero-padded codes like '0001', '0012', '0101', '3701'.
    """
    if pd.isna(code_val):
        return {
            'code': None, 'raw': None, 'digits': 0,
            'digit_type': 'unknown', 'color': '#64748b', 'label': 'ไม่ระบุ'
        }
    s = str(code_val).strip()
    if not s or s.lower() in {'nan', 'none', 'null', 'road'}:
        return {
            'code': None, 'raw': s, 'digits': 0,
            'digit_type': 'unknown', 'color': '#64748b', 'label': 'ไม่ระบุ'
        }
    
    # Check for DOH highway numeric pattern (may have prefix 'ทล.', 'ทางหลวงหมายเลข', etc.)
    # Examples: '0001', '1', 'ทล. 12', '24', '0304', '304', '3701'
    m = re.match(r'^(?:ทล\.|ทางหลวง(?:หมายเลข)?|ทลช\.)?\s*0*([1-9]\d*)\s*$', s)
    if m:
        num_str = m.group(1)
        d_count = len(num_str)
        if d_count == 1:
            return {
                'code': num_str, 'raw': s, 'digits': 1,
                'digit_type': 'digit_1', 'color': '#9333ea', 'label': 'ทางหลวงเลข 1 หลัก'
            }
        elif d_count == 2:
            return {
                'code': num_str, 'raw': s, 'digits': 2,
                'digit_type': 'digit_2', 'color': '#2563eb', 'label': 'ทางหลวงเลข 2 หลัก'
            }
        elif d_count == 3:
            return {
                'code': num_str, 'raw': s, 'digits': 3,
                'digit_type': 'digit_3', 'color': '#ec4899', 'label': 'ทางหลวงเลข 3 หลัก'
            }
        else:
            return {
                'code': num_str, 'raw': s, 'digits': d_count,
                'digit_type': 'digit_4_plus', 'color': '#64748b', 'label': f'ทางหลวงเลข {d_count} หลัก'
            }
    
    # Non-standard or rural road (e.g. 'รน.4038', 'กท.1002', 'road')
    return {
        'code': s, 'raw': s, 'digits': 0,
        'digit_type': 'unknown', 'color': '#64748b', 'label': 'ทางหลวงชนบท/อื่นๆ'
    }

print("Tested classify_highway_code:")
print("0001 ->", classify_highway_code('0001'))
print("12 ->", classify_highway_code('12'))
print("0304 ->", classify_highway_code('0304'))
print("3701 ->", classify_highway_code('3701'))
print("road ->", classify_highway_code('road'))
print("รน.4038 ->", classify_highway_code('รน.4038'))
