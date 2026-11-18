const BASE = import.meta.env?.BASE_URL || '/';
const API_ROOT = BASE.replace(/\/+$/, '');
const API_BASE = `${API_ROOT}/api`;
const assetUrl = (value) => {
  if (/^(?:data:|blob:|https?:)/.test(String(value))) return value;
  return `${BASE}${String(value).replace(/^\/+/, '')}`;
};

const DEFAULT_LAYER_OPTIONS = Object.freeze({
  fit: 'cover',
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  rotate: 0,
  flipX: false,
  flipY: false,
});

const state = {
  templates: [],
  views: [],
  templateId: '',
  template: null,
  assets: null,
  mode: 'single',
  image: null,
  layers: {},
  activeView: 'left',
  uploadTarget: null,
  report: null,
  previewDataUrl: '',
  fileNameTouched: false,
  guideVisible: false,
  checkerVisible: true,
  zoneVisible: true,
  options: {
    ...DEFAULT_LAYER_OPTIONS,
    background: 'auto',
    quality: 92,
    autoDownscale: true,
  },
  rendering: false,
  exporting: false,
  errorMessage: '',
  requestSeq: 0,
  controller: null,
  debounceTimer: null,
  toastTimer: null,
  templateSeq: 0,
  layerCards: new Map(),
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const els = {
  templateSelect: $('#templateSelect'),
  modelName: $('#modelName'),
  modelVariant: $('#modelVariant'),
  vehicleImage: $('#vehicleImage'),
  sourceLink: $('#sourceLink'),
  stageTitle: $('#stageTitle'),
  stageState: $('#stageState'),
  topStatus: $('#topStatus'),
  jobNo: $('#jobNo'),
  modeSwitch: $('#modeSwitch'),
  modeBadge: $('#modeBadge'),
  modeNote: $('#modeNote'),
  singleTools: $('#singleTools'),
  layerTools: $('#layerTools'),
  layerGrid: $('#layerGrid'),
  layerContext: $('#layerContext'),
  activeLayerLabel: $('#activeLayerLabel'),
  dropzone: $('#dropzone'),
  fileInput: $('#fileInput'),
  fileRow: $('#fileRow'),
  fileThumb: $('#fileThumb'),
  fileName: $('#fileName'),
  fileMeta: $('#fileMeta'),
  removeFile: $('#removeFile'),
  mirrorSides: $('#mirrorSides'),
  splitSample: $('#splitSample'),
  clearLayers: $('#clearLayers'),
  preview: $('#preview'),
  guideOverlay: $('#guideOverlay'),
  viewOutline: $('#viewOutline'),
  viewOutlineLabel: $('#viewOutlineLabel'),
  panelMap: $('#panelMap'),
  emptyState: $('#emptyState'),
  artboard: $('#artboard'),
  stage: $('#stage'),
  readoutSize: $('#readoutSize'),
  readoutMode: $('#readoutMode'),
  readoutZoom: $('#readoutZoom'),
  zoom: $('#zoom'),
  zoomOut: $('#zoomOut'),
  offsetX: $('#offsetX'),
  xOut: $('#xOut'),
  offsetY: $('#offsetY'),
  yOut: $('#yOut'),
  rotate: $('#rotate'),
  rotateOut: $('#rotateOut'),
  flipX: $('#flipX'),
  flipY: $('#flipY'),
  background: $('#background'),
  customColor: $('#customColor'),
  quality: $('#quality'),
  qualityOut: $('#qualityOut'),
  autoDownscale: $('#autoDownscale'),
  resetComposition: $('#resetComposition'),
  filename: $('#filename'),
  filenameHelp: $('#filenameHelp'),
  download: $('#download'),
  downloadReport: $('#downloadReport'),
  guideToggle: $('#guideToggle'),
  checkerToggle: $('#checkerToggle'),
  zoneToggle: $('#zoneToggle'),
  sampleButton: $('#sampleButton'),
  renderTime: $('#renderTime'),
  stamp: $('#stamp'),
  stampText: $('#stampText'),
  stampSub: $('#stampSub'),
  specSize: $('#specSize'),
  specBytes: $('#specBytes'),
  specCoverage: $('#specCoverage'),
  checks: $('#checks'),
  warnings: $('#warnings'),
  panelCount: $('#panelCount'),
  toast: $('#toast'),
  scopeDialog: $('#scopeDialog'),
  scopeButton: $('#scopeButton'),
};

const fitControl = $('#fitControl');
const advanced = $('.advanced');

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function cloneLayerOptions() {
  return { ...DEFAULT_LAYER_OPTIONS };
}

function sanitizeBase(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/[-_]{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 26)
    .replace(/[-_]+$/g, '');
}

function suggestedName(template, fileName) {
  const base = String(fileName ?? '').replace(/\.[^.]+$/, '');
  const design = sanitizeBase(base) || 'wrap';
  return sanitizeBase(`${template.short}_${design}`) || `${template.short}_wrap`;
}

function setJobNumber() {
  const now = new Date();
  const stamp = [
    String(now.getFullYear()).slice(2),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');
  els.jobNo.textContent = `WF-${stamp}-${String(Math.floor(Math.random() * 90) + 10)}`;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('is-visible');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), 3800);
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

function currentView() {
  return state.views.find((view) => view.id === state.activeView) || null;
}

function hasAnyLayer() {
  return Object.values(state.layers).some(Boolean);
}

function currentLayer() {
  return state.layers[state.activeView] || null;
}

function currentOptions() {
  if (state.mode === 'layers') {
    return currentLayer()?.options || DEFAULT_LAYER_OPTIONS;
  }
  return state.options;
}

function updateStatus() {
  const top = els.topStatus;
  const stage = els.stageState;
  top.classList.remove('is-rendering', 'is-error');
  stage.classList.remove('is-rendering', 'is-error');
  els.stage.classList.toggle('is-rendering', state.rendering);

  if (state.rendering) {
    top.classList.add('is-rendering');
    stage.classList.add('is-rendering');
    top.querySelector('span').textContent = '渲染中';
    stage.querySelector('span').textContent = 'RENDERING';
    return;
  }

  if (state.errorMessage) {
    top.classList.add('is-error');
    stage.classList.add('is-error');
    top.querySelector('span').textContent = '处理失败';
    stage.querySelector('span').textContent = 'ERROR';
    return;
  }

  const status = state.report?.status;
  if (status === 'pass') {
    top.querySelector('span').textContent = '已生成';
    stage.querySelector('span').textContent = 'READY';
  } else if (status === 'warn') {
    top.querySelector('span').textContent = '需检查';
    stage.querySelector('span').textContent = 'REVIEW';
  } else if (status === 'fail') {
    top.classList.add('is-error');
    stage.querySelector('span').textContent = 'HOLD';
    top.querySelector('span').textContent = '未通过';
  } else {
    top.querySelector('span').textContent = '准备就绪';
    stage.querySelector('span').textContent = 'READY';
  }
}

function invalidateInFlight() {
  state.requestSeq += 1;
  if (state.controller) {
    state.controller.abort();
    state.controller = null;
  }
  state.rendering = false;
  updateStatus();
}

function setRendering(value) {
  state.rendering = value;
  if (value) {
    state.errorMessage = '';
    els.artboard.classList.remove('is-stale');
  }
  updateStatus();
}

function markRenderFailure(message) {
  state.report = null;
  state.previewDataUrl = '';
  els.download.disabled = true;
  els.downloadReport.disabled = true;
  els.stamp.dataset.status = 'fail';
  els.stampText.textContent = '渲染失败';
  els.stampSub.textContent = message.length > 42 ? `${message.slice(0, 42)}…` : message;
  els.artboard.classList.add('is-stale');
}

function updateReadout() {
  const options = currentOptions();
  els.readoutMode.textContent = state.mode === 'layers'
    ? `${(currentView()?.short || 'LAYER').replace(' SIDE', '')} / ${options.fit.toUpperCase()}`
    : options.fit.toUpperCase();
  els.readoutZoom.textContent = `${Math.round(options.zoom * 100)}%`;
  els.zoomOut.textContent = `${Math.round(options.zoom * 100)}%`;
  els.xOut.textContent = `${options.offsetX > 0 ? '+' : ''}${options.offsetX}`;
  els.yOut.textContent = `${options.offsetY > 0 ? '+' : ''}${options.offsetY}`;
  els.rotateOut.textContent = `${options.rotate}°`;
  els.qualityOut.textContent = String(state.options.quality);
}

function setControlsDisabled(disabled) {
  const controls = [
    els.zoom,
    els.offsetX,
    els.offsetY,
    els.rotate,
    els.flipX,
    els.flipY,
    els.resetComposition,
    ...$$('#fitControl button'),
  ];
  for (const control of controls) control.disabled = disabled;
  if (disabled) els.rotate.disabled = true;

  for (const element of [fitControl, els.zoom, els.offsetX, els.offsetY, els.rotate, els.flipX, els.flipY]) {
    element.closest('.control')?.classList.toggle('is-disabled', disabled);
  }
}

function updateControls() {
  const options = currentOptions();
  const disabled = state.mode === 'layers' && !currentLayer();

  els.zoom.value = String(Math.round(options.zoom * 100));
  els.offsetX.value = String(options.offsetX);
  els.offsetY.value = String(options.offsetY);
  els.rotate.value = String(options.rotate);
  els.quality.value = String(state.options.quality);
  els.flipX.setAttribute('aria-pressed', String(options.flipX));
  els.flipY.setAttribute('aria-pressed', String(options.flipY));
  els.autoDownscale.checked = state.options.autoDownscale;

  setControlsDisabled(disabled);
  if (!disabled) els.rotate.disabled = options.fit === 'tile';
  els.rotate.closest('.control')?.classList.toggle('is-disabled', disabled || options.fit === 'tile');

  if (state.options.background === 'auto' || state.options.background === 'transparent'
    || state.options.background === '#0b1b2b' || state.options.background === '#f4eee2') {
    els.background.value = state.options.background;
    els.customColor.hidden = true;
  } else {
    els.background.value = 'custom';
    els.customColor.hidden = false;
    els.customColor.value = state.options.background;
  }

  $$('#fitControl button').forEach((button) => {
    button.classList.toggle('active', button.dataset.fit === options.fit);
  });

  els.layerContext.hidden = state.mode !== 'layers';
  els.activeLayerLabel.textContent = currentView()?.label || '—';
  updateReadout();
  updateViewOutline();
}

function updateModeUI() {
  const supportsSplit = Boolean(state.template?.supportsSplit && state.views.length > 0);
  $$('#modeSwitch button').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === state.mode);
    if (button.dataset.mode === 'layers') {
      button.disabled = !supportsSplit;
      button.title = supportsSplit ? '按车身面分别供图' : '该车型模板暂未校准分面模式';
    }
  });

  els.singleTools.hidden = state.mode !== 'single';
  els.layerTools.hidden = state.mode !== 'layers';
  els.layerContext.hidden = state.mode !== 'layers';
  els.zoneToggle.hidden = state.mode !== 'layers';
  els.modeBadge.textContent = state.mode === 'layers' ? 'SPLIT' : 'WHOLE';
  els.modeNote.textContent = state.mode === 'layers'
    ? '左右侧、前盖、后盖分别供图；可选前后保险杠。每个面独立构图。'
    : '一张整图套整个 UV 图集；适合抽象、迷彩、满版纹理。';
  els.sampleButton.textContent = state.mode === 'layers' ? '载入分面示例' : '换回示例';
  if (state.mode !== 'layers') {
    els.viewOutline.hidden = true;
  }
}

