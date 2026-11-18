import sharp from 'sharp';
import { analyzeAlpha, makeLineGuide, makePanelMap, readAlpha } from './panels.mjs';
import { getTemplate, readTemplateFile, UserError } from './templates.mjs';

const cache = new Map();
const pending = new Map();

function toDataUrl(buffer) {
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

async function load(id) {
  const definition = getTemplate(id);
  const buffer = await readTemplateFile(id);
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height) {
    throw new UserError(`无法读取模板尺寸：${id}`, 500);
  }

  const width = metadata.width;
  const height = metadata.height;
  const alpha = await readAlpha(buffer, width, height);
  const analysis = analyzeAlpha(alpha, width, height);
  if (analysis.components.length === 0) {
    throw new UserError(`模板没有有效涂装区域：${id}`, 500);
  }

  const template = {
    ...definition,
    width,
    height,
    buffer,
    alpha,
    labels: analysis.labels,
    components: analysis.components,
    maskCount: analysis.maskCount,
  };

  const [guideBuffer, panelMapBuffer] = await Promise.all([
    makeLineGuide(buffer, width, height),
    makePanelMap(template),
  ]);

  return {
    ...template,
    guide: toDataUrl(guideBuffer),
    panelMap: toDataUrl(panelMapBuffer),
  };
}

export async function getTemplateBundle(id) {
  if (cache.has(id)) return cache.get(id);
  if (pending.has(id)) return pending.get(id);

  const promise = load(id)
    .then((bundle) => {
      cache.set(id, bundle);
      return bundle;
    })
    .finally(() => {
      pending.delete(id);
    });

  pending.set(id, promise);
  return promise;
}

export function clearTemplateCache() {
  cache.clear();
  pending.clear();
}
