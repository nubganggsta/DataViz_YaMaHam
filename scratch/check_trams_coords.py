import sys
import pandas as pd
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
data_dir = Path(r'c:\Users\Lenovo Slim5i\OneDrive\Documents\Codex\DataViz_YaMaHam\data')
df = pd.read_csv(data_dir / 'accidents_2023_2025.csv', low_memory=False)

df['dead_num'] = pd.to_numeric(df['ผู้เสียชีวิต'], errors='coerce').fillna(0)
df['lat'] = pd.to_numeric(df['LATITUDE'], errors='coerce')
df['lon'] = pd.to_numeric(df['LONGITUDE'], errors='coerce')

total = len(df)
with_coords = df[df['lat'].notna() & df['lon'].notna() & (df['lat'] >= 5.0) & (df['lat'] <= 21.0) & (df['lon'] >= 97.0) & (df['lon'] <= 106.0)]
fatal = df[df['dead_num'] > 0]
fatal_coords = fatal[fatal['lat'].notna() & fatal['lon'].notna() & (fatal['lat'] >= 5.0) & (fatal['lat'] <= 21.0) & (fatal['lon'] >= 97.0) & (fatal['lon'] <= 106.0)]

print(f"Total TRAMS: {total:,}")
print(f"Total with valid coords: {len(with_coords):,} ({len(with_coords)/total*100:.1f}%)")
print(f"Total fatal incidents: {len(fatal):,}")
print(f"Fatal with valid coords: {len(fatal_coords):,} ({len(fatal_coords)/len(fatal)*100:.1f}%)")
print(f"Total fatalities in fatal_coords: {int(fatal_coords['dead_num'].sum()):,}")
