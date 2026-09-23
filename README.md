# DataViz_YaMaHam
ข้อมูลผู้เสียชีวิตจากอุบัติเหตุทางถนน จากระบบบูรณาการข้อมูลการตายจากอุบัติเหตุทางถนน

จากชุดข้อมูลทั้งหมด 3 ชุด ตั้งแต่ ปี 2566 - 2568


## Data Dictionary (คำอธิบายตัวแปร)

| ชื่อตัวแปร | ประเภท | คำอธิบาย |
| :--- | :---: | :--- |
| `id` | int | |
| `DEAD_YEAR(Budha)` | varchar | ปีที่เสียชีวิต (พ.ศ.) |
| `DEAD_YEAR` | varchar | ปีที่เสียชีวิตของผู้ประสบเหตุ |
| `Age` | varchar | อายุผู้เสียชีวิต |
| `Sex` | varchar | เพศผู้เสียชีวิต |
| `BirthYear` | varchar | level1 เปิดเผยเฉพาะปีเกิด |
| `NationalityId` | varchar | สัญชาติผู้เสียชีวิต (มรณบัตร) |
| `Tumbol` | varchar | ที่อยู่ตำบล |
| `District` | varchar | ที่อยู่อำเภอ |
| `Province` | varchar | ที่อยู่จังหวัด |
| `RiskHelmet` | varchar | หมวกนิรภัย |
| `RiskSafetyBelt` | varchar | การคาดเข็มขัดนิรภัยของผู้เสียชีวิต |
| `DeadDate` | varchar | วันที่เสียชีวิต (ข้อมูลจากมรณบัตร) |
| `DateRec` | varchar | วันที่เกิดเหตุ (E-claim) |
| `TimeRec` | varchar | เวลาเกิดเหตุ (E-claim) |
| `AccSubDist` | varchar | ตำบลเกิดเหตุ (E-claim) |
| `AccDist` | varchar | อำเภอเกิดเหตุ (E-claim) |
| `AccProv` | varchar | จังหวัดเกิดเหตุ (E-claim) |
| `AccLat` | varchar | พิกัด Latitude ของจุดที่เกิดเหตุ (E-claim) |
| `AccLong` | varchar | พิกัด Longitude ของจุดที่เกิดเหตุ (E-claim) |
| `ICD-10` | varchar | รหัส ICD-10 ตัว อักษร V ตามด้วยตัวเลข 3 หลัก |
| `Vehicle` | varchar | พาหนะที่ประสบเหตุตามรหัส ICD-10 |
| `created_at` | timestamp | วันที่สร้าง record |
| `verify_date` | varchar | วันที่ตรวจสอบข้อมูล |
| `created_by` | varchar | ผู้นำเข้าข้อมูล (เป็นตัวย่อภาษาอังกฤษ 2 หลัก) |

##  กรอบการวิเคราะห์ข้อมูล (Analytical Framework)

###  1. การวิเคราะห์มิติเวลาและพฤติกรรม (Temporal & Behavioral Patterns)

####  **ช่วงเวลาอันตราย (The Deadly Hours)**
* **วัตถุประสงค์:** ค้นหาช่วงวันและเวลาที่มีอัตราการเสียชีวิตสูงที่สุด
* **รูปแบบการนำเสนอ:** `Heatmap Matrix` (วันในสัปดาห์ x ช่วงเวลาเกิดเหตุ)
* **ตัวแปรที่ใช้:** `DeadDate` (สกัดวันในสัปดาห์), `TimeRec`, `id`

####  **ฤดูกาลและเทศกาล (Seasonal & Festival Spikes)**
* **วัตถุประสงค์:** เปรียบเทียบสถิติมองหาความผันผวนช่วง 7 วันอันตราย (ปีใหม่/สงกรานต์) เทียบกับช่วงวันปกติ
* **รูปแบบการนำเสนอ:** `Multi-Line Trend Chart` พร้อมแถบไฮไลต์ช่วงเทศกาล
* **ตัวแปรที่ใช้:** `DeadDate`, `DEAD_YEAR`, `id`

####  **กลุ่มอายุและเพศเสี่ยงสูง (Demographics Risk Profile)**
* **วัตถุประสงค์:** เจาะลึกโครงสร้างประชากรที่เป็นกลุ่มเสี่ยงหลักของประเทศ
* **รูปแบบการนำเสนอ:** `Population Pyramid` / `Butterfly Chart`
* **ตัวแปรที่ใช้:** `Age` (แบ่งกลุ่มช่วงอายุ), `Sex`, `id`

---

###  2. การวิเคราะห์พาหนะและบริบทการชน (Vehicle & Crash Dynamics)

####  **รูปแบบการชนและพาหนะเสี่ยง (Crash Type & Vehicle Analysis)**
* **วัตถุประสงค์:** วิเคราะห์สัดส่วนประเภทพาหนะของผู้เสียชีวิต และรูปแบบการชนที่สร้างความสูญเสียรุนแรงที่สุด
* **รูปแบบการนำเสนอ:** `Sankey Diagram` / `Grouped Bar Chart`
* **ตัวแปรที่ใช้:** `ICD-10` (รหัสกลุ่มอุบัติเหตุ), `Vehicle`, `id`

####  **ปัจจัยเสี่ยงด้านอุปกรณ์ความปลอดภัย (Safety Equipment Risk)**
* **วัตถุประสงค์:** ประเมินความสัมพันธ์ระหว่างการไม่ใช้อุปกรณ์นิรภัยกับการเสียชีวิต
* **รูปแบบการนำเสนอ:** `Donut Chart` / `KPI Gauge`
* **ตัวแปรที่ใช้:** `RiskHelmet`, `RiskSafetyBelt`, `Vehicle`, `id`
