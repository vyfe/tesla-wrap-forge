import sharp from 'sharp';
import { UserError } from './templates.mjs';

const PANEL_COLORS = [
  [45, 91, 255],
  [255, 90, 31],
  [28, 140, 94],
  [138, 79, 255],
  [0, 124, 145],
  [212, 160, 0],
];

export function analyzeAlpha(alpha, width, height, threshold = 8) {
  const labels = new Int32Array(width * height);
  labels.fill(-1);
  const queue = new Int32Array(width * height);
  const components = [];
  let maskCount = 0;

  for (let start = 0; start < alpha.length; start += 1) {
    if (alpha[start] <= threshold) continue;
    maskCount += 1;
    if (labels[start] !== -1) continue;

    const key = components.length;
    let head = 0;
    let tail = 0;
    let area = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    queue[tail] = start;
    tail += 1;
    labels[start] = key;

    while (head < tail) {
      const pixel = queue[head];
      head += 1;
      const x = pixel % width;
      const y = (pixel / width) | 0;
      area += 1;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      if (x > 0 && labels[pixel - 1] === -1 && alpha[pixel - 1] > threshold) {
        labels[pixel - 1] = key;
        queue[tail] = pixel - 1;
        tail += 1;
      }
      if (x + 1 < width && labels[pixel + 1] === -1 && alpha[pixel + 1] > threshold) {
        labels[pixel + 1] = key;
        queue[tail] = pixel + 1;
        tail += 1;
      }
      if (y > 0 && labels[pixel - width] === -1 && alpha[pixel - width] > threshold) {
        labels[pixel - width] = key;
        queue[tail] = pixel - width;
        tail += 1;
      }
      if (y + 1 < height && labels[pixel + width] === -1 && alpha[pixel + width] > threshold) {
        labels[pixel + width] = key;
        queue[tail] = pixel + width;
        tail += 1;
      }
    }

    components.push({
      key,
      area,
      bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
      centroid: { x: sumX / area, y: sumY / area },
    });
  }

  // 按从上到下、从左到右编号。行高随画布自适应，避免大模板的编号顺序漂移。
  const rowHeight = Math.max(32, Math.round(height * 0.08));
  components.sort((a, b) => {
    const rowA = Math.round(a.centroid.y / rowHeight);
    const rowB = Math.round(b.centroid.y / rowHeight);
    if (rowA !== rowB) return rowA - rowB;
    return a.centroid.x - b.centroid.x;
  });

  components.forEach((component, index) => {
    component.id = `P${String(index + 1).padStart(2, '0')}`;
  });

  return { labels, components, maskCount };
}

export async function readAlpha(buffer, width, height) {
  const { data } = await sharp(buffer)
    .ensureAlpha()
    .extractChannel('alpha')
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (data.length !== width * height) {
    throw new UserError('模板透明通道尺寸异常', 500);
  }
  return data;
}

export function tallyCoverage(alpha, template, labels = template.labels, width = template.width, height = template.height) {
  const count = template.components.length;
  const areas = new Array(count).fill(0);
  const filled = new Array(count).fill(0);
  const minX = new Array(count).fill(width);
  const minY = new Array(count).fill(height);
  const maxX = new Array(count).fill(0);
  const maxY = new Array(count).fill(0);
  const sumX = new Array(count).fill(0);
  const sumY = new Array(count).fill(0);
  let totalFilled = 0;
  let opaque = 0;
  let maskCount = 0;

  for (let index = 0; index < alpha.length; index += 1) {
    const key = labels[index];
    if (key < 0) continue;
    const x = index % width;
    const y = (index / width) | 0;
    maskCount += 1;
    areas[key] += 1;
    if (x < minX[key]) minX[key] = x;
    if (x > maxX[key]) maxX[key] = x;
    if (y < minY[key]) minY[key] = y;
    if (y > maxY[key]) maxY[key] = y;
    sumX[key] += x;
    sumY[key] += y;
    if (alpha[index] <= 8) continue;
    filled[key] += 1;
    totalFilled += 1;
    if (alpha[index] >= 250) opaque += 1;
  }

  const panels = template.components.map((component) => {
    const area = areas[component.key];
    const panelFill = area === 0 ? 0 : filled[component.key] / area;
    return {
      id: component.id,
      area,
      fill: Number(panelFill.toFixed(4)),
      bbox: {
        x: minX[component.key],
        y: minY[component.key],
        w: Math.max(0, maxX[component.key] - minX[component.key] + 1),
        h: Math.max(0, maxY[component.key] - minY[component.key] + 1),
      },
      centroid: {
        x: Number((sumX[component.key] / Math.max(1, area)).toFixed(1)),
        y: Number((sumY[component.key] / Math.max(1, area)).toFixed(1)),
      },
    };
  });

  const coverage = maskCount === 0 ? 0 : totalFilled / maskCount;
  const minPanelFill = panels.length === 0 ? 0 : Math.min(...panels.map((panel) => panel.fill));

  return {
    coverage,
    opaqueCoverage: maskCount === 0 ? 0 : opaque / maskCount,
    filled: totalFilled,
    holes: maskCount - totalFilled,
    maskCount,
    minPanelFill,
    panels,
  };
}

export async function makeLineGuide(templateBuffer, width, height) {
  const { data } = await sharp(templateBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const alpha = data[offset + 3];
    if (alpha <= 8) continue;
    const luminance = data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
    if (luminance >= 110) continue;
    out[offset] = 255;
    out[offset + 1] = 77;
    out[offset + 2] = 0;
    out[offset + 3] = alpha;
  }
  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

export async function makePanelMap(template) {
  const { width, height, labels, components } = template;
  const raw = Buffer.alloc(width * height * 4);
  for (let index = 0; index < labels.length; index += 1) {
    const key = labels[index];
    if (key < 0) continue;
    const color = PANEL_COLORS[key % PANEL_COLORS.length];
    const offset = index * 4;
    raw[offset] = color[0];
    raw[offset + 1] = color[1];
    raw[offset + 2] = color[2];
    raw[offset + 3] = 150;
  }

  const labelsSvg = components
    .filter((component) => component.area >= 250)
    .map((component) => {
      const size = component.area >= 9000 ? 22 : component.area >= 3000 ? 18 : 15;
      return `<text x="${component.centroid.x.toFixed(1)}" y="${component.centroid.y.toFixed(1)}" dy=".35em" font-family="Menlo, monospace" font-size="${size}" font-weight="700" text-anchor="middle" fill="#ffffff" stroke="#101312" stroke-width="3">${component.id}</text>`;
    })
    .join('');

  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${labelsSvg}</svg>`,
  );

  return sharp(raw, { raw: { width, height, channels: 4 } })
    .composite([{ input: svg, left: 0, top: 0 }])
    .png()
    .toBuffer();
}
