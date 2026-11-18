import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { AssetStore, inspectImage } from './assets.mjs';
import { renderWrap } from './render.mjs';
import { getTemplateBundle } from './template-cache.mjs';
import { getTemplate, listTemplates, ROOT, UserError } from './templates.mjs';
import { publicViews, VIEW_IDS } from './views.mjs';

const VERSION = '1.2.0';
const DIST_DIR = path.join(ROOT, 'dist');
const STATIC_DIR = process.env.STATIC_DIR || DIST_DIR;
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const assets = new AssetStore();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function json(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function errorJson(res, error) {
  const status = error instanceof UserError ? error.status : 500;
  const message = error instanceof UserError ? error.message : '服务端处理失败';
  if (status >= 500) console.error(error);
  json(res, status, { ok: false, error: message });
}

async function readJson(req) {
  if (!req.headers['content-type']?.includes('application/json')) {
    throw new UserError('请求必须使用 application/json', 415);
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw new UserError('请求体超过 64 MB', 413);
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new UserError('请求 JSON 解析失败');
  }
}

function assertSvgSafe(svg) {
  const dangerous = [
    /<script\b/i,
    /<foreignObject\b/i,
    /\son\w+\s*=/i,
    /(?:xlink:)?href\s*=\s*["']\s*(?:https?:|\/\/|file:|javascript:)/i,
    /@import\s+(?:url\()?["']?\s*(?:https?:|\/\/|file:)/i,
    /url\(\s*["']?\s*(?:https?:|\/\/|file:)/i,
  ];
  if (dangerous.some((pattern) => pattern.test(svg))) {
    throw new UserError('SVG 包含外部引用或脚本，已拒绝处理');
  }
}

function decodeDataUrl(value) {
  if (typeof value !== 'string') throw new UserError('缺少图案数据');
  const match = value.match(/^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) throw new UserError('图案必须是 PNG / JPG / WebP / SVG 的 base64 Data URL');

  const mime = match[1];
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (buffer.length === 0) throw new UserError('图案数据为空');
  if (buffer.length > MAX_IMAGE_BYTES) throw new UserError('图案超过 20 MB');

  if (mime === 'image/svg+xml') {
    assertSvgSafe(buffer.toString('utf8'));
  }

  return { buffer, mime };
}

async function resolveImage(source, label) {
  if (source?.assetId) {
    const asset = assets.get(source.assetId);
    if (!asset) throw new UserError(`${label}资源已过期，请重新上传`);
    return asset.buffer;
  }
  if (source?.image) return decodeDataUrl(source.image).buffer;
  throw new UserError(`${label}缺少图片`);
}

function safeJoin(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new UserError('路径无效', 400);
  }
  const target = path.resolve(root, `.${decoded}`);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new UserError('路径越界', 403);
  }
  return target;
}

async function serveStatic(res, pathname, headOnly = false) {
  let filePath;
  const isSample = pathname.startsWith('/samples/');
  const isVehicle = pathname.startsWith('/assets/vehicles/');

  if (pathname === '/' || pathname === '/index.html') {
    filePath = path.join(STATIC_DIR, 'index.html');
  } else if (isSample || isVehicle) {
    filePath = safeJoin(ROOT, pathname);
  } else if (pathname === '/favicon.svg') {
    filePath = path.join(STATIC_DIR, 'favicon.svg');
  } else {
    filePath = safeJoin(STATIC_DIR, pathname);
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const hashedAsset = pathname.startsWith('/assets/') && !isVehicle;
    const cacheControl = isSample || isVehicle
      ? 'public, max-age=3600'
      : hashedAsset
        ? 'public, max-age=31536000, immutable'
        : ext === '.html'
          ? 'no-cache'
          : 'public, max-age=3600';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(headOnly ? undefined : data);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') {
      if (pathname === '/' || pathname === '/index.html') {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('前端尚未构建：请先执行 npm run build:web');
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    throw error;
  }
}

async function handleApi(req, res, pathname, searchParams) {
  if (req.method === 'GET' && pathname === '/api/health') {
    json(res, 200, { ok: true, tool: 'tesla-wrap-forge', version: VERSION });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/templates') {
    json(res, 200, { ok: true, templates: listTemplates(), views: publicViews() });
    return true;
  }

  const assetMatch = pathname.match(/^\/api\/templates\/([a-z0-9-]+)\/assets$/);
  if (req.method === 'GET' && assetMatch) {
    const template = await getTemplateBundle(assetMatch[1]);
    json(res, 200, {
      ok: true,
      template: {
        id: template.id,
        width: template.width,
        height: template.height,
        guide: template.guide,
        panelMap: template.panelMap,
        vehicleUrl: template.vehicleUrl,
      },
    });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/assets') {
    const body = await readJson(req);
    const { buffer, mime } = decodeDataUrl(body.image);
    const asset = assets.put(buffer, mime);
    const meta = await inspectImage(buffer);
    json(res, 200, {
      ok: true,
      assetId: asset.id,
      asset: { ...meta, bytes: buffer.length },
    });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/render') {
    const body = await readJson(req);
    if (!body.templateId) throw new UserError('缺少 templateId');
    getTemplate(body.templateId);

    const layers = {};
    if (body.layers && typeof body.layers === 'object') {
      for (const [id, layer] of Object.entries(body.layers)) {
        if (!VIEW_IDS.includes(id)) throw new UserError(`未知的车身面：${id}`);
        layers[id] = {
          buffer: await resolveImage(layer, `车身面 ${id} `),
          options: layer.options || {},
        };
      }
    }

    const hasLayers = Object.keys(layers).length > 0;
    if (!body.image && !body.assetId && !hasLayers) {
      throw new UserError('请上传整图，或至少一个分面图案');
    }
    const baseImage = hasLayers ? null : await resolveImage(body, '整图');
    const inputName = typeof body.inputName === 'string'
      ? body.inputName.slice(0, 120)
      : (hasLayers ? 'multiview' : 'upload');
    const preview = searchParams.get('preview') === '1';
    const startedAt = Date.now();
    const result = await renderWrap(baseImage, {
      templateId: body.templateId,
      options: body.options || {},
      inputName,
      layers: hasLayers ? layers : null,
      preview,
    });
    const renderMs = Date.now() - startedAt;
    json(res, 200, {
      ok: true,
      image: `data:image/png;base64,${result.buffer.toString('base64')}`,
      report: result.report,
      fileName: result.fileName,
      renderMs,
    });
    return true;
  }

  return false;
}

export function createServer() {
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'");

    try {
      const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      const pathname = url.pathname;

      if (pathname.startsWith('/api/')) {
        const handled = await handleApi(req, res, pathname, url.searchParams);
        if (!handled) json(res, 404, { ok: false, error: 'API 不存在' });
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        res.end();
        return;
      }

      await serveStatic(res, pathname, req.method === 'HEAD');
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      errorJson(res, error);
    }
  });
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const port = Number(process.env.PORT) || 4180;
  const host = process.env.HOST || '127.0.0.1';
  const server = createServer();
  server.listen(port, host, () => {
    console.log(`车衣文件工坊已启动：http://${host}:${port}`);
    console.log(`静态目录：${STATIC_DIR}`);
  });
}
