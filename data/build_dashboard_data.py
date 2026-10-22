"""Join fatality, holiday, DOH line and traffic data for the browser dashboard.

Usage (from project root):
    python data/build_dashboard_data.py

The web interface is written in vanilla JavaScript/CSS/HTML. This preparation
step uses pandas plus Python's standard sqlite/json modules; no GIS package is
required. Spatial matching uses the GeoPackage RTree and exact point-to-line
distance in a local metre approximation. Incident dates are never substituted
with death dates.
"""

from __future__ import annotations

import json
import math
import re
import sqlite3
import struct
from datetime import datetime
from functools import lru_cache
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parent
DEATHS_CSV = ROOT / "road_fatalities_2566_2568_coordinates_checked.csv"
HOLIDAYS_CSV = ROOT / "thai_holidays_2566_2568.csv"
ROADS_GPKG = ROOT / "ข้อมูลทะเบียนบัญชีสายทาง (Road_Cl_Line_2568).gpkg"
TRAFFIC_XLSX = ROOT / "สถิติปริมาณจราจร.xlsx"
OUT_CSV = ROOT / "road_fatalities_dashboard_joined.csv"
OUT_JSON = ROOT / "dashboard_data.json"
MAX_MATCH_METERS = 100.0
GPKG_TABLE = "hods_road_cl_line_2568"
RTREE_TABLE = "rtree_hods_road_cl_line_2568_spatial_data"

THAI_MONTHS = {
    "มกราคม": 1, "กุมภาพันธ์": 2, "มีนาคม": 3, "เมษายน": 4,
    "พฤษภาคม": 5, "มิถุนายน": 6, "กรกฎาคม": 7, "สิงหาคม": 8,
    "กันยายน": 9, "ตุลาคม": 10, "พฤศจิกายน": 11, "ธันวาคม": 12,
}
WEEKDAYS_TH = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"]


def parse_thai_date(value: object) -> str | None:
    if pd.isna(value):
        return None
    m = re.search(r"(\d{1,2})\s+([ก-๙]+)\s+(\d{4})", str(value).strip())
    if not m or m.group(2) not in THAI_MONTHS:
        return None
    day, month, year = int(m.group(1)), THAI_MONTHS[m.group(2)], int(m.group(3))
    if year >= 2400:
        year -= 543
    try:
        return datetime(year, month, day).date().isoformat()
    except ValueError:
        return None


def parse_death_date(value: object) -> str | None:
    if pd.isna(value):
        return None
    value = str(value).strip()
    # Source dates include values such as 13/1/2023, confirming D/M/YYYY.
    parsed = pd.to_datetime(value, format="%d/%m/%Y", errors="coerce")
    if pd.isna(parsed):
        parsed = pd.to_datetime(value, errors="coerce")
    return None if pd.isna(parsed) else parsed.date().isoformat()


def parse_wkb_lines(blob: bytes) -> list[list[tuple[float, float]]]:
    """Read GeoPackage-wrapped 2D LineString or MultiLineString geometry."""
    if not blob or blob[:2] != b"GP":
        return []
    flags = blob[3]
    endian = "<" if flags & 1 else ">"
    envelope_code = (flags >> 1) & 7
    envelope_doubles = {0: 0, 1: 4, 2: 6, 3: 6, 4: 8}.get(envelope_code, 0)
    offset = 8 + envelope_doubles * 8

    def read_geom(pos: int) -> tuple[list[list[tuple[float, float]]], int]:
        byte_order = "<" if blob[pos] == 1 else ">"
        geom_type = struct.unpack_from(byte_order + "I", blob, pos + 1)[0]
        # Accommodate OGC dimensional type codes (1000/2000/3000 series).
        base_type = geom_type % 1000
        pos += 5
        if base_type == 2:  # LineString
            n = struct.unpack_from(byte_order + "I", blob, pos)[0]
            pos += 4
            coords = []
            stride = 16 if geom_type < 1000 else (24 if geom_type < 2000 else 32)
            for _ in range(n):
                x, y = struct.unpack_from(byte_order + "dd", blob, pos)
                coords.append((x, y))
                pos += stride
            return ([coords] if len(coords) >= 2 else []), pos
        if base_type == 5:  # MultiLineString
            n = struct.unpack_from(byte_order + "I", blob, pos)[0]
            pos += 4
            lines = []
            for _ in range(n):
                children, pos = read_geom(pos)
                lines.extend(children)
            return lines, pos
        return [], pos

    lines, _ = read_geom(offset)
    return lines


