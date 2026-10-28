# Data

This folder stores the road fatality dataset, supporting road-network data, and related datasets.

## Combined transport accident records

`accidents_2023_2025.csv` combines the Ministry of Transport TRAMS accident records from 2023, 2024, and 2025. It contains 71,508 event records and retains the source year and all original fields, with an added `source_file` column for provenance. Date fields are standardized as `YYYY-MM-DD`; time fields are standardized as `HH:MM` where the source value could be parsed. No records were deduplicated.

`accident_summary.json` contains the year-by-year aggregates used by the dashboard. Rebuild it with `python data/build_accident_summary.py`, or run `build_dashboard_data.ps1` to rebuild both the fatality dashboard data and the TRAMS summary.

The source dataset describes accident events on highways, rural highways, and expressways. Its unit is an accident event, while the RTDDI dataset is a person-level fatality dataset. Keep the two sources separate unless records can be reliably linked; their death counts may use different coverage and counting rules.

Source: [Ministry of Transport road accidents on transport networks (TRAMS)](https://data.go.th/dataset/gdpublish-roadaccident). Original annual files were supplied for this project as `accident2023.csv`, `accident2024.csv`, and `accident2025.csv`.
