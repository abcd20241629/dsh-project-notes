window.__ModuleLoader__.load({
  id: 'dsh-project-notes',
  factory(require) {
    const React = require('react');
    const {
      useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, memo,
    } = React;
    const h = React.createElement;

    // ── constants ───────────────────────────────────────────────────────────
    const PANEL_ID = 'project-notes';
    const API = '/api/dsh-project-notes';
    const LAST_KEY = 'pn:last-project';
    const MIN_W = 180;
    const MAX_W = 760;
    const MIN_H = 96;

    const CARD_COLORS = [
      { id: 'yellow', bg: '#fff8dc', line: '#e7dcae', label: '米黄' },
      { id: 'pink', bg: '#ffe9ef', line: '#f0c9d6', label: '淡粉' },
      { id: 'blue', bg: '#e6f2fb', line: '#c2dcee', label: '淡蓝' },
      { id: 'green', bg: '#e9f6e5', line: '#c6e2c0', label: '淡绿' },
      { id: 'purple', bg: '#f2eafb', line: '#d9c8ee', label: '淡紫' },
      { id: 'orange', bg: '#fff0e0', line: '#f2d3b5', label: '淡橙' },
      { id: 'gray', bg: '#f3f4f6', line: '#dadee3', label: '灰白' },
      { id: 'cyan', bg: '#e4f7f6', line: '#bee3e1', label: '淡青' },
      // 深色系：白字压深底，用来把「重点 / 结论 / 待办」从浅色便签里拎出来
      { id: 'navy', bg: '#1f3350', line: '#33507a', label: '深海蓝', text: '#eaf2fd' },
      { id: 'ink', bg: '#23262c', line: '#3a3f47', label: '石墨黑', text: '#eceef2' },
      { id: 'forest', bg: '#1f3a2c', line: '#2f5a41', label: '墨绿', text: '#e5f6eb' },
      { id: 'wine', bg: '#3d2029', line: '#5e3340', label: '酒红', text: '#fae9ee' },
      { id: 'dusk', bg: '#2f2547', line: '#46396a', label: '暗紫', text: '#efe9fc' },
      { id: 'brown', bg: '#3a2c20', line: '#574132', label: '暗褐', text: '#f7eee2' },
    ];
    const COLOR_BY_ID = Object.fromEntries(CARD_COLORS.map((c) => [c.id, c]));

    const MARKS = [
      { id: 'yellow', color: '#ffe58a' },
      { id: 'pink', color: '#ffb3c6' },
      { id: 'blue', color: '#a8d8ff' },
      { id: 'green', color: '#b6edb0' },
      { id: 'purple', color: '#d7c4ff' },
      { id: 'orange', color: '#ffc98a' },
    ];
    const MARK_BY_ID = Object.fromEntries(MARKS.map((m) => [m.id, m]));

    const LINK_BLUE = '#35c8ff';
    const LINK_HOT = '#ffffff';
    const CARD_TEXT = '#22262c';

    // ── tiny helpers ────────────────────────────────────────────────────────
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

    function uid(prefix) {
      return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    }

    async function api(method, body) {
      const response = await fetch(`${API}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!payload || payload.ok !== true) {
        const message = payload && payload.message ? payload.message : `request failed (${response.status})`;
        throw new Error(message);
      }
      return payload.value;
    }

    async function apiKeepalive(method, body) {
      try {
        await fetch(`${API}/${method}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body || {}),
          keepalive: true,
        });
      } catch {
        // Leaving the page: nothing useful to do with the failure.
      }
    }

    function escapeText(text) {
      return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    const MARK_IDS = new Set(MARKS.map((m) => m.id));

    /** Rebuild card HTML from a DOM tree with a strict allow-list. */
    function sanitizeNode(node) {
      let out = '';
      const children = node.childNodes ? Array.from(node.childNodes) : [];
      for (const child of children) {
        if (child.nodeType === 3) {
          out += escapeText(child.nodeValue || '');
          continue;
        }
        if (child.nodeType !== 1) continue;
        const tag = child.tagName ? child.tagName.toLowerCase() : '';
        const inner = sanitizeNode(child);
        if (tag === 'b' || tag === 'strong') {
          out += `<b>${inner}</b>`;
        } else if (tag === 'mark') {
          const color = child.getAttribute('data-color');
          out += MARK_IDS.has(color) ? `<mark data-color="${color}">${inner}</mark>` : inner;
        } else if (tag === 'br') {
          out += '<br>';
        } else if (tag === 'div' || tag === 'p') {
          out += `<div>${inner}</div>`;
        } else {
          out += inner;
        }
      }
      return out;
    }

    function sanitizeHtml(dirty) {
      const holder = document.createElement('div');
      holder.innerHTML = String(dirty || '');
      const clean = sanitizeNode(holder);
      return clean || '<div><br></div>';
    }

    function plainText(html) {
      const holder = document.createElement('div');
      holder.innerHTML = String(html || '');
      return (holder.innerText || holder.textContent || '').replace(/\u00a0/g, ' ').trim();
    }

    // True only for real text entry: a hidden <input type=file> must never
    // count, or Ctrl+G / Delete get swallowed while it happens to own focus.
    function isTextField(el) {
      if (!el) return false;
      if (el.isContentEditable) return true;
      if (el.tagName === 'TEXTAREA') return true;
      if (el.tagName !== 'INPUT') return false;
      const type = String(el.getAttribute('type') || 'text').toLowerCase();
      return type === 'text' || type === 'search' || type === 'url' || type === 'email'
        || type === 'password' || type === 'number' || type === 'tel';
    }

    function htmlToMarkdown(html) {
      let out = '';
      const walk = (node) => {
        for (const child of Array.from(node.childNodes || [])) {
          if (child.nodeType === 3) {
            out += child.nodeValue || '';
            continue;
          }
          if (child.nodeType !== 1) continue;
          const tag = child.tagName.toLowerCase();
          if (tag === 'b' || tag === 'strong') out += '**';
          if (tag === 'mark') out += '==';
          if (tag === 'div' || tag === 'p') out += out.endsWith('\n') ? '' : '\n';
          if (tag === 'br') out += '\n';
          walk(child);
          if (tag === 'b' || tag === 'strong') out += '**';
          if (tag === 'mark') out += '==';
        }
      };
      const holder = document.createElement('div');
      holder.innerHTML = String(html || '');
      walk(holder);
      return out.replace(/\n{3,}/g, '\n\n').trim();
    }

    function cardHeight(card, heights) {
      const measured = heights.get(card.id);
      return Math.max(card.h || MIN_H, measured || 0);
    }

    // The link label is a single-line input that hugs its text: empty = a tiny
    // square, otherwise width follows the measured text so nothing is cut off.
    let labelMeasureCtx = null;
    function labelWidth(text) {
      const value = text || '';
      if (!value) return 22;
      try {
        if (!labelMeasureCtx) labelMeasureCtx = document.createElement('canvas').getContext('2d');
        const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
        labelMeasureCtx.font = `12px ${family}`;
        const measured = labelMeasureCtx.measureText(value).width;
        return Math.min(600, Math.max(30, Math.ceil(measured) + 16));
      } catch (error) {
        let approx = 0;
        for (const ch of value) approx += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? 12.5 : 7;
        return Math.min(600, Math.max(30, Math.ceil(approx) + 16));
      }
    }

    function anchorOf(card, height, side) {
      const w = card.w;
      const cx = card.x + w / 2;
      const cy = card.y + height / 2;
      if (side === 'left') return { x: card.x, y: cy };
      if (side === 'right') return { x: card.x + w, y: cy };
      if (side === 'top') return { x: cx, y: card.y };
      return { x: cx, y: card.y + height };
    }

    function nearestAnchor(card, height, point) {
      const sides = ['left', 'right', 'top', 'bottom'];
      let best = null;
      for (const side of sides) {
        const p = anchorOf(card, height, side);
        const d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2;
        if (best === null || d < best.d) best = { side, point: p, d };
      }
      return best;
    }

    // ── styles ──────────────────────────────────────────────────────────────
    const CSS = `
.pn-root{height:100%;display:flex;flex-direction:column;min-height:0;
  background:rgba(247,248,250,.985);color:var(--dsw-alias-text-primary,#1f2328);
  font-family:inherit;font-size:inherit;overflow:hidden;position:relative}
.pn-bar{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:8px 12px;
  border-bottom:1px solid var(--dsw-alias-border-subtle,rgba(0,0,0,.08));min-height:44px;background:transparent}
.pn-title{font-weight:600;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px}
.pn-spacer{flex:1 1 auto}
.pn-btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:8px;
  border:1px solid var(--dsw-alias-border-subtle,rgba(0,0,0,.12));background:transparent;color:inherit;
  font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}
.pn-btn:hover{background:var(--dsw-alias-bg-hover,rgba(0,0,0,.05))}
.pn-btn:disabled{opacity:.4;cursor:default}
.pn-btn.primary{background:#2f7cf6;border-color:#2f7cf6;color:#fff}
.pn-btn.primary:hover{background:#2a6fe0}
.pn-btn.ghost{border-color:transparent}
.pn-btn.ghost:hover{background:var(--dsw-alias-bg-hover,rgba(0,0,0,.05))}
.pn-icon{width:26px;height:26px;padding:0;justify-content:center}
.pn-muted{color:var(--dsw-alias-text-tertiary,#8a919b);font-size:12px}
.pn-body{flex:1 1 auto;min-height:0;position:relative;overflow:hidden}

.pn-list{height:100%;overflow:auto;padding:24px}
.pn-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}
.pn-pcard{position:relative;border:1px solid var(--dsw-alias-border-subtle,rgba(0,0,0,.1));border-radius:12px;
  padding:14px 14px 12px;cursor:pointer;background:var(--dsw-alias-bg-elevated,#fff);transition:box-shadow .15s,border-color .15s}
.pn-pcard:hover{border-color:#2f7cf6;box-shadow:0 4px 16px rgba(0,0,0,.08)}
.pn-pcard h3{margin:0 0 8px;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:22px}
.pn-pcard .meta{display:flex;gap:10px;font-size:12px;color:var(--dsw-alias-text-tertiary,#8a919b)}
.pn-pcard .more{position:absolute;top:8px;right:8px;width:22px;height:22px;border:0;background:transparent;
  color:inherit;border-radius:6px;cursor:pointer;font-size:15px;line-height:1;opacity:.55}
.pn-pcard .more:hover{background:rgba(0,0,0,.07);opacity:1}
.pn-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;
  height:100%;color:var(--dsw-alias-text-tertiary,#8a919b);font-size:13px}

.pn-canvas{position:relative;flex:1 1 auto;min-height:0;overflow:hidden;
  background-image:radial-gradient(circle,rgba(0,0,0,.12) 1px,transparent 1px);
  background-size:24px 24px;background-position:0 0;cursor:default;user-select:none}
.pn-canvas.panning{cursor:grabbing}
.pn-world{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}
.pn-links{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}
.pn-links-layer{inset:0;width:100%;height:100%;z-index:1}
.pn-label-layer{position:absolute;inset:0;pointer-events:none;z-index:5}
.pn-link-hit{stroke:transparent;stroke-width:16;pointer-events:stroke;cursor:pointer}
.pn-label{position:absolute;transform:translate(-50%,-50%);font:inherit;font-size:12px;line-height:20px;
  text-align:center;padding:0 5px;height:22px;border-radius:7px;border:1px solid rgba(53,200,255,.9);
  background:rgba(255,255,255,.95);color:#0b3a4d;min-width:22px;box-sizing:border-box;
  box-shadow:0 2px 8px rgba(0,0,0,.22);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:auto;cursor:text;z-index:6}
.pn-label::placeholder{color:rgba(11,58,77,.35)}
.pn-label:focus{outline:2px solid #35c8ff;background:#fff}

.pn-group{position:absolute;border-radius:14px;pointer-events:none;z-index:0;
  border:1.5px dashed rgba(64,128,255,.45);background:rgba(64,128,255,.055)}
.pn-group-title{position:absolute;left:12px;top:-12px;pointer-events:auto;cursor:grab;
  font-weight:700;font-size:1.3em;line-height:1;padding:3px 9px;border-radius:6px;
  background:#fff;color:#2c5cc5;white-space:nowrap;max-width:420px;box-shadow:0 1px 5px rgba(0,0,0,.14);
  overflow:hidden;text-overflow:ellipsis}
.pn-group-title:active{cursor:grabbing}

.pn-card{position:absolute;border-radius:10px;border:1px solid;box-shadow:0 2px 10px rgba(0,0,0,.07);
  display:flex;flex-direction:column;z-index:2;box-sizing:border-box;transition:box-shadow .12s,border-color .12s}
.pn-card.selected{box-shadow:0 0 0 2px #2f7cf6,0 6px 20px rgba(47,124,246,.22);z-index:3}
.pn-card.dragging{box-shadow:0 10px 26px rgba(0,0,0,.18);transition:none}
.pn-card-head{display:flex;align-items:center;gap:2px;padding:4px 4px 0 6px;min-height:22px;cursor:grab;flex:0 0 auto}
.pn-card-head:active{cursor:grabbing}
.pn-card-body{flex:1 1 auto;min-height:0;padding:2px 10px 8px;outline:none;cursor:text;
  font:inherit;font-size:1em;line-height:1.65;color:inherit;overflow-wrap:anywhere;word-break:break-word}
.pn-card-body div{min-height:1.65em}
.pn-card-body mark{border-radius:2px;padding:0 1px;color:#1f2328;background:#ffe58a}
.pn-card-body mark[data-color="yellow"]{background:#ffe58a}
.pn-card-body mark[data-color="pink"]{background:#ffb3c6}
.pn-card-body mark[data-color="blue"]{background:#a8d8ff}
.pn-card-body mark[data-color="green"]{background:#b6edb0}
.pn-card-body mark[data-color="purple"]{background:#d7c4ff}
.pn-card-body mark[data-color="orange"]{background:#ffc98a}
.pn-card-body:empty::before{content:'写点什么…';color:currentColor;opacity:.42}
.pn-card-tools{display:flex;align-items:center;gap:2px;margin-left:auto}
.pn-mini{width:22px;height:22px;border:0;background:transparent;border-radius:5px;cursor:pointer;
  color:inherit;opacity:.55;font-size:13px;line-height:1;display:inline-flex;align-items:center;justify-content:center;padding:0}
.pn-mini:hover{background:rgba(127,127,127,.24);opacity:1}
.pn-mini.on{color:#e0a000;opacity:1}
.pn-attach{flex:0 0 auto;display:flex;flex-wrap:wrap;gap:4px;padding:0 8px 7px}
.pn-attach-item{position:relative;display:inline-flex;align-items:center;gap:4px;max-width:100%;font-size:11px;
  padding:2px 6px;border-radius:6px;background:rgba(127,127,127,.16);border:1px solid rgba(127,127,127,.36);
  cursor:pointer;color:inherit;overflow:hidden}
.pn-attach-item span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px}
.pn-attach-item:hover{background:#fff}
.pn-attach-x{display:none;position:absolute;right:-6px;top:-6px;width:15px;height:15px;border-radius:50%;
  background:#e0483d;color:#fff;font-size:11px;line-height:15px;text-align:center;cursor:pointer;
  box-shadow:0 1px 4px rgba(0,0,0,.3)}
.pn-attach-item:hover .pn-attach-x{display:block}
.pn-thumb-wrap{flex:0 0 auto;padding:0 8px 7px;display:flex;flex-wrap:wrap;gap:6px}
.pn-thumb{position:relative;border-radius:7px;overflow:hidden;border:1px solid rgba(0,0,0,.12);cursor:pointer;
  background:rgba(255,255,255,.55);line-height:0}
.pn-thumb img{display:block;max-width:150px;max-height:110px;object-fit:cover}
.pn-thumb:hover{border-color:#2f7cf6}
.pn-thumb .pn-attach-x{display:none}
.pn-thumb:hover .pn-attach-x{display:block}
.pn-marquee{position:absolute;border:1px solid #2f7cf6;background:rgba(47,124,246,.10);z-index:30;pointer-events:none;border-radius:2px}
.pn-group-resize{position:absolute;right:-2px;bottom:-2px;width:16px;height:16px;cursor:nwse-resize;z-index:6;pointer-events:auto}
.pn-group-resize::after{content:'';position:absolute;right:4px;bottom:4px;width:7px;height:7px;
  border-right:2px solid rgba(90,150,230,.75);border-bottom:2px solid rgba(90,150,230,.75)}
.pn-resize{position:absolute;right:-2px;bottom:-2px;width:14px;height:14px;cursor:nwse-resize;z-index:5}
.pn-resize::after{content:'';position:absolute;right:3px;bottom:3px;width:7px;height:7px;
  border-right:2px solid rgba(0,0,0,.3);border-bottom:2px solid rgba(0,0,0,.3);border-radius:0 0 2px 0}
.pn-dot{position:absolute;width:9px;height:9px;border-radius:50%;background:#2f7cf6;border:1.5px solid #fff;
  opacity:0;transition:opacity .12s;z-index:4;cursor:crosshair}
.pn-card:hover .pn-dot{opacity:.85}
.pn-dot:hover{opacity:1;transform:scale(1.25)}

.pn-menu{position:fixed;z-index:2000;min-width:188px;padding:6px;border-radius:10px;
  background:#fff;color:#1f2328;border:1px solid rgba(0,0,0,.12);
  box-shadow:0 10px 30px rgba(0,0,0,.18);font-size:13px}
.pn-menu-item{display:flex;align-items:center;gap:8px;padding:6px 9px;border-radius:6px;cursor:pointer;white-space:nowrap}
.pn-menu button.pn-menu-item{border:0;background:transparent;color:inherit;font:inherit;width:100%;text-align:left}
.pn-menu-item:hover{background:var(--dsw-alias-bg-hover,rgba(0,0,0,.06))}
.pn-menu-item.danger{color:#d33}
.pn-menu-sep{height:1px;margin:5px 4px;background:var(--dsw-alias-border-subtle,rgba(0,0,0,.08))}
.pn-swatches{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;padding:2px 4px 6px}
.pn-swatch{width:34px;height:24px;border-radius:6px;border:1px solid rgba(0,0,0,.14);cursor:pointer}
.pn-swatch.on{outline:2px solid #2f7cf6;outline-offset:1px}

.pn-toolbar{position:fixed;z-index:2100;display:flex;align-items:center;gap:3px;padding:4px 6px;
  border-radius:10px;background:#1f2328;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.3)}
.pn-toolbar button{width:24px;height:24px;border:0;border-radius:6px;background:transparent;color:#fff;
  cursor:pointer;font-size:13px;display:inline-flex;align-items:center;justify-content:center;padding:0}
.pn-toolbar button:hover{background:rgba(255,255,255,.16)}
.pn-toolbar .sep{width:1px;height:16px;background:rgba(255,255,255,.22);margin:0 2px}
.pn-toolbar .chip{width:18px;height:18px;border-radius:4px;border:1px solid rgba(255,255,255,.5)}

.pn-dialog-mask{position:fixed;inset:0;z-index:3000;background:rgba(15,18,22,.42);
  display:flex;align-items:center;justify-content:center;padding:24px}
.pn-dialog{width:min(420px,92vw);border-radius:14px;padding:18px;
  background:var(--dsw-alias-bg-elevated,#fff);color:inherit;box-shadow:0 24px 60px rgba(0,0,0,.3)}
.pn-dialog h3{margin:0 0 14px;font-size:15px;font-weight:600}
.pn-dialog input{width:100%;box-sizing:border-box;height:36px;padding:0 10px;border-radius:8px;
  border:1px solid var(--dsw-alias-border-subtle,rgba(0,0,0,.2));background:transparent;color:inherit;font:inherit;font-size:13px}
.pn-dialog input:focus{outline:2px solid #2f7cf6;outline-offset:-1px}
.pn-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}

.pn-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:3200;
  padding:8px 14px;border-radius:9px;background:rgba(24,28,34,.92);color:#fff;font-size:13px;
  box-shadow:0 8px 24px rgba(0,0,0,.26);pointer-events:none}
.pn-zoom{position:absolute;right:14px;bottom:14px;z-index:50;display:flex;align-items:center;gap:4px;
  padding:4px;border-radius:9px;background:var(--dsw-alias-bg-elevated,rgba(255,255,255,.94));
  border:1px solid var(--dsw-alias-border-subtle,rgba(0,0,0,.12));box-shadow:0 4px 14px rgba(0,0,0,.08)}
.pn-zoom span{font-size:12px;min-width:42px;text-align:center;color:var(--dsw-alias-text-tertiary,#6b7280)}
.pn-hint{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:1;
  text-align:center;color:var(--dsw-alias-text-tertiary,#94a0ad);font-size:13px;line-height:2;pointer-events:none}
.pn-hint kbd{font:inherit;font-size:12px;padding:1px 5px;border-radius:4px;border:1px solid rgba(0,0,0,.14);background:rgba(0,0,0,.04)}

/* Right-hand dock: shares the frame with the conversation instead of replacing it. */
.pn-dock{position:fixed;right:0;top:0;bottom:0;z-index:60;display:flex;flex-direction:column;
  pointer-events:auto;color:#1f2328;font-family:inherit;font-size:inherit;
  background:rgba(247,248,250,.99);
  border-left:1px solid rgba(0,0,0,.12);box-shadow:-10px 0 34px rgba(0,0,0,.26)}
.pn-dock-grip{position:absolute;left:-4px;top:0;bottom:0;width:9px;cursor:col-resize;z-index:3}
.pn-dock-grip:hover{background:rgba(47,124,246,.28)}
.pn-dock-head{flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:6px 10px;
  border-bottom:1px solid rgba(0,0,0,.1);min-height:38px}
.pn-dock-title{font-weight:600;font-size:13px;margin-right:auto}
.pn-dock-body{flex:1 1 auto;min-height:0;position:relative;overflow:hidden}
@media (prefers-color-scheme:dark){
  .pn-root{background:rgba(18,20,24,.84);color:#e7e9ec}
  .pn-title,.pn-name,.pn-pcard h3,.pn-dock-title{color:#eef1f5}
  .pn-pcard{background:rgba(32,35,40,.9);border-color:rgba(255,255,255,.13)}
  .pn-pcard:hover{border-color:#2f7cf6}
  .pn-zoom{background:rgba(32,35,40,.94)}
  .pn-hint{color:rgba(230,234,240,.6)}
  .pn-canvas{background-image:radial-gradient(circle,rgba(255,255,255,.14) 1px,transparent 1px)}
  .pn-dock{background:rgba(18,20,24,.96);color:#e7e9ec;border-left-color:rgba(255,255,255,.14)}
  .pn-dock-head{border-bottom-color:rgba(255,255,255,.12)}
}
`;

    // ── shared runtime bits ─────────────────────────────────────────────────
    let pluginCtx = null;

    // Right-hand dock: one module-level flag shared by the sidebar entry, the
    // canvas toolbar and the dock itself.
    const DOCK_OPEN_KEY = 'pn:dock-open';
    const DOCK_WIDTH_KEY = 'pn:dock-width';
    const dockListeners = new Set();
    const dockState = { open: false };
    try { dockState.open = localStorage.getItem(DOCK_OPEN_KEY) === '1'; } catch { dockState.open = false; }

    function notifyDock() {
      for (const fn of dockListeners) {
        try { fn(dockState.open); } catch { /* a dead listener must not break the rest */ }
      }
    }

    function setDockOpen(next) {
      const value = !!next;
      if (dockState.open === value) return;
      dockState.open = value;
      try {
        if (value) localStorage.setItem(DOCK_OPEN_KEY, '1');
        else localStorage.removeItem(DOCK_OPEN_KEY);
      } catch { /* ignore */ }
      notifyDock();
    }

    function useDockOpen() {
      const [open, setOpen] = useState(dockState.open);
      useEffect(() => {
        const fn = (value) => setOpen(value);
        dockListeners.add(fn);
        fn(dockState.open);
        return () => { dockListeners.delete(fn); };
      }, []);
      return open;
    }

    function dockToSide() {
      setDockOpen(true);
      try {
        const layout = pluginCtx && pluginCtx.get ? pluginCtx.get('layout') : null;
        if (layout) layout.selectPanel(null);
      } catch { /* ignore */ }
    }

    function goConversation() {
      try {
        const layout = pluginCtx && pluginCtx.get ? pluginCtx.get('layout') : null;
        if (layout && typeof layout.selectPanel === 'function') layout.selectPanel('conversation');
      } catch {
        // Older/newer host without the layout action: the copy still happened.
      }
    }

    // ── icons ───────────────────────────────────────────────────────────────
    function PanelIcon({ size }) {
      const s = size || 16;
      return h('svg', {
        width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      },
        h('rect', { x: 2.5, y: 4, width: 8.5, height: 6.5, rx: 2 }),
        h('rect', { x: 13, y: 13.5, width: 8.5, height: 6.5, rx: 2 }),
        h('path', { d: 'M7 10.5c0 4 2.5 5.5 9 5.5' }),
        h('circle', { cx: 7, cy: 13.2, r: 0.9, fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 16.6, cy: 13.2, r: 0.9, fill: 'currentColor', stroke: 'none' }),
      );
    }

    // ── dialog ──────────────────────────────────────────────────────────────
    function NameDialog({ open, title, initial, confirmText, placeholder, onCancel, onConfirm }) {
      const [value, setValue] = useState(initial || '');
      const inputRef = useRef(null);
      useEffect(() => {
        if (open) {
          setValue(initial || '');
          const timer = setTimeout(() => {
            if (inputRef.current) {
              inputRef.current.focus();
              inputRef.current.select();
            }
          }, 30);
          return () => clearTimeout(timer);
        }
        return undefined;
      }, [open, initial]);
      if (!open) return null;
      const submit = () => {
        const name = value.trim();
        if (name === '') return;
        onConfirm(name);
      };
      return h('div', { className: 'pn-dialog-mask', onMouseDown: (e) => { if (e.target === e.currentTarget) onCancel(); } },
        h('div', { className: 'pn-dialog', role: 'dialog', 'aria-modal': 'true' },
          h('h3', null, title),
          h('input', {
            ref: inputRef,
            value,
            onChange: (e) => setValue(e.target.value),
            onKeyDown: (e) => {
              if (e.key === 'Enter') { e.preventDefault(); submit(); }
              if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
            },
            placeholder: placeholder || '项目名称',
          }),
          h('div', { className: 'pn-dialog-actions' },
            h('button', { type: 'button', className: 'pn-btn ghost', onClick: onCancel }, '取消'),
            h('button', { type: 'button', className: 'pn-btn primary', onClick: submit, disabled: value.trim() === '' }, confirmText || '确定'),
          ),
        ),
      );
    }

    // ── text toolbar (bold / highlight) ─────────────────────────────────────
    function TextToolbar({ state, onBold, onMark, onClear }) {
      if (!state) return null;
      return h('div', { className: 'pn-toolbar', style: { left: state.x, top: state.y }, onMouseDown: (e) => e.preventDefault() },
        h('button', { type: 'button', title: '加粗 (Ctrl+B)', onMouseDown: (e) => e.preventDefault(), onClick: onBold }, h('b', null, 'B')),
        h('div', { className: 'sep' }),
        ...MARKS.map((mark) => h('button', {
          key: mark.id,
          type: 'button',
          title: '荧光笔',
          onMouseDown: (e) => e.preventDefault(),
          onClick: () => onMark(mark.id),
        }, h('i', { className: 'chip', style: { background: mark.color } }))),
        h('div', { className: 'sep' }),
        h('button', { type: 'button', title: '清除格式', onMouseDown: (e) => e.preventDefault(), onClick: onClear }, '⌫'),
      );
    }

    function readSelectionState() {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
      const range = sel.getRangeAt(0);
      const body = range.commonAncestorContainer.nodeType === 1
        ? range.commonAncestorContainer.closest && range.commonAncestorContainer.closest('[data-card-body]')
        : range.commonAncestorContainer.parentElement && range.commonAncestorContainer.parentElement.closest('[data-card-body]');
      if (!body) return null;
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return null;
      return {
        cardId: body.getAttribute('data-card-body'),
        x: clamp(rect.left + rect.width / 2 - 92, 8, window.innerWidth - 200),
        y: rect.top < 60 ? rect.bottom + 10 : rect.top - 46,
      };
    }

    function applyBold() {
      try { document.execCommand('bold'); } catch { /* noop */ }
    }

    function applyMark(colorId) {
      const mark = MARK_BY_ID[colorId];
      const sel = window.getSelection();
      if (!mark || !sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      if (!range.commonAncestorContainer.parentElement
        && !(range.commonAncestorContainer.closest && range.commonAncestorContainer.closest('[data-card-body]'))) return;
      const node = document.createElement('mark');
      node.setAttribute('data-color', colorId);
      try {
        range.surroundContents(node);
      } catch {
        const fragment = range.extractContents();
        node.appendChild(fragment);
        range.insertNode(node);
      }
      sel.removeAllRanges();
      const next = document.createRange();
      next.selectNodeContents(node);
      sel.addRange(next);
    }

    function applyClear() {
      try { document.execCommand('removeFormat'); } catch { /* noop */ }
    }

    // ── card ────────────────────────────────────────────────────────────────
    const IMG_RE = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i;

    function attachmentUrl(docId, stored) {
      return `${API}/attachment?id=${encodeURIComponent(docId)}&stored=${encodeURIComponent(stored)}`;
    }

    const Card = memo(function Card({
      card, docId, epoch, selected, zoom, onPatch, onFocus, onBlur, onMeasure,
      onGrab, onDot, onResizeStart, onContext, onAttach, onOpenAttachment, onRemoveAttachment,
    }) {
      const rootRef = useRef(null);
      const bodyRef = useRef(null);
      const fileRef = useRef(null);
      const color = COLOR_BY_ID[card.color] || CARD_COLORS[0];
      const [attMenu, setAttMenu] = useState(null);
      const [editing, setEditing] = useState(false);

      useLayoutEffect(() => {
        if (!editing) return;
        const el = bodyRef.current;
        if (!el) return;
        el.focus();
        const sel = window.getSelection();
        if (!sel) return;
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }, [editing]);

      useEffect(() => {
        if (!attMenu) return undefined;
        const close = () => setAttMenu(null);
        window.addEventListener('mousedown', close);
        return () => window.removeEventListener('mousedown', close);
      }, [attMenu]);

      useLayoutEffect(() => {
        const el = bodyRef.current;
        if (el && el.innerHTML !== card.html) el.innerHTML = card.html;
        // epoch bumps on load/undo so external rewrites replace stale editor content.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [epoch, card.id]);

      useLayoutEffect(() => {
        const el = rootRef.current;
        if (!el) return undefined;
        onMeasure(card.id, el.offsetHeight);
        if (typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(() => onMeasure(card.id, el.offsetHeight));
        observer.observe(el);
        return () => observer.disconnect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [card.id]);

      const dots = [
        { side: 'left', style: { left: -5, top: '50%', transform: 'translateY(-50%)' } },
        { side: 'right', style: { right: -5, top: '50%', transform: 'translateY(-50%)' } },
        { side: 'top', style: { top: -5, left: '50%', transform: 'translateX(-50%)' } },
        { side: 'bottom', style: { bottom: -5, left: '50%', transform: 'translateX(-50%)' } },
      ];

      const attachFiles = card.attachments || [];
      const images = attachFiles.filter((f) => IMG_RE.test(f.name));
      const others = attachFiles.filter((f) => !IMG_RE.test(f.name));

      const openAttMenu = (e, file) => {
        e.preventDefault();
        e.stopPropagation();
        setAttMenu({
          x: Math.max(8, Math.min(e.clientX, window.innerWidth - 200)),
          y: Math.max(8, Math.min(e.clientY, window.innerHeight - 140)),
          file,
        });
      };

      const removeButton = (file) => h('span', {
        className: 'pn-attach-x',
        title: '删除附件',
        onMouseDown: (e) => e.stopPropagation(),
        onClick: (e) => { e.stopPropagation(); onRemoveAttachment(card.id, file); },
      }, '×');

      function renderAttachments() {
        const out = [];
        if (images.length > 0) {
          out.push(h('div', { key: 'thumbs', className: 'pn-thumb-wrap' }, ...images.map((file) => h('div', {
            key: file.stored,
            className: 'pn-thumb',
            title: file.name,
            onClick: (e) => { e.stopPropagation(); onOpenAttachment(card.id, file); },
            onContextMenu: (e) => openAttMenu(e, file),
          },
            h('img', { src: attachmentUrl(docId, file.stored), alt: file.name, draggable: false }),
            removeButton(file),
          ))));
        }
        if (others.length > 0) {
          out.push(h('div', { key: 'files', className: 'pn-attach' }, ...others.map((file) => h('div', {
            key: file.stored,
            className: 'pn-attach-item',
            title: file.name,
            onClick: (e) => { e.stopPropagation(); onOpenAttachment(card.id, file); },
            onContextMenu: (e) => openAttMenu(e, file),
          },
            h('span', null, file.name),
            removeButton(file),
          ))));
        }
        return out;
      }

      const attachMenuEl = attMenu ? h('div', {
        className: 'pn-menu',
        style: { left: attMenu.x, top: attMenu.y, minWidth: 150 },
        onMouseDown: (e) => e.stopPropagation(),
      },
        h('div', {
          className: 'pn-menu-item',
          onClick: async () => {
            const file = attMenu.file;
            setAttMenu(null);
            const res = await api('attach-path', { id: docId, stored: file.stored });
            if (res && res.ok && res.path) copyText(res.path);
          },
        }, '⧉ 复制文件路径'),
        h('div', {
          className: 'pn-menu-item',
          onClick: () => { const file = attMenu.file; setAttMenu(null); onOpenAttachment(card.id, file); },
        }, '↗ 打开'),
        h('div', { className: 'pn-menu-sep' }),
        h('div', {
          className: 'pn-menu-item danger',
          onClick: () => { const file = attMenu.file; setAttMenu(null); onRemoveAttachment(card.id, file); },
        }, '✕ 删除附件'),
      ) : null;

      return h('div', {
        ref: rootRef,
        className: 'pn-card' + (selected ? ' selected' : ''),
        'data-card-id': card.id,
        style: {
          left: card.x,
          top: card.y,
          width: card.w,
          minHeight: card.h || MIN_H,
          background: color.bg,
          borderColor: color.line,
          color: color.text || CARD_TEXT,
        },
        onMouseDown: (e) => {
          if (e.button !== 0) return;
          if (e.target.closest('[data-card-body]') && !e.altKey) return;
          if (e.target.closest('.pn-dot') || e.target.closest('.pn-resize')) return;
          if (e.target.closest('button')) return;
          onGrab(e, card.id);
        },
        onContextMenu: (e) => {
          e.preventDefault();
          e.stopPropagation();
          onContext(e, card.id);
        },
      },
        h('div', { className: 'pn-card-head' },
          h('div', { className: 'pn-card-tools' },
            h('button', {
              type: 'button',
              className: 'pn-mini' + (card.starred ? ' on' : ''),
              title: card.starred ? '取消收藏' : '收藏',
              onMouseDown: (e) => e.stopPropagation(),
              onClick: (e) => { e.stopPropagation(); onPatch(card.id, { starred: !card.starred }); },
            }, card.starred ? '★' : '☆'),
            h('button', {
              type: 'button',
              className: 'pn-mini',
              title: '复制卡片内容',
              onMouseDown: (e) => e.stopPropagation(),
              onClick: (e) => {
                e.stopPropagation();
                const text = plainText(card.html);
                copyText(text);
              },
            }, '⧉'),
            h('button', {
              type: 'button',
              className: 'pn-mini',
              title: '添加附件',
              onMouseDown: (e) => e.stopPropagation(),
              onClick: (e) => { e.stopPropagation(); if (fileRef.current) fileRef.current.click(); },
            }, '📎'),
          ),
          h('input', {
            ref: fileRef,
            type: 'file',
            multiple: true,
            style: { display: 'none' },
            onChange: (e) => {
              const files = Array.from(e.target.files || []);
              e.target.value = '';
              if (files.length > 0) onAttach(card.id, files);
            },
          }),
        ),
        h('div', {
          ref: bodyRef,
          className: 'pn-card-body',
          contentEditable: editing,
          suppressContentEditableWarning: true,
          'data-card-body': card.id,
          style: { fontSize: '1em' },
          onMouseDown: (e) => {
            if (editing) return;
            e.preventDefault();
            onFocus(card.id);
          },
          onDoubleClick: (e) => {
            e.stopPropagation();
            setEditing(true);
          },
          onBlur: () => {
            setEditing(false);
            onBlur(card.id);
          },
          onInput: () => {
            if (bodyRef.current) onPatch(card.id, { html: sanitizeHtml(bodyRef.current.innerHTML) }, { history: false });
          },
          onPaste: (e) => {
            e.preventDefault();
            const text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
            try { document.execCommand('insertText', false, text); } catch { /* noop */ }
          },
          onKeyDown: (e) => {
            if (e.key === 'Escape') { e.preventDefault(); bodyRef.current && bodyRef.current.blur(); }
          },
        }),
        ...renderAttachments(),
        ...dots.map((dot) => h('div', {
          key: dot.side,
          className: 'pn-dot',
          style: dot.style,
          title: '拖出连线',
          onMouseDown: (e) => { e.stopPropagation(); onDot(e, card.id, dot.side); },
        })),
        h('div', {
          className: 'pn-resize',
          title: '拖动调整大小',
          onMouseDown: (e) => { e.stopPropagation(); onResizeStart(e, card.id); },
        }),
        attachMenuEl,
      );
    });

    function copyText(text) {
      const value = String(text || '');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).catch(() => fallbackCopy(value));
        return;
      }
      fallbackCopy(value);
    }

    function fallbackCopy(value) {
      try {
        const area = document.createElement('textarea');
        area.value = value;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
      } catch {
        // Nothing else to try.
      }
    }

    // Opens the OS file picker and resolves with the chosen File (null if cancelled).
    function pickFile(accept) {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept || '';
        input.style.position = 'fixed';
        input.style.left = '-9999px';
        document.body.appendChild(input);
        const done = (file) => {
          if (input.parentNode) input.parentNode.removeChild(input);
          resolve(file || null);
        };
        input.addEventListener('change', () => done(input.files && input.files[0]), { once: true });
        input.addEventListener('cancel', () => done(null), { once: true });
        input.click();
      });
    }

    // ── canvas ──────────────────────────────────────────────────────────────
    function Canvas({ doc, epoch, onDoc, onBack, onExport, onDock, autoFit, toast }) {
      const surfaceRef = useRef(null);
      const worldRef = useRef(null);
      const [view, setView] = useState(doc.viewport || { x: 0, y: 0, zoom: 1 });
      const viewRef = useRef(view);
      const [selection, setSelection] = useState([]);
      const [heights, setHeights] = useState(() => new Map());
      const heightsRef = useRef(heights);
      const [linking, setLinking] = useState(null);
      const linkingRef = useRef(null);
      const [menu, setMenu] = useState(null);
      const [groupDialog, setGroupDialog] = useState(null);
      const [exportMenu, setExportMenu] = useState(null);
      const [toolbar, setToolbar] = useState(null);
      const [spaceDown, setSpaceDown] = useState(false);
      const [marquee, setMarquee] = useState(null);
      const [savedLabel, setSavedLabel] = useState('');
      const cardEls = useRef(new Map());
      const dragRef = useRef(null);
      const panRef = useRef(null);
      const docRef = useRef(doc);

      docRef.current = doc;
      viewRef.current = view;
      heightsRef.current = heights;
      linkingRef.current = linking;

      // Keep the viewport on the doc without spamming history while panning.
      const commitView = useCallback((next) => {
        setView(next);
        viewRef.current = next;
      }, []);

      const persistView = useCallback(() => {
        const current = docRef.current;
        const v = viewRef.current;
        if (!current) return;
        if (current.viewport && current.viewport.x === v.x && current.viewport.y === v.y && current.viewport.zoom === v.zoom) return;
        onDoc({ ...current, viewport: { ...v } }, { history: false });
      }, [onDoc]);

      // ── doc mutations ──
      const patchCard = useCallback((id, patch, options) => {
        const current = docRef.current;
        const cards = current.cards.map((card) => (card.id === id ? { ...card, ...patch } : card));
        onDoc({ ...current, cards }, options || {});
      }, [onDoc]);

      // Bold / highlight are DOM edits done by execCommand and range surgery, which
      // never fire an `input` event — so the edited HTML must be read back by hand.
      const commitBody = useCallback((cardId) => {
        const el = document.querySelector(`[data-card-body="${cardId}"]`);
        if (!el) return;
        patchCard(cardId, { html: sanitizeHtml(el.innerHTML) }, { history: false });
      }, [patchCard]);

      const addCardAt = useCallback((worldX, worldY) => {
        const current = docRef.current;
        const id = uid('c');
        const card = {
          id,
          x: Math.round(worldX - 90),
          y: Math.round(worldY - 40),
          w: 300,
          h: 140,
          color: CARD_COLORS[0].id,
          html: '',
          starred: false,
          attachments: [],
        };
        onDoc({ ...current, cards: [...current.cards, card] });
        setSelection([id]);
        return id;
      }, [onDoc]);

      const removeCards = useCallback((ids) => {
        const current = docRef.current;
        const idSet = new Set(ids);
        const cards = current.cards.filter((card) => !idSet.has(card.id));
        const links = current.links.filter((link) => !idSet.has(link.from) && !idSet.has(link.to));
        const groups = current.groups
          .map((group) => ({ ...group, cardIds: group.cardIds.filter((id) => !idSet.has(id)) }))
          .filter((group) => group.cardIds.length > 0);
        onDoc({ ...current, cards, links, groups });
        setSelection([]);
      }, [onDoc]);

      const createLink = useCallback((fromId, toId) => {
        if (!fromId || !toId || fromId === toId) return;
        const current = docRef.current;
        const exists = current.links.some((link) =>
          (link.from === fromId && link.to === toId) || (link.from === toId && link.to === fromId));
        if (exists) return;
        onDoc({ ...current, links: [...current.links, { id: uid('l'), from: fromId, to: toId, label: '' }] });
      }, [onDoc]);

      const patchLink = useCallback((id, patch, options) => {
        const current = docRef.current;
        onDoc({ ...current, links: current.links.map((link) => (link.id === id ? { ...link, ...patch } : link)) }, options || {});
      }, [onDoc]);

      const removeLink = useCallback((id) => {
        const current = docRef.current;
        onDoc({ ...current, links: current.links.filter((link) => link.id !== id) });
      }, [onDoc]);

      const createGroup = useCallback((title, cardIds) => {
        const current = docRef.current;
        const group = { id: uid('g'), title: title || `组 ${current.groups.length + 1}`, cardIds: [...cardIds] };
        const bounds = groupBoundsOf({ ...group, cardIds }, current.cards, heightsRef.current);
        if (bounds) {
          // Freeze the box at creation time; it only moves/resizes when dragged.
          group.x = Math.round(bounds.x);
          group.y = Math.round(bounds.y);
          group.w = Math.round(bounds.w);
          group.h = Math.round(bounds.h);
        }
        onDoc({ ...current, groups: [...current.groups, group] });
      }, [onDoc]);

      const patchGroupTitle = useCallback((id, title, options) => {
        const current = docRef.current;
        onDoc({
          ...current,
          groups: current.groups.map((group) => (group.id === id ? { ...group, title } : group)),
        }, options || {});
      }, [onDoc]);

      const removeGroup = useCallback((id) => {
        const current = docRef.current;
        onDoc({ ...current, groups: current.groups.filter((group) => group.id !== id) });
      }, [onDoc]);

      const addAttachment = useCallback(async (cardId, files) => {
        const current = docRef.current;
        const added = [];
        for (const file of files) {
          try {
            const url = `${API}/upload?id=${encodeURIComponent(current.id)}&name=${encodeURIComponent(file.name)}`;
            const response = await fetch(url, { method: 'POST', body: file });
            const payload = await response.json();
            if (payload && payload.ok) added.push(payload.value);
          } catch {
            // Skip a single failed upload; the rest still attach.
          }
        }
        if (added.length === 0) {
          toast('附件上传失败');
          return;
        }
        const latest = docRef.current;
        onDoc({
          ...latest,
          cards: latest.cards.map((card) => (card.id === cardId
            ? { ...card, attachments: [...(card.attachments || []), ...added] }
            : card)),
        });
      }, [onDoc, toast]);

      const openAttachment = useCallback(async (cardId, file) => {
        try {
          await api('open', { id: docRef.current.id, stored: file.stored });
        } catch {
          toast('打不开这个附件');
        }
      }, [toast]);

      const removeAttachment = useCallback(async (cardId, file) => {
        try {
          await api('remove-attachment', { id: docRef.current.id, stored: file.stored });
        } catch {
          // Even if the file is already gone, drop the card entry below.
        }
        const latest = docRef.current;
        onDoc({
          ...latest,
          cards: latest.cards.map((card) => (card.id === cardId
            ? { ...card, attachments: (card.attachments || []).filter((item) => item.stored !== file.stored) }
            : card)),
        });
        toast('已解除绑定：项目里的副本删掉了，你的原文件没动');
      }, [onDoc, toast]);

      // ── measuring ──
      const onMeasure = useCallback((id, height) => {
        setHeights((prev) => {
          const known = prev.get(id);
          if (known !== undefined && Math.abs(known - height) < 1) return prev;
          const next = new Map(prev);
          next.set(id, height);
          heightsRef.current = next;
          return next;
        });
      }, []);

      // ── world/screen ──
      const screenToWorld = useCallback((clientX, clientY) => {
        const surface = surfaceRef.current;
        if (!surface) return { x: 0, y: 0 };
        const rect = surface.getBoundingClientRect();
        const v = viewRef.current;
        return {
          x: (clientX - rect.left - v.x) / v.zoom,
          y: (clientY - rect.top - v.y) / v.zoom,
        };
      }, []);

      // ── drag card ──
      const beginCardDrag = useCallback((event, cardId) => {
        const multi = event.ctrlKey || event.metaKey || event.shiftKey;
        if (multi) {
          setSelection((prev) => (prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId]));
          return;
        }
        const current = docRef.current;
        const ids = selection.includes(cardId) ? selection : [cardId];
        if (!selection.includes(cardId)) setSelection([cardId]);
        const originals = ids
          .map((id) => {
            const card = current.cards.find((item) => item.id === id);
            const el = cardEls.current.get(id);
            return card && el ? { id, card, el } : null;
          })
          .filter(Boolean);
        if (originals.length === 0) return;
        const start = { x: event.clientX, y: event.clientY };
        const zoom = viewRef.current.zoom;
        let moved = false;
        dragRef.current = { ids, start, originals, zoom, moved };
        const onMove = (moveEvent) => {
          const state = dragRef.current;
          if (!state) return;
          const dx = (moveEvent.clientX - state.start.x) / state.zoom;
          const dy = (moveEvent.clientY - state.start.y) / state.zoom;
          if (!state.moved && Math.abs(dx) + Math.abs(dy) > 2) {
            state.moved = true;
            for (const item of state.originals) item.el.classList.add('dragging');
          }
          for (const item of state.originals) {
            item.el.style.left = `${item.card.x + dx}px`;
            item.el.style.top = `${item.card.y + dy}px`;
          }
        };
        const onUp = (upEvent) => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          const state = dragRef.current;
          dragRef.current = null;
          if (!state) return;
          for (const item of state.originals) item.el.classList.remove('dragging');
          if (!state.moved) return;
          const dx = Math.round((upEvent.clientX - state.start.x) / state.zoom);
          const dy = Math.round((upEvent.clientY - state.start.y) / state.zoom);
          const latest = docRef.current;
          const moved = new Set(state.ids);
          const cards = latest.cards.map((card) => (moved.has(card.id) ? { ...card, x: card.x + dx, y: card.y + dy } : card));
          const next = { ...latest, cards };

          // Group membership follows the drop: entering a group joins it, Alt-dragging out leaves it.
          if (state.ids.length === 1) {
            const id = state.ids[0];
            const card = cards.find((item) => item.id === id);
            if (card) {
              const height = cardHeight(card, heightsRef.current);
              const center = { x: card.x + card.w / 2, y: card.y + height / 2 };
              const groups = latest.groups.map((group) => {
                const bounds = groupBoundsOf(group, cards, heightsRef.current);
                const inside = bounds && center.x >= bounds.x && center.x <= bounds.x + bounds.w
                  && center.y >= bounds.y && center.y <= bounds.y + bounds.h;
                const member = group.cardIds.includes(id);
                if (upEvent.altKey) {
                  return member ? { ...group, cardIds: group.cardIds.filter((item) => item !== id) } : group;
                }
                if (inside && !member) return { ...group, cardIds: [...group.cardIds, id] };
                return group;
              }).filter((group) => group.cardIds.length > 0);
              next.groups = groups;
            }
          }
          onDoc(next);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      }, [doc, onDoc, selection]);

      // ── resize card ──
      const beginResize = useCallback((event, cardId) => {
        event.preventDefault();
        event.stopPropagation();
        const card = docRef.current.cards.find((item) => item.id === cardId);
        if (!card) return;
        const start = { x: event.clientX, y: event.clientY, w: card.w, h: card.h || MIN_H };
        const zoom = viewRef.current.zoom;
        const el = cardEls.current.get(cardId);
        const onMove = (moveEvent) => {
          const dw = (moveEvent.clientX - start.x) / zoom;
          const dh = (moveEvent.clientY - start.y) / zoom;
          const w = clamp(Math.round(start.w + dw), MIN_W, MAX_W);
          const height = Math.max(MIN_H, Math.round(start.h + dh));
          if (el) {
            el.style.width = `${w}px`;
            el.style.minHeight = `${height}px`;
          }
        };
        const onUp = (upEvent) => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          const dw = (upEvent.clientX - start.x) / zoom;
          const dh = (upEvent.clientY - start.y) / zoom;
          const w = clamp(Math.round(start.w + dw), MIN_W, MAX_W);
          const height = Math.max(MIN_H, Math.round(start.h + dh));
          const latest = docRef.current;
          onDoc({
            ...latest,
            cards: latest.cards.map((item) => (item.id === cardId ? { ...item, w, h: height } : item)),
          });
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      }, [onDoc]);

      // ── link drag ──
      const beginLink = useCallback((event, cardId, side) => {
        event.preventDefault();
        event.stopPropagation();
        const card = docRef.current.cards.find((item) => item.id === cardId);
        if (!card) return;
        const height = cardHeight(card, heightsRef.current);
        const start = anchorOf(card, height, side);
        setLinking({ from: cardId, side, start, point: start });
        const onMove = (moveEvent) => {
          const point = screenToWorld(moveEvent.clientX, moveEvent.clientY);
          setLinking((prev) => (prev ? { ...prev, point } : prev));
        };
        const onUp = (upEvent) => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          setLinking(null);
          const el = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
          const target = el && el.closest ? el.closest('[data-card-id]') : null;
          if (!target) return;
          const targetId = target.getAttribute('data-card-id');
          if (targetId && targetId !== cardId) createLink(cardId, targetId);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      }, [createLink, screenToWorld]);

      // ── pan / zoom ──
      useEffect(() => {
        const surface = surfaceRef.current;
        if (!surface) return undefined;
        const onWheel = (event) => {
          const target = event.target;
          const body = target && target.closest ? target.closest('.pn-card-body') : null;
          if (body && body.scrollHeight > body.clientHeight + 2) return;
          const label = target && target.closest ? target.closest('.pn-label') : null;
          if (label) return;
          event.preventDefault();
          const v = viewRef.current;
          const rect = surface.getBoundingClientRect();
          const px = event.clientX - rect.left;
          const py = event.clientY - rect.top;
          const factor = Math.exp(-event.deltaY * (event.ctrlKey || event.metaKey ? 0.0015 : 0.0022));
          const zoom = clamp(v.zoom * factor, 0.25, 2.5);
          const scale = zoom / v.zoom;
          const next = { x: px - (px - v.x) * scale, y: py - (py - v.y) * scale, zoom };
          commitView(next);
          persistView();
        };
        surface.addEventListener('wheel', onWheel, { passive: false });
        return () => surface.removeEventListener('wheel', onWheel);
      }, [commitView]);

      const beginPan = useCallback((event) => {
        if (event.button !== 0 && event.button !== 1) return;
        const v = viewRef.current;
        const start = { x: event.clientX, y: event.clientY, vx: v.x, vy: v.y };
        setSpaceDown(true);
        const onMove = (moveEvent) => {
          commitView({
            x: start.vx + (moveEvent.clientX - start.x),
            y: start.vy + (moveEvent.clientY - start.y),
            zoom: viewRef.current.zoom,
          });
        };
        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          setSpaceDown(false);
          persistView();
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      }, [commitView, persistView]);

      // Space key toggles pan mode.
      useEffect(() => {
        const onKeyDown = (event) => {
          if (event.code === 'Space' && !event.repeat) {
            const active = document.activeElement;
            const typing = active && (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
            if (!typing) {
              event.preventDefault();
              setSpaceDown(true);
            }
          }
        };
        const onKeyUp = (event) => {
          if (event.code === 'Space') setSpaceDown(false);
        };
        // If the window loses focus mid-press, keyup never arrives and the canvas
        // would stay stuck in pan mode.
        const clearSpace = () => setSpaceDown(false);
        window.addEventListener('blur', clearSpace);
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        return () => {
          window.removeEventListener('keydown', onKeyDown);
          window.removeEventListener('keyup', onKeyUp);
          window.removeEventListener('blur', clearSpace);
        };
      }, []);

      // Zoom controls helpers.
      const zoomBy = useCallback((factor) => {
        const surface = surfaceRef.current;
        const v = viewRef.current;
        if (!surface) return;
        const rect = surface.getBoundingClientRect();
        const px = rect.width / 2;
        const py = rect.height / 2;
        const zoom = clamp(v.zoom * factor, 0.25, 2.5);
        const scale = zoom / v.zoom;
        commitView({ x: px - (px - v.x) * scale, y: py - (py - v.y) * scale, zoom });
      }, [commitView]);

      const fitToContent = useCallback(() => {
        const surface = surfaceRef.current;
        const current = docRef.current;
        if (!surface || !current) return;
        if (current.cards.length === 0) {
          commitView({ x: surface.clientWidth / 2 - 150, y: surface.clientHeight / 2 - 80, zoom: 1 });
          return;
        }
        let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
        for (const card of current.cards) {
          const height = cardHeight(card, heightsRef.current);
          minX = Math.min(minX, card.x);
          minY = Math.min(minY, card.y);
          maxX = Math.max(maxX, card.x + card.w);
          maxY = Math.max(maxY, card.y + height);
        }
        const pad = 40;
        const zoom = clamp(Math.min(
          (surface.clientWidth - pad * 2) / Math.max(1, maxX - minX),
          (surface.clientHeight - pad * 2) / Math.max(1, maxY - minY),
        ), 0.4, 1.6);
        commitView({
          x: (surface.clientWidth - (maxX - minX) * zoom) / 2 - minX * zoom,
          y: (surface.clientHeight - (maxY - minY) * zoom) / 2 - minY * zoom,
          zoom,
        });
      }, [commitView]);

      useEffect(() => {
        if (!autoFit) return undefined;
        // The dock is narrower than the saved full-screen viewport, so frame
        // whatever is on the canvas once the surface has its real size.
        const timer = setTimeout(() => fitToContent(), 90);
        return () => clearTimeout(timer);
      }, [autoFit, fitToContent]);

      useEffect(() => {
        // Center a brand-new empty canvas once; existing projects restore their saved viewport.
        if (doc.cards.length === 0 && (!doc.viewport || (doc.viewport.x === 0 && doc.viewport.y === 0))) {
          const surface = surfaceRef.current;
          if (surface) commitView({ x: surface.clientWidth / 2 - 150, y: 120, zoom: 1 });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [doc.id]);

      // ── selection & keyboard ──
      useEffect(() => {
        const onKeyDown = (event) => {
          const active = document.activeElement;
          // Only treat focus inside this panel as "typing": the canvas may sit in
          // the dock while the conversation textarea still owns focus.
          const rootEl = surfaceRef.current ? surfaceRef.current.closest('.pn-root') : null;
          const typing = !!active && !!rootEl && rootEl.contains(active) && isTextField(active);
          const meta = event.ctrlKey || event.metaKey;
          if (meta && event.key.toLowerCase() === 's') {
            event.preventDefault();
            let next = docRef.current;
            if (next) onDoc({ ...next, viewport: { ...viewRef.current } }, { history: false, immediate: true });
            return;
          }
          if (typing) return;
          if (meta && event.key.toLowerCase() === 'z') {
            event.preventDefault();
            if (event.shiftKey) onDoc(null, { action: 'redo' });
            else onDoc(null, { action: 'undo' });
            return;
          }
          if (meta && event.key.toLowerCase() === 'y') {
            event.preventDefault();
            onDoc(null, { action: 'redo' });
            return;
          }
          if (meta && event.key.toLowerCase() === 'g') {
            event.preventDefault();
            if (selection.length >= 1) setGroupDialog({ ids: selection });
            return;
          }
          if (meta && event.key.toLowerCase() === '0') {
            event.preventDefault();
            fitToContent();
            return;
          }
          if (event.key === 'Delete' || event.key === 'Backspace') {
            if (selection.length > 0) {
              event.preventDefault();
              removeCards(selection);
            }
          }
          if (event.key === 'Escape') {
            setSelection([]);
            setMenu(null);
          }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
      }, [doc, fitToContent, onDoc, removeCards, selection, createGroup]);

      // ── selection toolbar ──
      useEffect(() => {
        const onSelectionChange = () => {
          const active = document.activeElement;
          if (!active || !active.isContentEditable) {
            setToolbar(null);
            return;
          }
          setToolbar(readSelectionState());
        };
        document.addEventListener('selectionchange', onSelectionChange);
        return () => document.removeEventListener('selectionchange', onSelectionChange);
      }, []);

      // ── context menu ──
      useEffect(() => {
        if (!menu) return undefined;
        const close = () => setMenu(null);
        const onKey = (event) => { if (event.key === 'Escape') close(); };
        window.addEventListener('mousedown', close);
        window.addEventListener('keydown', onKey);
        return () => {
          window.removeEventListener('mousedown', close);
          window.removeEventListener('keydown', onKey);
        };
      }, [menu]);

      const contextFor = useCallback((event, cardId) => {
        if (!selection.includes(cardId)) setSelection([cardId]);
        setMenu({
          x: Math.max(8, Math.min(event.clientX, window.innerWidth - 216)),
          y: Math.max(8, Math.min(event.clientY, window.innerHeight - 248)),
          cardId,
        });
      }, [selection]);

      const onSurfaceDown = useCallback((event) => {
        if (event.target !== event.currentTarget && !event.target.classList.contains('pn-world')) return;
        setMenu(null);
        setExportMenu(null);
        if (event.button === 1 || event.button === 2 || spaceDown) {
          if (event.button !== 0) beginPan(event);
          return;
        }
        const additive = event.ctrlKey || event.metaKey || event.shiftKey;
        const surface = surfaceRef.current;
        if (!surface) return;
        const rect = surface.getBoundingClientRect();
        const start = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        const marquee = { ...start, x2: start.x, y2: start.y };
        setMarquee(marquee);
        let moved = false;
        const apply = (x2, y2) => {
          setMarquee({ x: Math.min(start.x, x2), y: Math.min(start.y, y2), w: Math.abs(x2 - start.x), h: Math.abs(y2 - start.y) });
        };
        const onMove = (moveEvent) => {
          const x2 = moveEvent.clientX - rect.left;
          const y2 = moveEvent.clientY - rect.top;
          if (Math.abs(x2 - start.x) > 3 || Math.abs(y2 - start.y) > 3) moved = true;
          apply(x2, y2);
        };
        const onUp = (upEvent) => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          setMarquee(null);
          if (!moved) {
            if (!additive) setSelection([]);
            return;
          }
          const x2 = upEvent.clientX - rect.left;
          const y2 = upEvent.clientY - rect.top;
          const left = Math.min(start.x, x2) / viewRef.current.zoom - viewRef.current.x / viewRef.current.zoom;
          const top = Math.min(start.y, y2) / viewRef.current.zoom - viewRef.current.y / viewRef.current.zoom;
          const right = Math.max(start.x, x2) / viewRef.current.zoom - viewRef.current.x / viewRef.current.zoom;
          const bottom = Math.max(start.y, y2) / viewRef.current.zoom - viewRef.current.y / viewRef.current.zoom;
          const current = docRef.current;
          const picked = current.cards.filter((card) => {
            const height = cardHeight(card, heightsRef.current);
            return card.x < right && card.x + card.w > left && card.y < bottom && card.y + height > top;
          }).map((card) => card.id);
          setSelection((prev) => (additive ? Array.from(new Set([...prev, ...picked])) : picked));
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      }, [beginPan, spaceDown]);

      const onSurfaceDoubleClick = useCallback((event) => {
        if (event.target !== event.currentTarget && !event.target.classList.contains('pn-world')) return;
        const point = screenToWorld(event.clientX, event.clientY);
        addCardAt(point.x, point.y);
      }, [addCardAt, screenToWorld]);

      // ── derived ──
      const cardById = useMemo(() => new Map(doc.cards.map((card) => [card.id, card])), [doc.cards]);
      const selectedSet = useMemo(() => new Set(selection), [selection]);
      const groupBounds = useMemo(() => {
        const map = new Map();
        for (const group of doc.groups) {
          const bounds = groupBoundsOf(group, doc.cards, heights);
          if (bounds) map.set(group.id, bounds);
        }
        return map;
      }, [doc.groups, doc.cards, heights]);

      const renderLinks = () => {
        const nodes = [];
        for (const link of doc.links) {
          const from = cardById.get(link.from);
          const to = cardById.get(link.to);
          if (!from || !to) continue;
          const fromH = cardHeight(from, heights);
          const toH = cardHeight(to, heights);
          const a = nearestAnchor(from, fromH, { x: to.x + to.w / 2, y: to.y + toH / 2 }).point;
          const b = nearestAnchor(to, toH, { x: from.x + from.w / 2, y: from.y + fromH / 2 }).point;
          const sa = { x: a.x * view.zoom + view.x, y: a.y * view.zoom + view.y };
          const sb = { x: b.x * view.zoom + view.x, y: b.y * view.zoom + view.y };
          const hot = selectedSet.has(link.from) || selectedSet.has(link.to);
          nodes.push(h('line', {
            key: `l-${link.id}`,
            x1: sa.x, y1: sa.y, x2: sb.x, y2: sb.y,
            stroke: hot ? LINK_HOT : LINK_BLUE,
            strokeWidth: hot ? 2.6 : 2,
            strokeLinecap: 'round',
            style: hot ? { filter: 'drop-shadow(0 0 4px rgba(255,255,255,.9))' } : undefined,
          }));
          nodes.push(h('line', {
            key: `h-${link.id}`,
            className: 'pn-link-hit',
            x1: sa.x, y1: sa.y, x2: sb.x, y2: sb.y,
            onDoubleClick: () => removeLink(link.id),
          }));
        }
        return nodes;
      };

      const renderLabels = () => doc.links.map((link) => {
        const from = cardById.get(link.from);
        const to = cardById.get(link.to);
        if (!from || !to) return null;
        const fromH = cardHeight(from, heights);
        const toH = cardHeight(to, heights);
        const a = nearestAnchor(from, fromH, { x: to.x + to.w / 2, y: to.y + toH / 2 }).point;
        const b = nearestAnchor(to, toH, { x: from.x + from.w / 2, y: from.y + fromH / 2 }).point;
        const mid = {
          x: ((a.x + b.x) / 2) * view.zoom + view.x + (link.labelDx || 0),
          y: ((a.y + b.y) / 2) * view.zoom + view.y + (link.labelDy || 0),
        };
        return h('input', {
          key: `lab-${link.id}`,
          className: 'pn-label',
          value: link.label || '',
          placeholder: '',
          title: link.label || '连线标注（双击线可删除）',
          style: { left: mid.x, top: mid.y, width: labelWidth(link.label) },
          onChange: (e) => patchLink(link.id, { label: e.target.value }, { history: false }),
          onBlur: () => onDoc({ ...docRef.current }, { history: false }),
          onMouseDown: (e) => e.stopPropagation(),
          onDoubleClick: (e) => e.stopPropagation(),
        });
      });

      const previewEnd = linking ? linking.point : null;

      return h('div', { className: 'pn-root' },
        h('style', null, CSS),
        h('div', { className: 'pn-bar' },
          h('button', { type: 'button', className: 'pn-btn ghost', onClick: onBack }, '← 项目'),
          h('div', { className: 'pn-title', title: doc.name }, doc.name),
          h('span', { className: 'pn-muted' }, `${doc.cards.length} 张卡`),
          h('div', { className: 'pn-spacer' }),
          onDock
            ? h('button', { type: 'button', className: 'pn-btn ghost', title: '收到右侧，和对话同屏', onClick: onDock }, '⇥ 收到侧边')
            : null,
          h('button', { type: 'button', className: 'pn-btn ghost', title: '撤销 (Ctrl+Z)', onClick: () => onDoc(null, { action: 'undo' }) }, '↶'),
          h('button', { type: 'button', className: 'pn-btn ghost', title: '重做 (Ctrl+Shift+Z)', onClick: () => onDoc(null, { action: 'redo' }) }, '↷'),
          h('button', {
            type: 'button',
            className: 'pn-btn ghost',
            title: '导出',
            onClick: (e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setExportMenu({ x: Math.round(r.left), y: Math.round(r.bottom + 6) });
            },
          }, '导出'),
          h('button', {
            type: 'button',
            className: 'pn-btn primary',
            onClick: () => {
              const point = screenToWorld(
                (surfaceRef.current ? surfaceRef.current.getBoundingClientRect().left : 0) + 220,
                (surfaceRef.current ? surfaceRef.current.getBoundingClientRect().top : 0) + 180,
              );
              addCardAt(point.x, point.y);
            },
          }, '＋ 卡片'),
        ),
        h('div', {
          ref: surfaceRef,
          className: 'pn-canvas' + (spaceDown ? ' panning' : ''),
          onMouseDown: onSurfaceDown,
          onDoubleClick: onSurfaceDoubleClick,
        },
          h('div', {
            ref: worldRef,
            className: 'pn-world',
            style: { transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` },
          },
            doc.groups.map((group) => {
              const bounds = groupBounds.get(group.id);
              if (!bounds) return null;
              return h('div', {
                key: group.id,
                className: 'pn-group',
                style: { left: bounds.x, top: bounds.y, width: bounds.w, height: bounds.h },
              },
                h('div', {
                  className: 'pn-group-title',
                  title: '拖动移动整组 · 双击改名 · 右键删除',
                  onMouseDown: (e) => {
                    e.stopPropagation();
                    const start = { x: e.clientX, y: e.clientY };
                    const groupEl = e.currentTarget.closest('.pn-group');
                    const members = group.cardIds
                      .map((id) => {
                        const card = docRef.current.cards.find((item) => item.id === id);
                        const el = cardEls.current.get(id);
                        return card && el ? { card, el } : null;
                      })
                      .filter(Boolean);
                    const onMove = (moveEvent) => {
                      const dx = (moveEvent.clientX - start.x) / viewRef.current.zoom;
                      const dy = (moveEvent.clientY - start.y) / viewRef.current.zoom;
                      for (const member of members) {
                        member.el.style.left = `${member.card.x + dx}px`;
                        member.el.style.top = `${member.card.y + dy}px`;
                      }
                      if (groupEl && bounds) {
                        groupEl.style.left = `${bounds.x + dx}px`;
                        groupEl.style.top = `${bounds.y + dy}px`;
                      }
                    };
                    const onUp = (upEvent) => {
                      window.removeEventListener('mousemove', onMove);
                      window.removeEventListener('mouseup', onUp);
                      const dx = Math.round((upEvent.clientX - start.x) / viewRef.current.zoom);
                      const dy = Math.round((upEvent.clientY - start.y) / viewRef.current.zoom);
                      if (dx === 0 && dy === 0) return;
                      const latest = docRef.current;
                      const ids = new Set(group.cardIds);
                      onDoc({
                        ...latest,
                        cards: latest.cards.map((card) => (ids.has(card.id) ? { ...card, x: card.x + dx, y: card.y + dy } : card)),
                        groups: latest.groups.map((item) => (item.id === group.id && bounds
                          ? { ...item, x: bounds.x + dx, y: bounds.y + dy, w: bounds.w, h: bounds.h }
                          : item)),
                      });
                    };
                    window.addEventListener('mousemove', onMove);
                    window.addEventListener('mouseup', onUp);
                  },
                  onDoubleClick: (e) => {
                    e.stopPropagation();
                    setGroupDialog({ ids: [], renameId: group.id, initial: group.title });
                  },
                  onContextMenu: (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    removeGroup(group.id);
                  },
                }, group.title),
                h('div', {
                  className: 'pn-group-resize',
                  title: '调整组框大小',
                  onMouseDown: (e) => {
                    e.stopPropagation();
                    const groupEl = e.currentTarget.closest('.pn-group');
                    const start = { x: e.clientX, y: e.clientY, w: bounds.w, h: bounds.h };
                    const onMove = (moveEvent) => {
                      const w = Math.max(80, start.w + (moveEvent.clientX - start.x) / viewRef.current.zoom);
                      const h = Math.max(60, start.h + (moveEvent.clientY - start.y) / viewRef.current.zoom);
                      if (groupEl) { groupEl.style.width = `${w}px`; groupEl.style.height = `${h}px`; }
                    };
                    const onUp = (upEvent) => {
                      window.removeEventListener('mousemove', onMove);
                      window.removeEventListener('mouseup', onUp);
                      const w = Math.round(Math.max(80, start.w + (upEvent.clientX - start.x) / viewRef.current.zoom));
                      const h = Math.round(Math.max(60, start.h + (upEvent.clientY - start.y) / viewRef.current.zoom));
                      const latest = docRef.current;
                      onDoc({
                        ...latest,
                        groups: latest.groups.map((item) => (item.id === group.id
                          ? { ...item, x: bounds.x, y: bounds.y, w, h }
                          : item)),
                      });
                    };
                    window.addEventListener('mousemove', onMove);
                    window.addEventListener('mouseup', onUp);
                  },
                }),
              );
            }),
            linking ? h('svg', { className: 'pn-links', width: 1, height: 1, style: { zIndex: 4 } },
              h('line', {
                x1: linking.start.x, y1: linking.start.y,
                x2: previewEnd ? previewEnd.x : linking.start.x,
                y2: previewEnd ? previewEnd.y : linking.start.y,
                stroke: '#2f7cf6', strokeWidth: 2, strokeDasharray: '6 4',
              }),
            ) : null,
            doc.cards.map((card) => {
              const el = h(Card, {
                key: card.id,
                card,
                docId: doc.id,
                epoch,
                selected: selectedSet.has(card.id),
                zoom: view.zoom,
                onPatch: patchCard,
                onMeasure,
                onGrab: beginCardDrag,
                onDot: beginLink,
                onResizeStart: beginResize,
                onContext: contextFor,
                onAttach: addAttachment,
                onOpenAttachment: openAttachment,
                onRemoveAttachment: removeAttachment,
                onFocus: (id) => setSelection((prev) => (prev.length === 1 && prev[0] === id ? prev : [id])),
                onBlur: (id) => commitBody(id),
              });
              return h('div', {
                key: `wrap-${card.id}`,
                ref: (node) => {
                  if (node && node.firstChild) cardEls.current.set(card.id, node.firstChild);
                  else cardEls.current.delete(card.id);
                },
                style: { position: 'absolute', left: 0, top: 0, width: 0, height: 0 },
              }, el);
            }),
          ),
          h('svg', { className: 'pn-links pn-links-layer' }, renderLinks()),
          h('div', { className: 'pn-label-layer' }, renderLabels()),
          marquee ? h('div', {
            className: 'pn-marquee',
            style: { left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h },
          }) : null,
          doc.cards.length === 0
            ? h('div', { className: 'pn-hint' },
              '双击空白处新建卡片',
              h('br'),
              h('span', null, '滚轮缩放 · 中键拖动平移'),
            )
            : null,
          h('div', { className: 'pn-zoom' },
            h('button', { type: 'button', className: 'pn-btn ghost pn-icon', onClick: () => zoomBy(1 / 1.2), title: '缩小' }, '−'),
            h('span', null, `${Math.round(view.zoom * 100)}%`),
            h('button', { type: 'button', className: 'pn-btn ghost pn-icon', onClick: () => zoomBy(1.2), title: '放大' }, '＋'),
            h('button', { type: 'button', className: 'pn-btn ghost', onClick: fitToContent, title: '适应画布 (Ctrl+0)' }, '适应'),
          ),
        ),
        menu ? h(CardMenu, {
          menu,
          card: cardById.get(menu.cardId),
          onClose: () => setMenu(null),
          onColor: (colorId) => { patchCard(menu.cardId, { color: colorId }); setMenu(null); },
          onCopy: () => {
            const card = cardById.get(menu.cardId);
            if (card) copyText(plainText(card.html));
            setMenu(null);
          },
          onCopyBack: () => {
            const card = cardById.get(menu.cardId);
            if (card) copyText(plainText(card.html));
            setMenu(null);
            goConversation();
          },
          onGroup: () => {
            const ids = selection.length > 0 ? selection : [menu.cardId];
            setMenu(null);
            setGroupDialog({ ids });
          },
          onDelete: () => { removeCards(selection.length > 0 ? selection : [menu.cardId]); setMenu(null); },
        }) : null,
        h(TextToolbar, {
          state: toolbar,
          onBold: () => {
            const cur = readSelectionState();
            applyBold();
            if (cur) commitBody(cur.cardId);
            setToolbar(readSelectionState());
          },
          onMark: (id) => {
            const cur = readSelectionState();
            applyMark(id);
            if (cur) commitBody(cur.cardId);
            setToolbar(readSelectionState());
          },
          onClear: () => {
            const cur = readSelectionState();
            applyClear();
            if (cur) commitBody(cur.cardId);
            setToolbar(readSelectionState());
          },
        }),
        h(NameDialog, {
          open: !!groupDialog,
          title: groupDialog && groupDialog.renameId ? '改个组名' : '给这个组起个名字',
          initial: groupDialog ? (groupDialog.initial || `组 ${doc.groups.length + 1}`) : '',
          confirmText: groupDialog && groupDialog.renameId ? '改名' : '建组',
          placeholder: '分组名称',
          onCancel: () => setGroupDialog(null),
          onConfirm: (name) => {
            if (!groupDialog) return;
            if (groupDialog.renameId) patchGroupTitle(groupDialog.renameId, name);
            else createGroup(name, groupDialog.ids);
            setGroupDialog(null);
          },
        }),
        exportMenu ? h('div', {
          className: 'pn-menu',
          style: { left: exportMenu.x, top: exportMenu.y, position: 'fixed' },
          onMouseDown: (e) => e.stopPropagation(),
        },
          h('button', {
            type: 'button',
            className: 'pn-menu-item',
            onClick: () => { setExportMenu(null); onExport('json'); },
          }, '导出 JSON'),
          h('button', {
            type: 'button',
            className: 'pn-menu-item',
            onClick: () => { setExportMenu(null); onExport('md'); },
          }, '导出 Markdown'),
        ) : null,
      );
    }

    function groupBoundsOf(group, cards, heights) {
      if (Number.isFinite(group.x) && Number.isFinite(group.y)
        && Number.isFinite(group.w) && Number.isFinite(group.h) && group.w > 0 && group.h > 0) {
        return { x: group.x, y: group.y, w: group.w, h: group.h };
      }
      const map = new Map(cards.map((card) => [card.id, card]));
      let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
      for (const id of group.cardIds) {
        const card = map.get(id);
        if (!card) continue;
        const height = cardHeight(card, heights);
        minX = Math.min(minX, card.x);
        minY = Math.min(minY, card.y);
        maxX = Math.max(maxX, card.x + card.w);
        maxY = Math.max(maxY, card.y + height);
      }
      if (!Number.isFinite(minX)) return null;
      const pad = 26;
      return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
    }

    function CardMenu({ menu, card, onClose, onColor, onCopy, onCopyBack, onGroup, onDelete }) {
      if (!card) return null;
      const left = Math.min(menu.x, window.innerWidth - 220);
      const top = Math.min(menu.y, window.innerHeight - 300);
      return h('div', {
        className: 'pn-menu',
        style: { left, top },
        onMouseDown: (e) => e.stopPropagation(),
      },
        h('div', { className: 'pn-swatches' }, ...CARD_COLORS.map((color) => h('div', {
          key: color.id,
          className: 'pn-swatch' + (card.color === color.id ? ' on' : ''),
          title: color.label,
          style: { background: color.bg, borderColor: color.line },
          onClick: () => onColor(color.id),
        }))),
        h('div', { className: 'pn-menu-sep' }),
        h('div', { className: 'pn-menu-item', onClick: onCopy }, '⧉ 复制内容'),
        h('div', { className: 'pn-menu-item', onClick: onCopyBack }, '↩ 复制并返回对话'),
        h('div', { className: 'pn-menu-item', onClick: onGroup }, '▢ 建组'),
        h('div', { className: 'pn-menu-sep' }),
        h('div', { className: 'pn-menu-item danger', onClick: onDelete }, '✕ 删除卡片'),
      );
    }

    // ── project list ────────────────────────────────────────────────────────
    function ProjectList({ projects, loading, error, onCreate, onOpen, onRename, onDuplicate, onRemove, onImport, onRefresh }) {
      const [menuFor, setMenuFor] = useState(null);
      useEffect(() => {
        if (!menuFor) return undefined;
        const close = () => setMenuFor(null);
        window.addEventListener('mousedown', close);
        return () => window.removeEventListener('mousedown', close);
      }, [menuFor]);

      const formatTime = (iso) => {
        if (!iso) return '';
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return '';
        const now = new Date();
        if (date.toDateString() === now.toDateString()) {
          return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        }
        return `${date.getMonth() + 1}/${date.getDate()}`;
      };

      const project = projects.find((item) => item.id === menuFor);
      return h('div', { className: 'pn-root' },
        h('style', null, CSS),
        h('div', { className: 'pn-bar' },
          h('div', { className: 'pn-title' }, '项目笔记'),
          h('div', { className: 'pn-spacer' }),
          h('button', { type: 'button', className: 'pn-btn ghost', onClick: onRefresh, title: '刷新' }, '⟳'),
          h('button', { type: 'button', className: 'pn-btn ghost', onClick: onImport, title: '从 JSON 文件导入项目' }, '导入'),
          h('button', { type: 'button', className: 'pn-btn primary', onClick: onCreate }, '＋ 新建项目'),
        ),
        h('div', { className: 'pn-body' },
          loading
            ? h('div', { className: 'pn-empty' }, '加载中…')
            : error
              ? h('div', { className: 'pn-empty' }, `读取失败：${error}`)
              : projects.length === 0
                ? h('div', { className: 'pn-empty' },
                  h('div', null, '还没有项目'),
                  h('div', null, '新建一个，把脑子里的设想摊开'))
                : h('div', { className: 'pn-list' },
                  h('div', { className: 'pn-grid' }, ...projects.map((item) => h('div', {
                    key: item.id,
                    className: 'pn-pcard',
                    onDoubleClick: () => onOpen(item.id),
                    onClick: () => onOpen(item.id),
                  },
                    h('h3', { title: item.name }, item.name),
                    h('div', { className: 'meta' },
                      h('span', null, `${item.cards} 张卡`),
                      item.starred > 0 ? h('span', null, `★ ${item.starred}`) : null,
                      h('span', null, formatTime(item.updatedAt)),
                    ),
                    h('button', {
                      type: 'button',
                      className: 'more',
                      title: '更多',
                      onClick: (e) => { e.stopPropagation(); setMenuFor(item.id); },
                    }, '⋯'),
                  ))),
                ),
          menuFor ? h('div', {
            className: 'pn-menu',
            style: { left: 40, top: 120 },
            onMouseDown: (e) => e.stopPropagation(),
          },
            h('div', { className: 'pn-menu-item', onClick: () => { setMenuFor(null); onRename(project); } }, '✎ 重命名'),
            h('div', { className: 'pn-menu-item', onClick: () => { setMenuFor(null); onDuplicate(project); } }, '⧉ 复制项目'),
            h('div', { className: 'pn-menu-item danger', onClick: () => { setMenuFor(null); onRemove(project); } }, '✕ 删除项目'),
          ) : null,
        ),
      );
    }

    // ── panel root ──────────────────────────────────────────────────────────
    function Panel({ embedded }) {
      const [mode, setMode] = useState('list');
      const [projects, setProjects] = useState([]);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState('');
      const [doc, setDocState] = useState(null);
      const [epoch, setEpoch] = useState(0);
      const [toastText, setToastText] = useState('');
      const [dialog, setDialog] = useState(null);
      const [saveState, setSaveState] = useState('idle');

      const docRef = useRef(null);
      const undoRef = useRef([]);
      const redoRef = useRef([]);
      const saveTimer = useRef(null);
      const toastTimer = useRef(null);

      const toast = useCallback((text) => {
        setToastText(text);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToastText(''), 2200);
      }, []);

      const refresh = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
          const value = await api('list');
          setProjects(Array.isArray(value.projects) ? value.projects : []);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setLoading(false);
        }
      }, []);

      useEffect(() => { refresh(); }, [refresh]);

      // A full-screen rendering owns the frame: drop the dock so the same
      // project is never edited in two places at once.
      useEffect(() => {
        if (!embedded) setDockOpen(false);
      }, [embedded]);

      const flushSave = useCallback(async (target) => {
        if (!target) return;
        setSaveState('saving');
        try {
          await api('save', { id: target.id, doc: target });
          setSaveState('saved');
        } catch (err) {
          setSaveState('error');
          toast(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        }
      }, [toast]);

      const scheduleSave = useCallback((target) => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => { flushSave(target); }, 500);
      }, [flushSave]);

      const setDocNow = useCallback((next, bumpEpoch) => {
        docRef.current = next;
        setDocState(next);
        if (bumpEpoch) setEpoch((value) => value + 1);
      }, []);

      const onDoc = useCallback((next, options) => {
        const opts = options || {};
        if (opts.action === 'undo') {
          const prev = undoRef.current.pop();
          if (!prev) return;
          redoRef.current.push(docRef.current);
          setDocNow(prev, true);
          scheduleSave(prev);
          return;
        }
        if (opts.action === 'redo') {
          const forward = redoRef.current.pop();
          if (!forward) return;
          undoRef.current.push(docRef.current);
          setDocNow(forward, true);
          scheduleSave(forward);
          return;
        }
        if (!next) return;
        const previous = docRef.current;
        if (previous && opts.history !== false) {
          undoRef.current.push(previous);
          if (undoRef.current.length > 50) undoRef.current.shift();
          redoRef.current = [];
        }
        setDocNow(next, false);
        if (opts.immediate) {
          if (saveTimer.current) clearTimeout(saveTimer.current);
          flushSave(next);
        } else {
          scheduleSave(next);
        }
      }, [flushSave, scheduleSave, setDocNow]);

      // Reopen the project that was on screen when the panel was last left,
      // so switching panels never throws the canvas away.
      useEffect(() => {
        let cancelled = false;
        let last = null;
        try { last = localStorage.getItem(LAST_KEY); } catch { last = null; }
        if (!last) return undefined;
        (async () => {
          try {
            const value = await api('load', { id: last });
            if (cancelled || !value || !value.doc) return;
            undoRef.current = [];
            redoRef.current = [];
            setDocNow(value.doc, true);
            setMode('canvas');
          } catch {
            try { localStorage.removeItem(LAST_KEY); } catch { /* ignore */ }
          }
        })();
        return () => { cancelled = true; };
      }, [setDocNow]);

      const openProject = useCallback(async (id) => {
        try {
          const value = await api('load', { id });
          undoRef.current = [];
          redoRef.current = [];
          setDocNow(value.doc, true);
          setMode('canvas');
          try { localStorage.setItem(LAST_KEY, id); } catch { /* ignore */ }
        } catch (err) {
          toast(`打开失败：${err instanceof Error ? err.message : String(err)}`);
          try { localStorage.removeItem(LAST_KEY); } catch { /* ignore */ }
        }
      }, [setDocNow, toast]);

      const createProject = useCallback(async (name) => {
        try {
          const value = await api('create', { name });
          undoRef.current = [];
          redoRef.current = [];
          setDocNow(value.doc, true);
          setMode('canvas');
          try { localStorage.setItem(LAST_KEY, value.doc.id); } catch { /* ignore */ }
        } catch (err) {
          toast(`新建失败：${err instanceof Error ? err.message : String(err)}`);
        }
      }, [setDocNow, toast]);

      const backToList = useCallback(() => {
        const current = docRef.current;
        if (current) {
          if (saveTimer.current) clearTimeout(saveTimer.current);
          flushSave(current);
        }
        try { localStorage.removeItem(LAST_KEY); } catch { /* ignore */ }
        setMode('list');
        refresh();
      }, [flushSave, refresh]);

      const exportDoc = useCallback(async (format) => {
        const current = docRef.current;
        if (!current) return;
        try {
          const result = await api('export', { id: current.id, format: format === 'md' ? 'md' : 'json' });
          toast(result && result.path ? `已导出到项目文件夹：${result.path}` : '已导出');
        } catch (error) {
          toast(`导出失败：${error && error.message ? error.message : '未知错误'}`);
        }
      }, [toast]);

      // Leaving the panel flushes whatever is pending.
      useEffect(() => () => {
        const current = docRef.current;
        if (current) apiKeepalive('save', { id: current.id, doc: current });
        if (saveTimer.current) clearTimeout(saveTimer.current);
      }, []);

      // Warn before an accidental reload with unsaved edits.
      useEffect(() => {
        const onBeforeUnload = (event) => {
          if (saveState === 'saving' || saveState === 'idle') return undefined;
          return undefined;
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
      }, [saveState]);

      const renameProject = useCallback((project) => {
        setDialog({ kind: 'rename', project });
      }, []);

      const duplicateProject = useCallback(async (project) => {
        try {
          await api('duplicate', { id: project.id });
          toast('已复制项目');
          refresh();
        } catch (err) {
          toast(`复制失败：${err instanceof Error ? err.message : String(err)}`);
        }
      }, [refresh, toast]);

      const importProject = useCallback(async () => {
        const file = await pickFile('.json,application/json');
        if (!file) return;
        let parsed;
        try {
          parsed = JSON.parse(await file.text());
        } catch {
          toast('这个文件不是有效的 JSON');
          return;
        }
        const incoming = parsed && typeof parsed === 'object' && parsed.doc ? parsed.doc : parsed;
        if (!incoming || typeof incoming !== 'object' || !Array.isArray(incoming.cards)) {
          toast('这个 JSON 里没有项目笔记数据');
          return;
        }
        try {
          const result = await api('import', {
            doc: incoming,
            name: incoming.name || file.name.replace(/\.json$/i, ''),
          });
          toast(`已导入「${(result && result.doc && result.doc.name) || '项目'}」`);
          refresh();
        } catch (err) {
          toast(`导入失败：${err instanceof Error ? err.message : String(err)}`);
        }
      }, [refresh, toast]);

      const removeProject = useCallback(async (project) => {
        if (!window.confirm(`删除「${project.name}」？会移到回收站文件夹。`)) return;
        try {
          await api('remove', { id: project.id });
          toast('已删除');
          refresh();
        } catch (err) {
          toast(`删除失败：${err instanceof Error ? err.message : String(err)}`);
        }
      }, [refresh, toast]);

      const savedHint = saveState === 'saving' ? '保存中…' : saveState === 'saved' ? '已保存' : saveState === 'error' ? '未保存' : '';

      const handleDock = useCallback(async () => {
        // Flush first: switching panels unmounts this Canvas.
        if (docRef.current) await flushSave(docRef.current);
        dockToSide();
      }, [flushSave]);

      return h('div', { style: { height: '100%', minHeight: 0, position: 'relative' } },
        mode === 'canvas' && doc
          ? h(Canvas, {
            key: doc.id,
            doc,
            epoch,
            onDoc,
            onBack: backToList,
            onExport: exportDoc,
            onDock: embedded ? null : handleDock,
            autoFit: !!embedded,
            toast,
          })
          : h(ProjectList, {
            projects,
            loading,
            error,
            onCreate: () => setDialog({ kind: 'create' }),
            onOpen: openProject,
            onRename: renameProject,
            onDuplicate: duplicateProject,
            onRemove: removeProject,
            onImport: importProject,
            onRefresh: refresh,
          }),
        h(NameDialog, {
          open: dialog !== null,
          title: dialog && dialog.kind === 'rename' ? '重命名项目' : '新建项目',
          initial: dialog && dialog.kind === 'rename' ? dialog.project.name : '未命名项目',
          confirmText: dialog && dialog.kind === 'rename' ? '保存' : '创建',
          onCancel: () => setDialog(null),
          onConfirm: async (name) => {
            const current = dialog;
            setDialog(null);
            if (!current) return;
            if (current.kind === 'create') {
              await createProject(name);
            } else if (current.kind === 'rename') {
              try {
                await api('rename', { id: current.project.id, name });
                if (docRef.current && docRef.current.id === current.project.id) {
                  setDocNow({ ...docRef.current, name }, false);
                }
                refresh();
              } catch (err) {
                toast(`改名失败：${err instanceof Error ? err.message : String(err)}`);
              }
            }
          },
        }),
        toastText ? h('div', { className: 'pn-toast' }, toastText) : null,
        mode === 'canvas' && savedHint
          ? h('div', {
            className: 'pn-muted',
            style: { position: 'absolute', right: 14, bottom: 56, zIndex: 60, pointerEvents: 'none' },
          }, savedHint)
          : null,
      );
    }

    // ── right-hand dock ─────────────────────────────────────────────────────
    class PanelBoundary extends React.Component {
      constructor(props) { super(props); this.state = { err: null }; }
      static getDerivedStateFromError(err) { return { err }; }
      componentDidCatch(err, info) {
        try {
          window.__pnRenderErr = String((err && err.stack) || err) + '\n---\n' + String((info && info.componentStack) || '');
        } catch (e) { /* ignore */ }
      }
      render() {
        if (this.state.err) {
          const message = String((this.state.err && this.state.err.message) || this.state.err);
          return h('div', {
            className: 'pn-root',
            style: { padding: 20, fontSize: 13, lineHeight: 1.7, overflow: 'auto' },
          },
            h('div', { style: { fontWeight: 600, marginBottom: 6 } }, '项目笔记出了点问题'),
            h('div', { className: 'pn-muted' }, message),
            h('div', { className: 'pn-muted', style: { marginTop: 10 } }, '点侧边栏其他地方再切回来试试；持续出现请把这条消息发给主人大肥鱼。'));
        }
        return this.props.children;
      }
    }

    function dockWidth() {
      try {
        const raw = Number(localStorage.getItem(DOCK_WIDTH_KEY));
        if (Number.isFinite(raw) && raw >= 320) return Math.round(raw);
      } catch { /* ignore */ }
      return 440;
    }

    function Dock() {
      const open = useDockOpen();
      const [width, setWidth] = useState(dockWidth);
      const widthRef = useRef(width);
      widthRef.current = width;
      if (!open) return null;

      const startResize = (event) => {
        event.preventDefault();
        const startX = event.clientX;
        const startW = widthRef.current;
        const move = (e) => {
          const max = Math.round(window.innerWidth * 0.7);
          const next = Math.max(320, Math.min(max, startW + (startX - e.clientX)));
          widthRef.current = next;
          setWidth(next);
        };
        const up = () => {
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          try { localStorage.setItem(DOCK_WIDTH_KEY, String(widthRef.current)); } catch { /* ignore */ }
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      };

      const expand = () => {
        setDockOpen(false);
        try {
          const layout = pluginCtx && pluginCtx.get ? pluginCtx.get('layout') : null;
          if (layout) layout.selectPanel(PANEL_ID);
        } catch { /* ignore */ }
      };

      return h('div', { className: 'pn-dock', style: { width } },
        h('div', { className: 'pn-dock-grip', title: '拖动改宽度', onMouseDown: startResize }),
        h('div', { className: 'pn-dock-head' },
          h('div', { className: 'pn-dock-title' }, '项目笔记'),
          h('button', { type: 'button', className: 'pn-btn ghost', title: '展开成全屏面板', onClick: expand }, '⤢ 展开'),
          h('button', { type: 'button', className: 'pn-btn ghost', title: '关掉右侧面板', onClick: () => setDockOpen(false) }, '✕'),
        ),
        h('div', { className: 'pn-dock-body' }, h(PanelBoundary, null, h(Panel, { embedded: true }))),
      );
    }

    // ── registration ────────────────────────────────────────────────────────
    function apply(ctx) {
      pluginCtx = ctx;
      const slots = ctx.get ? ctx.get('slots') : ctx.slots;
      if (!slots) return;
      function PanelRoot() { return h(PanelBoundary, null, h(Panel, { embedded: false })); }
      slots.inject('main', () => slots.register({ name: 'main', key: PANEL_ID }, PanelRoot));
      slots.inject('shell.overlay', () => slots.register({ name: 'shell.overlay', id: 'project-notes-dock' }, Dock));
      slots.inject('sidebar.panellist', () => slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 60,
        label: () => '项目笔记',
      }, PanelIcon));
    }

    return { inject: ['slots'], apply };
  },
});
