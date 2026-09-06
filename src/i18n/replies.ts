import type { ReplyLanguage } from '../domain/defaults';
const exact: Record<string, string> = {
  'Please connect your Daily Budget account in settings first.': 'กรุณาเชื่อมบัญชี Daily Budget ใน Settings ก่อน',
  'I could not reach Daily Budget. Please check the connection or that cloud sync is on.': 'เชื่อมต่อ Daily Budget ไม่สำเร็จ ตรวจเครือข่ายและการซิงค์ข้อมูลอีกครั้ง',
  'I could not find that expense to delete.': 'ไม่พบรายจ่ายที่จะลบ',
  'I could not find that expense to edit.': 'ไม่พบรายจ่ายที่จะแก้ไข',
  'I could not delete that expense.': 'ลบรายจ่ายไม่สำเร็จ',
  'I could not update that expense.': 'แก้ไขรายจ่ายไม่สำเร็จ',
  'I could not save that expense.': 'บันทึกรายจ่ายไม่สำเร็จ',
  'Sorry, I could not delete those items.': 'ขอโทษด้วย ลบรายการไม่สำเร็จ',
  'Done.': 'เรียบร้อยแล้ว', 'How can I help?': 'มีอะไรให้ช่วยไหม',
  'I did not hear anything. Please try again.': 'ยังไม่ได้ยินเสียง ลองพูดอีกครั้งนะ',
  'Sorry, I could not process that request.': 'ขอโทษด้วย ยังทำคำสั่งนี้ไม่สำเร็จ',
  'Delete cancelled.': 'ยกเลิกการลบแล้ว',
  'There are no matching items left to delete.': 'ไม่มีรายการที่ตรงกับคำขอลบแล้ว',
  'There are no overdue tasks.': 'ไม่มีงานค้างที่เลยกำหนด',
  'There is nothing left on this shopping list.': 'ไม่มีของที่ยังต้องซื้อในลิสต์นี้',
  'You have no items scheduled for today.': 'วันนี้ไม่มีรายการที่ต้องทำ',
  'There are no items in that time range.': 'ไม่มีรายการในช่วงเวลานี้',
  'Preferences saved.': 'จำค่าที่ตั้งไว้แล้ว', 'Assignment saved.': 'บันทึกผู้รับผิดชอบและผู้รับการเตือนแล้ว',
  'Occurrence saved.': 'บันทึกสถานะของรอบนี้แล้ว',
  'I could not find a note about that.': 'ไม่พบบันทึกเกี่ยวกับเรื่องนี้',
  'There are no saved memories yet.': 'ยังไม่มีบันทึกความทรงจำ',
  'There are no free slots in that range.': 'ไม่มีช่วงว่างที่นานพอในเวลานั้น',
  'What time should I use?': 'ต้องการเวลาไหน',
  'Nothing was saved. Please choose a different time or confirm the conflict.': 'ยังไม่ได้บันทึก เลือกเวลาอื่นหรือยืนยันว่าจะนัดซ้อนกัน',
};
/** Local output localization never calls an LLM or changes stored names/content. */
export function localizeReply(text: string, language: ReplyLanguage): string {
  if (language === 'en') return text;
  let result = text;
  for (const [en, th] of Object.entries(exact).sort((a,b) => b[0].length-a[0].length)) result = result.split(en).join(th);
  return result
    .replace(/Today you have (\d+) items?:/g, 'วันนี้มี $1 รายการ:')
    .replace(/You have (\d+) items?:/g, 'มี $1 รายการ:')
    .replace(/Deleted (\d+) items?\./g, 'ลบแล้ว $1 รายการ')
    .replace(/Saved in /g, 'บันทึกใน ').replace(/Shared in /g, 'แชร์ใน ')
    .replace(/Still to buy:/g, 'ยังต้องซื้อ:').replace(/Overdue:/g, 'งานค้าง:')
    .replace(/Only me/g, 'ส่วนตัว').replace(/Available:/g, 'ช่วงที่ว่าง:')
    .replace(/Logged ([\d,]+) baht(?: for (.+?))?\./g, 'บันทึกรายจ่าย $1 บาท $2')
    .replace(/Updated to ([\d,]+) baht\./g, 'แก้เป็น $1 บาทแล้ว')
    .replace(/Deleted the ([\d,]+) baht expense(?: for (.+?))?\./g, 'ลบรายจ่าย $1 บาท $2 แล้ว')
    .replace(/Sources:/g, 'บันทึกอ้างอิง:');
}
