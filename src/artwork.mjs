import sharp from 'sharp';
import { parseHexColor } from './options.mjs';
import { UserError } from './templates.mjs';

const MAX_INPUT_PIXELS = 40_000_000;
const MAX_TARGET_EDGE = 8192;
const preparedCache = new WeakMap();
const backgroundCache = new WeakMap();
const resizedCache = new WeakMap();

async function prepareArtwork(inputBuffer, options) {
  const key = `${Boolean(options.flipX)}|${Boolean(options.flipY)}|${Number(options.rotate) || 0}`;
  let perBuffer = preparedCache.get(inputBuffer);
  if (perBuffer?.has(key)) return perBuffer.get(key);
  const sourceMeta = await sharp(inputBuffer, { failOn: 'none', limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  if (!sourceMeta.width || !sourceMeta.height) {
    throw new UserError('无法读取图案尺寸，请换一张 PNG / JPG / WebP / SVG');
  }

  let pipeline = sharp(inputBuffer, {
    failOn: 'none',
    limitInputPixels: MAX_INPUT_PIXELS,
    density: sourceMeta.format === 'svg' ? 96 : 72,
  })
    .autoOrient()
    .ensureAlpha()
    .toColourspace('srgb');

  if (options.flipX) pipeline = pipeline.flop();
  if (options.flipY) pipeline = pipeline.flip();
  if (options.rotate !== 0) {
    pipeline = pipeline.rotate(options.rotate, {
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  }

  const buffer = await pipeline.png({ compressionLevel: 1 }).toBuffer();
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height) {
    throw new UserError('图案解码失败');
  }

  const prepared = {
    buffer,
    width: metadata.width,
    height: metadata.height,
    format: sourceMeta.format,
    sourceWidth: sourceMeta.width,
    sourceHeight: sourceMeta.height,
  };
  if (!perBuffer) {
    perBuffer = new Map();
    preparedCache.set(inputBuffer, perBuffer);
  }
  perBuffer.set(key, prepared);
  return prepared;
}

async function makeBackground(art, width, height, background) {
  const cacheKey = `${width}x${height}:${background}`;
  let perArt = backgroundCache.get(art.buffer);
  if (perArt?.has(cacheKey)) return perArt.get(cacheKey);
  const result = await buildBackground(art, width, height, background);
  if (!perArt) {
    perArt = new Map();
    backgroundCache.set(art.buffer, perArt);
  }
  perArt.set(cacheKey, result);
  return result;
}

async function buildBackground(art, width, height, background) {
  if (background === 'transparent') {
    return sharp({
      create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).png().toBuffer();
  }

  if (background === 'auto') {
    const smallWidth = Math.max(64, Math.round(width / 12));
    const smallHeight = Math.max(1, Math.round((smallWidth * height) / width));
    return sharp(art.buffer)
      .resize({ width: smallWidth, height: smallHeight, fit: 'cover', position: 'centre' })
      .flatten({ background: { r: 12, g: 14, b: 14 } })
      .blur(6)
      .modulate({ brightness: 0.72, saturation: 1.08 })
      .resize({ width, height, fit: 'cover', position: 'centre' })
      .png()
      .toBuffer();
  }

  const color = parseHexColor(background);
  return sharp({
    create: { width, height, channels: 4, background: color },
  }).png().toBuffer();
}

function targetSize(art, width, height, options) {
  if (options.fit === 'stretch') {
    return {
      width: Math.max(1, Math.round(width * options.zoom)),
      height: Math.max(1, Math.round(height * options.zoom)),
    };
  }

  const scale = options.fit === 'cover'
    ? Math.max(width / art.width, height / art.height)
    : Math.min(width / art.width, height / art.height);
  const zoom = scale * options.zoom;
  let targetWidth = Math.max(1, Math.round(art.width * zoom));
  let targetHeight = Math.max(1, Math.round(art.height * zoom));

  if (targetWidth > MAX_TARGET_EDGE || targetHeight > MAX_TARGET_EDGE) {
    const shrink = Math.min(MAX_TARGET_EDGE / targetWidth, MAX_TARGET_EDGE / targetHeight);
    targetWidth = Math.max(1, Math.round(targetWidth * shrink));
    targetHeight = Math.max(1, Math.round(targetHeight * shrink));
  }

  return { width: targetWidth, height: targetHeight };
}

async function visiblePart(buffer, artWidth, artHeight, x, y, width, height) {
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const right = Math.min(width, x + artWidth);
  const bottom = Math.min(height, y + artHeight);
  if (right <= left || bottom <= top) return null;

  const sourceLeft = left - x;
  const sourceTop = top - y;
  const partWidth = right - left;
  const partHeight = bottom - top;

  if (sourceLeft === 0 && sourceTop === 0 && partWidth === artWidth && partHeight === artHeight) {
    return { buffer, left, top };
  }

  return {
    buffer: await sharp(buffer)
      .extract({ left: sourceLeft, top: sourceTop, width: partWidth, height: partHeight })
      .png()
      .toBuffer(),
    left,
    top,
  };
}

async function composeTiles(art, canvas, width, height, options) {
  const tileWidth = Math.max(80, Math.min(width * 2, Math.round(width / (2 * options.zoom))));
  const tileHeight = Math.max(1, Math.round((tileWidth * art.height) / art.width));
  const tile = await sharp(art.buffer)
    .resize({ width: tileWidth, height: tileHeight, fit: 'fill', kernel: 'lanczos3' })
    .png()
    .toBuffer();

  const shiftX = Math.round((options.offsetX / 100) * width) % tileWidth;
  const shiftY = Math.round((options.offsetY / 100) * height) % tileHeight;
  const startX = shiftX - tileWidth;
  const startY = shiftY - tileHeight;
  const layers = [];

  for (let y = startY; y < height; y += tileHeight) {
    for (let x = startX; x < width; x += tileWidth) {
      layers.push({ input: tile, left: x, top: y });
    }
  }

  return canvas.composite(layers).png().toBuffer();
}

export async function composeArtwork(inputBuffer, width, height, options) {
  const effective = options.fit === 'tile' && options.rotate !== 0
    ? { ...options, rotate: 0 }
    : options;
  const art = await prepareArtwork(inputBuffer, effective);
  const warnings = [];

  if (art.format !== 'svg' && Math.max(art.sourceWidth, art.sourceHeight) < 800) {
    warnings.push('原图小于 800 px，放大后可能偏糊');
  }
  if (effective.rotate !== options.rotate) {
    warnings.push('平铺模式不支持整图旋转，已忽略旋转');
  }

  const background = await makeBackground(art, width, height, effective.background);
  let canvas = sharp(background);

  if (effective.fit === 'tile') {
    return {
      buffer: await composeTiles(art, canvas, width, height, effective),
      warnings,
      source: { width: art.sourceWidth, height: art.sourceHeight, format: art.format },
    };
  }

  const target = targetSize(art, width, height, effective);
  const resizeKey = `${target.width}x${target.height}`;
  let resizedMap = resizedCache.get(art.buffer);
  let resized = resizedMap?.get(resizeKey);
  if (!resized) {
    resized = await sharp(art.buffer)
      .resize({ width: target.width, height: target.height, fit: 'fill', kernel: 'lanczos3' })
      .png()
      .toBuffer();
    if (!resizedMap) {
      resizedMap = new Map();
      resizedCache.set(art.buffer, resizedMap);
    }
    resizedMap.set(resizeKey, resized);
  }

  const x = Math.round((width - target.width) / 2 + (effective.offsetX / 100) * width);
  const y = Math.round((height - target.height) / 2 + (effective.offsetY / 100) * height);
  const part = await visiblePart(resized, target.width, target.height, x, y, width, height);

  if (part) {
    canvas = canvas.composite([{ input: part.buffer, left: part.left, top: part.top }]);
  }

  return {
    buffer: await canvas.png().toBuffer(),
    warnings,
    source: { width: art.sourceWidth, height: art.sourceHeight, format: art.format },
  };
}
