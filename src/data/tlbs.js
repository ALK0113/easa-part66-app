export const tlbs = [
  {
    id: 1,
    practiceId: '1116403',
    moduleId: 'M11',
    aircraft: 'LEARJET 25C',
    registration: 'I-BMFE',
    msn: '25C-146',
    date: '2026-11-10',
    teacher: 'Ildefonso Laguna García',
    published: true,
    crs: 'CERTIFICATE OF RELEASE TO SERVICE - CERTIFIES THAT THE WORK SPECIFIED WAS CARRIED OUT IN ACCORDANCE WITH PART-145',
    defects: [
      {
        n: 1,
        ata: 'ATA 36',
        pirep: 'CPT. ROS',
        defect: 'REPETITIVE SHUTDOWNS OF BLEED SYSTEM. PLEASE REPLACE BLEED AIR SHUTOFF VALVE. PROVIDE P/N & S/N OF PARTS',
        action: 'REPLACED IAW AMM 36-10-01 pg201 REV'
      },
      {
        n: 2,
        ata: 'ATA 36',
        pirep: 'CPT. ROS',
        defect: 'RH OVERTEMP LIGHT ON. PLEASE EXPLAIN OPERATION OF THE SWITCH AND REPLACE SWITCH. EMERGENCY BOTTLE REPLACEMENT IS REQUIRED. PROVIDE P/N - S/N AND INSPECTION - CHECK INTERVAL',
        action: 'WARNING LIGHT ON: Tº>=395ºF; LIGHT OFF: Tº<370ºF. REPLACED IAW AMM 36-20-01 PG 201 SEP. EMERGENCY BOTTLE HAS BEEN REPLACED IAW AMM 36-15-01 PG 201'
      },
      {
        n: 3,
        ata: 'ATA 36',
        pirep: 'CPT. ROS',
        defect: 'INSPECT HIGH PRESSURE BLEED VALVE. JT9 ENG HIGH STAGE VALVE INOP',
        action: 'HIGH PRESSURE BLEED VALVE CHECKED IAW AMM 36-10-04 PG 201 REV 05/11. TX TOO HIL IAW MEL 36-1-1 CAT C MAINTENANCE PROCEDURE C/O (SECURED IN CLOSED POSITION)'
      }
    ]
  }
];
