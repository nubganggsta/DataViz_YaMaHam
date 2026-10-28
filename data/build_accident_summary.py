"""Build compact, browser-ready summaries from the combined TRAMS event CSV."""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "accidents_2023_2025.csv"
OUTPUT = ROOT / "accident_summary.json"
YEARS = (2023, 2024, 2025)
MONTHS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
WEEKDAYS_TH = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"]


def number(value: object) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def label(value: object) -> str:
    text = str(value).strip()
    return text if text and text.lower() not in {"nan", "none", "null"} else "ไม่ระบุ"


def ranked(counter: Counter[str], limit: int = 12) -> list[list[object]]:
    return [[name, count] for name, count in counter.most_common(limit)]


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(f"Missing combined event dataset: {SOURCE}")
    df = pd.read_csv(SOURCE, encoding="utf-8-sig", dtype=str, keep_default_na=False, low_memory=False)
    required = ["ปีที่เกิดเหตุ", "วันที่เกิดเหตุ", "เวลา", "จังหวัด", "รถคันที่1", "มูลเหตุสันนิษฐาน", "ลักษณะการเกิดเหตุ", "สภาพอากาศ", "ผู้เสียชีวิต", "ผู้บาดเจ็บสาหัส", "ผู้บาดเจ็บเล็กน้อย", "รวมจำนวนผู้บาดเจ็บ", "สายทางหน่วยงาน", "LATITUDE", "LONGITUDE"]
    missing = [column for column in required if column not in df.columns]
    if missing:
        raise ValueError(f"Missing expected columns: {', '.join(missing)}")

    output: dict[str, object] = {"meta": {"records": len(df), "source": "TRAMS · กระทรวงคมนาคม", "years": list(YEARS)}, "years": {}}
    for year in YEARS:
        rows = df[df["ปีที่เกิดเหตุ"].map(number) == year]
        monthly = [0] * 12
        weekdays = [0] * 7
        hours = [0] * 12
        provinces: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0])
        dimensions: dict[str, Counter[str]] = {key: Counter() for key in ("vehicle", "cause", "collision", "weather", "road_type")}
        fatalities = serious = minor = injuries = vehicles = coordinates = 0

        for row in rows.to_dict("records"):
            fatalities += number(row["ผู้เสียชีวิต"])
            serious += number(row["ผู้บาดเจ็บสาหัส"])
            minor += number(row["ผู้บาดเจ็บเล็กน้อย"])
            injuries += number(row["รวมจำนวนผู้บาดเจ็บ"])
            vehicles += number(row.get("รถที่เกิดเหตุ", 0))
            if label(row.get("LATITUDE", "")) != "ไม่ระบุ" and label(row.get("LONGITUDE", "")) != "ไม่ระบุ":
                coordinates += 1

            try:
                incident_date = date.fromisoformat(row["วันที่เกิดเหตุ"])
                monthly[incident_date.month - 1] += 1
                weekdays[incident_date.weekday()] += 1
            except (TypeError, ValueError):
                pass
            try:
                hour = int(row["เวลา"].split(":", 1)[0])
                if 0 <= hour <= 23:
                    hours[hour // 2] += 1
            except (AttributeError, ValueError, IndexError):
                pass

            province = label(row["จังหวัด"])
            provinces[province][0] += 1
            provinces[province][1] += number(row["ผู้เสียชีวิต"])
            provinces[province][2] += number(row["รวมจำนวนผู้บาดเจ็บ"])
            dimensions["vehicle"][label(row["รถคันที่1"])] += 1
            dimensions["cause"][label(row["มูลเหตุสันนิษฐาน"])] += 1
            dimensions["collision"][label(row["ลักษณะการเกิดเหตุ"])] += 1
            dimensions["weather"][label(row["สภาพอากาศ"])] += 1
            dimensions["road_type"][label(row["สายทางหน่วยงาน"])] += 1

        output["years"][str(year)] = {
            "events": len(rows), "fatalities": fatalities, "serious": serious,
            "minor": minor, "injuries": injuries, "vehicles": vehicles,
            "coordinates": coordinates, "monthly": monthly, "weekdays": weekdays,
            "hours": hours,
            "provinces": [[name, *values] for name, values in sorted(provinces.items(), key=lambda item: item[1][0], reverse=True)],
            **{key: ranked(counter) for key, counter in dimensions.items()},
        }

    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUTPUT} ({OUTPUT.stat().st_size / 1_000_000:.2f} MB)")
    print(f"Events: {len(df):,}")


if __name__ == "__main__":
    main()
