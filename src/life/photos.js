import { MAX_PHOTO_CHARS } from './model.js';

export async function compressPhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 照片。');
  if (file.size > 10 * 1024 * 1024) throw new Error('原始照片请小于 10 MB。');
  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error('无法读取这张照片，请换一张有效图片。'); }
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器暂时无法处理照片。');
    for (const limit of [1200, 960, 720, 480]) {
      const scale = Math.min(1, limit / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [.82, .65, .45]) {
        const result = canvas.toDataURL('image/jpeg', quality);
        if (result.length <= MAX_PHOTO_CHARS) return result;
      }
    }
    throw new Error('照片压缩后仍然过大，请选择较小的照片。');
  } finally { bitmap.close(); }
}

export async function verifyPhotos(events) {
  for (const event of events) {
    if (!event.photo) continue;
    const image = new Image(); image.src = event.photo;
    try { await image.decode(); }
    catch { throw new Error('备份中有无法读取的照片，原有记录未改变。'); }
  }
}
