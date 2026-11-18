import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { composeArtwork } from '../src/artwork.mjs';
import { makeFileName, sanitizeSegment, suggestedBaseName } from '../src/filename.mjs';
import { normalizeOptions } from '../src/options.mjs';
import { analyzeAlpha, readAlpha, tallyCoverage } from '../src/panels.mjs';
import { renderWrap } from '../src/render.mjs';
import { getTemplateBundle } from '../src/template-cache.mjs';
import { TEMPLATES, UserError } from '../src/templates.mjs';

async function solidArt(width = 1200, height = 1200, color = { r: 20, g: 50, b: 180 }) {
  return sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer();
}

test('官方模板与连通板块被正确加载', async () => {
  assert.equal(TEMPLATES.length, 12);
  const template = await getTemplateBundle('model3-2024-base');
  assert.equal(template.width, 1024);
  assert.equal(template.height, 1024);
  assert.equal(template.components.length, 16);
  assert.ok(template.maskCount > 400_000);
  assert.match(template.guide, /^data:image\/png;base64,/);
  assert.match(template.panelMap, /^data:image\/png;base64,/);
});

test('alpha 连通块分析与覆盖统计一致', async () => {
  const template = await getTemplateBundle('model3-2024-base');
  const alpha = await readAlpha(template.buffer, template.width, template.height);
  const analysis = analyzeAlpha(alpha, template.width, template.height);
  assert.equal(analysis.components.length, 16);
  assert.equal(analysis.maskCount, template.maskCount);
  const tally = tallyCoverage(alpha, template, template.labels, template.width, template.height);
  assert.equal(tally.coverage, 1);
  assert.equal(tally.minPanelFill, 1);
  assert.equal(tally.panels.length, 16);
});

test('满版渲染满足尺寸、透明通道、1 MB 与覆盖率要求', async () => {
  const { buffer, report, fileName } = await renderWrap(await solidArt(), {
    templateId: 'model3-2024-base',
    options: { fit: 'cover' },
    inputName: 'solid.png',
  });
  const metadata = await sharp(buffer).metadata();
  assert.equal(metadata.width, 1024);
  assert.equal(metadata.height, 1024);
  assert.equal(metadata.hasAlpha, true);
  assert.ok(buffer.length <= 1_000_000);
  assert.equal(report.status, 'pass');
  assert.equal(report.coverage.ratio, 1);
  assert.equal(report.coverage.minPanelFill, 1);
  assert.equal(fileName.length <= 30, true);
  assert.match(fileName, /^m3-2024_solid\.png$/);
  assert.equal(report.checks.every((check) => check.status === 'pass'), true);
});

test('透明留白会触发低覆盖并阻止通过', async () => {
  const { report } = await renderWrap(await solidArt(1400, 700), {
    templateId: 'model3-2024-base',
    options: { fit: 'contain', background: 'transparent' },
    inputName: 'wide.png',
  });
  assert.equal(report.status, 'fail');
  assert.ok(report.coverage.ratio < 0.7);
  assert.equal(report.checks.find((check) => check.id === 'coverage').status, 'fail');
  assert.ok(report.warnings.some((warning) => warning.includes('透明区域')));
});

test('Cybertruck 非方形模板输出 1024×768', async () => {
  const { buffer, report } = await renderWrap(await solidArt(1000, 700), {
    templateId: 'cybertruck',
    options: { fit: 'cover' },
    inputName: 'truck.png',
  });
  const metadata = await sharp(buffer).metadata();
  assert.equal(metadata.width, 1024);
  assert.equal(metadata.height, 768);
  assert.equal(report.status, 'pass');
});

test('平铺模式可用，旋转会被明确忽略', async () => {
  const { report } = await renderWrap(await solidArt(1000, 500), {
    templateId: 'model3-2024-base',
    options: { fit: 'tile', rotate: 25 },
    inputName: 'tile.png',
  });
  assert.equal(report.status, 'pass');
  assert.ok(report.warnings.includes('平铺模式不支持整图旋转，已忽略旋转'));
});

test('超大噪声图会被压缩到 1 MB 以内', async () => {
  const width = 900;
  const height = 900;
  const raw = Buffer.alloc(width * height * 3);
  for (let index = 0; index < raw.length; index += 1) raw[index] = Math.floor(Math.random() * 256);
  const noise = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
  const { buffer, report } = await renderWrap(noise, {
    templateId: 'model3-2024-base',
    options: { fit: 'cover', quality: 92 },
    inputName: 'noise.png',
  });
  assert.ok(buffer.length <= 1_000_000);
  assert.equal(report.output.width >= 512, true);
  assert.equal(report.output.height >= 512, true);
  assert.equal(report.checks.find((check) => check.id === 'bytes').status, 'pass');
});

