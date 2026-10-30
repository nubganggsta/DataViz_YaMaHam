"""Reproducible TRAMS cleaning for BI; raw CSV is never overwritten."""
import json
import re
from collections import Counter
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
CAUSE = {
    'ขับรถเร็วเกินอัตรากำหนด':'ขับรถเร็วเกินอัตราที่กำหนด',
    'ขับรถเร็วเกินอัตราที่กำหนด':'ขับรถเร็วเกินอัตราที่กำหนด',
    'คน/รถ/สัตว์ตัดหน้ากระชั้นชิด':'ตัดหน้าระยะกระชั้นชิด',
    'มีการตัดหน้าระยะกระชั้นชิด':'ตัดหน้าระยะกระชั้นชิด',
    'ถนนลื่น':'ถนนลื่น','ถนนลื่น (เนื่องจากสภาพอากาศ)':'ถนนลื่น',
    'ยางเสื่อมสภาพ/ยางแตก':'ยางชำรุด/ยางแตก','ยางรถยนต์ชำรุด':'ยางชำรุด/ยางแตก',
    'ไม่คุ้นเคยเส้นทาง/ขับรถไม่ชำนาญ':'ไม่คุ้นเคยเส้นทาง/ขับรถไม่ชำนาญ',
    'ขับรถไม่ชำนาญ/ไม่เป็น':'ไม่คุ้นเคยเส้นทาง/ขับรถไม่ชำนาญ',
    'ไม่คุ้นชินกับยานพาหนะ เช่น กรณีเช่ารถ':'ไม่คุ้นเคยเส้นทาง/ขับรถไม่ชำนาญ',
    'ไม่ให้สัญญาณชะลอ/เลี้ยว':'ไม่ให้สัญญาณชะลอ/เลี้ยว',
}
CONTEXT = {
    **dict.fromkeys(['ทางตรง+ไม่มีความลาดชัน','ทางตรง+ที่ราบ','ทางตรง+ไม่มีความลาดชัน/ที่ราบ','ทางตรง'],'ทางตรง (ที่ราบ)'),
    **dict.fromkeys(['ทางโค้งกว้าง+ไม่มีความลาดชัน','ทางโค้งกว้าง+ไม่มีความลาดชัน/ที่ราบ','ทางโค้งปกติ+ที่ราบ'],'ทางโค้ง (ที่ราบ)'),
    **dict.fromkeys(['ทางแยกรูปตัว T+ที่ราบ','ทางสามแยก(T)','ทางสามแยก (T)'],'ทางสามแยก (T-Junction)'),
    **dict.fromkeys(['ทางแยกรูปตัว ++ที่ราบ','ทางสี่แยก'],'ทางสี่แยก (Crossroads)'),
}


def missing(value):
    return pd.isna(value) or str(value).strip().lower() in {'','nan','null','none','n/a'}


def text(value):
    return '' if missing(value) else re.sub(r'\s+', ' ', str(value).strip())


def standardize(column, value):
    value = text(value)
    if column == 'มูลเหตุสันนิษฐาน':
        value = re.sub(r'\s*/\s*','/',value)
        return CAUSE.get(value, value or 'ไม่ทราบสาเหตุ')
    if column == 'บริเวณที่เกิดเหตุ':
        return CONTEXT.get(value, value or 'ไม่ระบุ')
    if column == 'ลักษณะการเกิดเหตุ':
        if value in {'','ไม่มีรายละเอียด','อื่นๆ','อื่น ๆ'}:
            return 'ไม่ระบุ'
        if value in {'ชนประสานงา (ไม่ใช่การแซง)','ชนในทิศทางตรงกันข้าม (ไม่ใช่การแซง)'}:
            return 'ชนประสานงา/สวนทางกัน'
        match = re.match(r'^อื่น\s*ๆ\s*\((.*?)\)\s*$',value)
        if match:
            detail = match.group(1).strip()
            if any(word in detail for word in ['ล้มเอง','แฉลบ','เสียหลัก']):
                return 'เสียหลัก/พลิกคว่ำ/ล้มเอง'
            if any(word in detail for word in ['สุนัข','สัตว์','กระบือ']):
                return 'ชนสัตว์'
            return detail or 'ไม่ระบุ'
    if column == 'สภาพอากาศ' and value in {'','อื่นๆ','อื่น ๆ'}:
        return 'ไม่ระบุ'
    if column == 'จังหวัด' and value == 'อยุธยา':
        return 'พระนครศรีอยุธยา'
    return value or 'ไม่ระบุ'


def date_value(value):
    value = text(value)
    if not value or value == 'ไม่ระบุ':
        return None
    # Handle ISO and Thai Buddhist year dates without swapping ISO month/day.
    match = re.fullmatch(r'(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T].*)?',value)
    if match:
        y,m,d = map(int,match.groups());y = y-543 if y>2400 else y
        value = f'{y:04d}-{m:02d}-{d:02d}'
        parsed = pd.to_datetime(value, format='%Y-%m-%d', errors='coerce')
    else:
        match = re.fullmatch(r'(\d{1,2})/(\d{1,2})/(\d{4})',value)
        if match:
            d,m,y=map(int,match.groups());y=y-543 if y>2400 else y
            parsed=pd.to_datetime(f'{y:04d}-{m:02d}-{d:02d}',format='%Y-%m-%d',errors='coerce')
        else:
            parsed=pd.to_datetime(value,format='mixed',dayfirst=True,errors='coerce')
    return None if pd.isna(parsed) else parsed.strftime('%Y-%m-%d')