function setTemplateMeta(template) {
  els.modelName.textContent = template.name;
  els.modelVariant.textContent = `${template.year} · ${template.variant} · ${template.body}`;
  els.vehicleImage.src = assetUrl(template.vehicleUrl);
  els.vehicleImage.alt = `${template.name} ${template.variant}`;
  els.sourceLink.href = template.sourceUrl;
  els.stageTitle.textContent = `${template.series.toUpperCase()} / ${template.year} / ${template.variant.toUpperCase()}`;
}

async function selectTemplate(id, { render = true } = {}) {
  const template = state.templates.find((item) => item.id === id);
  if (!template) return;

  invalidateInFlight();
  const seq = ++state.templateSeq;
  state.templateId = id;
  state.template = template;
  els.templateSelect.value = id;
  setTemplateMeta(template);
  updateModeUI();

  if (state.mode === 'layers' && !template.supportsSplit) {
    state.mode = 'single';
    showToast(`${template.name} 暂未校准分面，已切回单图模式`);
    updateModeUI();
    updateControls();
  }

  if (!state.fileNameTouched) {
    els.filename.value = state.mode === 'layers'
      ? `${template.short}_split`
      : (state.image ? suggestedName(template, state.image.name) : '');
    updateFilenameHelp();
  }

  els.stage.classList.add('is-rendering');
  try {
    const response = await fetch(`${API_BASE}/templates/${encodeURIComponent(id)}/assets`);
    if (!response.ok) throw new Error('模板资源载入失败');
    const data = await response.json();
    if (seq !== state.templateSeq) return;

    state.assets = data.template;
    state.template.width = data.template.width;
    state.template.height = data.template.height;
    els.guideOverlay.src = data.template.guide;
    els.guideOverlay.classList.toggle('is-hidden', !state.guideVisible);
    els.panelMap.src = data.template.panelMap;
    els.readoutSize.textContent = `${data.template.width} × ${data.template.height}`;
    els.artboard.style.setProperty('--ratio', String(data.template.width / data.template.height));
    updateViewOutline();
  } catch (error) {
    if (seq !== state.templateSeq) return;
    showToast(errorText(error));
  } finally {
    if (seq === state.templateSeq) els.stage.classList.remove('is-rendering');
  }

  if (render) {
    if (state.mode === 'single' && state.image) scheduleRender(0);
    else if (state.mode === 'layers' && hasAnyLayer()) scheduleRender(0);
  }
}

