import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEMPLATE_DIR = path.join(ROOT, 'assets', 'templates');
export const VEHICLE_DIR = path.join(ROOT, 'assets', 'vehicles');
export const OFFICIAL_REPO = 'https://github.com/teslamotors/custom-wraps';

const DEFINITIONS = [
  {
    id: 'model3-2024-base',
    name: 'Model 3 焕新版',
    variant: '标准续航 / 长续航',
    series: 'Model 3',
    year: '2024+',
    body: '轿车',
    short: 'm3-2024',
    order: 10,
  },
  {
    id: 'model3-2024-performance',
    name: 'Model 3 焕新版',
    variant: 'Performance',
    series: 'Model 3',
    year: '2024+',
    body: '轿车',
    short: 'm3-2024p',
    order: 11,
  },
  {
    id: 'model3',
    name: 'Model 3',
    variant: '2023 及以前',
    series: 'Model 3',
    year: '2017–2023',
    body: '轿车',
    short: 'm3',
    order: 12,
    split: {
      trunk: { search: [0.30, 0.72, 0.40, 0.15], minArea: 20000, maxWidth: 0.55 },
      rearBumper: { zone: [0.30, 0.86, 0.40, 0.14] },
    },
  },
  {
    id: 'modely-2025-base',
    name: 'Model Y 焕新版',
    variant: '标准续航',
    series: 'Model Y',
    year: '2025+',
    body: 'SUV',
    short: 'my-2025',
    order: 20,
    split: {
      trunk: { search: [0.30, 0.80, 0.40, 0.12], minArea: 10000, maxWidth: 0.55 },
      rearBumper: { zone: [0.30, 0.92, 0.40, 0.08] },
    },
  },
  {
    id: 'modely-2025-premium',
    name: 'Model Y 焕新版',
    variant: '长续航 / Premium',
    series: 'Model Y',
    year: '2025+',
    body: 'SUV',
    short: 'my-2025p',
    order: 21,
    split: {
      trunk: { search: [0.30, 0.80, 0.40, 0.12], minArea: 10000, maxWidth: 0.55 },
      rearBumper: { zone: [0.30, 0.92, 0.40, 0.08] },
    },
  },
  {
    id: 'modely-2025-performance',
    name: 'Model Y 焕新版',
    variant: 'Performance',
    series: 'Model Y',
    year: '2025+',
    body: 'SUV',
    short: 'my-2025perf',
    order: 22,
    split: {
      trunk: { search: [0.30, 0.80, 0.40, 0.12], minArea: 10000, maxWidth: 0.55 },
      rearBumper: { zone: [0.30, 0.92, 0.40, 0.08] },
    },
  },
  {
    id: 'modely',
    name: 'Model Y',
    variant: '2024 及以前',
    series: 'Model Y',
    year: '2020–2024',
    body: 'SUV',
    short: 'my',
    order: 23,
  },
  {
    id: 'modely-l',
    name: 'Model Y L',
    variant: '六座',
    series: 'Model Y',
    year: '2025+',
    body: 'SUV',
    short: 'myl',
    order: 24,
    split: {
      trunk: { search: [0.30, 0.80, 0.40, 0.10], minArea: 8000, maxWidth: 0.55 },
      rearBumper: { zone: [0.30, 0.90, 0.40, 0.10] },
    },
  },
  {
    id: 'models-2025-plaid',
    name: 'Model S',
    variant: '2025+ Plaid',
    series: 'Model S',
    year: '2025+',
    body: '轿车',
    short: 'ms-2025',
    split: false,
    order: 30,
  },
  {
    id: 'models-2021',
    name: 'Model S',
    variant: '2021+',
    series: 'Model S',
    year: '2021+',
    body: '轿车',
    short: 'ms',
    split: false,
    order: 31,
  },
  {
    id: 'modelx-2021',
    name: 'Model X',
    variant: '2021+',
    series: 'Model X',
    year: '2021+',
    body: 'SUV',
    short: 'mx',
    split: false,
    order: 40,
  },
  {
    id: 'cybertruck',
    name: 'Cybertruck',
    variant: '标准版',
    series: 'Cybertruck',
    year: '2024+',
    body: '皮卡',
    short: 'ct',
    order: 50,
    split: false,
  },
];

export const TEMPLATES = DEFINITIONS
  .sort((a, b) => a.order - b.order)
  .map((definition) => ({
    ...definition,
    supportsSplit: definition.split !== false,
    sourceUrl: `${OFFICIAL_REPO}/blob/master/${definition.id}/template.png`,
    templatePath: path.join(TEMPLATE_DIR, definition.id, 'template.png'),
    vehicleUrl: `assets/vehicles/${definition.id}/vehicle_image.png`,
  }));

const BY_ID = new Map(TEMPLATES.map((template) => [template.id, template]));

export class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'UserError';
    this.status = status;
  }
}

export function getTemplate(id) {
  const template = BY_ID.get(id);
  if (!template) {
    throw new UserError(`未知车型模板：${id || '(空)'}`);
  }
  return template;
}

export function listTemplates() {
  return TEMPLATES.map((template) => ({
    id: template.id,
    name: template.name,
    variant: template.variant,
    series: template.series,
    year: template.year,
    body: template.body,
    short: template.short,
    supportsSplit: template.supportsSplit,
    vehicleUrl: template.vehicleUrl,
    sourceUrl: template.sourceUrl,
  }));
}

export async function readTemplateFile(id) {
  const template = getTemplate(id);
  try {
    return await fs.readFile(template.templatePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new UserError(`模板文件缺失：${template.templatePath}`, 500);
    }
    throw error;
  }
}
