import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { renderWrap } from '../src/render.mjs';
import { ROOT } from '../src/templates.mjs';

const OUT_DIR = path.join(ROOT, 'samples', 'out');
const SPLIT_DIR = path.join(ROOT, 'samples', 'split');

const JOBS = [
  {
    input: 'samples/orbit-07.svg',
    templateId: 'model3-2024-base',
    name: 'm3-2024_orbit-07',
    options: { fit: 'cover', background: 'auto', quality: 92 },
  },
  {
    input: 'samples/signal-flora.svg',
    templateId: 'cybertruck',
    name: 'ct_signal-flora',
    options: { fit: 'cover', background: 'auto', quality: 92 },
  },
  {
    input: 'samples/signal-flora.svg',
    templateId: 'modely-2025-premium',
    name: 'my-2025_signal-flora',
    options: { fit: 'cover', background: 'auto', quality: 92 },
  },
];

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function makeProofSheet(results) {
  const width = 1600;
  const height = 1000;
  const panelWidth = 700;
  const panelHeight = 620;
  const panels = [
    { x: 60, y: 152, result: results[0] },
    { x: 840, y: 152, result: results[1] },
  ];

  const layers = [];
  for (const panel of panels) {
    const texture = await sharp(panel.result.buffer)
      .resize({ width: 580, height: 560, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const meta = await sharp(texture).metadata();
    layers.push({
      input: texture,
      left: panel.x + Math.round((panelWidth - meta.width) / 2),
      top: panel.y + Math.round((panelHeight - meta.height) / 2),
    });
  }

  const text = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <pattern id="check" width="22" height="22" patternUnits="userSpaceOnUse">
          <rect width="22" height="22" fill="#f4f2e9"/>
          <rect width="11" height="11" fill="#dedbd0"/>
          <rect x="11" y="11" width="11" height="11" fill="#dedbd0"/>
        </pattern>
      </defs>
      <rect width="${width}" height="${height}" fill="#e8e6dc"/>
      <g stroke="#131613" stroke-opacity=".06">
        ${Array.from({ length: 24 }, (_, index) => `<path d="M${index * 64 + 32} 0V${height}"/>`).join('')}
        ${Array.from({ length: 15 }, (_, index) => `<path d="M0 ${index * 64 + 32}H${width}"/>`).join('')}
      </g>
      <text x="60" y="58" font-family="Arial, Helvetica, sans-serif" font-size="13" letter-spacing="6" fill="#6c746d">WRAP FORGE / SAMPLE PROOF</text>
      <text x="60" y="108" font-family="Arial Narrow, Arial, sans-serif" font-size="46" font-weight="700" letter-spacing="1" fill="#131613">TESLA WRAP FILE / 车机涂装文件</text>
      <text x="1540" y="58" text-anchor="end" font-family="Menlo, monospace" font-size="12" letter-spacing="2" fill="#6c746d">WF 1.0.0 / 2026</text>
      <path d="M60 128H1540" stroke="#131613" stroke-width="2"/>
      ${panels.map((panel) => `
        <rect x="${panel.x}" y="${panel.y}" width="${panelWidth}" height="${panelHeight}" fill="url(#check)"/>
        <rect x="${panel.x}" y="${panel.y}" width="${panelWidth}" height="${panelHeight}" fill="none" stroke="#131613" stroke-opacity=".30"/>
        <path d="M${panel.x + 12} ${panel.y + 12}h22M${panel.x + 12} ${panel.y + 12}v22" stroke="#ff4d00" stroke-width="2" fill="none"/>
        <path d="M${panel.x + panelWidth - 12} ${panel.y + 12}h-22M${panel.x + panelWidth - 12} ${panel.y + 12}v22" stroke="#ff4d00" stroke-width="2" fill="none"/>
        <path d="M${panel.x + 12} ${panel.y + panelHeight - 12}h22M${panel.x + 12} ${panel.y + panelHeight - 12}v-22" stroke="#ff4d00" stroke-width="2" fill="none"/>
        <path d="M${panel.x + panelWidth - 12} ${panel.y + panelHeight - 12}h-22M${panel.x + panelWidth - 12} ${panel.y + panelHeight - 12}v-22" stroke="#ff4d00" stroke-width="2" fill="none"/>
      `).join('')}
      ${panels.map((panel, index) => {
        const report = panel.result.report;
        const labelY = 810;
        return `
          <text x="${panel.x}" y="${labelY}" font-family="Menlo, monospace" font-size="11" letter-spacing="2" fill="#6c746d">0${index + 1} / ${escapeXml(report.template.id.toUpperCase())}</text>
          <text x="${panel.x}" y="${labelY + 32}" font-family="Arial Narrow, Arial, sans-serif" font-size="26" font-weight="700" fill="#131613">${escapeXml(report.template.name)} ${escapeXml(report.template.variant)}</text>
          <text x="${panel.x}" y="${labelY + 54}" font-family="Menlo, monospace" font-size="11" fill="#3b423d">${report.output.width} × ${report.output.height} px · ${(report.output.bytes / 1024).toFixed(1)} KB · ${report.status.toUpperCase()}</text>
          <text x="${panel.x}" y="${labelY + 76}" font-family="Menlo, monospace" font-size="10" fill="#6c746d">PANEL COVERAGE ${(report.coverage.minPanelFill * 100).toFixed(1)}% / ${report.panels.length} PANELS</text>
        `;
      }).join('')}
      <path d="M60 930H1540" stroke="#131613" stroke-opacity=".35"/>
      <text x="60" y="958" font-family="Menlo, monospace" font-size="10" letter-spacing="1" fill="#6c746d">DETERMINISTIC MASK / NO GENERATIVE RETOUCH · CHECKER = TRANSPARENT / NO FILM</text>
      <text x="1540" y="958" text-anchor="end" font-family="Menlo, monospace" font-size="10" letter-spacing="1" fill="#b6251b">FOR IN-CAR 3D WRAP ONLY · NOT A PRINT FILE</text>
    </svg>
  `;

  return sharp(Buffer.from(text))
    .composite(layers)
    .png()
    .toBuffer();
}

await fs.mkdir(OUT_DIR, { recursive: true });
await fs.mkdir(SPLIT_DIR, { recursive: true });

// 分面示例：从一张原创图案裁出左/右/前盖/后盖四个视角，右侧做镜像。
const splitSource = await sharp(path.join(ROOT, 'samples', 'signal-flora.svg'), { density: 120 })
  .resize(1600, 1600, { fit: 'fill' })
  .png()
  .toBuffer();
const splitFiles = {
  left: { left: 0, top: 560, width: 1600, height: 600 },
  right: { left: 0, top: 560, width: 1600, height: 600 },
  hood: { left: 200, top: 250, width: 1200, height: 800 },
  trunk: { left: 200, top: 760, width: 1200, height: 800 },
  frontBumper: { left: 100, top: 600, width: 1400, height: 430 },
  rearBumper: { left: 100, top: 1060, width: 1400, height: 430 },
};
for (const [id, crop] of Object.entries(splitFiles)) {
  let image = sharp(splitSource).extract(crop);
  if (id === 'right') image = image.flop();
  await image.png().toFile(path.join(SPLIT_DIR, `${id}.png`));
}

const results = [];

for (const job of JOBS) {
  const input = await fs.readFile(path.join(ROOT, job.input));
  const result = await renderWrap(input, {
    templateId: job.templateId,
    options: { ...job.options, name: job.name },
    inputName: path.basename(job.input),
  });
  const pngPath = path.join(OUT_DIR, result.fileName);
  const reportPath = pngPath.replace(/\.png$/i, '.json');
  await fs.writeFile(pngPath, result.buffer);
  await fs.writeFile(reportPath, `${JSON.stringify(result.report, null, 2)}\n`);
  results.push(result);
  console.log(`${result.report.status.toUpperCase()}  ${path.relative(ROOT, pngPath)}  ${(result.buffer.length / 1024).toFixed(1)} KB`);
}

const splitLayers = {};
for (const id of ['left', 'right', 'hood', 'trunk', 'frontBumper', 'rearBumper']) {
  splitLayers[id] = {
    buffer: await fs.readFile(path.join(SPLIT_DIR, `${id}.png`)),
    options: { fit: 'cover' },
  };
}
const splitResult = await renderWrap(null, {
  templateId: 'model3-2024-base',
  layers: splitLayers,
  options: { background: '#121614', name: 'm3-2024_split-sample' },
  inputName: 'split-sample',
});
const splitPath = path.join(OUT_DIR, splitResult.fileName);
await fs.writeFile(splitPath, splitResult.buffer);
await fs.writeFile(splitPath.replace(/\.png$/i, '.json'), `${JSON.stringify(splitResult.report, null, 2)}\n`);
results.push(splitResult);
console.log(`${splitResult.report.status.toUpperCase()}  ${path.relative(ROOT, splitPath)}  ${(splitResult.buffer.length / 1024).toFixed(1)} KB  split`);

const summary = {
  generatedAt: new Date().toISOString(),
  outputs: results.map((result) => ({
    fileName: result.fileName,
    template: result.report.template,
    output: result.report.output,
    status: result.report.status,
    coverage: result.report.coverage,
  })),
};
await fs.writeFile(path.join(OUT_DIR, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

const proof = await makeProofSheet(results);
await fs.writeFile(path.join(OUT_DIR, 'proof-sheet.png'), proof);
console.log(`PASS  samples/out/proof-sheet.png  ${(proof.length / 1024).toFixed(1)} KB`);