def line_distance_m(point_lon: float, point_lat: float, lines: list[list[tuple[float, float]]]) -> float:
    """Minimum local equirectangular point-to-segment distance in metres."""
    cos_lat = math.cos(math.radians(point_lat))
    best = float("inf")
    for line in lines:
        if len(line) < 2:
            continue
        xy = [((lon - point_lon) * 111_320.0 * cos_lat, (lat - point_lat) * 110_574.0) for lon, lat in line]
        for (x1, y1), (x2, y2) in zip(xy, xy[1:]):
            dx, dy = x2 - x1, y2 - y1
            denom = dx * dx + dy * dy
            t = 0.0 if denom == 0 else max(0.0, min(1.0, -(x1 * dx + y1 * dy) / denom))
            best = min(best, math.hypot(x1 + t * dx, y1 + t * dy))
    return best


def simplify_line(coords: list[tuple[float, float]], tolerance: float = 0.00008) -> list[list[float]]:
    """Iterative Douglas-Peucker simplification for map rendering only."""
    if len(coords) <= 2:
        return [[x, y] for x, y in coords]
    keep = {0, len(coords) - 1}
    stack = [(0, len(coords) - 1)]
    while stack:
        start, end = stack.pop()
        x1, y1 = coords[start]
        x2, y2 = coords[end]
        dx, dy = x2 - x1, y2 - y1
        denom = dx * dx + dy * dy
        farthest, farthest_i = 0.0, None
        for i in range(start + 1, end):
            x, y = coords[i]
            t = 0 if denom == 0 else max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / denom))
            dist = math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))
            if dist > farthest:
                farthest, farthest_i = dist, i
        if farthest_i is not None and farthest > tolerance:
            keep.add(farthest_i)
            stack.extend([(start, farthest_i), (farthest_i, end)])
    return [[coords[i][0], coords[i][1]] for i in sorted(keep)]


def traffic_code(value: object) -> str | None:
    if pd.isna(value):
        return None
    digits = "".join(re.findall(r"\d", str(value)))
    return digits.zfill(4) if digits else None


