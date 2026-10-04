export const MAX_PNG_BYTES = 5 * 1024 * 1024;
export async function readPng(file: File): Promise<{ bytes: number[]; dataUrl: string }> {
  if (file.size > MAX_PNG_BYTES) throw new Error('PNG 파일은 5MB 이하로 올려주세요.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || !signature.every((value, index) => bytes[index] === value) || (file.type && file.type !== 'image/png')) throw new Error('실제 PNG 형식의 이미지가 필요해요.');
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = header.getUint32(16), height = header.getUint32(20);
  if (header.getUint32(8) !== 13 || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR' || width < 1 || height < 1 || width > 4096 || height > 4096) throw new Error('PNG 가로·세로 크기는 각각 1~4096px이어야 해요.');
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' })).catch(() => { throw new Error('읽을 수 없는 PNG예요. 파일을 다시 확인해주세요.'); });
  if (!bitmap.width || !bitmap.height) { bitmap.close(); throw new Error('이미지 크기를 확인할 수 없어요.'); }
  bitmap.close();
  const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('이미지를 읽지 못했어요.')); reader.readAsDataURL(new Blob([bytes], { type: 'image/png' })); });
  return { bytes: Array.from(bytes), dataUrl };
}
