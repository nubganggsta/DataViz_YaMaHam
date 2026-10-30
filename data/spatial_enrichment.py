"""Boundary checks and conservative road enrichment; source values stay auditable."""
import math
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1] / '.spatial_deps'))
from pyproj import Transformer
from shapely.geometry import Point, MultiLineString, shape
from shapely import make_valid
from shapely.ops import transform
from shapely.strtree import STRtree


def present(value):
    return value is not None and str(value).strip().lower() not in {'', 'ไม่ระบุ', 'nan', 'none', 'null', '-'}


def numeric_ref(value):
    text = str(value or '').strip()
    return str(int(text)) if re.fullmatch(r'\d+', text) else None


def canonical_ref(value):
    return numeric_ref(value) or re.sub(r'\s+', '', str(value or '').strip()).casefold()


def enrich_records(records, boundary_fc, roads, tolerance=100):
    if not 0 < tolerance <= 100:
        raise ValueError('Road tolerance must be greater than 0 and at most 100 metres')
    polygons, names, regions = [], [], []
    region_map = {'North':'ภาคเหนือ','Northeast':'ภาคตะวันออกเฉียงเหนือ','Central':'ภาคกลาง',
                  'East':'ภาคตะวันออก','West':'ภาคตะวันตก','South':'ภาคใต้'}
    for feature in boundary_fc.get('features', []):
        p = feature.get('properties', {})
        name = p.get('PROV_NAM_T') or p.get('pro_th')
        name = 'พระนครศรีอยุธยา' if name == 'อยุธยา' else name
        if not name or not feature.get('geometry'):
            continue
        polygons.append(make_valid(shape(feature['geometry'])))
        names.append(name)
        region = p.get('REGION_6') or p.get('reg_th')
        regions.append(region_map.get(region, region))
    if not polygons:
        raise ValueError('Province polygons are required; cannot perform boundary filtering')
    province_tree = STRtree(polygons)
    road_geometries, road_rows = [], []
    for road in roads:
        lines = [line for line in road.get('lines', []) if len(line) >= 2]
        if lines:
            road_geometries.append(MultiLineString(lines))
            road_rows.append(road)
    projected = {}
    for zone in (47, 48):
        project = Transformer.from_crs(4326, 32600 + zone, always_xy=True).transform
        geometries = [transform(project, geom) for geom in road_geometries]
        projected[zone] = (project, geometries, STRtree(geometries))

    accepted, excluded, stats = [], [], Counter()
    for record in records:
        row = dict(record)
        lat, lon = row.get('latitude'), row.get('longitude')
        reason = None
        if lat is None or lon is None or not (math.isfinite(lat) and math.isfinite(lon)):
            reason = 'missing_or_invalid_coordinates'
        elif not (5.61 <= lat <= 20.46 and 97.34 <= lon <= 105.64):
            reason = 'outside_thailand_bbox'
        point = Point(lon, lat) if reason is None else None
        hits = sorted(int(i) for i in province_tree.query(point, predicate='intersects')) if point is not None else []
        if reason is None and not hits:
            reason = 'outside_thailand_polygon'
        if reason:
            stats[reason] += 1
            excluded.append({**row, 'exclusion_reason': reason})
            continue

        row['province_original'] = row.get('province')
        row['highway_code_raw_original'] = row.get('highway_code_raw')
        row['road_name_original'] = row.get('road_name')
        row['province_from_coordinates'] = names[hits[0]] if len(hits) == 1 else None
        row['province_source'] = 'source' if present(row.get('province')) else 'missing'
        if not present(row.get('province')) and len(hits) == 1:
            row['province'], row['region'] = names[hits[0]], regions[hits[0]]
            row['province_source'] = 'point_in_polygon'
            stats['province_filled'] += 1
        row['province_coordinate_conflict'] = present(row.get('province')) and row['province'] not in [names[i] for i in hits]
        stats['province_coordinate_conflicts'] += int(row['province_coordinate_conflict'])
        row['boundary_status'] = 'inside_thailand'
        row['legacy_road_feature_id'] = row.get('road_feature_id')
        row['road_status'], row['road_feature_id'], row['road_distance_m'], row['matched_highway_code'] = 'unmatched', None, None, None
        row['road_name_source'] = 'source' if present(row.get('road_name')) else 'missing'
        row['highway_ref_source'] = 'source' if present(row.get('highway_code_raw')) else 'missing'
        project, geometries, tree = projected[47 if lon < 102 else 48]
        p = transform(project, point)
        candidates = []
        for i in tree.query(p.buffer(tolerance)):
            distance = p.distance(geometries[int(i)])
            if distance <= tolerance:
                candidates.append((distance, int(i)))
        candidates.sort(key=lambda item:(item[0], str(road_rows[item[1]]['id'])))
        raw = row.get('highway_code_raw')
        compatible = [(d,i) for d,i in candidates if not present(raw) or canonical_ref(raw) == canonical_ref(road_rows[i]['highway_code'])]
        if not candidates:
            row['road_spatial_status'] = 'no_highway_within_tolerance'
        elif not compatible:
            row['road_spatial_status'] = 'source_ref_conflict'
        else:
            distance, i = compatible[0]
            road = road_rows[i]
            ties = [(d,j) for d,j in compatible if abs(d-distance) < 0.01 and j != i]
            if ties:
                row['road_spatial_status'] = 'ambiguous_nearest'
            else:
                row['road_spatial_status'] = 'matched'
                row['road_status'] = 'matched'
                row['road_feature_id'] = road['id']
                row['road_distance_m'] = round(distance, 3)
                row['matched_highway_code'] = road['highway_code']
                row['matched_road_source'] = road.get('source', 'DOH')
                stats[f"matched_{row['matched_road_source']}"] += 1
                if not present(raw):
                    row['highway_code_raw'] = numeric_ref(road['highway_code']) or road['highway_code']
                    row['highway_code'] = numeric_ref(row['highway_code_raw'])
                    code = numeric_ref(row['highway_code'])
                    row['highway_digits'] = len(code) if code else None
                    row['digit_type'] = f'digit_{len(code)}' if code and len(code) <= 4 else ('rural' if re.match(r'^[ก-ฮ]', row['highway_code_raw']) else 'unknown')
                    row['highway_ref_source'] = 'nearest_highway'
                    stats['highway_ref_filled'] += 1
                if not present(row.get('road_name')) and present(road.get('road_name')):
                    row['road_name'] = road['road_name']
                    row['road_name_source'] = 'nearest_highway'
                    stats['road_name_filled'] += 1
        stats[row['road_spatial_status']] += 1
        accepted.append(row)
    return accepted, excluded, {'input_events':len(records),'accepted_events':len(accepted),
        'excluded_events':len(excluded),'tolerance_m':tolerance,'distance_crs':'EPSG:32647 / EPSG:32648',
        'geometry':'original unsimplified DOH GeoPackage and DRR source road lines','counts':dict(stats)}
