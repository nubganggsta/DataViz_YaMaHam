"""Download every publicly returned DRR feature and prepare road display overlays.

Uses object IDs rather than offset pagination (which some ArcGIS services ignore).
This changes display layers only; TRAMS road matching remains on its original layer.
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT / '.spatial_deps'))
from shapely import make_valid
from shapely.geometry import MultiLineString, shape
from shapely.strtree import STRtree
from build_dashboard_data import simplify_line

SERVICE = 'https://gis.drr.go.th/arcgis/rest/services/DRR_Feature/FeatureServer/2'
REGIONS = {'North':'ภาคเหนือ','Northeast':'ภาคตะวันออกเฉียงเหนือ','Central':'ภาคกลาง',
           'East':'ภาคตะวันออก','West':'ภาคตะวันตก','South':'ภาคใต้'}


def request(params):
    url = SERVICE + '/query?' + urllib.parse.urlencode({'f':'json', **params})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent':'DataViz-road-map/1.0'}), timeout=90) as response:
                result = json.load(response)
            if result.get('error'):
                raise RuntimeError(str(result['error']))
            return result
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2)


def save(path, data):
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, separators=(',',':')), encoding='utf-8')
    temp.replace(path)


def main():
    ids = sorted(set(request({'where':'1=1','returnIdsOnly':'true'})['objectIds']))
    if not ids:
        raise RuntimeError('DRR service returned no object IDs')
    print(f'DRR service exposes {len(ids)} feature IDs', flush=True)
    features = {}
    for offset in range(0,len(ids),100):
        batch = ids[offset:offset+100]
        response = request({'objectIds':','.join(map(str,batch)),
            'outFields':'OBJECTID,road_code,route_name,status,budget_year',
            'returnGeometry':'true','outSR':4326})
        received = {int(f['attributes']['OBJECTID']): f for f in response.get('features',[])}
        if set(received) != set(batch):
            raise RuntimeError('Service returned missing or unexpected object IDs; refusing incomplete download')
        features.update(received)
        print(f'Downloaded {len(features)}/{len(ids)} DRR features', flush=True)
    save(ROOT/'dataset/drr_roads_source.json', {'service':SERVICE,'object_ids':ids,'features':list(features.values())})

    boundary = json.loads((ROOT/'data/provinces.geojson').read_text(encoding='utf-8'))
    polygons, names, regions = [], [], []
    for f in boundary['features']:
        props = f['properties']; name = props.get('PROV_NAM_T') or props.get('pro_th')
        names.append('พระนครศรีอยุธยา' if name == 'อยุธยา' else name)
        region = props.get('REGION_6') or props.get('reg_th')
        regions.append(REGIONS.get(region,region))
        polygons.append(make_valid(shape(f['geometry'])))
    tree = STRtree(polygons)

    def attach_areas(road):
        geom = MultiLineString(road['lines'])
        hits = sorted(int(i) for i in tree.query(geom,predicate='intersects'))
        road['provinces'] = sorted({names[i] for i in hits})
        road['regions'] = sorted({regions[i] for i in hits})
        if not road.get('province') or road['province']=='ไม่ระบุ':
            road['province'] = ' / '.join(road['provinces']) or 'ไม่ระบุ'
            road['region'] = road['regions'][0] if len(road['regions'])==1 else 'หลายภาค'
        return road

    rural, skipped = [], []
    for oid, f in sorted(features.items()):
        a = f['attributes']; paths = (f.get('geometry') or {}).get('paths',[])
        lines = [simplify_line([[round(p[0],6),round(p[1],6)] for p in line]) for line in paths if len(line)>=2]
        if not lines:
            skipped.append(oid)
            continue
        rural.append(attach_areas({'id':f'drr:{oid}','highway_code':a.get('road_code'),
            'road_name':a.get('route_name'),'highway_name':a.get('route_name'),
            'road_code':a.get('road_code'),'digit_type':'rural','digit_label':'ทางหลวงชนบท',
            'network':'rural','source':'DRR','budget_year':a.get('budget_year'),
            'source_status':a.get('status'),'lines':lines}))
    national = json.loads((ROOT/'data/roads.json').read_text(encoding='utf-8'))
    areas = {}
    for road in national:
        attach_areas(road)
        areas[str(road['id'])] = {'provinces':road['provinces'],'regions':road['regions']}
    save(ROOT/'data/rural_roads.json',rural)
    save(ROOT/'data/road_areas.json',areas)
    metadata = {'service':SERVICE,'downloaded_at':datetime.now(timezone.utc).isoformat(),
        'service_features':len(ids),'rural_display_features':len(rural),'national_display_features':len(national),
        'skipped_geometry_ids':skipped,'province_coverage':len({p for r in rural for p in r['provinces']}),
        'rural_refs':len({r['highway_code'] for r in rural}),
        'rural_source_statuses':dict(Counter(r['source_status'] for r in rural)),
        'coverage_note':'All feature IDs returned by the public DRR layer; not a guarantee of all roads in Thailand'}
    save(ROOT/'data/road_overlay_meta.json',metadata)
    print(json.dumps(metadata,ensure_ascii=False),flush=True)


if __name__=='__main__':
    main()
