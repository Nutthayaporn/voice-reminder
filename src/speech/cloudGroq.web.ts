// The browser uses Web Speech API instead of recording and uploading audio.
// This platform stub keeps expo-file-system's native uploader out of web
// bundles if the shared hook imports the cloud gateway.

export async function transcribeWithGroq(_uri: string): Promise<string> {
  throw new Error('Cloud STT ไม่ได้เปิดใช้บนเว็บ — กรุณาใช้ Browser STT');
}