def time_value(value):
    value=text(value)
    if not value or value=='ไม่ระบุ':return None
    match=re.fullmatch(r'(\d{1,2}):(\d{2})(?::(\d{2}))?',value)
    if not match:return None
    h,m,s=int(match[1]),int(match[2]),int(match[3] or 0)
    return f'{h:02d}:{m:02d}:{s:02d}' if h<24 and m<60 and s<60 else None


def clean_dataframe(source):
    source=source.copy();columns=list(source.columns)
    exact=source.duplicated(keep='first')
    work=source.loc[~exact].copy()
    score_columns=[c for c in columns if c not in {'_id','source_file','ACC_CODE'}]
    unknown={'ไม่ระบุ','ไม่ทราบ','ไม่ทราบสาเหตุ','ไม่มีรายละเอียด','อื่นๆ','อื่น ๆ'}
    score=work[score_columns].map(lambda v:not missing(v) and text(v) not in unknown).sum(axis=1)
    ids=work['ACC_CODE'].map(lambda v:None if missing(v) else str(v).strip())
    ranked=pd.DataFrame({'id':ids,'score':score,'position':range(len(work))},index=work.index).sort_values(['score','position'],ascending=[False,True],kind='stable')
    chosen=ranked.loc[ranked['id'].isna() | ~ranked['id'].duplicated()].index
    work=work.loc[work.index.isin(chosen)].copy()
    work['source_row']=work.index+2
    work['completeness_score']=score.loc[work.index]
    provenance={'original_latitude':'LATITUDE','original_longitude':'LONGITUDE','original_province':'จังหวัด',
                'original_cause':'มูลเหตุสันนิษฐาน','original_context':'บริเวณที่เกิดเหตุ','original_collision':'ลักษณะการเกิดเหตุ',
                'original_weather':'สภาพอากาศ','original_incident_date':'วันที่เกิดเหตุ','original_report_date':'วันที่รายงาน'}
    for target,col in provenance.items():work[target]=work[col]
    changes=[];mapping=Counter();counts=Counter()
    def change(i,col,old,new,reason):
        old=None if missing(old) else old
        new=None if missing(new) else new
        old=old.item() if hasattr(old,'item') else old
        new=new.item() if hasattr(new,'item') else new
        if old==new:return
        changes.append({'source_row':int(work.at[i,'source_row']),'ACC_CODE':text(work.at[i,'ACC_CODE']),
                        'column':col,'before':old,'after':new,'reason':reason})
        counts[reason]+=1
        if reason=='text_standardization':mapping[(col,str(old) if old is not None else '(ว่าง)',str(new))]+=1
    categorical=[c for c in columns if (pd.api.types.is_object_dtype(work[c]) or isinstance(work[c].dtype,pd.StringDtype))
                 and c not in {'วันที่เกิดเหตุ','วันที่รายงาน','เวลา','เวลาที่รายงาน','LATITUDE','LONGITUDE','ACC_CODE','_id'}]
    for col in categorical:
        for i,value in work[col].items():
            result=standardize(col,value);change(i,col,value,result,'text_standardization');work.at[i,col]=result
    work['coordinates_swapped']=False;work['report_date_corrected']=False
    work['incident_time_invalid']=False;work['report_time_invalid']=False
    for i,row in work.iterrows():
        lat=pd.to_numeric(row['LATITUDE'],errors='coerce');lon=pd.to_numeric(row['LONGITUDE'],errors='coerce')
        if pd.notna(lat) and pd.notna(lon) and lat>25 and 5<=lon<=25:
            lat,lon=lon,lat;work.at[i,'coordinates_swapped']=True;counts['coordinates_swapped']+=1
        for col,value,lo,hi in [('LATITUDE',lat,5.,21.),('LONGITUDE',lon,97.,106.)]:
            result=value if pd.notna(value) and lo<=value<=hi else None
            change(i,col,row[col],result,'coordinate_repair');work.at[i,col]=result
        incident,report=date_value(row['วันที่เกิดเหตุ']),date_value(row['วันที่รายงาน'])
        if report and incident and report<incident:
            report=incident;work.at[i,'report_date_corrected']=True;counts['report_date_corrected']+=1
        for col,value in [('วันที่เกิดเหตุ',incident),('วันที่รายงาน',report)]:
            change(i,col,row[col],value,'date_normalization');work.at[i,col]=value
            if value is None and not missing(row[col]):counts['invalid_'+col]+=1
        for col,flag in [('เวลา','incident_time_invalid'),('เวลาที่รายงาน','report_time_invalid')]:
            value=time_value(row[col]);work.at[i,flag]=value is None and not missing(row[col])
            change(i,col,row[col],value,'time_normalization');work.at[i,col]=value
            if work.at[i,flag]:counts[flag]+=1
    dup_ids=source['ACC_CODE'].dropna().astype(str).str.strip().value_counts()
    summary={'source_rows':len(source),'exact_duplicates_removed':int(exact.sum()),
        'duplicate_id_rows_removed':len(source)-int(exact.sum())-len(work),
        'total_duplicates_removed':len(source)-len(work),'cleaned_rows':len(work),
        'duplicate_id_groups':int((dup_ids>1).sum()),'counts':dict(counts),
        'selection_rule':'Most nonmissing, informative source fields; ties keep earliest source row. source_file/_id/ACC_CODE do not affect completeness.',
        'mapping_changes':[{'column':c,'before':a,'after':b,'count':n} for (c,a,b),n in mapping.most_common()],
        'original_source_columns':columns,'output_columns':list(work.columns)}
    loss_columns=['ผู้เสียชีวิต','ผู้บาดเจ็บสาหัส','ผู้บาดเจ็บเล็กน้อย']
    original_losses=source[loss_columns].apply(pd.to_numeric,errors='coerce').fillna(0)
    legacy=source.assign(__loss=original_losses.sum(axis=1),__key=[text(v) or f'row:{i}' for i,v in source['ACC_CODE'].items()])
    legacy=legacy.sort_values('__loss',ascending=False,kind='stable').drop_duplicates('__key')
    summary['casualty_totals_before_spatial_filter']={
        'previous_highest_casualty_rule':{c:float(pd.to_numeric(legacy[c],errors='coerce').sum()) for c in loss_columns},
        'current_most_complete_rule':{c:float(pd.to_numeric(work[c],errors='coerce').sum()) for c in loss_columns}}
    return work,summary,changes


