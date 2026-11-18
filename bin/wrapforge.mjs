#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { renderWrap } from '../src/render.mjs';
import { getTemplate, listTemplates, ROOT, TEMPLATES, UserError } from '../src/templates.mjs';

const HELP = `
tesla-wrap-forge / 车衣文件工坊

把任意图案确定性地加工成特斯拉官方车机涂装模板 PNG。

用法：
  wrapforge templates
  wrapforge render --template <id> --image <file> --out <file.png> [选项]
  wrapforge split  --template <id> --left <file> --right <file> --hood <file> --trunk <file> --out <file.png>
  wrapforge batch  --template <id> --input <目录> --out <目录> [选项]
  wrapforge batch  --manifest <jobs.json> --out <目录> [选项]
  wrapforge doctor

渲染选项：
  --fit cover|contain|stretch|tile   适配方式，默认 cover
  --zoom 1.2                         缩放，0.2–4
  --x 0 --y 0                        位移，-150–150（百分比）
  --rotate 0                         旋转，-180–180
  --flip-x --flip-y                  水平 / 垂直翻转
  --background auto|transparent|#hex 背景，默认 auto
  --quality 92                       调色板压缩质量，30–100
  --max-bytes 1000000                文件大小上限
  --name <文件名>                    自定义输出名（可省略 .png）
  --left/--right/--hood/--trunk     分面模式的车身面图片
  --front-bumper/--rear-bumper      可选的前后保险杠图片
  --no-auto-downscale                文件超限时不自动降到 768 / 512

示例：
  npm start
  node bin/wrapforge.mjs render -t model3-2024-base -i samples/orbit-07.svg -o samples/out/test.png
  node bin/wrapforge.mjs batch -t model3-2024-base -i samples -o samples/out --fit cover
  node bin/wrapforge.mjs split -t model3-2024-base --left left.png --right right.png --hood hood.png --trunk trunk.png -o split.png
`;

function optionsFromArgs(values) {
  return {
    fit: values.fit,
    zoom: values.zoom,
    offsetX: values.x,
    offsetY: values.y,
    rotate: values.rotate,
    flipX: values['flip-x'],
    flipY: values['flip-y'],
    background: values.background,
    quality: values.quality,
    maxBytes: values['max-bytes'],
    autoDownscale: values['no-auto-downscale'] ? false : undefined,
    name: values.name,
  };
}

function requireValue(values, key, label) {
  if (!values[key]) throw new UserError(`缺少 ${label}`);
  return values[key];
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function statusLabel(status) {
  return status === 'pass' ? 'PASS' : status === 'warn' ? 'WARN' : 'FAIL';
}

function printReport(report, outputPath) {
  console.log(`\n${statusLabel(report.status)}  ${report.output.fileName}`);
  console.log(`  车型      ${report.template.name} ${report.template.variant} (${report.template.year})`);
  console.log(`  尺寸      ${report.output.width} × ${report.output.height}`);
  console.log(`  文件      ${formatBytes(report.output.bytes)} / 上限 ${formatBytes(report.output.maxBytes)}`);
  console.log(`  覆盖率    ${(report.coverage.ratio * 100).toFixed(2)}%（最低板块 ${(report.coverage.minPanelFill * 100).toFixed(1)}%）`);
  console.log(`  压缩      ${report.output.palette ? `调色板 ${report.output.colours} 色` : '真彩 PNG'}`);
  if (report.mode === 'layers') {
    const used = report.views.filter((view) => view.provided).map((view) => view.label);
    console.log(`  分面      ${used.join(' / ')}`);
  }
  if (report.warnings.length) {
    for (const warning of report.warnings) console.log(`  提示      ${warning}`);
  }
  console.log(`  输出      ${outputPath}`);
}


async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function commandRender(values) {
  const templateId = requireValue(values, 'template', '--template');
  const imagePath = requireValue(values, 'image', '--image');
  const outputPath = requireValue(values, 'out', '--out');
  getTemplate(templateId);

  let input;
  try {
    input = await fs.readFile(imagePath);
  } catch (error) {
    if (error.code === 'ENOENT') throw new UserError(`图案不存在：${imagePath}`);
    throw error;
  }

  const result = await renderWrap(input, {
    templateId,
    options: optionsFromArgs(values),
    inputName: path.basename(imagePath),
  });

  await ensureDir(path.dirname(path.resolve(outputPath)));
  await fs.writeFile(outputPath, result.buffer);
  const reportPath = outputPath.replace(/\.png$/i, '') + '.json';
  await writeJson(reportPath, result.report);
  printReport(result.report, outputPath);
  if (result.report.status === 'fail') process.exitCode = 1;
}

async function listInputFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /\.(png|jpe?g|webp|svg)$/i.test(name))
    .filter((name) => !name.startsWith('.'))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    .map((name) => path.join(dir, name));
}

