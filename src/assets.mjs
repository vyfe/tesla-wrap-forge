import crypto from 'node:crypto';
import sharp from 'sharp';

const DEFAULT_LIMIT = 64 * 1024 * 1024;

/**
 * 进程内资源缓存：前端只上传一次图层，后续渲染用 assetId 引用。
 * 有容量上限，进程重启后清空；不落盘，适合单实例部署。
 */
export class AssetStore {
  constructor(limitBytes = DEFAULT_LIMIT) {
    this.limitBytes = limitBytes;
    this.bytes = 0;
    this.items = new Map();
  }

  put(buffer, mime = 'image/png') {
    const id = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 32);
    const existing = this.items.get(id);
    if (existing) {
      this.items.delete(id);
      this.items.set(id, existing);
      return existing;
    }

    const asset = { id, buffer, mime, bytes: buffer.length };
    this.items.set(id, asset);
    this.bytes += asset.bytes;
    while (this.bytes > this.limitBytes && this.items.size > 1) {
      const oldest = this.items.entries().next().value;
      if (!oldest) break;
      this.items.delete(oldest[0]);
      this.bytes -= oldest[1].bytes;
    }
    return asset;
  }

  get(id) {
    const asset = this.items.get(id);
    if (!asset) return null;
    this.items.delete(id);
    this.items.set(id, asset);
    return asset;
  }

  describe(id) {
    const asset = this.get(id);
    if (!asset) return null;
    return { id: asset.id, mime: asset.mime, bytes: asset.bytes };
  }
}

export async function inspectImage(buffer) {
  const metadata = await sharp(buffer, { failOn: 'none' }).metadata();
  return {
    width: metadata.width || 0,
    height: metadata.height || 0,
    format: metadata.format || 'unknown',
    hasAlpha: Boolean(metadata.hasAlpha),
  };
}