function openFilePicker(target) {
  state.uploadTarget = target;
  els.fileInput.value = '';
  els.fileInput.click();
}

async function readFileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

async function limitImageDataUrl(dataUrl, mime) {
  if (mime === 'image/svg+xml') {
    const dimensions = await imageDimensions(dataUrl);
    return { dataUrl, ...dimensions };
  }

  const image = await new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('图片解码失败'));
    element.src = dataUrl;
  });
  const maxEdge = 2048;
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
  if (scale >= 1) {
    return { dataUrl, width: image.naturalWidth, height: image.naturalHeight };
  }

  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);
  const outputMime = mime === 'image/png' ? 'image/png' : (mime === 'image/webp' ? 'image/webp' : 'image/jpeg');
  return {
    dataUrl: canvas.toDataURL(outputMime, 0.92),
    width,
    height,
  };
}

async function imageDimensions(dataUrl) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({
      width: image.naturalWidth || 1600,
      height: image.naturalHeight || 1600,
    });
    image.onerror = () => resolve({ width: 1600, height: 1600 });
    image.src = dataUrl;
  });
}

function mimeFromName(name) {
  const extension = String(name).toLowerCase().split('.').pop();
  return {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    svg: 'image/svg+xml',
  }[extension] || 'image/png';
}

function withDataUrlMime(dataUrl, mime) {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return dataUrl;
  return `data:${mime};base64,${dataUrl.slice(comma + 1)}`;
}