test('超小上限会触发自动降采样且仍满足尺寸下限', async () => {
  const width = 620;
  const height = 620;
  const raw = Buffer.alloc(width * height * 3);
  for (let index = 0; index < raw.length; index += 1) raw[index] = Math.floor(Math.random() * 256);
  const noise = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
  const { buffer, report } = await renderWrap(noise, {
    templateId: 'model3-2024-base',
    options: { fit: 'cover', maxBytes: 120_000, quality: 80 },
    inputName: 'tiny-budget.png',
  });
  assert.ok(buffer.length <= 120_000);
  assert.equal(report.output.scale < 1, true);
  assert.equal(report.output.width >= 512, true);
  assert.equal(report.output.height >= 512, true);
  assert.ok(report.warnings.some((warning) => warning.includes('缩至')));
});

test('分面模式按车身面合成并保留左右/前后关系', async () => {
  const left = await solidArt(1600, 600, { r: 20, g: 70, b: 220 });
  const right = await solidArt(1600, 600, { r: 240, g: 70, b: 20 });
  const hood = await solidArt(1200, 800, { r: 10, g: 120, b: 70 });
  const trunk = await solidArt(1200, 800, { r: 130, g: 70, b: 220 });
  const { buffer, report } = await renderWrap(null, {
    templateId: 'model3-2024-base',
    layers: {
      left: { buffer: left, options: { fit: 'cover' } },
      right: { buffer: right, options: { fit: 'cover' } },
      hood: { buffer: hood, options: { fit: 'cover' } },
      trunk: { buffer: trunk, options: { fit: 'cover' } },
    },
    options: { background: '#111614' },
    inputName: 'split',
  });
  assert.equal(report.mode, 'layers');
  assert.equal(report.status, 'pass');
  assert.equal(report.views.filter((view) => view.provided).length, 4);
  assert.equal(report.views.find((view) => view.id === 'frontBumper').autoFilled, true);
  assert.equal(report.output.fileName, 'm3-2024_split.png');

  const template = await getTemplateBundle('model3-2024-base');
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const pixel = (x, y) => {
    const offset = (y * info.width + x) * 4;
    return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
  };
  const p05 = template.components.find((component) => component.id === 'P05');
  const p08 = template.components.find((component) => component.id === 'P08');
  const p04 = template.components.find((component) => component.id === 'P04');
  const p14 = template.components.find((component) => component.id === 'P14');
  const first = pixel(Math.round(p05.centroid.x), Math.round(p05.centroid.y));
  const second = pixel(Math.round(p08.centroid.x), Math.round(p08.centroid.y));
  const third = pixel(Math.round(p04.centroid.x), Math.round(p04.centroid.y));
  const fourth = pixel(Math.round(p14.centroid.x), Math.round(p14.centroid.y));
  assert.ok(first[2] > first[0] && first[3] > 0, '左侧应为蓝色');
  assert.ok(second[0] > second[2] && second[3] > 0, '右侧应为橙色');
  assert.ok(third[1] > third[0] && third[3] > 0, '前盖应为绿色');
  assert.ok(fourth[2] > fourth[1] && fourth[3] > 0, '后盖应为紫色');
});

test('分面缺主面时给出 WARN 而不是静默通过', async () => {
  const left = await solidArt(1200, 500, { r: 20, g: 70, b: 220 });
  const { report } = await renderWrap(null, {
    templateId: 'model3-2024-base',
    layers: { left: { buffer: left, options: { fit: 'cover' } } },
    options: { background: '#111614' },
    inputName: 'split',
  });
  assert.equal(report.status, 'warn');
  const check = report.checks.find((item) => item.id === 'views');
  assert.equal(check.status, 'warn');
  assert.match(check.detail, /缺/);
});

test('未校准车型拒绝分面模式', async () => {
  const image = await solidArt(800, 800);
  await assert.rejects(
    () => renderWrap(null, {
      templateId: 'models-2021',
      layers: { left: { buffer: image, options: { fit: 'cover' } } },
      options: { background: '#111' },
      inputName: 'split',
    }),
    UserError,
  );
});

test('文件名清洗与长度限制', () => {
  assert.equal(sanitizeSegment('My Tesla Wrap!'), 'my-tesla-wrap');
  assert.equal(sanitizeSegment('特斯拉'), '');
  assert.equal(makeFileName({ short: 'm3-2024' }, '特斯拉'), 'm3-2024_wrap.png');
  assert.equal(makeFileName({ short: 'm3-2024' }, 'a'.repeat(40)).length, 30);
  const base = suggestedBaseName({ short: 'm3-2024' }, 'Orbit 07.svg');
  assert.equal(base, 'm3-2024_orbit-07');
});

test('非法参数被拒绝', () => {
  assert.throws(() => normalizeOptions({ fit: 'unknown' }), UserError);
  assert.throws(() => normalizeOptions({ zoom: 10 }), UserError);
  assert.throws(() => normalizeOptions({ background: 'url(http://x)' }), UserError);
  assert.equal(normalizeOptions({ flipX: 'false' }).flipX, false);
});

test('composeArtwork 返回输入元信息', async () => {
  const result = await composeArtwork(await solidArt(1000, 500), 1024, 1024, normalizeOptions({ fit: 'cover' }));
  assert.equal(result.source.width, 1000);
  assert.equal(result.source.height, 500);
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(metadata.width, 1024);
  assert.equal(metadata.height, 1024);
});