async function readManifest(manifestPath) {
  let jobs;
  try {
    jobs = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new UserError(`无法读取 manifest：${error.message}`);
  }
  if (!Array.isArray(jobs)) throw new UserError('manifest 必须是数组');
  return jobs;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function uniqueName(name, used) {
  let candidate = name;
  let counter = 2;
  while (used.has(candidate)) {
    const base = name.replace(/\.png$/i, '');
    const suffix = `-${counter}`;
    candidate = `${base.slice(0, 26 - suffix.length)}${suffix}.png`;
    counter += 1;
  }
  used.add(candidate);
  return candidate;
}

async function commandSplit(values) {
  const templateId = requireValue(values, 'template', '--template');
  const outputPath = requireValue(values, 'out', '--out');
  const template = getTemplate(templateId);
  if (!template.supportsSplit) throw new UserError(`${template.name} 暂未校准分面模式`);

  const mappings = {
    left: values.left,
    right: values.right,
    hood: values.hood,
    trunk: values.trunk,
    frontBumper: values['front-bumper'],
    rearBumper: values['rear-bumper'],
  };
  const layers = {};
  for (const [id, filePath] of Object.entries(mappings)) {
    if (!filePath) continue;
    let buffer;
    try {
      buffer = await fs.readFile(filePath);
    } catch (error) {
      if (error.code === 'ENOENT') throw new UserError(`图案不存在：${filePath}`);
      throw error;
    }
    layers[id] = { buffer, options: {} };
  }
  if (Object.keys(layers).length === 0) {
    throw new UserError('split 至少需要 --left / --right / --hood / --trunk 中的一个');
  }

  const result = await renderWrap(null, {
    templateId,
    layers,
    options: optionsFromArgs(values),
    inputName: 'split',
  });
  await ensureDir(path.dirname(path.resolve(outputPath)));
  await fs.writeFile(outputPath, result.buffer);
  const reportPath = outputPath.replace(/\.png$/i, '') + '.json';
  await writeJson(reportPath, result.report);
  printReport(result.report, outputPath);
  if (result.report.status === 'fail') process.exitCode = 1;
}

async function commandBatch(values) {
  const outDir = requireValue(values, 'out', '--out');
  const manifestPath = values.manifest;
  // render 用 -i 指图片，batch 里 -i 也可以作为输入目录的简写。
  const inputDir = values.input || (values.manifest ? undefined : values.image);
  if (!manifestPath && !inputDir) throw new UserError('batch 需要 --input <目录> 或 --manifest <jobs.json>');

  let jobs;
  if (manifestPath) {
    const manifestJobs = await readManifest(path.resolve(manifestPath));
    const baseDir = path.dirname(path.resolve(manifestPath));
    jobs = manifestJobs.map((job) => ({
      ...job,
      image: path.resolve(baseDir, job.image),
    }));
  } else {
    const files = await listInputFiles(path.resolve(inputDir));
    if (files.length === 0) throw new UserError('目录里没有 PNG / JPG / WebP / SVG');
    jobs = files.map((file) => ({ image: file }));
  }

  const globalTemplate = values.template;
  // batch --input 模式必须有模板；manifest 允许每项单独指定。
  if (!manifestPath && !globalTemplate) throw new UserError('batch --input 模式需要 --template');
  if (globalTemplate) getTemplate(globalTemplate);

  const concurrency = Math.max(1, Math.min(8, Number(values.concurrency) || 2));
  await ensureDir(outDir);
  const usedNames = new Set();
  let passed = 0;
  let warned = 0;
  let failed = 0;
  let errored = 0;

  const results = await mapLimit(jobs, concurrency, async (job, index) => {
    const templateId = job.template || globalTemplate;
    const label = path.basename(job.image);
    try {
      if (!templateId) throw new UserError('没有指定车型模板');
      getTemplate(templateId);
      const input = await fs.readFile(job.image);
      const options = {
        ...optionsFromArgs(values),
        ...(job.options || {}),
        name: job.name || job.options?.name || '',
      };
      const result = await renderWrap(input, {
        templateId,
        options,
        inputName: label,
      });
      const fileName = uniqueName(result.fileName, usedNames);
      const outputPath = path.join(outDir, fileName);
      await fs.writeFile(outputPath, result.buffer);
      const reportPath = path.join(outDir, fileName.replace(/\.png$/i, '') + '.json');
      await writeJson(reportPath, { ...result.report, output: { ...result.report.output, fileName } });
      if (result.report.status === 'pass') passed += 1;
      else if (result.report.status === 'warn') warned += 1;
      else failed += 1;
      console.log(`${statusLabel(result.report.status)}  ${String(index + 1).padStart(3, '0')}  ${label} → ${fileName}`);
      return {
        status: result.report.status,
        input: label,
        fileName,
        reportPath,
        bytes: result.buffer.length,
      };
    } catch (error) {
      errored += 1;
      console.error(`FAIL  ${String(index + 1).padStart(3, '0')}  ${label}：${error.message}`);
      return { status: 'error', input: label, error: error.message };
    }
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    total: jobs.length,
    pass: passed,
    warn: warned,
    fail: failed,
    error: errored,
    outputDir: path.resolve(outDir),
    results,
  };
  await writeJson(path.join(outDir, 'summary.json'), summary);

  console.log(`\n完成：${jobs.length} 张 · PASS ${passed} · WARN ${warned} · FAIL ${failed} · ERROR ${errored}`);
  console.log(`汇总：${path.join(outDir, 'summary.json')}`);
  if (failed || errored) process.exitCode = 1;
}

async function commandTemplates() {
  const rows = await Promise.all(listTemplates().map(async (template) => {
    const meta = await sharp(TEMPLATES.find((item) => item.id === template.id).templatePath).metadata();
    return {
      id: template.id,
      name: `${template.name} ${template.variant}`,
      year: template.year,
      size: `${meta.width}×${meta.height}`,
    };
  }));
  const idWidth = Math.max(...rows.map((row) => row.id.length));
  const nameWidth = Math.max(...rows.map((row) => row.name.length));
  for (const row of rows) {
    console.log(`${row.id.padEnd(idWidth)}  ${row.name.padEnd(nameWidth)}  ${row.year.padEnd(9)}  ${row.size}`);
  }
}

async function commandDoctor() {
  const checks = [];
  checks.push(['Node.js', process.version]);
  checks.push(['sharp', sharp.versions.sharp]);
  checks.push(['libvips', sharp.versions.vips]);

  let missing = 0;
  for (const template of TEMPLATES) {
    try {
      await fs.access(template.templatePath);
    } catch {
      missing += 1;
    }
  }
  checks.push(['模板', `${TEMPLATES.length} 个，缺失 ${missing} 个`]);

  const samplePath = path.join(ROOT, 'samples', 'orbit-07.svg');
  try {
    const input = await fs.readFile(samplePath);
    const result = await renderWrap(input, {
      templateId: 'model3-2024-base',
      options: { fit: 'cover', quality: 90 },
      inputName: 'orbit-07.svg',
    });
    checks.push(['冒烟渲染', `${result.report.output.width}×${result.report.output.height} / ${formatBytes(result.report.output.bytes)} / ${result.report.status}`]);
    if (result.report.status === 'fail') process.exitCode = 1;
  } catch (error) {
    checks.push(['冒烟渲染', `失败：${error.message}`]);
    process.exitCode = 1;
  }

  for (const [label, value] of checks) console.log(`${label.padEnd(12)} ${value}`);
  if (missing > 0) process.exitCode = 1;
  if (!process.exitCode) console.log('\n环境正常。');
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      template: { type: 'string', short: 't' },
      image: { type: 'string', short: 'i' },
      out: { type: 'string', short: 'o' },
      input: { type: 'string' },
      manifest: { type: 'string' },
      left: { type: 'string' },
      right: { type: 'string' },
      hood: { type: 'string' },
      trunk: { type: 'string' },
      'front-bumper': { type: 'string' },
      'rear-bumper': { type: 'string' },
      concurrency: { type: 'string' },
      fit: { type: 'string' },
      zoom: { type: 'string' },
      x: { type: 'string' },
      y: { type: 'string' },
      rotate: { type: 'string' },
      'flip-x': { type: 'boolean' },
      'flip-y': { type: 'boolean' },
      background: { type: 'string' },
      quality: { type: 'string' },
      'max-bytes': { type: 'string' },
      'no-auto-downscale': { type: 'boolean' },
      name: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help || positionals.length === 0) {
    console.log(HELP.trim());
    return;
  }

  const command = positionals[0];
  if (command === 'templates') return commandTemplates();
  if (command === 'render') return commandRender(values);
  if (command === 'split') return commandSplit(values);
  if (command === 'batch') return commandBatch(values);
  if (command === 'doctor') return commandDoctor();
  throw new UserError(`未知命令：${command}\n\n${HELP.trim()}`);
}

main().catch((error) => {
  console.error(`\n错误：${error.message}`);
  if (process.env.DEBUG && error.stack) console.error(error.stack);
  process.exitCode = 1;
});
