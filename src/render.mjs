import sharp from 'sharp';
import { composeArtwork } from './artwork.mjs';
import { composeLayers } from './layered.mjs';
import { makeFileName, suggestedBaseName } from './filename.mjs';
import { normalizeOptions } from './options.mjs';
import { readAlpha, tallyCoverage } from './panels.mjs';
import { getTemplateBundle } from './template-cache.mjs';
import { UserError } from './templates.mjs';

const TOOL_VERSION = '1.2.0';

async function maskToTemplate(artBuffer, templateBuffer) {
  return sharp(artBuffer)
    .ensureAlpha()
    .composite([{ input: templateBuffer, blend: 'dest-in' }])
    .png({ compressionLevel: 6 })
    .toBuffer();
}

function candidateScales(width, height, autoDownscale) {
  if (!autoDownscale) return [1];
  const scales = [1];
  for (const scale of [0.75, 0.5]) {
    if (Math.round(width * scale) >= 512 && Math.round(height * scale) >= 512) {
      scales.push(scale);
    }
  }
  return scales;
}

async function encodeCandidate(input, quality, dither, colours) {
  return sharp(input)
    .png({
      compressionLevel: 9,
      adaptiveFiltering: true,
      palette: true,
      quality,
      colours,
      dither,
      effort: 10,
    })
    .toBuffer();
}

async function encodePreview(maskedBuffer, width, height) {
  const size = 768;
  const buffer = await sharp(maskedBuffer)
    .resize({ width: size, height: size, fit: 'fill', kernel: 'lanczos3' })
    .png({
      compressionLevel: 1,
      adaptiveFiltering: false,
      palette: true,
      quality: 72,
      colours: 160,
      dither: 0,
      effort: 1,
    })
    .toBuffer();
  return { buffer, palette: false, colours: null, scale: 1 };
}

async function encodeForTesla(maskedBuffer, width, height, options) {
  const attempts = [];
  const scales = candidateScales(width, height, options.autoDownscale);

  for (const scale of scales) {
    const resized = scale === 1
      ? maskedBuffer
      : await sharp(maskedBuffer)
        .resize({
          width: Math.round(width * scale),
          height: Math.round(height * scale),
          fit: 'fill',
          kernel: 'lanczos3',
        })
        .png()
        .toBuffer();

    const lossless = await sharp(resized)
      .png({ compressionLevel: 9, adaptiveFiltering: true, effort: 10 })
      .toBuffer();
    attempts.push({ buffer: lossless, palette: false, colours: null, scale });
    if (lossless.length <= options.maxBytes) return attempts.at(-1);

    for (const [colours, quality] of [
      [256, options.quality],
      [192, Math.max(40, options.quality - 12)],
      [128, Math.max(35, options.quality - 24)],
    ]) {
      const buffer = await encodeCandidate(resized, quality, options.dither, colours);
      attempts.push({ buffer, palette: true, colours, scale });
      if (buffer.length <= options.maxBytes) return attempts.at(-1);
    }
  }

  const smallest = attempts.reduce((best, attempt) => (
    attempt.buffer.length < best.buffer.length ? attempt : best
  ));
  throw new UserError(
    `压缩后仍为 ${smallest.buffer.length} 字节，超过 ${options.maxBytes} 字节。请降低图案细节，或关闭 autoDownscale 前先手动缩小。`,
  );
}

function buildChecks({ metadata, bytes, maxBytes, tally, dimensionsValid }) {
  const checks = [];

  checks.push({
    id: 'dimensions',
    label: '尺寸 512–1024 px',
    status: dimensionsValid ? 'pass' : 'fail',
    detail: `${metadata.width} × ${metadata.height}`,
  });

  checks.push({
    id: 'alpha',
    label: '包含透明通道',
    status: metadata.hasAlpha ? 'pass' : 'fail',
    detail: metadata.hasAlpha ? 'RGBA / 模板外透明' : '缺少 alpha',
  });

  const sizeStatus = bytes > maxBytes ? 'fail' : bytes > maxBytes * 0.9 ? 'warn' : 'pass';
  checks.push({
    id: 'bytes',
    label: '文件 ≤ 1 MB',
    status: sizeStatus,
    detail: `${bytes.toLocaleString('en-US')} B`,
  });

  const coverageStatus = tally.coverage >= 0.98 ? 'pass' : tally.coverage >= 0.85 ? 'warn' : 'fail';
  checks.push({
    id: 'coverage',
    label: '模板区域覆盖',
    status: coverageStatus,
    detail: `${(tally.coverage * 100).toFixed(2)}%`,
  });

  const panelStatus = tally.minPanelFill >= 0.9 ? 'pass' : tally.minPanelFill >= 0.6 ? 'warn' : 'fail';
  checks.push({
    id: 'panels',
    label: '单板块最低覆盖',
    status: panelStatus,
    detail: `${(tally.minPanelFill * 100).toFixed(1)}%`,
  });

  return checks;
}

