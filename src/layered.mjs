import sharp from 'sharp';
import { composeArtwork } from './artwork.mjs';
import { parseHexColor, normalizeOptions } from './options.mjs';
import { assertSplitAllowed, COMPOSE_ORDER, VIEWS, zoneRect } from './views.mjs';
import { UserError } from './templates.mjs';

function normalizeAngle(value) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

async function edgeColor(buffer, edge) {
  const meta = await sharp(buffer).metadata();
  const height = Math.max(1, Math.round(meta.height * 0.03));
  const top = edge === 'bottom' ? meta.height - height : 0;
  const { data } = await sharp(buffer)
    .extract({ left: 0, top, width: meta.width, height })
    .resize(1, 1, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { r: data[0], g: data[1], b: data[2], alpha: 255 };
}

async function solidZone(width, height, color) {
  return sharp({
    create: { width, height, channels: 4, background: color },
  }).png().toBuffer();
}

async function baseCanvas(width, height, background) {
  if (background === 'transparent') {
    return sharp({
      create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).png().toBuffer();
  }

  const color = background === 'auto' ? parseHexColor('#121614') : parseHexColor(background);
  if (!color) throw new UserError(`无法解析底色：${background}`);
  return sharp({
    create: { width, height, channels: 4, background: color },
  }).png().toBuffer();
}

function panelKeys(view, template) {
  if (view.kind === 'side') {
    const leftSide = view.id === 'left';
    return template.components
      .filter((component) => {
        const center = component.centroid.x / template.width;
        return component.area > 1000
          && component.bbox.w <= template.width * 0.40
          && (leftSide ? center < 0.42 : center > 0.58);
      })
      .map((component) => component.key);
  }
  if (view.kind !== 'center' || !view.search) return [];
  const override = template.split?.[view.id];
  const [left, top, width, height] = (override?.search || view.search);
  const minArea = override?.minArea ?? view.minArea;
  const maxWidth = override?.maxWidth ?? view.maxWidth;
  const x1 = left * template.width;
  const y1 = top * template.height;
  const x2 = (left + width) * template.width;
  const y2 = (top + height) * template.height;
  return template.components
    .filter((component) => (
      component.area >= (minArea || 0)
      && component.centroid.x >= x1
      && component.centroid.x <= x2
      && component.centroid.y >= y1
      && component.centroid.y <= y2
      && (!maxWidth || component.bbox.w <= maxWidth * template.width)
    ))
    .map((component) => component.key);
}

function zoneFor(view, template, keys) {
  const overrideZone = template.split?.[view.id]?.zone;
  if (keys.length === 0) return zoneRect(view, template.width, template.height, overrideZone);
  let minX = template.width;
  let minY = template.height;
  let maxX = 0;
  let maxY = 0;
  for (const component of template.components) {
    if (!keys.includes(component.key)) continue;
    minX = Math.min(minX, component.bbox.x);
    minY = Math.min(minY, component.bbox.y);
    maxX = Math.max(maxX, component.bbox.x + component.bbox.w);
    maxY = Math.max(maxY, component.bbox.y + component.bbox.h);
  }
  const x = Math.max(0, minX - 1);
  const y = Math.max(0, minY - 1);
  return {
    x,
    y,
    width: Math.min(template.width - x, maxX - minX + 2),
    height: Math.min(template.height - y, maxY - minY + 2),
  };
}

function bboxForKeys(template, keys) {
  let minX = template.width;
  let minY = template.height;
  let maxX = 0;
  let maxY = 0;
  for (const component of template.components) {
    if (!keys.includes(component.key)) continue;
    minX = Math.min(minX, component.bbox.x);
    minY = Math.min(minY, component.bbox.y);
    maxX = Math.max(maxX, component.bbox.x + component.bbox.w);
    maxY = Math.max(maxY, component.bbox.y + component.bbox.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

const panelMaskCache = new WeakMap();

async function panelMask(template, keys) {
  if (keys.length === 0) return null;
  const cacheKey = keys.join('|');
  let perTemplate = panelMaskCache.get(template);
  if (!perTemplate) {
    perTemplate = new Map();
    panelMaskCache.set(template, perTemplate);
  }
  if (perTemplate.has(cacheKey)) return perTemplate.get(cacheKey);
  const promise = buildPanelMask(template, keys);
  perTemplate.set(cacheKey, promise);
  return promise;
}

async function buildPanelMask(template, keys) {
  const selected = new Set(keys);
  const raw = Buffer.alloc(template.width * template.height * 4);
  for (let index = 0; index < template.labels.length; index += 1) {
    if (!selected.has(template.labels[index])) continue;
    const offset = index * 4;
    raw[offset] = 255;
    raw[offset + 1] = 255;
    raw[offset + 2] = 255;
    raw[offset + 3] = 255;
  }
  return sharp(raw, {
    raw: { width: template.width, height: template.height, channels: 4 },
  }).png().toBuffer();
}

async function applyMask(buffer, mask, zone) {
  if (!mask) return buffer;
  const cropped = await sharp(mask)
    .extract({ left: zone.x, top: zone.y, width: zone.width, height: zone.height })
    .png()
    .toBuffer();
  return sharp(buffer)
    .composite([{ input: cropped, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

/**
 * 把每个车身面的图放进对应的归一化区域，再统一裁到官方 alpha。
 * 中央区域（前盖/后盖/保险杠）按连通板块贴合，左右侧按整条侧视区域贴合。
 * 这是视觉分区，不是精确的 3D 投影；最终以车机 3D 预览为准。
 */
export async function composeLayers({ baseBuffer, layers, template, options }) {
  assertSplitAllowed(template);
  const provided = VIEWS.filter((view) => layers[view.id]?.buffer);
  if (provided.length === 0) {
    throw new UserError('分面模式至少需要上传一个车身面');
  }

  const warnings = [];
  const compositeLayers = [];
  const zoneBuffers = new Map();
  const rawZoneBuffers = new Map();
  const metadata = new Map(VIEWS.map((view) => {
    const keys = panelKeys(view, template);
    return [view.id, {
      keys,
      zone: zoneFor(view, template, keys),
      mask: null,
    }];
  }));
  const leftMeta = metadata.get('left');
  const rightMeta = metadata.get('right');
  const leftBox = bboxForKeys(template, leftMeta.keys);
  const rightBox = bboxForKeys(template, rightMeta.keys);
  if (leftBox.w > 0 && rightBox.w > 0) {
    const leftKeys = new Set(leftMeta.keys);
    const rightKeys = new Set(rightMeta.keys);
    let leftMax = 0;
    let rightMin = template.width;
    for (const component of template.components) {
      if (leftKeys.has(component.key)) leftMax = Math.max(leftMax, component.bbox.x + component.bbox.w);
      if (rightKeys.has(component.key)) rightMin = Math.min(rightMin, component.bbox.x);
    }
    const width = Math.min(template.width, Math.max(leftMax, template.width - rightMin, leftBox.w, rightBox.w) + 4);
    leftMeta.zone = { x: 0, y: 0, width, height: template.height };
    rightMeta.zone = {
      x: Math.max(0, template.width - width),
      y: 0,
      width,
      height: template.height,
    };
  }

  await Promise.all(VIEWS.map(async (view) => {
    const entry = metadata.get(view.id);
    if (view.kind === 'center' && !view.optional && entry.keys.length === 0) {
      throw new UserError(`${template.name} 的模板没有独立的${view.label}板块，暂不支持分面模式`);
    }
    entry.mask = view.kind === 'side' ? null : await panelMask(template, entry.keys);
  }));

  let canvas;
  if (baseBuffer) {
    const base = await composeArtwork(baseBuffer, template.width, template.height, {
      ...options,
      rotate: 0,
    });
    canvas = sharp(base.buffer);
    warnings.push(...base.warnings.map((warning) => `底层：${warning}`));
  } else {
    canvas = sharp(await baseCanvas(template.width, template.height, options.background));
  }

  const summary = [];
  const orderedViews = COMPOSE_ORDER.map((id) => VIEWS.find((view) => view.id === id));
  for (const view of orderedViews) {
    const layer = layers[view.id];
    const entry = metadata.get(view.id);
    if (!layer?.buffer) {
      summary.push({
        id: view.id,
        label: view.label,
        provided: false,
        optional: view.optional,
        panels: entry.keys.length,
        zone: entry.zone,
      });
      continue;
    }

    const angle = normalizeAngle(Number(layer.options?.rotate || 0) + view.rotate);
    const layerOptions = normalizeOptions({
      ...options,
      ...layer.options,
      background: 'transparent',
      rotate: angle,
      name: '',
    });
    const composed = await composeArtwork(
      layer.buffer,
      entry.zone.width,
      entry.zone.height,
      layerOptions,
    );
    const masked = await applyMask(composed.buffer, entry.mask, entry.zone);
    rawZoneBuffers.set(view.id, composed.buffer);
    zoneBuffers.set(view.id, masked);
    compositeLayers.push({ input: masked, left: entry.zone.x, top: entry.zone.y });
    warnings.push(...composed.warnings.map((warning) => `${view.label}：${warning}`));
    summary.push({
      id: view.id,
      label: view.label,
      provided: true,
      optional: view.optional,
      panels: entry.keys.length,
      zone: entry.zone,
      source: composed.source,
      options: {
        fit: layerOptions.fit,
        zoom: layerOptions.zoom,
        offsetX: layerOptions.offsetX,
        offsetY: layerOptions.offsetY,
        rotate: layerOptions.rotate,
        flipX: layerOptions.flipX,
        flipY: layerOptions.flipY,
        background: layerOptions.background,
      },
    });
  }

  // 没传保险杠时，用前盖/后盖边缘主色补一条，避免中央出现突兀的黑块。
  const fallbackSpecs = [
    { target: 'frontBumper', source: 'hood', edge: 'bottom' },
    { target: 'rearBumper', source: 'trunk', edge: 'top' },
  ];
  for (const fallback of fallbackSpecs) {
    const target = VIEWS.find((view) => view.id === fallback.target);
    const entry = summary.find((view) => view.id === fallback.target);
    const targetMeta = metadata.get(fallback.target);
    const sourceBuffer = rawZoneBuffers.get(fallback.source);
    if (!target || !entry || entry.provided || !sourceBuffer) continue;

    const color = await edgeColor(sourceBuffer, fallback.edge);
    const solid = await solidZone(targetMeta.zone.width, targetMeta.zone.height, color);
    const masked = await applyMask(solid, targetMeta.mask, targetMeta.zone);
    compositeLayers.push({
      input: masked,
      left: targetMeta.zone.x,
      top: targetMeta.zone.y,
    });
    const hex = `#${[color.r, color.g, color.b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
    entry.autoFilled = true;
    entry.fillColor = hex;
    entry.filledFrom = fallback.source;
    warnings.push(`${target.label}未上传，已用${VIEWS.find((view) => view.id === fallback.source).label}边缘色 ${hex} 补底`);
  }

  const missing = summary.filter((view) => !view.provided && !view.autoFilled && !view.optional);
  if (missing.length) {
    warnings.push(`未上传：${missing.map((view) => view.label).join('、')}，这些区域会使用底色`);
  }

  if (compositeLayers.length) canvas = canvas.composite(compositeLayers);

  return {
    buffer: await canvas.png().toBuffer(),
    warnings,
    source: {
      width: template.width,
      height: template.height,
      format: 'layers',
    },
    views: summary,
  };
}