def write_outputs(cleaned,summary,changes):
    out=ROOT/'dataset';logs=ROOT/'data'
    cleaned.to_csv(out/'accidents_cleaned.csv',index=False,encoding='utf-8-sig')
    (logs/'cleaning_summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    pd.DataFrame(changes,columns=['source_row','ACC_CODE','column','before','after','reason']).to_csv(logs/'cleaning_changes.csv',index=False,encoding='utf-8-sig')
    pd.DataFrame(summary['mapping_changes']).to_csv(logs/'cleaning_mapping.csv',index=False,encoding='utf-8-sig')
    lines=['# รายงานการคลีนข้อมูล TRAMS',f"- แถวต้นทาง: {summary['source_rows']:,}",f"- แถวหลังคลีน: {summary['cleaned_rows']:,}",
           f"- แถวซ้ำทั้งแถวที่ลบ: {summary['exact_duplicates_removed']:,}",f"- แถว ACC_CODE ซ้ำที่ลบเพิ่ม: {summary['duplicate_id_rows_removed']:,}",
           f"- พิกัดสลับที่แก้ไข: {summary['counts'].get('coordinates_swapped',0):,}",f"- วันที่รายงานก่อนเกิดเหตุที่แก้ไข: {summary['counts'].get('report_date_corrected',0):,}",
           '- เลือก ACC_CODE ซ้ำตามจำนวนช่องที่มีข้อมูลจริงมากที่สุด; กรณีเท่ากันเก็บแถวต้นทางที่มาก่อน',
           '- ค่าว่างในข้อความใช้ ไม่ระบุ (มูลเหตุใช้ ไม่ทราบสาเหตุ); ค่าว่าง/ผิดในตัวเลข พิกัด วันเวลา ยังคงเป็น null',
           '- ไฟล์ BI นี้ยังไม่ตัดเหตุการณ์พิกัดหาย/นอกประเทศ ส่วน dashboard ใช้การกรอง Polygon เพิ่มตาม pipeline GIS',
           '- รายการ mapping ทั้งหมดอยู่ใน cleaning_mapping.csv และรายละเอียดทุกค่าที่แก้ใน cleaning_changes.csv']
    (logs/'cleaning_summary.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    if summary.get('casualty_totals_before_spatial_filter'):
        totals=summary['casualty_totals_before_spatial_filter']
        with (logs/'cleaning_summary.md').open('a',encoding='utf-8') as f:
            f.write('\n## ผลของการเปลี่ยนกติกาเลือกรหัสซ้ำ (ก่อนกรองพิกัด)\n\n')
            for col,value in totals['current_most_complete_rule'].items():
                old=totals['previous_highest_casualty_rule'][col]
                f.write(f'- {col}: กติกาเดิม {old:,.0f} → กติกาข้อมูลสมบูรณ์ที่สุด {value:,.0f} (ต่าง {value-old:+,.0f})\n')


if __name__=='__main__':
    raw=pd.read_csv(ROOT/'dataset/accidents_2023_2025.csv',encoding='utf-8-sig',low_memory=False,dtype={'ACC_CODE':'string','รหัสสายทาง':'string'})
    cleaned,summary,changes=clean_dataframe(raw);write_outputs(cleaned,summary,changes)
    print(json.dumps({k:v for k,v in summary.items() if k not in {'mapping_changes','output_columns','original_source_columns'}},ensure_ascii=False))
