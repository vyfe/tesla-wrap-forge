export function sanitizeSegment(value, fallback = '') {
  const ascii = String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/[-_]{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
  return ascii || fallback;
}

export function makeFileName(template, requested) {
  const stripped = String(requested ?? '').trim().replace(/\.png$/i, '');
  const base = sanitizeSegment(stripped, `${template.short}_wrap`).slice(0, 26).replace(/[-_]+$/g, '');
  return `${base || `${template.short}_wrap`}.png`;
}

export function suggestedBaseName(template, designName) {
  const design = sanitizeSegment(String(designName ?? '').replace(/\.[^.]+$/, ''), 'wrap');
  return sanitizeSegment(`${template.short}_${design}`, `${template.short}_wrap`).slice(0, 26).replace(/[-_]+$/g, '');
}
