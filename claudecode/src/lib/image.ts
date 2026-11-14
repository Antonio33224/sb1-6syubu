/** Redimensiona e comprime uma imagem no navegador (JPEG). */
export async function compressImage(file: File, maxSize = 1000, quality = 0.72): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Envie um arquivo de imagem.');
  if (file.size > 12 * 1024 * 1024) throw new Error('Imagem muito grande (máx. 12 MB).');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao processar imagem.'))), 'image/jpeg', quality),
  );
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
