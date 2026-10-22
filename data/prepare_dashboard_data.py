"""Prepare road fatality records with calendar and holiday attributes.

Run from the repository root:
    python data/prepare_dashboard_data.py

The fatality CSV is already the combined fact table for 2566-2568. The script
adds a date dimension and holiday flags; it deliberately does not join road
traffic workbooks because they have no shared road code in the fatality data.
"""

from __future__ import annotations

import re
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parent
FATALITIES_PATH = ROOT / "road_fatalities_2566_2568_coordinates_checked.csv"
HOLIDAYS_PATH = ROOT / "thai_holidays_2566_2568.csv"
OUTPUT_PATH = ROOT / "road_fatalities_dashboard.csv"

THAI_MONTHS = {
    "มกราคม": 1, "กุมภาพันธ์": 2, "มีนาคม": 3, "เมษายน": 4,
    "พฤษภาคม": 5, "มิถุนายน": 6, "กรกฎาคม": 7, "สิงหาคม": 8,
    "กันยายน": 9, "ตุลาคม": 10, "พฤศจิกายน": 11, "ธันวาคม": 12,
}
WEEKDAYS_TH = {
    0: "จันทร์", 1: "อังคาร", 2: "พุธ", 3: "พฤหัสบดี",
    4: "ศุกร์", 5: "เสาร์", 6: "อาทิตย์",
}


def parse_date(value: object) -> pd.Timestamp:
    """Parse Gregorian dates and Thai long-form Buddhist dates."""
    if pd.isna(value):
        return pd.NaT
    text = str(value).strip()
    thai = re.search(r"(\d{1,2})\s+([ก-๙]+)\s+(\d{4})", text)
    if thai:
        day, month_name, year = thai.groups()
        month = THAI_MONTHS.get(month_name)
        if month:
            year_num = int(year)
            if year_num >= 2400:
                year_num -= 543
            return pd.Timestamp(year_num, month, int(day))

    # Dates in the source fatality file use M/D/YYYY. A Buddhist year is
    # converted when present; pandas handles ISO and common slash formats.
    parsed = pd.to_datetime(text, errors="coerce", dayfirst=False)
    if pd.notna(parsed) and parsed.year >= 2400:
        parsed = parsed.replace(year=parsed.year - 543)
    return parsed


def main() -> None:
    deaths = pd.read_csv(FATALITIES_PATH, encoding="utf-8-sig", low_memory=False)
    holidays = pd.read_csv(HOLIDAYS_PATH, encoding="utf-8-sig", low_memory=False)

    # Standardize source column names while retaining every original field.
    date_col = "Dead_Date" if "Dead_Date" in deaths else "DeadDate"
    id_col = "Dead_ID" if "Dead_ID" in deaths else "id"
    deaths["event_date"] = deaths[date_col].map(parse_date)
    if deaths["event_date"].isna().any():
        print(f"Warning: {deaths['event_date'].isna().sum()} fatality rows have no parseable death date.")

    # Preserve the reported accident date separately for time-of-event analyses.
    if "Date Rec" in deaths:
        deaths["accident_date"] = deaths["Date Rec"].map(parse_date)
    elif "DateRec" in deaths:
        deaths["accident_date"] = deaths["DateRec"].map(parse_date)
    else:
        deaths["accident_date"] = pd.NaT

    holiday_date_col = "วันที่เดือนปี" if "วันที่เดือนปี" in holidays else "วันเดือนปี"
    if holiday_date_col not in holidays:
        # The repository's Thai CSV header can vary by source export; detect
        # the date column by its values instead of relying on one spelling.
        candidates = [c for c in holidays.columns if holidays[c].astype(str).str.contains(r"\d{1,2}\s+มกราคม|\d{1,2}\s+เมษายน", regex=True).any()]
        if not candidates:
            raise ValueError(f"Cannot identify holiday date column in: {holidays.columns.tolist()}")
        holiday_date_col = candidates[0]

    holidays["event_date"] = holidays[holiday_date_col].map(parse_date)
    # Find likely descriptive columns without depending on Thai terminal encoding.
    non_date_cols = [c for c in holidays.columns if c != "event_date" and c != holiday_date_col]
    label_col = next((c for c in non_date_cols if "name" in c.lower() or "description" in c.lower()), None)
    category_col = next((c for c in non_date_cols if "alcohol" in c.lower() or "type" in c.lower()), None)

    keep = ["event_date"]
    rename = {}
    if label_col:
        keep.append(label_col)
        rename[label_col] = "holiday_name"
    if category_col:
        keep.append(category_col)
        rename[category_col] = "holiday_category"
    holiday_dim = holidays[keep].rename(columns=rename).dropna(subset=["event_date"])
    # A calendar date may have multiple observances; collapse before joining
    # to keep one row per death record.
    aggregations = {c: lambda s: "; ".join(sorted(set(s.dropna().astype(str)))) for c in holiday_dim.columns if c != "event_date"}
    holiday_dim = holiday_dim.groupby("event_date", as_index=False).agg(aggregations)

    # Holiday attribution should use the crash date when it is available.
    # Dead_Date is the death registration date and can differ from crash date.
    deaths["analysis_date"] = deaths["accident_date"].fillna(deaths["event_date"])
    holiday_dim = holiday_dim.rename(columns={"event_date": "analysis_date"})
    result = deaths.merge(holiday_dim, on="analysis_date", how="left", validate="many_to_one")
    result["is_special_holiday"] = result["holiday_name"].notna() if "holiday_name" in result else result["analysis_date"].isin(holiday_dim["analysis_date"])
    result["weekday_num"] = result["analysis_date"].dt.weekday
    result["weekday_th"] = result["weekday_num"].map(WEEKDAYS_TH)
    result["event_year_ad"] = result["analysis_date"].dt.year
    result["event_year_be"] = result["event_year_ad"] + 543

    # Keep a stable, explicit record key for downstream charts.
    if id_col != "id":
        result = result.rename(columns={id_col: "id"})
    if result["id"].duplicated().any():
        raise ValueError("The source fatality table has duplicate IDs; review before dashboard aggregation.")

    result.to_csv(OUTPUT_PATH, index=False, encoding="utf-8-sig")
    print(f"Wrote {len(result):,} fatality records to {OUTPUT_PATH}")
    print(f"Holiday dates matched: {int(result['is_special_holiday'].sum()):,}")
    print(f"Unparseable death dates: {int(result['event_date'].isna().sum()):,}")


if __name__ == "__main__":
    # Keep the earlier entry point working while directing new runs through
    # the complete spatial + incident-date pipeline.
    from build_dashboard_data import main as build_complete_dashboard_data

    build_complete_dashboard_data()
