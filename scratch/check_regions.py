import sys
import json
import urllib.request

sys.stdout.reconfigure(encoding='utf-8')
url = 'https://raw.githubusercontent.com/chingchai/OpenGISData-Thailand/master/provinces.geojson'
with urllib.request.urlopen(url, timeout=15) as res:
    data = json.loads(res.read().decode('utf-8'))

regions = {}
for f in data['features']:
    props = f['properties']
    reg = props['reg_royin']
    pname = props['pro_th']
    if pname == 'อยุธยา':
        pname = 'พระนครศรีอยุธยา'
    regions.setdefault(reg, []).append(pname)

reg_th = {
    'North': 'ภาคเหนือ',
    'Northeast': 'ภาคตะวันออกเฉียงเหนือ',
    'Central': 'ภาคกลาง',
    'East': 'ภาคตะวันออก',
    'West': 'ภาคตะวันตก',
    'South': 'ภาคใต้'
}

total = 0
for reg_en, pnames in sorted(regions.items()):
    th_name = reg_th.get(reg_en, reg_en)
    print(f"\n{th_name} ({reg_en}) - {len(pnames)} จังหวัด:")
    print(", ".join(sorted(pnames)))
    total += len(pnames)

print(f"\nTotal provinces: {total}")