function overallStatus(checks) {
  if (checks.some((check) => check.status === 'fail')) return 'fail';
  if (checks.some((check) => check.status === 'warn')) return 'warn';
  return 'pass';
}

export async function renderWrap(inputBuffer, {
  templateId,
  options: rawOptions = {},
  inputName = '',
  layers = null,
  preview = false,
} = {}) {
  const splitMode = Boolean(layers && Object.keys(layers).length > 0);
  if (!splitMode && (!inputBuffer || inputBuffer.length === 0)) {
    throw new UserError('没有收到图案文件');
  }

  const options = normalizeOptions(rawOptions);
  const template = await getTemplateBundle(templateId);
  const composed = splitMode
    ? await composeLayers({
      baseBuffer: inputBuffer?.length ? inputBuffer : null,
      layers,
      template,
      options,
    })
    : await composeArtwork(inputBuffer, template.width, template.height, options);
  const masked = await maskToTemplate(composed.buffer, template.buffer);
  const encoded = preview
    ? await encodePreview(masked, template.width, template.height)
    : await encodeForTesla(masked, template.width, template.height, options);
  const metadata = await sharp(encoded.buffer).metadata();

  const outputAlpha = await readAlpha(encoded.buffer, metadata.width, metadata.height);
  const outputLabels = sampleLabels(template, metadata.width, metadata.height);
  const tally = tallyCoverage(outputAlpha, template, outputLabels, metadata.width, metadata.height);

  const dimensionsValid = metadata.width >= 512
    && metadata.height >= 512
    && metadata.width <= 1024
    && metadata.height <= 1024;

  const checks = buildChecks({
    metadata,
    bytes: encoded.buffer.length,
    maxBytes: options.maxBytes,
    tally,
    dimensionsValid,
  });
  if (preview) {
    const bytesCheck = checks.find((check) => check.id === 'bytes');
    if (bytesCheck) {
      bytesCheck.status = 'pass';
      bytesCheck.detail = '预览 / 导出时压缩';
    }
  }

  if (splitMode) {
    const required = ['left', 'right', 'hood', 'trunk'];
    const missing = required.filter((id) => !composed.views?.find((view) => view.id === id)?.provided);
    checks.push({
      id: 'views',
      label: '分面素材完整',
      status: missing.length ? 'warn' : 'pass',
      detail: missing.length ? `缺 ${missing.map((id) => ({ left: '左', right: '右', hood: '前盖', trunk: '后盖' }[id])).join('/')}` : '4 / 4 主面',
    });
  }

  const warnings = [...composed.warnings];
  if (tally.holes > 0 && options.background === 'transparent') {
    warnings.push('图案含透明区域，车机上会露出原车漆；需要满版时请把背景设为 auto 或颜色');
  }
  if (encoded.scale !== 1) {
    warnings.push(`为控制文件大小，输出已缩至 ${metadata.width} × ${metadata.height}`);
  }

  const fallbackName = suggestedBaseName(template, inputName.replace(/\.[^.]+$/, '') || 'wrap');
  const fileName = makeFileName(template, options.name || fallbackName);

  const report = {
    tool: 'tesla-wrap-forge',
    preview,
    version: TOOL_VERSION,
    generatedAt: new Date().toISOString(),
    status: overallStatus(checks),
    mode: splitMode ? 'layers' : 'single',
    template: {
      id: template.id,
      name: template.name,
      variant: template.variant,
      year: template.year,
      width: template.width,
      height: template.height,
      sourceUrl: template.sourceUrl,
    },
    input: {
      name: inputName || (splitMode ? 'multiview' : 'inline-image'),
      width: composed.source.width,
      height: composed.source.height,
      format: composed.source.format,
    },
    output: {
      fileName,
      width: metadata.width,
      height: metadata.height,
      bytes: encoded.buffer.length,
      maxBytes: options.maxBytes,
      hasAlpha: Boolean(metadata.hasAlpha),
      palette: encoded.palette,
      colours: encoded.colours,
      scale: encoded.scale,
    },
    settings: options,
    views: composed.views || null,
    checks,
    coverage: {
      ratio: Number(tally.coverage.toFixed(4)),
      opaqueRatio: Number(tally.opaqueCoverage.toFixed(4)),
      holes: tally.holes,
      maskPixels: tally.maskCount,
      minPanelFill: Number(tally.minPanelFill.toFixed(4)),
    },
    panels: tally.panels,
    warnings,
  };

  return { buffer: encoded.buffer, report, fileName };
}

function sampleLabels(template, width, height) {
  if (width === template.width && height === template.height) return template.labels;
  const labels = new Int32Array(width * height);
  const scaleX = template.width / width;
  const scaleY = template.height / height;
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(template.height - 1, Math.floor(y * scaleY));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(template.width - 1, Math.floor(x * scaleX));
      labels[y * width + x] = template.labels[sourceY * template.width + sourceX];
    }
  }
  return labels;
}

