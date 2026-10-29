"""Build reproducible, event-level TRAMS dashboard data from the supplied CSV."""
from __future__ import annotations

import json
import math
import re
import sqlite3
import struct
from collections import Counter, defaultdict
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "dataset"
OUT_DIR = ROOT / "data"
SOURCE = DATA_DIR / "accidents_2023_2025.csv"
JOINED = DATA_DIR / "accidents_dashboard_joined.csv"
PROVINCES_FILE = DATA_DIR / "provinces.geojson"
ROADS_FILE = DATA_DIR / "ข้อมูลทะเบียนบัญชีสายทาง (Road_Cl_Line_2568).gpkg"
MISSING = "ไม่ระบุ"


def clean(value):
    if pd.isna(value) or str(value).strip().lower() in {"", "nan", "none", "null"}:
        return None
    return str(value).strip()


def num(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def serial(value):
    if value is None:
        return None
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def count_pairs(counter):
    return [[key, value] for key, value in counter.most_common()]


def geometry_bbox(coordinates):
    points = []
    def walk(value):
        if isinstance(value, list) and len(value) >= 2 and all(isinstance(x, (int, float)) for x in value[:2]):
            points.append((float(value[0]), float(value[1])))
        elif isinstance(value, list):
            for child in value:
                walk(child)
    walk(coordinates)
    if not points:
        return None
    xs, ys = zip(*points)
    return [min(xs), min(ys), max(xs), max(ys)]


def inside_ring(point, ring):
    x, y = point
    inside = False
    if len(ring) < 4:
        return False
    x0, y0 = ring[-1][:2]
    for current in ring:
        x1, y1 = current[:2]
        if ((y1 > y) != (y0 > y)) and x < (x0 - x1) * (y - y1) / ((y0 - y1) or 1e-30) + x1:
            inside = not inside
        x0, y0 = x1, y1
    return inside


def point_in_feature(point, feature):
    geom = feature.get("geometry") or {}
    coords = geom.get("coordinates") or []
    polygons = [coords] if geom.get("type") == "Polygon" else coords if geom.get("type") == "MultiPolygon" else []
    for polygon in polygons:
        if polygon and inside_ring(point, polygon[0]) and not any(inside_ring(point, hole) for hole in polygon[1:]):
            return True
    return False


def parse_gpkg_wkb(blob):
    if not blob or blob[:2] != b"GP":
        return []
    flags = blob[3]
    envelope = (flags >> 1) & 7
    envelope_sizes = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}
    offset = 8 + envelope_sizes.get(envelope, 0)
    def parse(offset):
        endian = "<" if blob[offset] == 1 else ">"
        offset += 1
        kind = struct.unpack_from(endian + "I", blob, offset)[0]
        offset += 4
        base = kind & 0xFF
        dims = 2 + (1 if kind >= 1000 and kind < 3000 else 2 if kind >= 3000 else 0)
        if base == 2:
            count = struct.unpack_from(endian + "I", blob, offset)[0]
            offset += 4
            line = []
            for _ in range(count):
                values = struct.unpack_from(endian + ("d" * dims), blob, offset)
                offset += 8 * dims
                line.append([values[0], values[1]])
            return [line], offset
        if base == 5:
            count = struct.unpack_from(endian + "I", blob, offset)[0]
            offset += 4
            lines = []
            for _ in range(count):
                child, offset = parse(offset)
                lines.extend(child)
            return lines, offset
        raise ValueError(f"Unsupported GeoPackage geometry type {kind}")
    lines, _ = parse(offset)
    return [line for line in lines if len(line) >= 2]


def road_middle(lines):
    longest = max(lines, key=len, default=[])
    return longest[len(longest) // 2][:2] if longest else None


def simplify_line(line, tolerance=0.00003):
    """Generalize display geometry by about 3 m; source GeoPackage stays intact."""
    n = len(line)
    if n <= 2:
        return line
    cos_lat = math.cos(math.radians(sum(p[1] for p in line) / n))
    points = [(p[0] * cos_lat, p[1]) for p in line]
    keep = {0, n - 1}
    stack = [(0, n - 1)]
    tol2 = tolerance * tolerance
    while stack:
        first, last = stack.pop()
        ax, ay = points[first]
        bx, by = points[last]
        dx, dy = bx - ax, by - ay
        denom = dx * dx + dy * dy
        best_i, best_d2 = -1, tol2
        for i in range(first + 1, last):
            px, py = points[i]
            t = 0 if denom == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / denom))
            ex, ey = px - (ax + t * dx), py - (ay + t * dy)
            d2 = ex * ex + ey * ey
            if d2 > best_d2:
                best_i, best_d2 = i, d2
        if best_i >= 0:
            keep.add(best_i)
            stack.append((first, best_i))
            stack.append((best_i, last))
    return [line[i] for i in sorted(keep)]


