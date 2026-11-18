import { UserError } from './templates.mjs';

/**
 * 官方模板是按车身展开的 UV 图集：
 * - 左侧车身在图片左侧，车头朝上；右侧车身在图片右侧，车头朝上
 * - 上方中央是前保险杠 / 前盖，下方中央是后盖 / 后保险杠
 * - 中间大面积留白是车顶玻璃，不属于可涂装区域
 *
 * 分面模式用归一化矩形把图集划成可独立供图的区域。
 * 这是视觉分区，不是精确的 3D 投影；最终以车机 3D 预览为准。
 */
export const VIEWS = [
  {
    id: 'frontBumper',
    label: '前保险杠',
    short: 'FRONT BUMPER',
    hint: '可选；图案上方 = 车头',
    zone: [0.30, 0.00, 0.40, 0.15],
    search: [0.20, 0.00, 0.60, 0.16],
    minArea: 5000,
    maxWidth: 0.70,
    kind: 'center',
    rotate: 0,
    optional: true,
  },
  {
    id: 'hood',
    label: '前盖',
    short: 'HOOD',
    hint: '引擎盖；图案上方 = 车头',
    zone: [0.30, 0.15, 0.40, 0.37],
    search: [0.30, 0.14, 0.40, 0.38],
    minArea: 2000,
    maxWidth: 0.55,
    kind: 'center',
    rotate: 0,
    optional: false,
  },
  {
    id: 'trunk',
    label: '后盖',
    short: 'TRUNK',
    hint: '尾门；图案上方 = 车尾',
    zone: [0.30, 0.52, 0.40, 0.24],
    search: [0.30, 0.52, 0.40, 0.30],
    minArea: 15000,
    maxWidth: 0.55,
    kind: 'center',
    rotate: 0,
    optional: false,
  },
  {
    id: 'rearBumper',
    label: '后保险杠',
    short: 'REAR BUMPER',
    hint: '可选；图案上方 = 车尾',
    zone: [0.30, 0.76, 0.40, 0.24],
    kind: 'rect',
    rotate: 0,
    optional: true,
  },
  {
    id: 'left',
    label: '左侧',
    short: 'LEFT SIDE',
    hint: '车头朝左；人物/文字保持正立',
    zone: [0.00, 0.00, 0.42, 1.00],
    kind: 'side',
    rotate: 90,
    optional: false,
  },
  {
    id: 'right',
    label: '右侧',
    short: 'RIGHT SIDE',
    hint: '车头朝右；人物/文字保持正立',
    zone: [0.58, 0.00, 0.42, 1.00],
    kind: 'side',
    rotate: -90,
    optional: false,
  },
];

export const VIEW_IDS = VIEWS.map((view) => view.id);

const UI_ORDER = ['left', 'right', 'hood', 'trunk', 'frontBumper', 'rearBumper'];

// 侧面色先铺，中央部件后盖，避免中央板块被侧视分区切掉。
export const COMPOSE_ORDER = ['left', 'right', 'frontBumper', 'hood', 'trunk', 'rearBumper'];

export function publicViews() {
  return VIEWS
    .slice()
    .sort((a, b) => UI_ORDER.indexOf(a.id) - UI_ORDER.indexOf(b.id))
    .map(({ id, label, short, hint, zone, rotate, optional, kind }) => ({
      id,
      label,
      short,
      hint,
      zone,
      rotate,
      optional,
      kind,
    }));
}

export function supportsSplit(template) {
  const count = Array.isArray(template.components)
    ? template.components.length
    : template.componentCount ?? 0;
  return template.split !== false && count >= 6;
}

export function zoneRect(view, width, height, overrideZone) {
  const [left, top, zoneWidth, zoneHeight] = overrideZone || view.zone;
  const x = Math.round(left * width);
  const y = Math.round(top * height);
  return {
    x,
    y,
    width: Math.max(1, Math.round(zoneWidth * width)),
    height: Math.max(1, Math.round(zoneHeight * height)),
  };
}

export function assertSplitAllowed(template) {
  if (!supportsSplit(template)) {
    throw new UserError(`${template.name} 的模板不是多板块图集，暂不支持分面模式；请用单图模式`);
  }
}
