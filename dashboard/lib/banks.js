// สีและตัวย่อประจำธนาคาร ใช้เป็นป้ายให้จำธนาคารได้เร็ว (แสดงคู่กับชื่อเสมอ)
const BANKS = {
  '004': { short: 'K', color: '#138f2d' },
  '014': { short: 'SCB', color: '#4e2e7f' },
  '002': { short: 'BBL', color: '#1e4598' },
  '006': { short: 'KTB', color: '#0d8fd0' },
  '025': { short: 'BAY', color: '#f5b800', dark: true },
  '011': { short: 'ttb', color: '#0050f0' },
  '030': { short: 'GSB', color: '#d9117c' },
  '034': { short: 'ธกส', color: '#3f8f1c' },
  '069': { short: 'KKP', color: '#5a4b9a' },
  '022': { short: 'CIMB', color: '#7e2f36' },
  '024': { short: 'UOB', color: '#0b3979' },
  '033': { short: 'GHB', color: '#e06a12' },
  '067': { short: 'TISCO', color: '#12549f' },
  '073': { short: 'LH', color: '#5c6370' },
  '066': { short: 'IBT', color: '#1c5a1e' },
};

export function bankStyle(code) {
  return BANKS[code] || { short: '?', color: '#69728c' };
}