def load_roads(provinces):
    if not ROADS_FILE.exists():
        return []
    connection = sqlite3.connect(ROADS_FILE)
    connection.row_factory = sqlite3.Row
    table = connection.execute("SELECT table_name FROM gpkg_contents WHERE data_type='features' LIMIT 1").fetchone()[0]
    rows = connection.execute(f'SELECT fid, highway_code, highway_name, road_code, road_name, spatial_data FROM "{table}"').fetchall()
    result = []
    province_boxes = [(p["bbox"], p) for p in provinces.values() if p.get("bbox")]
    for row in rows:
        lines = parse_gpkg_wkb(row["spatial_data"])
        if not lines:
            continue
        mid = road_middle(lines)
        lines = [simplify_line(line) for line in lines]
        province = region = MISSING
        if mid:
            for bbox, meta in province_boxes:
                if bbox[0] <= mid[0] <= bbox[2] and bbox[1] <= mid[1] <= bbox[3] and any(point_in_feature(mid, f) for f in meta["features"]):
                    province, region = meta["province"], meta["region"]
                    break
        code = clean(row["highway_code"])
        code_digits = code if code and code.isdigit() else ""
        # The DOH line file stores some highway identifiers zero-padded (e.g. 0001).
        # Keep the source identifier intact, but classify its significant digits.
        significant_code = code_digits.lstrip("0")
        n_digits = len(significant_code)
        digit_type = f"digit_{n_digits}" if n_digits in (1, 2, 3) else "unknown"
        digit_label = {1: "ทางหลวงเลข 1 หลัก", 2: "ทางหลวงเลข 2 หลัก", 3: "ทางหลวงเลข 3 หลัก"}.get(n_digits, "ไม่ระบุประเภท")
        result.append({"id": str(row["fid"]), "highway_code": code, "highway_name": clean(row["highway_name"]),
                       "road_code": clean(row["road_code"]), "road_name": clean(row["road_name"]),
                       "province": province, "region": region, "digit_type": digit_type,
                       "digit_label": digit_label, "digits": n_digits or None, "lines": lines})
    connection.close()
    return result


