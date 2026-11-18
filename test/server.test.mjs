import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { createServer } from '../src/server.mjs';

let server;
let baseUrl;

test.before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test('健康检查与模板列表', async () => {
  const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json());
  assert.equal(health.ok, true);
  const templates = await fetch(`${baseUrl}/api/templates`).then((response) => response.json());
  assert.equal(templates.templates.length, 12);
  assert.equal(templates.views.length, 6);
  assert.equal(templates.templates.filter((template) => template.supportsSplit).length, 8);
  assert.ok(templates.templates.some((template) => template.id === 'model3-2024-base'));
});

test('模板资源接口返回线稿与板块图', async () => {
  const response = await fetch(`${baseUrl}/api/templates/model3-2024-base/assets`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.template.width, 1024);
  assert.match(data.template.guide, /^data:image\/png;base64,/);
  assert.match(data.template.panelMap, /^data:image\/png;base64,/);
});

test('渲染接口返回标准 PNG 和报告', async () => {
  const art = await sharp({ create: { width: 800, height: 800, channels: 4, background: { r: 240, g: 90, b: 30 } } }).png().toBuffer();
  const response = await fetch(`${baseUrl}/api/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      templateId: 'model3-2024-base',
      image: `data:image/png;base64,${art.toString('base64')}`,
      inputName: 'api.png',
      options: { fit: 'cover' },
    }),
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.match(data.image, /^data:image\/png;base64,/);
  assert.equal(data.report.status, 'pass');
  assert.equal(data.report.output.width, 1024);
});

test('分面接口返回多面合成报告', async () => {
  const make = (color) => sharp({ create: { width: 1000, height: 600, channels: 4, background: color } }).png().toBuffer();
  const layers = {};
  for (const [id, color] of Object.entries({
    left: { r: 20, g: 70, b: 220 },
    right: { r: 240, g: 70, b: 20 },
    hood: { r: 10, g: 120, b: 70 },
    trunk: { r: 130, g: 70, b: 220 },
  })) {
    const buffer = await make(color);
    layers[id] = { image: `data:image/png;base64,${buffer.toString('base64')}`, options: { fit: 'cover' } };
  }
  const response = await fetch(`${baseUrl}/api/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      templateId: 'model3-2024-base',
      layers,
      options: { background: '#111614' },
      inputName: 'split',
    }),
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.report.mode, 'layers');
  assert.equal(data.report.status, 'pass');
  assert.equal(data.report.views.filter((view) => view.provided).length, 4);
  assert.match(data.image, /^data:image\/png;base64,/);
});

test('未校准车型的多面请求返回 400', async () => {
  const image = await sharp({ create: { width: 600, height: 400, channels: 4, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
  const response = await fetch(`${baseUrl}/api/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      templateId: 'cybertruck',
      layers: { left: { image: `data:image/png;base64,${image.toString('base64')}`, options: { fit: 'cover' } } },
    }),
  });
  assert.equal(response.status, 400);
});

test('无效模板、缺失图片与路径穿越都被拒绝', async () => {
  const badTemplate = await fetch(`${baseUrl}/api/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId: 'nope', image: 'data:image/png;base64,AA==' }),
  });
  assert.equal(badTemplate.status, 400);

  const missingImage = await fetch(`${baseUrl}/api/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId: 'model3-2024-base' }),
  });
  assert.equal(missingImage.status, 400);

  const traversal = await fetch(`${baseUrl}/assets/vehicles/../../.env.example`);
  assert.notEqual(traversal.status, 200);

  const templateFile = await fetch(`${baseUrl}/assets/templates/model3-2024-base/template.png`);
  assert.equal(templateFile.status, 404);
});

test('静态页面与示例文件可访问', async () => {
  const page = await fetch(`${baseUrl}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /车衣文件工坊/);
  const sample = await fetch(`${baseUrl}/samples/orbit-07.svg`);
  assert.equal(sample.status, 200);
});

test('资源缓存与 preview/export 分离', async () => {
  const art = await sharp({ create: { width: 900, height: 900, channels: 4, background: { r: 34, g: 80, b: 220 } } }).png().toBuffer();
  const uploaded = await fetch(`${baseUrl}/api/assets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: `data:image/png;base64,${art.toString('base64')}` }),
  }).then((response) => response.json());
  assert.match(uploaded.assetId, /^[a-f0-9]{32}$/);

  const preview = await fetch(`${baseUrl}/api/render?preview=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      templateId: 'model3-2024-base',
      assetId: uploaded.assetId,
      options: { fit: 'cover' },
    }),
  }).then((response) => response.json());
  assert.equal(preview.ok, true);
  assert.equal(preview.report.preview, true);
  assert.equal(preview.report.output.width, 768);
  assert.equal(preview.report.checks.find((check) => check.id === 'bytes').status, 'pass');

  const final = await fetch(`${baseUrl}/api/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      templateId: 'model3-2024-base',
      assetId: uploaded.assetId,
      options: { fit: 'cover' },
    }),
  }).then((response) => response.json());
  assert.equal(final.report.preview, false);
  assert.equal(final.report.output.width, 1024);
  assert.ok(final.report.output.bytes <= final.report.output.maxBytes);
});