async function uploadAsset(dataUrl) {
  try {
    const response = await fetch(`${API_BASE}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl }),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload.assetId || null;
  } catch {
    return null;
  }
}

async function ensureAsset(image) {
  if (!image || image.assetId) return image?.assetId || null;
  const assetId = await uploadAsset(image.dataUrl);
  if (assetId) image.assetId = assetId;
  return assetId;
}

function fileAllowed(file) {
  const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
  return allowed.includes(file.type) || /\.(png|jpe?g|webp|svg)$/i.test(file.name);
}

async function readImageFile(file) {
  if (!file) return null;
  if (!fileAllowed(file)) {
    showToast('只接受 PNG / JPG / WebP / SVG');
    return null;
  }
  if (file.size > 20 * 1024 * 1024) {
    showToast('图案超过 20 MB，请先压缩');
    return null;
  }
  const mime = file.type || mimeFromName(file.name);
  const limited = await limitImageDataUrl(withDataUrlMime(await readFileDataUrl(file), mime), mime);
  return {
    dataUrl: limited.dataUrl,
    name: file.name,
    bytes: Math.round(limited.dataUrl.length * 0.75),
    width: limited.width,
    height: limited.height,
  };
}

function showEmptyArtwork(title = '等待图案', sub = '拖入文件后开始计算') {
  els.artboard.classList.remove('has-image', 'is-stale');
  els.preview.removeAttribute('src');
  els.emptyState.hidden = false;
  els.emptyState.querySelector('strong').textContent = title;
  els.emptyState.querySelector('span:last-child').textContent = sub;
}

async function setSingleImage(image, { render = true } = {}) {
  invalidateInFlight();
  await ensureAsset(image);
  state.image = image;
  els.fileName.textContent = image.name;
  els.fileMeta.textContent = `${image.width} × ${image.height} · ${formatBytes(image.bytes)}`;
  els.fileThumb.src = image.dataUrl;
  els.fileRow.hidden = false;
  els.dropzone.classList.add('is-compact');
  els.artboard.classList.add('has-image');
  els.emptyState.hidden = true;
  state.report = null;
  state.previewDataUrl = '';
  resetReport();
  if (!state.fileNameTouched && state.template) {
    els.filename.value = suggestedName(state.template, image.name);
    updateFilenameHelp();
  }
  updateModeUI();
  if (render) await renderNow();
}

function clearSingleImage() {
  invalidateInFlight();
  state.image = null;
  state.report = null;
  state.previewDataUrl = '';
  state.fileNameTouched = false;
  els.fileInput.value = '';
  els.fileRow.hidden = true;
  els.dropzone.classList.remove('is-compact');
  els.fileThumb.removeAttribute('src');
  els.filename.value = '';
  resetReport();
  showEmptyArtwork();
  updateStatus();
}

async function setLayerImage(viewId, image) {
  invalidateInFlight();
  const view = state.views.find((item) => item.id === viewId);
  if (!view) return;
  await ensureAsset(image);
  state.layers[viewId] = {
    ...image,
    options: cloneLayerOptions(),
  };
  state.activeView = viewId;
  state.report = null;
  state.previewDataUrl = '';
  resetReport();
  if (!state.fileNameTouched && state.template) {
    els.filename.value = `${state.template.short}_split`;
    updateFilenameHelp();
  }
  updateLayerCards();
  updateControls();
  await renderNow();
}

function clearLayer(viewId) {
  if (!state.layers[viewId]) return;
  invalidateInFlight();
  state.layers[viewId] = null;
  state.report = null;
  state.previewDataUrl = '';
  resetReport();
  updateLayerCards();
  updateControls();
  if (hasAnyLayer()) scheduleRender(0);
  else {
    els.preview.removeAttribute('src');
    els.artboard.classList.remove('has-image');
    showEmptyArtwork('分面模式', '先上传至少一个车身面');
    updateStatus();
  }
}

function clearAllLayers() {
  invalidateInFlight();
  state.layers = {};
  state.report = null;
  state.previewDataUrl = '';
  els.preview.removeAttribute('src');
  els.artboard.classList.remove('has-image');
  resetReport();
  showEmptyArtwork('分面模式', '先上传至少一个车身面');
  updateLayerCards();
  updateControls();
  updateStatus();
}

function mirrorLeftToRight() {
  const left = state.layers.left;
  if (!left) {
    showToast('先上传左侧图案');
    return;
  }
  const previousRight = state.layers.right;
  state.layers.right = {
    ...left,
    options: {
      ...left.options,
      flipX: !left.options.flipX,
    },
  };
  state.activeView = 'right';
  updateLayerCards();
  updateControls();
  if (previousRight) showToast('右侧已替换为左侧镜像；文字会反转，请检查');
  else showToast('右侧已用左侧镜像；文字会反转，请检查');
  scheduleRender(0);
}

function updateLayerCards() {
  for (const view of state.views) {
    const card = state.layerCards.get(view.id);
    if (!card) continue;
    const layer = state.layers[view.id];
    const reportView = state.report?.views?.find((item) => item.id === view.id);
    const thumb = card.querySelector('.layer-thumb');
    const stateLabel = card.querySelector('.layer-state');
    const uploadButton = card.querySelector('[data-action="upload"]');
    const clearButton = card.querySelector('[data-action="clear"]');

    card.classList.toggle('is-active', state.activeView === view.id);
    thumb.replaceChildren();
    if (layer) {
      const image = document.createElement('img');
      image.src = layer.dataUrl;
      image.alt = '';
      thumb.append(image);
    } else {
      const icon = document.createElement('span');
      icon.className = 'layer-empty-icon';
      icon.textContent = view.optional ? '○' : '＋';
      thumb.append(icon);
    }

    if (layer) {
      stateLabel.textContent = reportView?.panels ? `${reportView.panels} 板块` : '已上传';
      stateLabel.className = 'layer-state has-file';
    } else if (reportView?.autoFilled) {
      stateLabel.textContent = '自动补色';
      stateLabel.className = 'layer-state auto-fill';
    } else if (view.optional) {
      stateLabel.textContent = '可选 · 点击上传';
      stateLabel.className = 'layer-state';
    } else {
      stateLabel.textContent = '点击上传';
      stateLabel.className = 'layer-state';
    }

    card.querySelector('.layer-select').title = layer
      ? `${view.label}：点击编辑这个面`
      : `${view.label}：点击上传`;
    uploadButton.textContent = layer ? '更换' : '上传';
    clearButton.hidden = !layer;
  }
}

function buildLayerCards() {
  state.layerCards.clear();
  els.layerGrid.replaceChildren();
  for (const view of state.views) {
    const card = document.createElement('div');
    card.className = 'layer-card';
    card.dataset.view = view.id;

    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'layer-select';
    select.dataset.action = 'select';
    select.title = view.hint;

    const thumb = document.createElement('span');
    thumb.className = 'layer-thumb';
    const icon = document.createElement('span');
    icon.className = 'layer-empty-icon';
    icon.textContent = view.optional ? '○' : '＋';
    thumb.append(icon);

    const copy = document.createElement('span');
    copy.className = 'layer-copy';
    const strong = document.createElement('strong');
    strong.textContent = view.label;
    const small = document.createElement('small');
    small.textContent = view.hint;
    copy.append(strong, small);

    const stateLabel = document.createElement('span');
    stateLabel.className = 'layer-state';
    stateLabel.textContent = view.optional ? '可选' : '未上传';

    select.append(thumb, copy, stateLabel);

    const buttons = document.createElement('div');
    buttons.className = 'layer-buttons';
    const upload = document.createElement('button');
    upload.type = 'button';
    upload.dataset.action = 'upload';
    upload.textContent = '上传';
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'layer-clear';
    clear.dataset.action = 'clear';
    clear.textContent = '×';
    clear.hidden = true;
    clear.setAttribute('aria-label', `清除${view.label}`);
    buttons.append(upload, clear);

    card.append(select, buttons);
    els.layerGrid.append(card);
    state.layerCards.set(view.id, card);
  }
  updateLayerCards();
}

function updateViewOutline() {
  if (state.mode !== 'layers' || !state.zoneVisible || !currentView()) {
    els.viewOutline.hidden = true;
    return;
  }
  const reportView = state.report?.views?.find((item) => item.id === state.activeView);
  const width = state.assets?.width || state.template?.width || 1024;
  const height = state.assets?.height || state.template?.height || 1024;
  const zone = reportView?.zone || (() => {
    const [x, y, w, h] = currentView().zone;
    return {
      x: Math.round(x * width),
      y: Math.round(y * height),
      width: Math.round(w * width),
      height: Math.round(h * height),
    };
  })();

  els.viewOutline.hidden = false;
  els.viewOutline.style.left = `${(zone.x / width) * 100}%`;
  els.viewOutline.style.top = `${(zone.y / height) * 100}%`;
  els.viewOutline.style.width = `${(zone.width / width) * 100}%`;
  els.viewOutline.style.height = `${(zone.height / height) * 100}%`;
  els.viewOutlineLabel.textContent = currentView().label;
}

function setMode(mode, { render = true } = {}) {
  if (mode === 'layers' && !(state.template?.supportsSplit && state.views.length)) {
    showToast('该车型模板暂未校准分面模式');
    return;
  }
  if (mode === state.mode) return;

  invalidateInFlight();
  state.mode = mode;
  state.activeView = currentView() ? state.activeView : 'left';
  if (mode === 'single') {
    state.activeView = 'left';
  }
  updateModeUI();
  updateControls();
  updateViewOutline();

  if (mode === 'layers') {
    advanced.open = true;
    if (!hasAnyLayer()) {
      showEmptyArtwork('分面模式', '先上传左侧、右侧、前盖或后盖');
      resetReport();
      updateStatus();
      return;
    }
  }

  if (render) {
    if (mode === 'single' && state.image) scheduleRender(0);
    else if (mode === 'layers' && hasAnyLayer()) scheduleRender(0);
    else if (mode === 'single' && !state.image) {
      showEmptyArtwork();
      resetReport();
      updateStatus();
    }
  }
}

function setOption(key, value) {
  if (state.mode === 'layers') {
    const layer = currentLayer();
    if (!layer) return;
    layer.options[key] = value;
  } else {
    state.options[key] = value;
  }
  updateControls();
  scheduleRender();
}

function setGlobalOption(key, value) {
  state.options[key] = value;
  updateControls();
  scheduleRender();
}

function updateFilenameHelp() {
  const length = els.filename.value.length;
  const invalid = /[^a-z0-9_-]/.test(els.filename.value);
  const tooLong = length > 26;
  els.filenameHelp.textContent = tooLong
    ? '文件名主体最多 26 字符，加 .png 后 ≤30。'
    : invalid
      ? '中文或空格会在离开输入框时转换为连字符。'
      : '仅字母、数字、下划线、连字符；总计 ≤30 字符。';
  els.filenameHelp.classList.toggle('is-error', tooLong);
}

function scheduleRender(delay = 240) {
  clearTimeout(state.debounceTimer);
  if (state.mode === 'single' && !state.image) return;
  if (state.mode === 'layers' && !hasAnyLayer()) return;
  state.debounceTimer = setTimeout(() => {
    renderNow();
  }, delay);
}

function renderBody() {
  const options = {
    ...state.options,
    name: state.fileNameTouched ? els.filename.value.trim() : '',
  };
  if (state.mode === 'layers') {
    const layers = {};
    for (const [id, layer] of Object.entries(state.layers)) {
      if (!layer) continue;
      layers[id] = {
        ...(layer.assetId ? { assetId: layer.assetId } : { image: layer.dataUrl }),
        options: { ...layer.options },
      };
    }
    return {
      templateId: state.templateId,
      layers,
      options,
      inputName: 'split',
    };
  }
  return {
    templateId: state.templateId,
    ...(state.image.assetId ? { assetId: state.image.assetId } : { image: state.image.dataUrl }),
    inputName: state.image.name,
    options,
  };
}

async function requestRender({ preview = true } = {}) {
  if (state.mode === 'single' && (!state.image || !state.template)) return null;
  if (state.mode === 'layers' && (!hasAnyLayer() || !state.template)) return null;
  clearTimeout(state.debounceTimer);

  const seq = ++state.requestSeq;
  if (state.controller) state.controller.abort();
  const controller = new AbortController();
  state.controller = controller;
  setRendering(true);

  const started = performance.now();
  try {
    const response = await fetch(`${API_BASE}/render${preview ? '?preview=1' : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(renderBody()),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `渲染失败（HTTP ${response.status}）`);
    if (seq !== state.requestSeq) return;

    const data = { ...payload, renderMs: Math.round(performance.now() - started) };
    applyReport(data);
    return data;
  } catch (error) {
    if (error.name === 'AbortError') return;
    if (seq !== state.requestSeq) return;
    state.errorMessage = errorText(error);
    markRenderFailure(state.errorMessage);
    showToast(state.errorMessage);
    updateStatus();
    return null;
  } finally {
    if (seq === state.requestSeq) setRendering(false);
  }
}

async function renderNow() {
  return requestRender({ preview: true });
}

async function exportNow() {
  if (state.exporting) return null;
  state.exporting = true;
  try {
    return await requestRender({ preview: false });
  } finally {
    state.exporting = false;
  }
}

function resetReport() {
  els.stamp.dataset.status = 'idle';
  els.stampText.textContent = '待校验';
  els.stampSub.textContent = '等待渲染结果';
  els.specSize.textContent = '—';
  els.specBytes.textContent = '—';
  els.specCoverage.textContent = '—';
  els.checks.replaceChildren();
  const row = document.createElement('li');
  row.className = 'check idle';
  row.innerHTML = '<i></i><span>等待检查</span><b>—</b>';
  els.checks.append(row);
  els.warnings.hidden = true;
  els.warnings.replaceChildren();
  els.download.disabled = true;
  els.downloadReport.disabled = true;
  els.download.querySelector('span').textContent = '下载标准 PNG';
  els.panelCount.textContent = '—';
  els.renderTime.textContent = '等待渲染';
}

function renderChecks(report) {
  els.checks.replaceChildren();
  for (const check of report.checks) {
    const row = document.createElement('li');
    row.className = `check ${check.status}`;
    const dot = document.createElement('i');
    const label = document.createElement('span');
    const detail = document.createElement('b');
    label.textContent = check.label;
    detail.textContent = check.detail;
    row.append(dot, label, detail);
    els.checks.append(row);
  }
}

function applyReport(data) {
  const report = data.report;
  state.report = report;
  state.previewDataUrl = data.image;
  els.preview.src = data.image;
  els.artboard.classList.add('has-image');
  els.emptyState.hidden = true;

  const statusMap = {
    pass: ['检验通过', '可下载 · 尺寸 / 覆盖达标'],
    warn: ['需要检查', '有提示项，仍可下载'],
    fail: ['不可用', '修正后重新渲染'],
  };
  const preview = Boolean(report.preview);
  const [stampText, stampSub] = preview
    ? ['快速预览', '拖动即时刷新 · 下载时压缩']
    : statusMap[report.status] || statusMap.fail;
  els.stamp.dataset.status = preview ? 'preview' : report.status;
  els.stampText.textContent = stampText;
  els.stampSub.textContent = preview
    ? '768 px 预览 · 导出 1024 / ≤1 MB'
    : (report.mode === 'layers' ? `分面 / ${report.views?.filter((view) => view.provided).length || 0} 面` : stampSub);

  els.specSize.textContent = `${report.output.width} × ${report.output.height}`;
  els.specBytes.textContent = formatBytes(report.output.bytes);
  els.specCoverage.textContent = `${(report.coverage.ratio * 100).toFixed(2)}%`;
  els.panelCount.textContent = `${report.panels.filter((panel) => panel.fill >= 0.9).length}/${report.panels.length} 板块 ≥90%`;
  els.renderTime.textContent = `${data.renderMs} ms · ${report.output.palette ? `调色板 ${report.output.colours} 色` : '真彩 PNG'}`;

  renderChecks(report);

  els.warnings.replaceChildren();
  if (report.warnings.length) {
    for (const warning of report.warnings) {
      const paragraph = document.createElement('p');
      paragraph.textContent = warning;
      els.warnings.append(paragraph);
    }
    els.warnings.hidden = false;
  } else {
    els.warnings.hidden = true;
  }

  const canDownload = report.status !== 'fail';
  els.download.disabled = !canDownload;
  els.downloadReport.disabled = preview || !canDownload;
  els.download.querySelector('span').textContent = preview ? '生成并下载' : '下载标准 PNG';

  if (!state.fileNameTouched && document.activeElement !== els.filename) {
    els.filename.value = report.output.fileName.replace(/\.png$/i, '');
    updateFilenameHelp();
  }

  updateLayerCards();
  updateViewOutline();
  updateStatus();
}

function resetComposition() {
  const target = state.mode === 'layers' ? currentLayer()?.options : state.options;
  if (!target) return;
  Object.assign(target, cloneLayerOptions());
  updateControls();
  scheduleRender(0);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dataUrlToBlob(dataUrl) {
  const [header, encoded] = dataUrl.split(',');
  const mime = header.match(/data:([^;]+)/)?.[1] || 'image/png';
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

function updateBackground(value) {
  if (value === 'custom') {
    els.customColor.hidden = false;
    state.options.background = els.customColor.value;
  } else {
    els.customColor.hidden = true;
    state.options.background = value;
  }
  scheduleRender(120);
}

async function loadSample() {
  try {
    const response = await fetch(`${BASE}samples/orbit-07.svg`);
    if (!response.ok) throw new Error('示例图案载入失败');
    const blob = await response.blob();
    const dataUrl = withDataUrlMime(await readFileDataUrl(blob), blob.type || 'image/svg+xml');
    const dimensions = await imageDimensions(dataUrl);
    state.fileNameTouched = false;
    await setSingleImage({
      dataUrl,
      name: 'orbit-07.svg',
      bytes: blob.size,
      width: dimensions.width,
      height: dimensions.height,
    });
  } catch (error) {
    showToast(errorText(error));
  }
}

async function loadSplitSample() {
  if (!(state.template?.supportsSplit && state.views.length)) {
    showToast('当前车型暂不支持分面示例');
    return;
  }
  const sampleViews = ['left', 'right', 'hood', 'trunk', 'frontBumper', 'rearBumper'];
  try {
    const entries = await Promise.all(sampleViews.map(async (id) => {
      const response = await fetch(`${BASE}samples/split/${id}.png`);
      if (!response.ok) throw new Error(`示例缺少 ${id}`);
      const blob = await response.blob();
      const dataUrl = withDataUrlMime(await readFileDataUrl(blob), 'image/png');
      const dimensions = await imageDimensions(dataUrl);
      return [id, {
        dataUrl,
        name: `split-${id}.png`,
        bytes: blob.size,
        width: dimensions.width,
        height: dimensions.height,
      }];
    }));
    invalidateInFlight();
    state.mode = 'layers';
    state.layers = {};
    await Promise.all(entries.map(([, image]) => ensureAsset(image)));
    for (const [id, image] of entries) {
      state.layers[id] = { ...image, options: cloneLayerOptions() };
    }
    state.activeView = 'left';
    state.fileNameTouched = false;
    els.filename.value = `${state.template.short}_split`;
    updateFilenameHelp();
    updateModeUI();
    updateLayerCards();
    updateControls();
    advanced.open = true;
    await renderNow();
  } catch (error) {
    showToast(errorText(error));
  }
}

function bindEvents() {
  els.templateSelect.addEventListener('change', (event) => {
    selectTemplate(event.target.value);
  });

  els.modeSwitch.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-mode]');
    if (button) setMode(button.dataset.mode);
  });

  els.dropzone.addEventListener('click', () => {
    if (state.mode === 'single') openFilePicker(null);
  });

  for (const eventName of ['dragenter', 'dragover']) {
    els.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropzone.classList.add('is-dragover');
    });
  }
  for (const eventName of ['dragleave', 'drop']) {
    els.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropzone.classList.remove('is-dragover');
    });
  }
  els.dropzone.addEventListener('drop', async (event) => {
    const [file] = event.dataTransfer.files;
    const image = await readImageFile(file);
    if (image) await setSingleImage(image);
  });
  els.dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (state.mode === 'single') openFilePicker(null);
    }
  });

  els.fileInput.addEventListener('change', async (event) => {
    const [file] = event.target.files;
    const target = state.uploadTarget;
    state.uploadTarget = null;
    const image = await readImageFile(file);
    if (!image) return;
    if (state.mode === 'layers' && target) await setLayerImage(target, image);
    else await setSingleImage(image);
  });

  els.removeFile.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    clearSingleImage();
  });

  els.layerGrid.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    const card = event.target.closest('[data-view]');
    if (!action || !card) return;
    const viewId = card.dataset.view;
    if (action === 'upload') {
      state.activeView = viewId;
      updateLayerCards();
      updateControls();
      openFilePicker(viewId);
    } else if (action === 'clear') {
      clearLayer(viewId);
    } else if (action === 'select') {
      state.activeView = viewId;
      updateLayerCards();
      updateControls();
      if (!state.layers[viewId]) openFilePicker(viewId);
    }
  });

  els.mirrorSides.addEventListener('click', mirrorLeftToRight);
  els.clearLayers.addEventListener('click', clearAllLayers);
  els.splitSample.addEventListener('click', loadSplitSample);

  $$('#fitControl button').forEach((button) => {
    button.addEventListener('click', () => {
      const fit = button.dataset.fit;
      if (fit === 'tile') setOption('rotate', 0);
      setOption('fit', fit);
    });
  });

  els.zoom.addEventListener('input', () => {
    setOption('zoom', Number(els.zoom.value) / 100);
  });
  els.offsetX.addEventListener('input', () => {
    setOption('offsetX', Number(els.offsetX.value));
  });
  els.offsetY.addEventListener('input', () => {
    setOption('offsetY', Number(els.offsetY.value));
  });
  els.rotate.addEventListener('input', () => {
    setOption('rotate', Number(els.rotate.value));
  });

  els.flipX.addEventListener('click', () => {
    const options = currentOptions();
    setOption('flipX', !options.flipX);
  });
  els.flipY.addEventListener('click', () => {
    const options = currentOptions();
    setOption('flipY', !options.flipY);
  });

  els.background.addEventListener('change', (event) => updateBackground(event.target.value));
  els.customColor.addEventListener('input', () => {
    state.options.background = els.customColor.value;
    scheduleRender();
  });

  els.quality.addEventListener('input', () => {
    setGlobalOption('quality', Number(els.quality.value));
  });
  els.autoDownscale.addEventListener('change', () => {
    setGlobalOption('autoDownscale', els.autoDownscale.checked);
  });

  els.resetComposition.addEventListener('click', resetComposition);

  els.filename.addEventListener('input', () => {
    state.fileNameTouched = true;
    updateFilenameHelp();
  });
  els.filename.addEventListener('blur', () => {
    const clean = sanitizeBase(els.filename.value);
    els.filename.value = clean || (state.template
      ? (state.mode === 'layers' ? `${state.template.short}_split` : (state.image ? suggestedName(state.template, state.image.name) : ''))
      : '');
    state.fileNameTouched = true;
    updateFilenameHelp();
    scheduleRender(0);
  });

  els.download.addEventListener('click', async () => {
    if (!state.report) return;
    let data = { image: state.previewDataUrl, report: state.report };
    if (state.report.preview) {
      data = await exportNow();
      if (!data) return;
    }
    downloadBlob(dataUrlToBlob(data.image), data.report.output.fileName);
  });

  els.downloadReport.addEventListener('click', async () => {
    if (!state.report) return;
    let report = state.report;
    if (report.preview) {
      const data = await exportNow();
      if (!data) return;
      report = data.report;
    }
    downloadBlob(
      new Blob([`${JSON.stringify({ ...report, exportedAt: new Date().toISOString() }, null, 2)}\n`], { type: 'application/json' }),
      report.output.fileName.replace(/\.png$/i, '.json'),
    );
  });

  els.guideToggle.addEventListener('click', () => {
    state.guideVisible = !state.guideVisible;
    els.guideToggle.classList.toggle('active', state.guideVisible);
    els.guideToggle.setAttribute('aria-pressed', String(state.guideVisible));
    els.guideOverlay.classList.toggle('is-hidden', !state.guideVisible);
  });

  els.checkerToggle.addEventListener('click', () => {
    state.checkerVisible = !state.checkerVisible;
    els.checkerToggle.classList.toggle('active', state.checkerVisible);
    els.checkerToggle.setAttribute('aria-pressed', String(state.checkerVisible));
    els.artboard.classList.toggle('is-checker', state.checkerVisible);
  });

  els.zoneToggle.addEventListener('click', () => {
    state.zoneVisible = !state.zoneVisible;
    els.zoneToggle.classList.toggle('active', state.zoneVisible);
    els.zoneToggle.setAttribute('aria-pressed', String(state.zoneVisible));
    updateViewOutline();
  });

  els.sampleButton.addEventListener('click', () => {
    state.fileNameTouched = false;
    if (state.mode === 'layers') loadSplitSample();
    else loadSample();
  });

  els.scopeButton.addEventListener('click', () => {
    els.scopeDialog.showModal();
  });

  els.artboard.addEventListener('wheel', (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    if (state.mode === 'layers' && !currentLayer()) return;
    event.preventDefault();
    const options = currentOptions();
    const next = Math.min(2, Math.max(0.5, options.zoom - event.deltaY * 0.001));
    setOption('zoom', Math.round(next * 100) / 100);
  }, { passive: false });
}

async function init() {
  setJobNumber();
  bindEvents();
  updateControls();
  updateStatus();

  try {
    const response = await fetch(`${API_BASE}/templates`);
    if (!response.ok) throw new Error('模板列表载入失败');
    const data = await response.json();
    state.templates = data.templates;
    state.views = data.views || [];
    for (const view of state.views) state.layers[view.id] = null;
    buildLayerCards();

    els.templateSelect.replaceChildren();
    for (const template of state.templates) {
      const option = document.createElement('option');
      option.value = template.id;
      option.textContent = `${template.series} · ${template.variant} · ${template.year}`;
      els.templateSelect.append(option);
    }

    const preferred = state.templates.find((template) => template.id === 'modely-2025-premium') || state.templates[0];
    await selectTemplate(preferred.id, { render: false });
    await loadSample();
  } catch (error) {
    state.errorMessage = errorText(error);
    showToast(state.errorMessage);
    updateStatus();
  }
}

init();
