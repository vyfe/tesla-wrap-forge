import { UserError } from './templates.mjs';

export const DEFAULT_OPTIONS = Object.freeze({
  fit: 'cover',
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  rotate: 0,
  flipX: false,
  flipY: false,
  background: 'auto',
  quality: 92,
  dither: 0.8,
  maxBytes: 1_000_000,
  autoDownscale: true,
  name: '',
});

const FITS = new Set(['cover', 'contain', 'stretch', 'tile']);

function bool(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function number(value, fallback, min, max, label) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new UserError(`${label} 必须是数字`);
  if (parsed < min || parsed > max) throw new UserError(`${label} 必须在 ${min}–${max} 之间`);
  return parsed;
}

export function parseHexColor(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^#?([0-9a-f]{3,8})$/i);
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3 || hex.length === 4) {
    hex = [...hex].map((char) => char + char).join('');
  }
  if (hex.length !== 6 && hex.length !== 8) return null;
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
    alpha: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) : 255,
  };
}

export function normalizeOptions(input = {}) {
  const fit = input.fit ?? DEFAULT_OPTIONS.fit;
  if (!FITS.has(fit)) throw new UserError(`适配方式必须是 ${[...FITS].join(' / ')}`);

  let background = input.background ?? DEFAULT_OPTIONS.background;
  if (background !== 'auto' && background !== 'transparent') {
    const parsed = parseHexColor(background);
    if (!parsed) throw new UserError('背景色必须是 auto、transparent 或 #RRGGBB');
    background = `#${[parsed.r, parsed.g, parsed.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }

  return {
    fit,
    zoom: number(input.zoom, DEFAULT_OPTIONS.zoom, 0.2, 4, '缩放'),
    offsetX: number(input.offsetX, DEFAULT_OPTIONS.offsetX, -150, 150, '水平位移'),
    offsetY: number(input.offsetY, DEFAULT_OPTIONS.offsetY, -150, 150, '垂直位移'),
    rotate: number(input.rotate, DEFAULT_OPTIONS.rotate, -180, 180, '旋转'),
    flipX: bool(input.flipX),
    flipY: bool(input.flipY),
    background,
    quality: Math.round(number(input.quality, DEFAULT_OPTIONS.quality, 30, 100, '压缩质量')),
    dither: number(input.dither, DEFAULT_OPTIONS.dither, 0, 1, '抖动'),
    maxBytes: Math.round(number(input.maxBytes, DEFAULT_OPTIONS.maxBytes, 100_000, 1_000_000, '大小上限')),
    autoDownscale: input.autoDownscale === undefined ? true : bool(input.autoDownscale),
    name: typeof input.name === 'string' ? input.name.slice(0, 80) : '',
  };
}
