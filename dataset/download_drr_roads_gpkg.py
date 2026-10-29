"""Download DRR road centerlines (FeatureServer layer 2) into GeoPackage.

Run from the repository root with network access:
    python data/download_drr_roads_gpkg.py

Uses only Python's standard library. Roads are paged from the public ArcGIS
REST API and written incrementally, so the full service response is not kept
in memory. Output CRS is EPSG:4326.
"""

from __future__ import annotations

import json
import sqlite3
import struct
import time
import urllib.parse
import urllib.request
from pathlib import Path


LAYER_URL = "https://gis.drr.go.th/arcgis/rest/services/DRR_Feature/FeatureServer/2"
OUTPUT = Path(__file__).resolve().parent / "drr_road_centerlines.gpkg"
PAGE_SIZE = 1000
FIELDS = [
    "OBJECTID", "direction", "status", "updated_date", "route_name",
    "length_gps", "length_drr", "lane_width", "road_code", "link_id",
    "sublink_id", "budget_year", "gid", "km_start", "km_end", "lane_count",
]


def get_json(url: str, params: dict[str, object]) -> dict:
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(
        f"{url}?{query}", headers={"User-Agent": "DataViz_YaMaHam/1.0"}
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.load(response)


def wkb_multilinestring(paths: list[list[list[float]]]) -> bytes:
    """Encode ArcGIS paths as 2D little-endian WKB MultiLineString."""
    lines = [p for p in paths if len(p) >= 2]
    out = bytearray(struct.pack("<BI", 1, 5))  # byte order, MultiLineString
    out.extend(struct.pack("<I", len(lines)))
    for line in lines:
        out.extend(struct.pack("<BI", 1, 2))  # LineString
        out.extend(struct.pack("<I", len(line)))
        for point in line:
            out.extend(struct.pack("<dd", float(point[0]), float(point[1])))
    return bytes(out)


def gpkg_geometry(paths: list[list[list[float]]]) -> bytes:
    # GeoPackage geometry header: magic, version 0, little endian/no envelope,
    # followed by SRS ID 4326 and standard WKB.
    return b"GP\x00\x01" + struct.pack("<i", 4326) + wkb_multilinestring(paths)


def initialize(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=NORMAL;
        CREATE TABLE gpkg_spatial_ref_sys (
            srs_name TEXT NOT NULL, srs_id INTEGER NOT NULL PRIMARY KEY,
            organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL,
            definition TEXT NOT NULL, description TEXT
        );
        INSERT INTO gpkg_spatial_ref_sys VALUES
          ('WGS 84 geodetic',4326,'EPSG',4326,
           'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]',NULL);
        INSERT INTO gpkg_spatial_ref_sys VALUES
          ('Undefined Cartesian',-1,'NONE',-1,'undefined',NULL);
        INSERT INTO gpkg_spatial_ref_sys VALUES
          ('Undefined geographic',0,'NONE',0,'undefined',NULL);
        CREATE TABLE gpkg_contents (
            table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL,
            identifier TEXT UNIQUE, description TEXT DEFAULT '',
            last_change DATETIME NOT NULL DEFAULT
              (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE,
            srs_id INTEGER,
            FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
        );
        CREATE TABLE gpkg_geometry_columns (
            table_name TEXT NOT NULL, column_name TEXT NOT NULL,
            geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL,
            z TINYINT NOT NULL, m TINYINT NOT NULL,
            PRIMARY KEY (table_name,column_name),
            FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name),
            FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
        );
    """)
    attributes = [
        'fid INTEGER PRIMARY KEY AUTOINCREMENT',
        'geom MULTILINESTRING NOT NULL',
        'OBJECTID INTEGER', 'direction TEXT', 'status TEXT',
        'updated_date TEXT', 'route_name TEXT', 'length_gps REAL',
        'length_drr REAL', 'lane_width REAL', 'road_code TEXT',
        'link_id INTEGER', 'sublink_id INTEGER', 'budget_year INTEGER',
        'gid INTEGER', 'km_start INTEGER', 'km_end INTEGER', 'lane_count INTEGER',
    ]
    conn.execute(f"CREATE TABLE roads ({', '.join(attributes)})")
    conn.execute("INSERT INTO gpkg_contents(table_name,data_type,identifier,description,srs_id) VALUES ('roads','features','DRR road centerlines','DRR FeatureServer layer 2; source CRS EPSG:4326',4326)")
    conn.execute("INSERT INTO gpkg_geometry_columns VALUES ('roads','geom','MULTILINESTRING',4326,0,0)")


def main() -> None:
    if OUTPUT.exists():
        OUTPUT.unlink()
    conn = sqlite3.connect(OUTPUT)
    initialize(conn)
    names = ["geom"] + FIELDS
    placeholders = ",".join("?" for _ in names)
    insert_sql = f"INSERT INTO roads ({','.join(names)}) VALUES ({placeholders})"
    offset = 0
    total = 0
    bounds = [float("inf"), float("inf"), float("-inf"), float("-inf")]

    try:
        while True:
            payload = get_json(
                f"{LAYER_URL}/query",
                {
                    "where": "1=1",
                    "outFields": ",".join(FIELDS),
                    "returnGeometry": "true",
                    "outSR": 4326,
                    "f": "geojson",
                    "resultOffset": offset,
                    "resultRecordCount": PAGE_SIZE,
                    "orderByFields": "OBJECTID",
                },
            )
            if payload.get("error"):
                raise RuntimeError(json.dumps(payload["error"], ensure_ascii=False))
            features = payload.get("features", [])
            if not features:
                break

            rows = []
            for feature in features:
                props = feature.get("properties") or feature.get("attributes") or {}
                geometry = feature.get("geometry") or {}
                paths = geometry.get("paths")
                if paths is None:  # GeoJSON geometry response
                    coordinates = geometry.get("coordinates", [])
                    paths = coordinates if geometry.get("type") == "MultiLineString" else [coordinates]
                paths = [p for p in paths if isinstance(p, list) and len(p) >= 2]
                if not paths:
                    continue
                for path in paths:
                    for x, y, *_ in path:
                        bounds[0] = min(bounds[0], float(x))
                        bounds[1] = min(bounds[1], float(y))
                        bounds[2] = max(bounds[2], float(x))
                        bounds[3] = max(bounds[3], float(y))
                rows.append((sqlite3.Binary(gpkg_geometry(paths)), *(props.get(k) for k in FIELDS)))

            conn.executemany(insert_sql, rows)
            conn.commit()
            total += len(rows)
            offset += len(features)
            print(f"Downloaded {total:,} line features...", flush=True)
            if not payload.get("exceededTransferLimit") and len(features) < PAGE_SIZE:
                break
            time.sleep(0.1)

        if total == 0:
            raise RuntimeError("No road features were returned by the service.")
        conn.execute(
            "UPDATE gpkg_contents SET min_x=?,min_y=?,max_x=?,max_y=?,last_change=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE table_name='roads'",
            bounds,
        )
        conn.commit()
        print(f"Created {OUTPUT} with {total:,} road segments (EPSG:4326).")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
