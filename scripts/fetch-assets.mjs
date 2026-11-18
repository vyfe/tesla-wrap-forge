#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { TEMPLATES } from '../src/templates.mjs';

const ROOT = path.resolve('.');
const RAW = 'https://raw.githubusercontent.com/teslamotors/custom-wraps/master';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function download(url, destination) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
        throw new Error('返回内容不是 PNG');
      }
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, buffer);
      return buffer.length;
    } catch (error) {
      if (attempt === 3) throw new Error(`${url}: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  return 0;
}

let downloaded = 0;
let skipped = 0;
for (const template of TEMPLATES) {
  const targets = [
    [`${RAW}/${template.id}/template.png`, path.join(ROOT, 'assets/templates', template.id, 'template.png')],
    [`${RAW}/${template.id}/vehicle_image.png`, path.join(ROOT, 'assets/vehicles', template.id, 'vehicle_image.png')],
  ];
  for (const [url, destination] of targets) {
    try {
      await fs.access(destination);
      skipped += 1;
      continue;
    } catch {
      // missing: download
    }
    await download(url, destination);
    downloaded += 1;
    console.log(`下载 ${path.relative(ROOT, destination)}`);
  }
}
console.log(`官方素材：下载 ${downloaded} 个，已存在 ${skipped} 个。`);