def safe_float(value: object) -> float | None:
    try:
        f = float(value)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def main() -> None:
    deaths = pd.read_csv(DEATHS_CSV, encoding="utf-8-sig", low_memory=False)
    holidays = pd.read_csv(HOLIDAYS_CSV, encoding="utf-8-sig", low_memory=False)
    if "id" not in deaths.columns and "Dead_ID" in deaths.columns:
        deaths.insert(0, "id", deaths["Dead_ID"])

    # Input calendar schema: weekday, Thai date, holiday name, alcohol flag, description.
    holiday_name_col = holidays.columns[2]
    holiday_date_col = holidays.columns[1]
    holidays["incident_date"] = holidays[holiday_date_col].map(parse_thai_date)
    holiday_map = {
        str(row["incident_date"]): str(row[holiday_name_col])
        for _, row in holidays.dropna(subset=["incident_date"]).iterrows()
    }

    # Incident date and time must remain missing when the source has no value.
    date_col = "Date Rec" if "Date Rec" in deaths.columns else "DateRec"
    time_col = "Time Rec" if "Time Rec" in deaths.columns else "TimeRec"
    deaths["incident_date"] = deaths[date_col].map(parse_death_date)
    deaths["incident_time"] = deaths[time_col].where(deaths[time_col].notna(), None)
    deaths["death_date"] = deaths["Dead_Date"].map(parse_death_date)
    deaths["holiday_name"] = deaths["incident_date"].map(holiday_map)
    deaths["is_special_holiday"] = deaths["incident_date"].map(lambda x: None if x is None else x in holiday_map)
    deaths["incident_weekday_th"] = deaths["incident_date"].map(
        lambda x: WEEKDAYS_TH[datetime.fromisoformat(x).weekday()] if x else None
    )

    # National holiday windows are based on the source holiday table, not death dates.
    festival_map = {}
    for day, name in holiday_map.items():
        if "สงกรานต์" in name:
            festival_map[day] = "สงกรานต์"
        elif "ขึ้นปีใหม่" in name or "ปีใหม่" in name:
            festival_map[day] = "ปีใหม่"
    deaths["festival"] = deaths["incident_date"].map(festival_map)

    # Load detailed DOH road line records and their RTree bounding boxes.
    road_conn = sqlite3.connect(f"file:{ROADS_GPKG.as_posix()}?mode=ro", uri=True)
    road_conn.row_factory = sqlite3.Row
    road_sql = f"SELECT fid,highway_code,highway_name,road_code,road_name,road_class,road_class_name,hierarchy_name,km_start_section,km_end_section,spatial_data FROM {GPKG_TABLE} WHERE fid=?"
    road_by_id = {}

    @lru_cache(maxsize=4096)
    def road_by_fid(fid: int):
        row = road_conn.execute(road_sql, (fid,)).fetchone()
        if row is None:
            return None
        return {
            "fid": int(row["fid"]), "highway_code": row["highway_code"],
            "highway_name": row["highway_name"], "road_code": row["road_code"],
            "road_name": row["road_name"], "km_start_section": row["km_start_section"],
            "km_end_section": row["km_end_section"], "road_class": row["road_class"],
            "road_class_name": row["road_class_name"], "hierarchy_name": row["hierarchy_name"],
            "lines": parse_wkb_lines(row["spatial_data"]),
        }

    traffic = pd.read_excel(TRAFFIC_XLSX, dtype={"road_code": str})
    traffic["match_highway_code"] = traffic["road_code"].map(traffic_code)
    traffic["budget_year"] = pd.to_numeric(traffic["budget_year"], errors="coerce")
    traffic_summary = (
        traffic.dropna(subset=["match_highway_code"])
        .groupby("match_highway_code", as_index=False)
        .agg(traffic_aadt_mean=("sum_AADT", "mean"), traffic_years=("budget_year", "nunique"), traffic_road_name=("road_name", "first"))
    ).set_index("match_highway_code")

    road_assignments = []
    map_lines = []
    for i, row in enumerate(deaths.itertuples(index=False), start=1):
        attrs = row._asdict()
        lon = safe_float(attrs.get("Longitude_Clean"))
        lat = safe_float(attrs.get("Latitude_Clean"))
        best = None
        best_dist = float("inf")
        if lon is not None and lat is not None and 5.3 <= lat <= 20.8 and 96.5 <= lon <= 106.0:
            dlat = MAX_MATCH_METERS / 110_574.0
            dlon = MAX_MATCH_METERS / (111_320.0 * max(0.1, math.cos(math.radians(lat))))
            ids = road_conn.execute(
                f"SELECT id FROM {RTREE_TABLE} WHERE minx<=? AND maxx>=? AND miny<=? AND maxy>=?",
                (lon + dlon, lon - dlon, lat + dlat, lat - dlat),
            ).fetchall()
            for candidate in ids:
                road = road_by_fid(int(candidate[0]))
                if not road or not road["lines"]:
                    continue
                dist = line_distance_m(lon, lat, road["lines"])
                if dist < best_dist:
                    best, best_dist = road, dist
        if best is not None and best_dist <= MAX_MATCH_METERS:
            code = traffic_code(best["highway_code"])
            tr = traffic_summary.loc[code].to_dict() if code in traffic_summary.index else {}
            assignment = {
                "road_match_status": "matched", "road_distance_m": round(best_dist, 1),
                "road_feature_id": best["fid"], "highway_code": best["highway_code"],
                "highway_name": best["highway_name"], "road_code": best["road_code"],
                "road_class": best["road_class"], "road_class_name": best["road_class_name"],
                "hierarchy_name": best["hierarchy_name"],
                "road_name": best["road_name"], "km_start_section": best["km_start_section"],
                "km_end_section": best["km_end_section"],
                "traffic_aadt_mean": safe_float(tr.get("traffic_aadt_mean")),
                "traffic_years_available": int(tr["traffic_years"]) if tr.get("traffic_years") is not None else None,
                "traffic_road_name": tr.get("traffic_road_name"),
            }
        else:
            assignment = {
                "road_match_status": "no_coordinates" if lon is None or lat is None else "no_road_within_100m",
                "road_distance_m": None, "road_feature_id": None, "highway_code": None,
                "highway_name": None, "road_code": None, "road_name": None,
                "road_class": None, "road_class_name": None, "hierarchy_name": None,
                "km_start_section": None, "km_end_section": None,
                "traffic_aadt_mean": None, "traffic_years_available": None, "traffic_road_name": None,
            }
        road_assignments.append(assignment)
        if i % 5000 == 0:
            print(f"Spatial matching: {i:,}/{len(deaths):,}", flush=True)

    road_conn.close()
    joined = pd.concat([deaths.reset_index(drop=True), pd.DataFrame(road_assignments)], axis=1)
    joined.to_csv(OUT_CSV, index=False, encoding="utf-8-sig")

    # Compact data for the web client.
    fields = {
        "id": "Dead_ID", "dead_year": "DEAD_YEAR", "death_date": "death_date",
        "incident_date": "incident_date", "incident_time": "incident_time",
        "age": "Age", "sex": "Sex", "vehicle": "Vehicle", "cause": "Cause_Code",
        "helmet": "Risk_Helmet", "belt": "Risk_Safety_Belt", "latitude": "Latitude_Clean",
        "longitude": "Longitude_Clean", "coordinate_status": "Coordinate_Status",
        "province": "Dead_Province", "holiday_name": "holiday_name", "festival": "festival",
        "road_status": "road_match_status", "road_distance_m": "road_distance_m",
        "road_feature_id": "road_feature_id", "road_class": "road_class",
        "road_class_name": "road_class_name", "hierarchy_name": "hierarchy_name",
        "highway_code": "highway_code", "highway_name": "highway_name", "road_code": "road_code",
        "road_name": "road_name", "km_start": "km_start_section", "km_end": "km_end_section",
        "traffic_aadt": "traffic_aadt_mean", "traffic_years": "traffic_years_available",
    }
    records = []
    for _, r in joined.iterrows():
        record = {}
        for out_key, in_key in fields.items():
            value = r.get(in_key)
            if pd.isna(value):
                value = None
            elif out_key in {"latitude", "longitude", "age", "road_distance_m", "traffic_aadt"}:
                value = safe_float(value)
            elif out_key == "traffic_years":
                value = int(value)
            else:
                value = str(value)
            record[out_key] = value
        records.append(record)

    # Simplified, display-only road lines. Spatial matching above always uses full geometry.
    roads_conn = sqlite3.connect(f"file:{ROADS_GPKG.as_posix()}?mode=ro", uri=True)
    road_features = []
    for r in roads_conn.execute(f"SELECT fid,highway_code,road_code,road_name,road_class,road_class_name,hierarchy_name,spatial_data FROM {GPKG_TABLE}"):
        lines = parse_wkb_lines(r[7])
        multi = [simplify_line(line) for line in lines if len(line) >= 2]
        multi = [line for line in multi if len(line) >= 2]
        if not multi:
            continue
        road_features.append({
            "id": int(r[0]), "highway_code": r[1], "road_code": r[2], "road_name": r[3],
            "road_class": r[4], "road_class_name": r[5], "hierarchy_name": r[6],
            "lines": multi,
        })
    roads_conn.close()

    meta = {
        "records": len(records), "coordinates": sum(r["latitude"] is not None and r["longitude"] is not None for r in records),
        "incident_dates": sum(r["incident_date"] is not None for r in records),
        "incident_times": sum(r["incident_time"] is not None for r in records),
        "holiday_matches": sum(r["holiday_name"] is not None for r in records),
        "road_matches": sum(r["road_status"] == "matched" for r in records),
        "road_missing_coordinates": sum(r["road_status"] == "no_coordinates" for r in records),
        "road_no_nearby": sum(r["road_status"] == "no_road_within_100m" for r in records),
        "helmet_known": sum(r["helmet"] is not None for r in records),
        "belt_known": sum(r["belt"] is not None for r in records),
        "coordinate_tolerance_m": MAX_MATCH_METERS,
        "roads": len(road_features),
        "traffic_road_codes_matched": int(traffic_summary.index.isin({traffic_code(x) for x in joined["highway_code"].dropna()}).sum()),
        "warning": "เทศกาลและวัน/เวลาเกิดเหตุใช้ Date Rec และ Time Rec เท่านั้น; วันที่เกิดเหตุในไฟล์ต้นทางว่างทั้งหมด จึงไม่แทนด้วยวันที่เสียชีวิต",
    }
    with OUT_JSON.open("w", encoding="utf-8") as f:
        json.dump({"meta": meta, "records": records, "roads": road_features}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote joined table: {OUT_CSV}")
    print(f"Wrote dashboard data: {OUT_JSON} ({OUT_JSON.stat().st_size / 1_000_000:.1f} MB)")
    print(json.dumps(meta, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
