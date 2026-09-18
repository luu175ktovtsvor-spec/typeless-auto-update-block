#!/usr/bin/env node
/**
 * Typeless update feed controller diagram kit — generates every SVG in this folder.
 *   node docs/assets/generate.mjs
 *
 * Design rules used here (keep them when editing):
 *   - 8px spacing grid, 64px page margins
 *   - one idea per card, max 3 lines of text, short labels
 *   - colour = meaning: blue = app, violet = our service, teal = state, amber = caution, rose = blocked, green = good
 *   - code lives in dark "terminal" pills, prose lives outside the diagram
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ tokens */
const C = {
  ink: '#0B1220',
  body: '#475569',
  mute: '#8194AD',
  line: '#E7EDF6',
  white: '#FFFFFF',
  blue: '#3B82F6',
  indigo: '#6366F1',
  violet: '#8B5CF6',
  teal: '#14B8A6',
  green: '#22C55E',
  amber: '#F59E0B',
  rose: '#F43F5E',
  slate: '#64748B',
};

const GRAD = {
  blue: ['#7DD3FC', '#2563EB'],
  indigo: ['#A5B4FC', '#4F46E5'],
  violet: ['#C4B5FD', '#7C3AED'],
  teal: ['#5EEAD4', '#0D9488'],
  green: ['#86EFAC', '#16A34A'],
  amber: ['#FDE68A', '#F59E0B'],
  rose: ['#FDA4AF', '#E11D48'],
  slate: ['#CBD5E1', '#475569'],
  dark: ['#1E293B', '#0B1220'],
};

const TINT = {
  blue: '#EFF6FF', indigo: '#EEF2FF', violet: '#F5F3FF', teal: '#F0FDFA',
  green: '#F0FDF4', amber: '#FFFBEB', rose: '#FFF1F2', slate: '#F8FAFC',
};

