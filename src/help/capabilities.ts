/** One catalog drives both the visible guide and the planner's spoken help. */
export interface CapabilityOptions { web: boolean; budget: boolean; shared: boolean }
export interface Capability { id: string; title: string; description: string; example: string }
export const capabilityIntroduction = 'เริ่มจากบอกสิ่งที่อยากให้จำหรือบันทึกนัดไว้ แล้วค่อยถาม ค้น หรือจัดการข้อมูลที่บันทึกไว้ได้';

export function capabilities(options: CapabilityOptions): Capability[] {
  return [
    { id: 'capture', title: 'จดสิ่งที่อยากจำ', description: 'บันทึกโน้ต ความทรงจำ และงานที่ต้องทำ', example: 'จำไว้ว่าวางกุญแจสำรองไว้ในลิ้นชัก' },
    { id: 'knowledge', title: 'รู้จักคน สัตว์เลี้ยง และสถานที่', description: 'บอกชื่อและความสัมพันธ์ แล้วแก้ข้อมูลที่จำไว้ได้ใน Settings', example: 'โมจิคือแมวของเรา' },
    { id: 'reminders', title: 'นัดและการเตือน', description: options.web ? 'บันทึกตารางนัดได้ เปิด Web Push ใน Settings เพื่อรับการแจ้งเตือน' : 'ตั้งเวลาเตือนและเตือนซ้ำ การปลุกต้องใช้แอปที่รองรับบนเครื่อง', example: 'พรุ่งนี้เก้าโมงเตือนโทรหาแม่' },
    { id: 'shopping', title: 'ลิสต์ซื้อของ', description: 'เพิ่มจำนวนของ รวมรายการซ้ำ และบอกว่าซื้อแล้ว', example: 'เพิ่มไข่สองแผงในลิสต์ซื้อของ' },
    { id: 'query', title: 'ถามตารางและค้นบันทึก', description: 'เมื่อบันทึกข้อมูลแล้ว ถามตารางหรือค้นสิ่งที่เคยบอกไว้ในพื้นที่ที่เลือก', example: 'วันนี้มีอะไรต้องทำบ้าง' },
    { id: 'calendars', title: 'เชื่อมปฏิทิน', description: 'เลือก Google หรือ Outlook ใน Settings → Calendars; Apple ใช้แอป iOS ที่รองรับ อ่านตารางรวมในพื้นที่ส่วนตัว แก้ไขนัดผ่านแอปต้นทาง', example: 'พรุ่งนี้มีนัดอะไรบ้าง' },
    { id: 'briefing', title: 'สรุปวันและงานค้าง', description: 'เมื่อมีนัดหรืองานที่บันทึกไว้ ให้ช่วยสรุปวันนี้และงานที่เลยกำหนด', example: 'สรุปวันนี้ให้หน่อย' },
    { id: 'planning', title: 'หาช่วงว่างและตรวจนัดซ้อน', description: 'ใช้ตารางนัดที่บันทึกไว้เพื่อหาช่วงว่าง และถามก่อนบันทึกนัดที่ชนกัน', example: 'พรุ่งนี้เก้าโมงถึงห้าโมงมีช่วงว่างหนึ่งชั่วโมงไหม' },
    { id: 'edit', title: 'แก้ไขด้วยเสียง', description: 'เลื่อนเวลา ทำเครื่องหมายเสร็จ หรือลบรายการ', example: 'เลื่อนอันแรกไปพรุ่งนี้สิบโมง' },
    { id: 'recurring', title: 'จัดการงานประจำทีละรอบ', description: 'ทำแล้วหรือข้ามบางวัน พร้อมเก็บประวัติของแต่ละรอบ', example: 'ข้ามงานประจำอันแรกเฉพาะพรุ่งนี้' },
    { id: 'spaces', title: 'ส่วนตัวและ Space', description: options.shared ? 'เลือกพื้นที่เหนือไมค์ หรือพูดชื่อ Space ที่คุณเข้าร่วม' : 'จดส่วนตัวได้ทันที เข้าสู่ระบบเพื่อสร้างหรือเข้าร่วม Space', example: 'จดส่วนตัวว่าต้องซื้อของขวัญ' },
    { id: 'defaults', title: 'จำค่าที่คุณใช้ประจำ', description: 'ตั้งคำเรียกเวลา เวลาเตือนล่วงหน้า และภาษาที่ตอบ', example: 'จำไว้ว่าตอนเช้าของผมคือเจ็ดโมงครึ่ง' },
    ...(options.budget ? [{ id: 'budget', title: 'Daily Budget', description: 'เชื่อมบัญชี Daily Budget แล้วบันทึกรายจ่าย ก่อนถามยอดใช้จ่ายหรืองบที่เหลือ', example: 'ซื้อข้าวไปห้าสิบบาท' }] : []),
  ];
}
export function capabilityAnswer(options: CapabilityOptions, language: 'th' | 'en' = 'th'): string {
  if (language === 'en') return 'Start by telling me what to remember: save a note, introduce people, pets or places, schedule a reminder, or add a shopping item. Once you have saved information, ask about your schedule, find past notes, get a daily summary, or check free time against your saved events. Then you can edit items, mark them done, or skip a recurring occurrence. You can also use shared Spaces and set your preferred times and response language.' + (options.web ? ' Enable Web Push in Settings for browser notifications.' : '') + (options.budget ? ' Connect Daily Budget to record expenses and then ask about spending and your remaining budget.' : '');
  return `${capabilityIntroduction}. ${capabilities(options).map((item) => `${item.title}: ${item.description}`).join('. ')}`;
}
export function isHelpQuestion(text: string): boolean {
  return /^(?:vora\s*)?(?:help|what can you do|what can this app do)[?! .]*$/i.test(text.trim()) ||
    /^(?:คุณ|เธอ|แอปนี้|แอพนี้|vora)?\s*(?:ช่วย)?(?:ทำอะไรได้บ้าง|ทำอะไรได้มั่ง|ใช้งานยังไง|ใช้ยังไง)(?:ครับ|ค่ะ|คะ)?[?\s]*$/i.test(text.trim());
}
