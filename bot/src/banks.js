// ธนาคารไทย: รหัส 3 หลัก (ตรงกับรหัสใน QR ของสลิป) ชื่อ และรูปแบบคำที่ใช้หาในข้อความ OCR
// pattern ภาษาไทยเขียนแบบตัดสระบน-ล่างและวรรณยุกต์ออกแล้ว ให้ตรงกับ skeleton() ใน parse.js
export const BANKS = [
  { code: '004', short: 'KBANK', name: 'กสิกรไทย', pattern: /กสกร|kasikorn|\bkbank\b/ },
  { code: '014', short: 'SCB', name: 'ไทยพาณิชย์', pattern: /ไทยพาณชย|siam commercial|\bscb\b/ },
  { code: '002', short: 'BBL', name: 'กรุงเทพ', pattern: /กรงเทพ(?!มหานคร)|bangkok bank|\bbbl\b/ },
  { code: '006', short: 'KTB', name: 'กรุงไทย', pattern: /กรงไทย|krung ?thai|\bktb\b/ },
  { code: '025', short: 'BAY', name: 'กรุงศรีอยุธยา', pattern: /กรงศร|krungsri|ayudhya|\bbay\b/ },
  { code: '011', short: 'TTB', name: 'ทหารไทยธนชาต', pattern: /ทหารไทย|ธนชาต|ททบ|\bttb\b|tmbthanachart/ },
  { code: '030', short: 'GSB', name: 'ออมสิน', pattern: /ออมสน|government savings|\bgsb\b/ },
  { code: '034', short: 'BAAC', name: 'ธ.ก.ส.', pattern: /ธ\.ก\.ส|ธกส(?!ก)|เพอการเกษตร|\bbaac\b/ },
  { code: '069', short: 'KKP', name: 'เกียรตินาคินภัทร', pattern: /เกยรตนาคน|kiatnakin|\bkkp\b/ },
  { code: '022', short: 'CIMB', name: 'ซีไอเอ็มบี ไทย', pattern: /ซไอเอมบ|\bcimb\b/ },
  { code: '024', short: 'UOB', name: 'ยูโอบี', pattern: /ยโอบ|\buob\b/ },
  { code: '033', short: 'GHB', name: 'อาคารสงเคราะห์', pattern: /อาคารสงเคราะห|ธ\.อ\.ส|ธอส|\bghb\b/ },
  { code: '067', short: 'TISCO', name: 'ทิสโก้', pattern: /ทสโก|\btisco\b/ },
  { code: '073', short: 'LHB', name: 'แลนด์ แอนด์ เฮ้าส์', pattern: /แลนด ?แอนด ?เฮาส|land and houses|\blh ?bank\b/ },
  { code: '066', short: 'ISBT', name: 'อิสลามแห่งประเทศไทย', pattern: /อสลาม|islamic bank/ },
];

const byCode = new Map(BANKS.map((b) => [b.code, b]));

export function bankByCode(code) {
  return byCode.get(code) || null;
}

export function bankName(code) {
  if (!code) return 'ไม่ทราบธนาคาร';
  return byCode.get(code)?.name || `ธนาคารรหัส ${code}`;
}
