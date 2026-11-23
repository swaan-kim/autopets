import { useEffect, useRef, useState } from 'react';

// Design reference photos for the presentation pet (Issue #104 prototype; not agreed yet).
// Photos are pasted here, re-encoded on this PC as JPEG (max 1600 px, which also drops camera
// metadata such as location) and kept in memory until "시작". Only then does the app save them
// under its data folder and put a short ref in the request; the photo itself never goes in a link.
export type DesignImage = { id: string; url: string; bytes: Uint8Array };
export const MAX_DESIGN_IMAGES = 3;
const MAX_SIDE = 1600;
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1.8 * 1024 * 1024;
const ACCEPTED = /^image\/(?:png|jpeg|webp)$/u;

export async function toDesignImage(file: Blob): Promise<DesignImage> {
  if (!ACCEPTED.test(file.type) || file.size > MAX_INPUT_BYTES) throw Error('unsupported-image');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) { bitmap.close(); throw Error('unsupported-image'); }
  // Transparent areas become white, as on a slide.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let blob: Blob | null = null;
  for (const quality of [0.85, 0.7, 0.55]) {
    blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= MAX_OUTPUT_BYTES) break;
  }
  if (!blob || blob.size > MAX_OUTPUT_BYTES) throw Error('unsupported-image');
  return { id: crypto.randomUUID(), url: URL.createObjectURL(blob), bytes: new Uint8Array(await blob.arrayBuffer()) };
}

const imageFiles = (files: Iterable<File>) => [...files].filter(file => file.type.startsWith('image/'));

export function DesignReferences({ images, onChange, disabled = false }: { images: DesignImage[]; onChange: (images: DesignImage[]) => void; disabled?: boolean }) {
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const latest = useRef({ images, onChange, disabled, reading });
  latest.current = { images, onChange, disabled, reading };

  const add = async (files: File[]) => {
    const { images: current, onChange: change, disabled: off, reading: busy } = latest.current;
    if (off || busy) return;
    setError('');
    if (!files.length) { setError('사진을 찾지 못했어요. PNG·JPG 사진을 붙여넣어 주세요.'); return; }
    const room = MAX_DESIGN_IMAGES - current.length;
    if (room <= 0) { setError(`사진은 ${MAX_DESIGN_IMAGES}장까지 넣을 수 있어요.`); return; }
    setReading(true);
    const added: DesignImage[] = [];
    let failed = false;
    for (const file of files.slice(0, room)) {
      try { added.push(await toDesignImage(file)); } catch { failed = true; }
    }
    setReading(false);
    if (failed) setError('읽을 수 없는 사진이 있어요. PNG·JPG 사진으로 다시 넣어 주세요.');
    else if (files.length > room) setError(`사진은 ${MAX_DESIGN_IMAGES}장까지 넣을 수 있어요.`);
    if (added.length) change([...latest.current.images, ...added]);
  };

  // Ctrl+V anywhere on this screen adds pasted photos. Text pastes (e.g. into the request field) are left alone.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = imageFiles(event.clipboardData?.files ?? []);
      if (!files.length || latest.current.disabled) return;
      event.preventDefault();
      void add(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  const remove = (id: string) => {
    const target = images.find(image => image.id === id);
    if (target) URL.revokeObjectURL(target.url);
    setError('');
    onChange(images.filter(image => image.id !== id));
  };

  return <div className="design-references" data-agent-id="pet-selection.composer.design-references">
    <div className="design-references-drop" tabIndex={disabled ? -1 : 0} aria-disabled={disabled}
      aria-label="디자인 참고 사진 붙여넣기 칸. Ctrl+V로 붙여넣거나 파일을 끌어 놓으세요."
      onDragOver={event => event.preventDefault()}
      onDrop={event => { event.preventDefault(); void add(imageFiles(event.dataTransfer.files)); }}>
      {images.length > 0 && <ul className="design-references-list" aria-label="넣은 디자인 참고 사진">
        {images.map((image, index) => <li key={image.id}>
          <img src={image.url} alt={`디자인 참고 사진 ${index + 1}`} />
          <button type="button" className="design-references-remove" disabled={disabled} aria-label={`디자인 참고 사진 ${index + 1} 빼기`} onClick={() => remove(image.id)}>×</button>
        </li>)}
      </ul>}
      <p>{reading ? '사진을 준비하는 중…' : images.length ? `${images.length}/${MAX_DESIGN_IMAGES}장 · Ctrl+V로 더 넣을 수 있어요.` : '예시 PPT 사진을 Ctrl+V로 붙여넣거나 끌어 놓으세요.'}</p>
      <button type="button" className="text-button" disabled={disabled || reading || images.length >= MAX_DESIGN_IMAGES} onClick={() => picker.current?.click()}>파일에서 고르기</button>
      <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={event => { void add(imageFiles(event.target.files ?? [])); event.target.value = ''; }} />
    </div>
    {error && <p className="design-references-error" role="alert">{error}</p>}
  </div>;
}