def main():
    if not SOURCE.exists():
        raise FileNotFoundError(f"ไม่พบไฟล์ข้อมูลหลัก: {SOURCE}")
    raw = pd.read_csv(SOURCE, encoding="utf-8-sig", low_memory=False,
                      dtype={"ACC_CODE": "string", "รหัสสายทาง": "string"})
    if "ACC_CODE" not in raw.columns:
        raise ValueError("ไม่พบคอลัมน์ ACC_CODE ในไฟล์ข้อมูล")

    # Map Thai source fields without renaming/mutating the source file.
    fields = {
        "year": "ปีที่เกิดเหตุ", "date": "วันที่เกิดเหตุ", "time": "เวลา",
        "id": "ACC_CODE", "agency": "หน่วยงาน", "road_authority": "สายทางหน่วยงาน",
        "highway_raw": "รหัสสายทาง", "road_name": "สายทาง", "km": "KM",
        "province": "จังหวัด", "vehicle": "รถคันที่1", "context": "บริเวณที่เกิดเหตุ",
        "cause": "มูลเหตุสันนิษฐาน", "collision": "ลักษณะการเกิดเหตุ",
        "weather": "สภาพอากาศ", "latitude": "LATITUDE", "longitude": "LONGITUDE",
        "fatalities": "ผู้เสียชีวิต", "serious": "ผู้บาดเจ็บสาหัส",
        "minor": "ผู้บาดเจ็บเล็กน้อย", "injuries_reported": "รวมจำนวนผู้บาดเจ็บ",
    }
    missing_cols = [c for c in fields.values() if c not in raw.columns]
    if missing_cols:
        raise ValueError("คอลัมน์ที่จำเป็นขาดหาย: " + ", ".join(missing_cols))

    boundary_fc = json.loads(PROVINCES_FILE.read_text(encoding="utf-8")) if PROVINCES_FILE.exists() else {"features": []}
    province_meta = {}
    province_lookup = {}
    region_boxes = {}
    for feature in boundary_fc.get("features", []):
        props = feature.setdefault("properties", {})
        name = clean(props.get("PROV_NAM_T")) or clean(props.get("pro_th"))
        if name == "อยุธยา":
            name = "พระนครศรีอยุธยา"
        region = clean(props.get("REGION_6")) or clean(props.get("reg_th")) or MISSING
        props.update({"pro_th": name, "reg_th": region})
        bbox = geometry_bbox((feature.get("geometry") or {}).get("coordinates", []))
        if not name or not bbox:
            continue
        metadata = {"province": name, "region": region, "bbox": bbox, "features": [feature]}
        province_meta[name] = metadata
        province_lookup[name] = metadata
        if name == "พระนครศรีอยุธยา":
            province_lookup["อยุธยา"] = metadata
        if region not in region_boxes:
            region_boxes[region] = bbox[:]
        else:
            old = region_boxes[region]
            region_boxes[region] = [min(old[0],bbox[0]),min(old[1],bbox[1]),max(old[2],bbox[2]),max(old[3],bbox[3])]

    raw["_id"] = raw[fields["id"]].map(clean)
    null_ids = int(raw["_id"].isna().sum())
    grouped = raw[raw["_id"].notna()].groupby("_id", sort=False, dropna=False)
    duplicate_groups = {key: group for key, group in grouped if len(group) > 1}
    mismatch_fields = [fields[k] for k in ("date", "time", "province", "latitude", "longitude", "fatalities", "serious", "minor")]
    mismatch_groups = sum(any(g[col].nunique(dropna=False) > 1 for col in mismatch_fields) for g in duplicate_groups.values())
    exact_duplicate_rows = int(raw.duplicated(keep="first").sum())

    # For repeated ACC_CODEs, use the row with the highest casualty counts and
    # retain that event's fields. Repeats with conflicting core values are reported.
    def casualty_score(row):
        return sum(num(row.get(fields[k])) or 0 for k in ("fatalities", "serious", "minor"))

    chosen = []
    for _, group in grouped:
        if len(group) == 1:
            row = group.iloc[0]
        else:
            row = max((r for _, r in group.iterrows()), key=casualty_score)
        chosen.append(row)

    # The previously supplied joined file provides region and validated fatal-event
    # road-match attributes. It is never used to add or replace casualty totals.
    joined_by_id = {}
    if JOINED.exists():
        joined = pd.read_csv(JOINED, encoding="utf-8-sig", low_memory=False)
        for _, row in joined.iterrows():
            joined_by_id[str(row.get("id"))] = row

    records = []
    quality = {"coordinate_missing": 0, "coordinate_invalid": 0, "coordinate_outside_thailand": 0,
               "date_missing": 0, "date_invalid": 0, "fatality_missing": 0,
               "injury_value_missing": 0, "negative_casualties": 0, "injury_total_mismatch": 0}
    for row in chosen:
        rid = clean(row[fields["id"]])
        j = joined_by_id.get(rid)
        province = clean(row[fields["province"]]) or MISSING
        if province == "อยุธยา":
            province = "พระนครศรีอยุธยา"
        region = clean(j.get("region")) if j is not None else None
        if province in province_lookup:
            region = province_lookup[province]["region"]
        y = num(row[fields["year"]])
        date = clean(row[fields["date"]])
        tm = clean(row[fields["time"]])
        lat, lon = num(row[fields["latitude"]]), num(row[fields["longitude"]])
        if lat is None or lon is None:
            quality["coordinate_missing"] += 1
        elif not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == 0 and lon == 0):
            quality["coordinate_invalid"] += 1
            lat = lon = None
        elif 5.0 <= lat <= 21.5 and 97.0 <= lon <= 106.0:
            pass
        else:
            quality["coordinate_outside_thailand"] += 1
        fatalities = num(row[fields["fatalities"]])
        serious = num(row[fields["serious"]])
        minor = num(row[fields["minor"]])
        injuries_reported = num(row[fields["injuries_reported"]])
        if fatalities is None:
            quality["fatality_missing"] += 1
        if serious is None or minor is None:
            quality["injury_value_missing"] += 1
        if any(v is not None and v < 0 for v in (fatalities, serious, minor, injuries_reported)):
            quality["negative_casualties"] += 1
        if serious is not None and minor is not None and injuries_reported is not None and serious + minor != injuries_reported:
            quality["injury_total_mismatch"] += 1
        try:
            parsed = pd.to_datetime(date, errors="raise") if date else None
            iso_date = parsed.strftime("%Y-%m-%d") if parsed is not None else None
        except Exception:
            iso_date = None
            if date:
                quality["date_invalid"] += 1
            else:
                quality["date_missing"] += 1
        highway = clean(row[fields["highway_raw"]]) or ""
        code_match = re.match(r"^\s*(?:ทล\.?\s*)?(\d+)\b", highway, flags=re.IGNORECASE)
        highway_code = (clean(j.get("highway_code")) if j is not None else None) or (code_match.group(1) if code_match else None)
        digit_count = len(highway_code.lstrip("0")) if highway_code and highway_code.isdigit() else 0
        digit_type = f"digit_{digit_count}" if digit_count in (1,2,3) else "unknown"
        rec = {
            "id": rid, "year": int(y) if y else None, "incident_date": iso_date,
            "incident_time": tm, "province": province, "region": region or MISSING,
            "highway_code": highway_code, "highway_digits": digit_count or None,
            "digit_type": digit_type,
            "highway_code_raw": clean(row[fields["highway_raw"]]),
            "road_name": clean(row[fields["road_name"]]), "km": clean(row[fields["km"]]),
            "agency": clean(row[fields["road_authority"]]) or clean(row[fields["agency"]]),
            "fatalities": serial(fatalities), "injuries_severe": serial(serious),
            "injuries_minor": serial(minor),
            "injuries": serial((serious or 0) + (minor or 0)) if serious is not None or minor is not None else None,
            "vehicle": clean(row[fields["vehicle"]]) or MISSING,
            "cause": clean(row[fields["cause"]]) or MISSING,
            "collision": clean(row[fields["collision"]]) or MISSING,
            "context": clean(row[fields["context"]]) or MISSING,
            "weather": clean(row[fields["weather"]]) or MISSING,
            "latitude": lat, "longitude": lon,
            "road_status": clean(j.get("road_status")) if j is not None else "unmatched",
            "road_distance_m": num(j.get("road_distance_m")) if j is not None else None,
            "road_feature_id": clean(j.get("road_feature_id")) if j is not None else None,
            "matched_highway_code": clean(j.get("matched_highway_code")) if j is not None else None,
        }
        records.append(rec)

    provinces = {name: {"province": meta["province"], "region": meta["region"], "bbox": meta["bbox"]}
                 for name, meta in province_meta.items()}
    for r in records:
        if r["province"] not in provinces and r["province"] != MISSING:
            provinces[r["province"]] = {"province": r["province"], "region": r["region"], "bbox": None}
    regions = {name: {"bbox": bbox} for name, bbox in region_boxes.items()}
    roads = load_roads(province_meta)

    annual = {}
    for year in (2023, 2024, 2025):
        subset = [r for r in records if r["year"] == year]
        monthly, weekdays, hours = [0] * 12, [0] * 7, [0] * 12
        provinces_ctr, vehicles, causes, collisions, weather, road_types = Counter(), Counter(), Counter(), Counter(), Counter(), Counter()
        for r in subset:
            d = pd.to_datetime(r["incident_date"], errors="coerce") if r["incident_date"] else pd.NaT
            if not pd.isna(d):
                monthly[d.month - 1] += 1
                weekdays[(d.weekday())] += 1
            try:
                hour = int((r["incident_time"] or "").split(":")[0])
                if 0 <= hour <= 23: hours[hour // 2] += 1
            except (ValueError, IndexError):
                pass
            provinces_ctr[r["province"]] += 1
            vehicles[r["vehicle"]] += 1
            causes[r["cause"]] += 1
            collisions[r["collision"]] += 1
            weather[r["weather"]] += 1
            road_types[r["agency"] or MISSING] += 1
        annual[str(year)] = {
            "events": len(subset),
            "fatalities": sum((r["fatalities"] or 0) for r in subset),
            "fatal_events": sum(1 for r in subset if (r["fatalities"] or 0) > 0),
            "serious": sum((r["injuries_severe"] or 0) for r in subset),
            "minor": sum((r["injuries_minor"] or 0) for r in subset),
            "injuries": sum((r["injuries"] or 0) for r in subset),
            "vehicles": sum(1 for r in subset if r["vehicle"] != MISSING),
            "coordinates": sum(1 for r in subset if r["latitude"] is not None),
            "monthly": monthly, "weekdays": weekdays, "hours": hours,
            "provinces": [[p, n, sum((r["fatalities"] or 0) for r in subset if r["province"] == p), sum((r["injuries"] or 0) for r in subset if r["province"] == p)] for p, n in provinces_ctr.most_common()],
            "vehicle": count_pairs(vehicles), "cause": count_pairs(causes),
            "collision": count_pairs(collisions), "weather": count_pairs(weather),
            "road_type": count_pairs(road_types),
        }

    total_rows = len(raw)
    total_events = len(records)
    fatal_events = sum(1 for r in records if (r["fatalities"] or 0) > 0)
    joined_matches = sum(1 for r in records if r["road_status"] == "matched")
    dashboard = {
        "meta": {"source": "TRAMS · กระทรวงคมนาคม", "source_file": "dataset/accidents_2023_2025.csv",
                 "source_columns": len(raw.columns), "source_headers": list(raw.columns),
                 "road_source": ROADS_FILE.name if ROADS_FILE.exists() else None,
                 "province_boundary_source": "DDPM DPM_TH_Boundary FeatureServer layer 1" if PROVINCES_FILE.exists() else None,
                 "road_features": len(roads), "province_features": len(boundary_fc.get("features", [])),
                 "years": [2023, 2024, 2025], "source_rows": total_rows, "event_count": total_events,
                 "fatal_event_count": fatal_events,
                 "total_fatalities": sum((r["fatalities"] or 0) for r in records),
                 "road_matches": joined_matches, "duplicate_id_groups": len(duplicate_groups),
                 "duplicate_id_rows": total_rows - total_events, "duplicate_conflict_groups": mismatch_groups,
                 "counting_rule": "หนึ่งเหตุการณ์ต่อ ACC_CODE; เลือกแถวที่มีจำนวนผู้เสียชีวิตและบาดเจ็บรวมสูงสุดเมื่อพบรหัสซ้ำ; กลุ่มซ้ำที่ข้อมูลหลักขัดแย้งถูกระบุให้ตรวจสอบ"},
        "records": records, "provinces": provinces, "regions": regions, "roads": [],
        "quality": {**quality, "source_rows": total_rows, "unique_acc_codes": total_events,
                    "missing_acc_code_rows": null_ids, "duplicate_id_groups": len(duplicate_groups),
                    "duplicate_id_rows": total_rows - total_events, "duplicate_conflict_groups": mismatch_groups,
                    "exact_duplicate_rows": exact_duplicate_rows},
    }
    summary = {"meta": {"records": total_events, "source_rows": total_rows,
                        "source": "TRAMS · กระทรวงคมนาคม", "years": [2023, 2024, 2025],
                        "counting_rule": dashboard["meta"]["counting_rule"]}, "years": annual}
    OUT_DIR.mkdir(exist_ok=True)
    (OUT_DIR / "dashboard_data.json").write_text(json.dumps(dashboard, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT_DIR / "accident_summary.json").write_text(json.dumps(summary, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT_DIR / "roads.json").write_text(json.dumps(roads, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT_DIR / "provinces.geojson").write_text(json.dumps(boundary_fc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Built {total_events:,} unique ACC_CODE events from {total_rows:,} rows; {fatal_events:,} fatal events; {dashboard['meta']['total_fatalities']:,} deaths.")
    print(f"Duplicate-ID groups: {len(duplicate_groups):,}; conflicting core groups: {mismatch_groups:,}; valid-coordinate candidates: {total_events-quality['coordinate_missing']-quality['coordinate_invalid']:,}.")


if __name__ == "__main__":
    main()