const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`;
const MONO = `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
/** same stack without inner quotes — safe inside SVG attributes */
const FONT_ATTR = FONT.replace(/"/g, '');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** rough width so pills and cards never clip: CJK ≈ 1em, latin ≈ 0.56em */
function textWidth(str, size) {
  let w = 0;
  for (const ch of String(str)) w += ch.codePointAt(0) > 0x2e80 ? size : size * 0.56;
  return w;
}

const ICONS = {
  snow: 'M12 3v18|M4.2 7.5l15.6 9|M19.8 7.5l-15.6 9',
  monitor: 'M3.5 5.5h17v10.5h-17z|M9 20h6|M12 16v4',
  window: 'M3 5.5h18v13H3z|M3 9.5h18|M6 7.5h.01|M8.5 7.5h.01|M11 7.5h.01',
  file: 'M7.5 3h6l4 4v14h-10z|M13.5 3v4.5H18',
  folder: 'M3 7.5a2 2 0 0 1 2-2h3.5l1.8 2H19a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  server: 'M4 4.5h16v6H4z|M4 13.5h16v6H4z|M7.5 7.5h.01|M7.5 16.5h.01',
  shield: 'M12 3.2l7 2.8v6c0 4-3 7-7 9-4-2-7-5-7-9v-6z|M9 12.2l2.1 2.1 4-4.2',
  cloud: 'M7 18.5a4.2 4.2 0 0 1 0-8.4 5.2 5.2 0 0 1 10 1.6A3.6 3.6 0 0 1 16.5 18.5z',
  lock: 'M6.5 11h11v8.5h-11z|M9.2 11V8.4a2.8 2.8 0 0 1 5.6 0V11',
  bell: 'M6 16.5V11.5a6 6 0 0 1 12 0v5l1.5 2h-15z|M10 20.5a2 2 0 0 0 4 0',
  refresh: 'M20 12a8 8 0 1 1-2.5-5.8|M20.5 4v4.5H16',
  trash: 'M4.5 7h15|M9.5 7V4.8h5V7|M6.5 7l1 13h9l1-13|M10.5 11v6|M13.5 11v6',
  check: 'M5 12.8l4.2 4.2L19 7',
  warn: 'M12 3.8l9 16.4H3z|M12 10v4.4|M12 17.4h.01',
  terminal: 'M4 5h16v14H4z|M7.2 10l3 2-3 2|M12.5 15h4.5',
  gear: 'M12 9.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8|M12 3.5v3|M12 17.5v3|M3.5 12h3|M17.5 12h3|M6 6l2.1 2.1|M15.9 15.9L18 18|M18 6l-2.1 2.1|M8.1 15.9L6 18',
  file_lock: 'M7.5 3h6l4 4v13h-10z|M13.5 3v4.5H18|M9.8 15.4h4.4v3.2H9.8z',
  eye: 'M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z|M12 14.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6',
  clock: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17|M12 7.5V12l3 2',
  play: 'M8.5 5.5l10 6.5-10 6.5z',
  bolt: 'M13.2 3L5.5 14h4.8l-1 7 8-11h-5z',
  rocket: 'M12 3.5c3.6 1.6 6 5 6 9.2l-3 3H9l-3-3c0-4.2 2.4-7.6 6-9.2z|M9.5 15.5L7 20l3.2-1.2M14.5 15.5L17 20l-3.2-1.2',
  download: 'M12 4v10.5|M8 11l4 4 4-4|M4.5 19.5h15',
  arrow: 'M4 12h14|M12.5 6.5L18 12l-5.5 5.5',
  key: 'M15.5 4.5a4.5 4.5 0 1 0-1.6 8.6l-1.4 1.4h-2v2h-2v2H4.5v-2.5l5-5A4.5 4.5 0 0 1 15.5 4.5z|M16.6 8.2h.01',
  code: 'M9 8.5L5.5 12 9 15.5|M15 8.5L18.5 12 15 15.5',
  layers: 'M12 3.5l8 4.2-8 4.2-8-4.2z|M4 12.5l8 4.2 8-4.2|M4 16.8l8 4.2 8-4.2',
};

function icon(name, x, y, size, { color = C.ink, width = 2.1 } = {}) {
  const paths = (ICONS[name] ?? '').split('|').map((d) => `<path d="${d}"/>`).join('');
  const s = size / 24;
  return `<g transform="translate(${x},${y}) scale(${s.toFixed(4)})" fill="none" stroke="${color}" stroke-width="${(width / s).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`;
}

/** rounded accent square with a tinted icon — the main visual anchor */
function iconChip(x, y, iconName, colorKey, size = 46) {
  const [g1, g2] = GRAD[colorKey];
  return [
    `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.32}" fill="url(#lg${colorKey})"/>`,
    `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.32}" fill="none" stroke="${g1}" stroke-opacity="0.9"/>`,
    icon(iconName, x + size * 0.26, y + size * 0.26, size * 0.48, { color: '#ffffff', width: 2.2 }),
  ].join('');
}

function card(x, y, w, h, { radius = 20, fill = '#ffffff', stroke = C.line, shadow = 'soft', accent = null, accentWidth = 6 } = {}) {
  const shadowFilter = shadow === 'soft' ? ' filter="url(#soft)"' : shadow === 'lift' ? ' filter="url(#lift)"' : '';
  return [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="1.3"${shadowFilter}/>`,
    accent ? `<rect x="${x}" y="${y}" width="${accentWidth}" height="${h}" rx="${accentWidth / 2}" fill="url(#lg${accent})"/>` : '',
  ].join('');
}

function pill(x, y, label, { color = 'slate', mono = false, solid = false, size = 12.5, padX = 14, height = 30 } = {}) {
  const w = textWidth(label, size) + padX * 2;
  const [g1, g2] = GRAD[color];
  const bg = solid ? `url(#lg${color})` : TINT[color];
  const fg = solid ? '#ffffff' : g2;
  return {
    w,
    svg:
      `<rect x="${x}" y="${y}" width="${w.toFixed(1)}" height="${height}" rx="${height / 2}" fill="${bg}" stroke="${solid ? g1 : g1}" stroke-opacity="${solid ? 1 : 0.75}"/>` +
      `<text x="${(x + w / 2).toFixed(1)}" y="${y + height / 2 + size * 0.36}" text-anchor="middle" font-family="${mono ? MONO : FONT_ATTR}" font-size="${size}" font-weight="${solid ? 650 : 600}" style="fill:${fg}">${esc(label)}</text>`,
  };
}

/** dark terminal strip used for commands / code */
function terminal(x, y, label, { w = null, size = 12.5, height = 38, height2 = 0 } = {}) {
  const width = w ?? textWidth(label, size) + 46;
  return {
    w: width,
    svg: [
      `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="12" fill="url(#lgdark)"/>`,
      `<circle cx="${x + 16}" cy="${y + height / 2}" r="3.4" fill="#F43F5E" fill-opacity="0.9"/>`,
      `<circle cx="${x + 28}" cy="${y + height / 2}" r="3.4" fill="#F59E0B" fill-opacity="0.9"/>`,
      `<circle cx="${x + 40}" cy="${y + height / 2}" r="3.4" fill="#22C55E" fill-opacity="0.9"/>`,
      `<text x="${x + 54}" y="${y + height / 2 + size * 0.36}" font-family="${MONO}" font-size="${size}" style="fill:#E2E8F0">${esc(label)}</text>`,
    ].join(''),
  };
}

function badge(cx, cy, n, colorKey, r = 15) {
  return [
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#lg${colorKey})"/>`,
    `<circle cx="${cx}" cy="${cy}" r="${r - 2}" fill="none" stroke="#ffffff" stroke-opacity="0.55"/>`,
    `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-family="${FONT_ATTR}" font-size="${r * 0.86}" font-weight="750" style="fill:#ffffff">${esc(n)}</text>`,
  ].join('');
}

function arrow(x1, y1, x2, y2, colorKey, { width = 3.2, dash = false } = {}) {
  return `<path d="M${x1},${y1} L${x2},${y2}" fill="none" stroke="url(#lg${colorKey})" stroke-width="${width}" stroke-linecap="round"${dash ? ' stroke-dasharray="9 7"' : ''} filter="url(#glow${colorKey})" marker-end="url(#ah${colorKey})"/>`;
}

function curve(d, colorKey, { width = 3.2, dash = false } = {}) {
  return `<path d="${d}" fill="none" stroke="url(#lg${colorKey})" stroke-width="${width}" stroke-linecap="round"${dash ? ' stroke-dasharray="9 7"' : ''} filter="url(#glow${colorKey})" marker-end="url(#ah${colorKey})"/>`;
}

function txt(x, y, content, cls = 'body', extra = '') {
  return `<text class="${cls}" x="${x}" y="${y}" ${extra}>${esc(content)}</text>`;
}

const colorKeys = Object.keys(GRAD);

function defs() {
  return `<defs>
    <style>
      text { font-family: ${FONT}; fill: ${C.ink}; }
      .title { font-size: 40px; font-weight: 780; letter-spacing: -0.6px; }
      .subtitle { font-size: 16px; fill: ${C.body}; }
      .section { font-size: 19px; font-weight: 730; }
      .section-sub { font-size: 13px; fill: ${C.mute}; }
      .cardtitle { font-size: 16px; font-weight: 700; }
      .body { font-size: 13.5px; fill: ${C.body}; }
      .small { font-size: 12.2px; fill: ${C.mute}; }
      .mono { font-family: ${MONO}; font-size: 12.4px; fill: ${C.body}; }
      .tiny { font-size: 11.5px; font-weight: 640; letter-spacing: 0.2px; }
    </style>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#F7FAFF"/><stop offset="55%" stop-color="#F2F6FE"/><stop offset="100%" stop-color="#EEF3FD"/>
    </linearGradient>
    <radialGradient id="glowA" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="#60A5FA" stop-opacity="0.30"/><stop offset="100%" stop-color="#60A5FA" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowB" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="#A78BFA" stop-opacity="0.26"/><stop offset="100%" stop-color="#A78BFA" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowC" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="#5EEAD4" stop-opacity="0.24"/><stop offset="100%" stop-color="#5EEAD4" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse">
      <path d="M28 0H0V28" fill="none" stroke="#0B1220" stroke-opacity="0.045" stroke-width="1"/>
    </pattern>
    ${colorKeys.map((k) => `
      <linearGradient id="lg${k}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${GRAD[k][0]}"/><stop offset="100%" stop-color="${GRAD[k][1]}"/>
      </linearGradient>
      <linearGradient id="soft${k}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${GRAD[k][0]}" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="${GRAD[k][1]}" stop-opacity="0.07"/>
      </linearGradient>
      <marker id="ah${k}" markerWidth="12" markerHeight="12" refX="9" refY="4" orient="auto">
        <path d="M0,0.6 L0,7.4 L10,4 z" fill="${GRAD[k][1]}"/>
      </marker>
      <filter id="glow${k}" x="-40%" y="-40%" width="180%" height="180%">
        <feDropShadow dx="0" dy="2" stdDeviation="3.4" flood-color="${GRAD[k][1]}" flood-opacity="0.32"/>
      </filter>`).join('')}
    <filter id="soft" x="-12%" y="-16%" width="124%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="9" flood-color="#0B1220" flood-opacity="0.07"/>
    </filter>
    <filter id="lift" x="-14%" y="-18%" width="128%" height="146%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#0B1220" flood-opacity="0.10"/>
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#0B1220" flood-opacity="0.06"/>
    </filter>
  </defs>`;
}

function shell(w, h, body, { glows = [['glowA', -80, -120, 700], ['glowB', w - 620, h - 460, 700], ['glowC', w * 0.42, h * 0.55, 620]] } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">
${defs()}
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  ${glows.map(([id, cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id})"/>`).join('')}
  <rect width="${w}" height="${h}" fill="url(#grid)"/>
${body}
</svg>`;
}

function pageTitle(x, y, title, subtitle) {
  return [
    `<rect x="${x}" y="${y - 34}" width="54" height="54" rx="17" fill="url(#lgblue)"/>`,
    icon('snow', x + 14, y - 20, 26, { color: '#ffffff', width: 2.2 }),
    txt(x + 72, y + 2, title, 'title'),
    txt(x + 74, y + 28, subtitle, 'subtitle'),
  ].join('');
}

/* ------------------------------------------------------------------- 1. hero */
function hero() {
  const W = 1600;
  const H = 620;
  const p = [];

  p.push(`<rect x="72" y="64" width="58" height="58" rx="18" fill="url(#lgblue)"/>`);
  p.push(icon('snow', 88, 80, 26, { color: '#ffffff', width: 2.3 }));
  p.push(txt(150, 104, 'Typeless 更新源控制器', 'title', 'font-size="42px"'));
  p.push(txt(150, 140, '备份并改写 electron-updater 的 feed · 本机应答 · 可恢复', 'subtitle', 'font-size="18px"'));

  const chips = [
    ['macOS 已验证 · Windows 待验收', 'blue'],
    ['零依赖 · 仅 Node 标准库', 'violet'],
    ['改 1 个字段', 'teal'],
    ['备份后可 revert', 'green'],
  ];
  let cx = 152;
  for (const [label, key] of chips) {
    const c = pill(cx, 168, label, { color: key, size: 13, height: 34 });
    p.push(c.svg);
    cx += c.w + 12;
  }

  // left: app window with the patched config
  p.push(card(96, 248, 620, 300, { radius: 24, shadow: 'lift' }));
  p.push(`<rect x="96" y="248" width="620" height="46" rx="24" fill="#F8FAFC"/>`);
  p.push(`<path d="M96 294h620" stroke="${C.line}" stroke-width="1.2"/>`);
  ['#F43F5E', '#F59E0B', '#22C55E'].forEach((c, i) => p.push(`<circle cx="${124 + i * 20}" cy="271" r="5.6" fill="${c}"/>`));
  p.push(txt(206, 276, 'Typeless.app / Contents/Resources/app-update.yml', 'mono', `style="fill:${C.mute}"`));
  p.push(iconChip(128, 316, 'file', 'blue'));
  p.push(txt(190, 336, '应用包内更新配置', 'cardtitle'));
  p.push(txt(190, 358, '只有 url 这一行被改道', 'small'));
  const t1 = terminal(128, 386, 'provider: generic', { w: 556, size: 12.6 });
  p.push(t1.svg);
  const t2 = terminal(128, 432, 'url: http://127.0.0.1:47821/now.typeless.desktop/', { w: 556, size: 12.6 });
  p.push(t2.svg);
  p.push(`<rect x="136" y="428" width="540" height="46" rx="12" fill="none" stroke="#60A5FA" stroke-width="2"/>`);
  const ok = pill(128, 494, '✓ 实测更新检查显示当前版本', { color: 'green', size: 13, height: 34 });
  p.push(ok.svg);

  // middle: local feed service
  p.push(card(752, 248, 396, 300, { radius: 24, shadow: 'lift', fill: '#FFFFFF', stroke: '#DDD6FE' }));
  p.push(`<rect x="752" y="248" width="396" height="300" rx="24" fill="url(#softviolet)"/>`);
  p.push(iconChip(784, 280, 'server', 'violet'));
  p.push(txt(846, 302, '本机清单服务', 'cardtitle'));
  p.push(txt(846, 324, '127.0.0.1:47821', 'mono', `style="fill:${C.violet}"`));
  p.push(txt(784, 374, '任何清单请求 → 返回“已装版本”', 'body'));
  const badge20 = pill(784, 396, '每 20 秒检查漂移', { color: 'violet', size: 12.5, height: 32 });
  p.push(badge20.svg);
  p.push(txt(784, 462, '· 版本相同，不触发更新下载', 'body'));
  p.push(txt(784, 488, '· 清理已下载的更新载荷', 'body'));
  p.push(txt(784, 514, '· 失败会通知 + doctor 标红', 'body'));

  p.push(arrow(1000, 398, 1116, 398, 'blue'));
  p.push(badge(1058, 398, '1', 'blue'));

  // right: the app happy state
  p.push(card(1148, 248, 356, 300, { radius: 24, shadow: 'lift', fill: '#F7FEF9', stroke: '#BBF7D0' }));
  p.push(iconChip(1180, 280, 'check', 'green'));
  p.push(txt(1242, 302, '应用侧结果', 'cardtitle'));
  p.push(txt(1242, 324, 'update-not-available', 'mono', `style="fill:${C.green}"`));
  p.push(txt(1180, 380, '不下载  ·  不安装  ·  不提示', 'body'));
  p.push(`<rect x="1180" y="404" width="292" height="112" rx="16" fill="#ffffff" stroke="#BBF7D0"/>`);
  p.push(icon('shield', 1200, 424, 22, { color: C.green }));
  p.push(txt(1232, 442, '只控制更新清单', 'cardtitle'));
  p.push(txt(1200, 472, '会改变应用包的签名状态', 'small'));
  p.push(txt(1200, 494, '不控制模型、账号与数据请求', 'small'));

  return shell(W, H, p.join('\n'));
}

/* ------------------------------------------------------- 2. overview (lanes) */
function overview() {
  const W = 1600;
  const H = 1180;
  const p = [pageTitle(72, 92, '技术架构总览', '三个部分：目标应用 · 本机清单服务 · 状态与自启')];

  const laneY = 190;
  const laneH = 700;
  const lanes = [
    { x: 72, w: 468, key: 'blue', icon: 'window', title: '目标应用', sub: '应用包内的更新源改为回环地址' },
    { x: 566, w: 468, key: 'violet', icon: 'server', title: '本机清单服务', sub: '127.0.0.1:47821 · 只监听回环' },
    { x: 1060, w: 468, key: 'teal', icon: 'layers', title: '状态 · 自启 · 运行时', sub: '仓库可移动，服务只依赖自己的副本' },
  ];
  for (const l of lanes) {
    p.push(card(l.x, laneY, l.w, laneH, { radius: 26, shadow: 'lift' }));
    p.push(`<rect x="${l.x}" y="${laneY}" width="${l.w}" height="96" rx="26" fill="url(#soft${l.key})"/>`);
    p.push(`<path d="M${l.x},${laneY + 96}h${l.w}" stroke="${C.line}" stroke-width="1.3"/>`);
    p.push(iconChip(l.x + 24, laneY + 24, l.icon, l.key, 48));
    p.push(txt(l.x + 86, laneY + 46, l.title, 'cardtitle', 'font-size="17px"'));
    p.push(txt(l.x + 86, laneY + 68, l.sub, 'small'));
  }

  const [A, B, D] = lanes;

  // Lane A
  p.push(card(A.x + 24, laneY + 120, A.w - 48, 190, { fill: '#FFFFFF', stroke: '#BFDBFE', accent: 'blue' }));
  p.push(iconChip(A.x + 46, laneY + 142, 'file', 'blue', 40));
  p.push(txt(A.x + 100, laneY + 160, 'app-update.yml', 'cardtitle'));
  p.push(txt(A.x + 100, laneY + 182, '更新源配置（唯一改动点）', 'small'));
  const ta1 = terminal(A.x + 46, laneY + 200, 'provider: generic', { w: A.w - 92, size: 12.2, height: 34 });
  p.push(ta1.svg);
  const ta2 = terminal(A.x + 46, laneY + 242, 'url: 127.0.0.1:47821/<slug>/', { w: A.w - 92, size: 12.2, height: 34 });
  p.push(ta2.svg);
  p.push(`<rect x="${A.x + 42}" y="${laneY + 238}" width="${A.w - 84}" height="42" rx="12" fill="none" stroke="#60A5FA" stroke-width="2"/>`);

  p.push(card(A.x + 24, laneY + 326, A.w - 48, 118, { fill: '#F8FFFB', stroke: '#BBF7D0', accent: 'green' }));
  p.push(iconChip(A.x + 46, laneY + 348, 'folder', 'green', 40));
  p.push(txt(A.x + 100, laneY + 366, '原始 url 逐字节备份', 'cardtitle'));
  p.push(txt(A.x + 100, laneY + 388, '~/.typeless-auto-update-block/backups/<slug>/', 'mono', `style="fill:${C.green}"`, 'font-size="10.5px"'));
  p.push(txt(A.x + 46, laneY + 424, 'revert 原样写回；系统信任仍需重新校验', 'small'));

  p.push(card(A.x + 24, laneY + 458, A.w - 48, 118, { fill: '#FFFCF5', stroke: '#FDE68A', accent: 'amber' }));
  p.push(iconChip(A.x + 46, laneY + 480, 'trash', 'amber', 40));
  p.push(txt(A.x + 100, laneY + 498, '已下载的更新载荷', 'cardtitle'));
  p.push(txt(A.x + 100, laneY + 520, '~/Library/Caches/typeless-updater/', 'mono', `style="fill:${C.amber}"`));
  p.push(txt(A.x + 46, laneY + 556, '看守清理 pending/*（目录名不符则跳过）', 'small'));

  p.push(card(A.x + 24, laneY + 590, A.w - 48, 86, { fill: '#F7FEF9', stroke: '#BBF7D0' }));
  p.push(icon('check', A.x + 48, laneY + 612, 22, { color: C.green }));
  p.push(txt(A.x + 84, laneY + 630, '应用自己的更新 UI 显示“已是最新”', 'body', `style="fill:${C.ink}"`));
  p.push(txt(A.x + 48, laneY + 660, '已验证当前更新检查不触发下载', 'small'));

  // Lane B
  p.push(card(B.x + 24, laneY + 120, B.w - 48, 216, { fill: '#FFFFFF', stroke: '#DDD6FE', accent: 'violet' }));
  p.push(iconChip(B.x + 46, laneY + 142, 'bolt', 'violet', 40));
  p.push(txt(B.x + 100, laneY + 160, '清单生成器（HTTP）', 'cardtitle'));
  p.push(txt(B.x + 100, laneY + 182, '任意 <channel>.yml → 实时读已装版本', 'small'));
  const tb = terminal(B.x + 46, laneY + 202, 'GET /<slug>/arm64-mac.yml', { w: B.w - 92, size: 12.2, height: 34 });
  p.push(tb.svg);
  const tb2 = terminal(B.x + 46, laneY + 244, '200 OK  version: 2.7.0', { w: B.w - 92, size: 12.2, height: 34 });
  p.push(tb2.svg);
  p.push(txt(B.x + 46, laneY + 306, '→ electron-updater 按版本相同结束检查', 'small'));

  p.push(card(B.x + 24, laneY + 352, B.w - 48, 150, { fill: '#FAF8FF', stroke: '#DDD6FE', accent: 'violet' }));
  p.push(iconChip(B.x + 46, laneY + 374, 'refresh', 'violet', 40));
  p.push(txt(B.x + 100, laneY + 392, '漂移检查循环', 'cardtitle'));
  const period = pill(B.x + 300, laneY + 370, '每 20 秒', { color: 'violet', size: 12, height: 30 });
  p.push(period.svg);
  p.push(txt(B.x + 46, laneY + 440, '配置被改写 / 重装还原 → 下个周期重写 url', 'body'));
  p.push(txt(B.x + 46, laneY + 466, '多应用逐个隔离，一个失败不影响其它', 'small'));
  p.push(txt(B.x + 46, laneY + 488, '写前逐键比对，拒绝不一致结果', 'small'));

  p.push(card(B.x + 24, laneY + 518, B.w - 48, 158, { fill: '#FFFCF5', stroke: '#FDE68A', accent: 'amber' }));
  p.push(iconChip(B.x + 46, laneY + 540, 'bell', 'amber', 40));
  p.push(txt(B.x + 100, laneY + 558, '失败可见化', 'cardtitle'));
  p.push(txt(B.x + 100, laneY + 580, '写入被系统拦截（EPERM）时', 'small'));
  p.push(txt(B.x + 46, laneY + 614, '· 日志写明原因与修复命令', 'body'));
  p.push(txt(B.x + 46, laneY + 640, '· 桌面通知（每应用每小时最多一次）', 'body'));
  p.push(txt(B.x + 46, laneY + 666, '· doctor 标红，提示运行 repair', 'body'));

  // Lane C
  p.push(card(D.x + 24, laneY + 120, D.w - 48, 250, { fill: '#FFFFFF', stroke: '#99F6E4', accent: 'teal' }));
  p.push(iconChip(D.x + 46, laneY + 142, 'folder', 'teal', 40));
  p.push(txt(D.x + 100, laneY + 160, '~/.typeless-auto-update-block/', 'cardtitle', 'font-size="14px"'));
  p.push(txt(D.x + 100, laneY + 182, 'Windows: %LOCALAPPDATA%\\typeless-auto-update-block', 'small', 'font-size="10.5px"'));
  const rows = [
    ['app/', '工具稳定副本'],
    ['bin/', 'node 解析包装脚本'],
    ['backups/', '逐字节原始配置'],
    ['logs/', '运行日志（2 MB 轮转）'],
    ['state.json', '冻结清单 / 端口 / 限流'],
  ];
  rows.forEach(([k, v], i) => {
    const y = laneY + 212 + i * 30;
    p.push(`<rect x="${D.x + 46}" y="${y - 16}" width="${D.w - 92}" height="26" rx="8" fill="${i % 2 ? '#F8FAFC' : '#FFFFFF'}" stroke="${C.line}"/>`);
    p.push(txt(D.x + 58, y + 2, k, 'mono', `style="fill:${C.ink}"`));
    p.push(txt(D.x + 190, y + 2, v, 'small'));
  });

  p.push(card(D.x + 24, laneY + 386, D.w - 48, 132, { fill: '#F0FDFA', stroke: '#99F6E4', accent: 'teal' }));
  p.push(iconChip(D.x + 46, laneY + 408, 'gear', 'teal', 40));
  p.push(txt(D.x + 100, laneY + 426, '服务托管（自启 + 崩溃重启）', 'cardtitle'));
  const mac = pill(D.x + 46, laneY + 448, 'macOS LaunchAgent', { color: 'teal', size: 12, height: 30 });
  const win = pill(D.x + 46 + mac.w + 10, laneY + 448, 'Windows Run key', { color: 'teal', size: 12, height: 30 });
  p.push(mac.svg, win.svg);
  p.push(txt(D.x + 46, laneY + 502, '登录时启动；异常退出按平台策略重新拉起', 'small'));

  p.push(card(D.x + 24, laneY + 534, D.w - 48, 142, { fill: '#F8FAFC', stroke: C.line, accent: 'slate' }));
  p.push(iconChip(D.x + 46, laneY + 556, 'terminal', 'slate', 40));
  p.push(txt(D.x + 100, laneY + 574, 'node 运行时解析', 'cardtitle'));
  p.push(txt(D.x + 100, laneY + 596, '适配任意安装方式', 'small'));
  p.push(txt(D.x + 46, laneY + 628, '$UPDATE_FREEZE_NODE · Homebrew · /usr/local', 'mono', 'font-size="11.6px"'));
  p.push(txt(D.x + 46, laneY + 650, '~/.local/bin · PATH · nvm / volta / fnm', 'mono', 'font-size="11.6px"'));

  // arrows between lanes
  const between = (l1, l2) => ({ from: l1.x + l1.w, to: l2.x, mid: (l1.x + l1.w + l2.x) / 2 });
  const g1 = between(A, B);
  const g2 = between(B, D);

  p.push(arrow(g1.from + 8, laneY + 200, g1.to - 10, laneY + 200, 'blue'));
  p.push(badge(g1.mid, laneY + 200, '1', 'blue'));
  p.push(txt(g1.mid, laneY + 172, '请求清单', 'tiny', `text-anchor="middle" style="fill:${C.blue}"`));

  p.push(arrow(g1.to - 10, laneY + 266, g1.from + 8, laneY + 266, 'green'));
  p.push(badge(g1.mid, laneY + 266, '2', 'green'));
  p.push(txt(g1.mid, laneY + 296, '返回清单', 'tiny', `text-anchor="middle" style="fill:${C.green}"`));

  p.push(arrow(g1.to - 10, laneY + 420, g1.from + 8, laneY + 420, 'violet'));
  p.push(badge(g1.mid, laneY + 420, '3', 'violet'));
  p.push(txt(g1.mid, laneY + 392, '重打补丁', 'tiny', `text-anchor="middle" style="fill:${C.violet}"`));

  p.push(arrow(g1.to - 10, laneY + 520, g1.from + 8, laneY + 520, 'amber'));
  p.push(badge(g1.mid, laneY + 520, '4', 'amber'));
  p.push(txt(g1.mid, laneY + 550, '清理缓存', 'tiny', `text-anchor="middle" style="fill:${C.amber}"`));

  p.push(arrow(g2.to - 10, laneY + 420, g2.from + 8, laneY + 420, 'teal'));
  p.push(badge(g2.mid, laneY + 420, '5', 'teal'));
  p.push(txt(g2.mid, laneY + 392, '状态落盘', 'tiny', `text-anchor="middle" style="fill:${C.teal}"`));

  // properties strip
  const stripY = laneY + laneH + 40;
  const props = [
    ['file_lock', 'blue', '只改 1 个字段', '不碰 app.asar 与可执行文件'],
    ['refresh', 'violet', '按请求读版本', '手动升级后使用新安装版本'],
    ['code', 'teal', '零运行库依赖', '仅 Node 标准库'],
    ['shield', 'green', '有备份可还原', 'revert 逐字节恢复配置'],
  ];
  props.forEach(([ic, key, title, sub], i) => {
    const x = 72 + i * 372;
    p.push(card(x, stripY, 348, 104, { radius: 20, fill: '#FFFFFF' }));
    p.push(iconChip(x + 20, stripY + 22, ic, key, 44));
    p.push(txt(x + 78, stripY + 46, title, 'cardtitle'));
    p.push(txt(x + 78, stripY + 70, sub, 'small'));
  });

  return shell(W, H, p.join('\n'));
}

/* -------------------------------------------------- 3. journey + self-heal */
function journey() {
  const W = 1600;
  const H = 1020;
  const p = [pageTitle(72, 92, '更新判定与漂移处理', '上半：清单如何返回当前版本 · 下半：配置变化后如何重写 url')];

  // ---- top journey
  p.push(card(72, 176, 1456, 316, { radius: 26, shadow: 'lift' }));
  p.push(iconChip(96, 200, 'play', 'blue', 44));
  p.push(txt(154, 222, '正常路径', 'section'));
  p.push(txt(154, 246, '应用负责版本比较；本项目只提供同版本清单', 'section-sub'));

  const steps = [
    { key: 'blue', icon: 'monitor', title: '应用启动', lines: ['读取包内更新配置', 'url 已指向本机'], cmd: 'url: 127.0.0.1:47821' },
    { key: 'indigo', icon: 'arrow', title: '请求清单', lines: ['任意 channel 均应答', '?noCache= 也不影响'], cmd: 'GET /<slug>/<channel>.yml' },
    { key: 'violet', icon: 'bolt', title: '生成清单', lines: ['实时读取已装版本', '拼出合法 files[]'], cmd: 'version: <installed>' },
    { key: 'amber', icon: 'clock', title: '版本比较', lines: ['清单版本 = 已装版本', 'allowDowngrade: false'], cmd: 'compare(current, latest)' },
    { key: 'green', icon: 'check', title: '结果：不更新', lines: ['不触发更新包下载', '当前版本实测显示“已是最新”'], cmd: 'update-not-available' },
  ];
  const cardW = 262;
  const gap = 25;
  const rowY = 280;
  steps.forEach((s, i) => {
    const x = 96 + i * (cardW + gap);
    const isLast = i === steps.length - 1;
    p.push(card(x, rowY, cardW, 190, {
      radius: 18,
      fill: isLast ? '#F7FEF9' : '#FFFFFF',
      stroke: isLast ? '#BBF7D0' : C.line,
      accent: s.key,
      shadow: 'soft',
    }));
    p.push(badge(x + 28, rowY + 30, String(i + 1), s.key, 15));
    p.push(iconChip(x + cardW - 66, rowY + 14, s.icon, s.key, 44));
    p.push(txt(x + 24, rowY + 72, s.title, 'cardtitle'));
    p.push(txt(x + 24, rowY + 100, s.lines[0], 'body'));
    p.push(txt(x + 24, rowY + 122, s.lines[1], 'small'));
    const t = terminal(x + 24, rowY + 136, s.cmd, { w: cardW - 48, size: 11.4, height: 34 });
    p.push(t.svg);
    if (!isLast) p.push(arrow(x + cardW + 3, rowY + 96, x + cardW + gap - 6, rowY + 96, i === 3 ? 'green' : s.key));
  });

  // ---- bottom self-heal
  p.push(card(72, 528, 1456, 336, { radius: 26, shadow: 'lift' }));
  p.push(iconChip(96, 552, 'refresh', 'violet', 44));
  p.push(txt(154, 574, '配置漂移处理', 'section'));
  p.push(txt(154, 598, '应用被重装、升级或自行改写配置后，下个周期如何恢复本地 URL', 'section-sub'));

  const loop = [
    { key: 'slate', icon: 'download', title: '配置被还原', line: '重装 / 升级后 url 回到官方地址' },
    { key: 'violet', icon: 'refresh', title: '对账发现漂移', line: '每 20 秒读一次配置，多应用逐个隔离' },
    { key: 'blue', icon: 'file', title: '只改回 url 一行', line: '写前逐键比对，拒绝不一致结果' },
  ];
  loop.forEach((s, i) => {
    const x = 96 + i * 316;
    p.push(card(x, 634, 292, 150, { radius: 18, accent: s.key, fill: '#FFFFFF' }));
    p.push(iconChip(x + 20, 652, s.icon, s.key, 42));
    p.push(txt(x + 74, 670, s.title, 'cardtitle'));
    p.push(txt(x + 20, 716, s.line, 'small', 'font-size="12px"'));
    if (i < 2) p.push(arrow(x + 295, 700, x + 312, 700, s.key));
  });

  const outcomeX = 1084;
  p.push(card(outcomeX, 626, 444, 84, { radius: 18, fill: '#F7FEF9', stroke: '#BBF7D0', accent: 'green' }));
  p.push(icon('check', outcomeX + 22, 648, 24, { color: C.green }));
  p.push(txt(outcomeX + 58, 660, '成功 · 自动恢复', 'cardtitle'));
  p.push(txt(outcomeX + 58, 686, '日志记 re-applied；仍受 20 秒周期影响', 'small'));

  p.push(card(outcomeX, 726, 444, 118, { radius: 18, fill: '#FFFCF5', stroke: '#FDE68A', accent: 'amber' }));
  p.push(icon('warn', outcomeX + 22, 748, 24, { color: C.amber }));
  p.push(txt(outcomeX + 58, 760, '受限 · 需要你出手', 'cardtitle'));
  p.push(txt(outcomeX + 58, 786, 'macOS 13+ 会拦截后台写入应用包（EPERM）', 'small'));
  const repair = pill(outcomeX + 58, 800, 'node src/cli.mjs repair', { color: 'amber', mono: true, solid: true, size: 11.5, height: 30 });
  p.push(repair.svg);

  p.push(curve(`M1026,700 C1050,690 1052,668 1078,668`, 'green'));
  p.push(curve(`M1026,712 C1054,726 1052,762 1078,764`, 'amber', { dash: true }));

  // why not strip
  const whyY = 900;
  p.push(card(72, whyY, 1456, 104, { radius: 22 }));
  p.push(iconChip(96, whyY + 30, 'bolt', 'rose', 44));
  p.push(txt(154, whyY + 44, '为什么不用别的办法', 'cardtitle', 'font-size="17px"'));
  const alts = [
    ['黑掉更新域名', '请求失败，可能影响同域其他流量', C.rose],
    ['只删已下载的更新包', '应用仍可能再次下载', C.amber],
    ['本机清单（本项目）', '返回正常 HTTP，同版本结束检查', C.green],
  ];
  alts.forEach(([title, sub, color], i) => {
    const x = 470 + i * 346;
    p.push(`<rect x="${x}" y="${whyY + 26}" width="320" height="52" rx="14" fill="#FFFFFF" stroke="${color}" stroke-opacity="0.5"/>`);
    p.push(icon(i === 2 ? 'check' : 'warn', x + 16, whyY + 42, 20, { color }));
    p.push(txt(x + 46, whyY + 50, title, 'body', `style="fill:${C.ink}" font-weight="650"`));
    p.push(txt(x + 46, whyY + 70, sub, 'small', 'font-size="11.6px"'));
  });

  return shell(W, H, p.join('\n'));
}

/* ------------------------------------------------------- 4. control boundary */
function boundary() {
  const W = 1600;
  const H = 900;
  const p = [pageTitle(72, 92, '控制边界', '更新清单在本机控制；业务请求和服务端策略保持原样')];

  p.push(card(72, 176, 700, 520, { radius: 26, fill: '#FFFFFF', stroke: '#BBF7D0', shadow: 'lift' }));
  p.push(`<rect x="72" y="176" width="700" height="520" rx="26" fill="url(#softgreen)"/>`);
  p.push(iconChip(100, 204, 'shield', 'green', 48));
  p.push(txt(164, 226, '本项目可控', 'section'));
  p.push(txt(164, 250, '客户端侧 · 每一项都可还原', 'section-sub'));

  const left = [
    ['file', '更新源 URL', 'app-update.yml → 127.0.0.1:47821/<slug>/'],
    ['server', '清单内容', '任意 channel → “已安装版本”＝“无新版本”'],
    ['trash', '已下载的更新载荷', '看守清理 pending/*（目录名不符则跳过）'],
    ['folder', '原始配置与还原', '逐字节备份 + revert；系统仍可能重新校验'],
  ];
  left.forEach(([ic, title, sub], i) => {
    const y = 284 + i * 102;
    p.push(card(100, y, 644, 86, { radius: 18, fill: '#FFFFFF', stroke: '#DCFCE7' }));
    p.push(iconChip(118, y + 21, ic, 'green', 44));
    p.push(txt(176, y + 40, title, 'cardtitle'));
    p.push(txt(176, y + 64, sub, 'small', 'font-size="12.2px"'));
  });

  p.push(card(828, 176, 700, 520, { radius: 26, fill: '#FFFFFF', stroke: '#FECDD3', shadow: 'lift' }));
  p.push(`<rect x="828" y="176" width="700" height="520" rx="26" fill="url(#softrose)"/>`);
  p.push(iconChip(856, 204, 'cloud', 'rose', 48));
  p.push(txt(920, 226, '服务端决策', 'section'));
  p.push(txt(920, 250, '本项目不修改 · 由 Typeless 服务端和账号策略决定', 'section-sub'));

  const right = [
    ['bolt', '模型与提示词', '转写 / 润色 / 翻译的模型版本随时可变'],
    ['eye', '数据去向与留存', '客户端代码不能证明服务端最终处理方式'],
    ['key', '加密公钥', '客户端会向服务端取得 RSA 公钥'],
    ['clock', '配额与最低版本', '套餐、配额、强制升级要求由服务端判定'],
  ];
  right.forEach(([ic, title, sub], i) => {
    const y = 284 + i * 102;
    p.push(card(856, y, 644, 86, { radius: 18, fill: '#FFFFFF', stroke: '#FFE4E6' }));
    p.push(iconChip(874, y + 21, ic, 'rose', 44));
    p.push(txt(932, y + 40, title, 'cardtitle'));
    p.push(txt(932, y + 64, sub, 'small', 'font-size="12.2px"'));
  });

  p.push(`<line x1="800" y1="176" x2="800" y2="696" stroke="#94A3B8" stroke-width="2.4" stroke-dasharray="10 8"/>`);
  p.push(`<rect x="726" y="396" width="148" height="44" rx="22" fill="url(#lgdark)"/>`);
  p.push(icon('lock', 744, 409, 18, { color: '#FFFFFF' }));
  p.push(txt(770, 424, '信任边界', 'body', 'style="fill:#ffffff" font-weight="650"'));

  p.push(card(72, 728, 1456, 132, { radius: 26, fill: 'url(#lgdark)', stroke: '#1E293B', shadow: 'lift' }));
  p.push(iconChip(104, 758, 'bolt', 'amber', 44));
  p.push(txt(168, 782, '结论：本项目只改变更新清单来源', 'section', 'style="fill:#ffffff" font-size="21px"'));
  p.push(txt(168, 812, '它不代理语音、上下文、历史同步或模型请求，也不能阻止服务端拒绝旧客户端。', 'body', 'style="fill:#CBD5E1" font-size="13.4px"'));

  return shell(W, H, p.join('\n'));
}

/* --------------------------------------------------- 5. state + lifecycle */
function stateAndLifecycle() {
  const W = 1600;
  const H = 940;
  const p = [pageTitle(72, 92, '状态目录与生命周期', '先 revert 和卸载服务，再删除状态目录')];

  p.push(card(72, 176, 760, 620, { radius: 26, shadow: 'lift' }));
  p.push(iconChip(100, 204, 'folder', 'teal', 48));
  p.push(txt(164, 226, '~/.typeless-auto-update-block/', 'section', 'font-size="17px"'));
  p.push(txt(164, 250, 'Windows: %LOCALAPPDATA%\\typeless-auto-update-block', 'section-sub', 'font-size="11px"'));

  const files = [
    ['app/', '工具稳定副本（仓库可移动 / 删除）', 'CLI', 'blue'],
    ['bin/typeless-auto-update-block-agent.sh | .cmd', '运行时解析 node 的启动包装脚本', 'CLI', 'blue'],
    ['backups/<slug>/app-update.yml', '原始配置逐字节备份', 'CLI', 'green'],
    ['backups/<slug>/meta.json', '来源路径、原始 url、备份时间', 'CLI', 'green'],
    ['logs/agent.log', '清单命中、重打补丁、清理缓存、失败提示', 'daemon', 'amber'],
    ['state.json', '冻结清单 / 端口 / 通知限流', 'CLI + daemon', 'violet'],
  ];
  files.forEach(([file, desc, tag, key], i) => {
    const y = 292 + i * 82;
    p.push(card(100, y, 704, 68, { radius: 16, fill: '#FFFFFF', stroke: TINT[key], accent: key }));
    p.push(icon('file', 124, y + 22, 22, { color: C[key] }));
    p.push(txt(156, y + 30, file, 'mono', `style="fill:${C.ink}"`));
    p.push(txt(156, y + 52, desc, 'small'));
    const chip = pill(640, y + 19, tag, { color: key, size: 11.5, height: 30 });
    p.push(chip.svg);
  });

  p.push(card(872, 176, 656, 620, { radius: 26, shadow: 'lift' }));
  p.push(iconChip(900, 204, 'clock', 'violet', 48));
  p.push(txt(964, 226, '生命周期', 'section'));
  p.push(txt(964, 250, '每条命令只影响它该影响的东西', 'section-sub'));

  const steps = [
    ['scan', '只读盘点', '识别更新源，不写任何文件', 'blue'],
    ['freeze', '应用本地 feed', '备份 → 改 url → 安装服务 → 启动守护', 'violet'],
    ['（常态）', '持续运行', '应答清单、20 秒对账、清理缓存、必要时通知', 'green'],
    ['repair', '人工兜底', '系统拦截后台写入时，在你的终端里重新打补丁', 'amber'],
    ['revert', '还原', '恢复原始 url；系统信任状态需重新校验', 'slate'],
    ['agent uninstall', '卸载服务', '删除自启项；状态目录由用户确认后删除', 'rose'],
  ];
  p.push(`<line x1="936" y1="292" x2="936" y2="742" stroke="${C.line}" stroke-width="3"/>`);
  steps.forEach(([cmd, title, desc, key], i) => {
    const y = 320 + i * 78;
    p.push(`<circle cx="936" cy="${y}" r="16" fill="url(#lg${key})"/>`);
    p.push(`<circle cx="936" cy="${y}" r="13.5" fill="none" stroke="#ffffff" stroke-opacity="0.6"/>`);
    p.push(`<text x="936" y="${y + 5.4}" text-anchor="middle" font-size="13" font-weight="750" style="fill:#ffffff">${i + 1}</text>`);
    const chip = pill(972, y - 16, cmd, { color: key, mono: true, size: 12, height: 30 });
    p.push(chip.svg);
    p.push(txt(972 + chip.w + 12, y + 5, title, 'cardtitle', 'font-size="14.5px"'));
    p.push(txt(972, y + 26, desc, 'small', 'font-size="12px"'));
  });

  p.push(card(72, 828, 1456, 76, { radius: 20, fill: '#FFFFFF' }));
  p.push(icon('shield', 100, 850, 22, { color: C.teal }));
  p.push(txt(136, 866, '恢复顺序', 'cardtitle', 'font-size="15px"'));
  p.push(txt(136, 888, '先 revert --all，再 agent uninstall，最后删除状态目录；多数查询命令支持 --json。', 'small'));

  return shell(W, H, p.join('\n'));
}

/* ------------------------------------------------------------- 6. quickstart */
function quickstart() {
  const W = 1600;
  const H = 620;
  const p = [pageTitle(72, 92, '三步上手', '需要 Node 18+ · freeze 会修改应用包内的 app-update.yml')];

  const steps = [
    {
      key: 'blue', icon: 'eye', title: '先看清单', tag: '只读',
      cmd: 'node src/cli.mjs scan',
      lines: ['列出机器上所有带更新源的应用', '同时显示更新源地址与缓存目录'],
    },
    {
      key: 'violet', icon: 'snow', title: '改到本机 feed', tag: '写入备份',
      cmd: 'node src/cli.mjs freeze Typeless',
      lines: ['备份原始配置 → 改为回环地址', '安装自启服务并启动守护进程'],
    },
    {
      key: 'green', icon: 'check', title: '重启应用并验证', tag: '验证',
      cmd: 'node src/cli.mjs status',
      lines: ['应用“检查更新”显示已是最新', '日志出现 feed HIT，pending/ 为空'],
    },
  ];
  steps.forEach((s, i) => {
    const w = 456;
    const x = 72 + i * (w + 44);
    p.push(card(x, 200, w, 272, { radius: 26, shadow: 'lift' }));
    p.push(`<rect x="${x}" y="200" width="${w}" height="86" rx="26" fill="url(#soft${s.key})"/>`);
    p.push(`<path d="M${x},${286}h${w}" stroke="${C.line}" stroke-width="1.3"/>`);
    p.push(badge(x + 44, 243, String(i + 1), s.key, 17));
    p.push(iconChip(x + 78, 221, s.icon, s.key, 46));
    p.push(txt(x + 140, 238, s.title, 'cardtitle', 'font-size="18px"'));
    const tag = pill(x + 140, 250, s.tag, { color: s.key, size: 11.5, height: 28 });
    p.push(tag.svg);
    const term = terminal(x + 28, 314, s.cmd, { w: w - 56, size: 12.4, height: 44 });
    p.push(term.svg);
    p.push(txt(x + 28, 390, s.lines[0], 'body'));
    p.push(txt(x + 28, 414, s.lines[1], 'small'));
    p.push(icon('check', x + 28, 434, 18, { color: C[s.key] }));
    p.push(txt(x + 54, 448, i === 0 ? '不写任何文件' : i === 1 ? '改动可逆' : '确认生效', 'small', `style="fill:${C[s.key]}"`));
    if (i < steps.length - 1) {
      p.push(arrow(x + w + 8, 336, x + w + 36, 336, 'blue', { width: 3.6 }));
    }
  });

  p.push(card(72, 496, 1456, 60, { radius: 20, fill: '#FFFFFF' }));
  p.push(icon('shield', 98, 514, 22, { color: C.green }));
  p.push(txt(132, 532, '想撤销？先运行 node src/cli.mjs revert --all，再检查 agent 和应用签名状态。', 'body'));

  return shell(W, H, p.join('\n'));
}

const files = {
  'hero.svg': hero(),
  'architecture-overview.svg': overview(),
  'update-decision-flow.svg': journey(),
  'controlled-vs-cloud.svg': boundary(),
  'state-and-lifecycle.svg': stateAndLifecycle(),
  'quickstart.svg': quickstart(),
};

for (const [name, svg] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), `${svg.trim()}\n`, 'utf8');
  process.stdout.write(`wrote ${name}\n`);
}
