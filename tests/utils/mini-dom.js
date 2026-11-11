'use strict';

/**
 * Lightweight, deterministic DOM environment for testing Webspresso's
 * Datastar Client Behavior Layer in Node.js (Vitest) without external jsdom dependency.
 *
 * Supports:
 * - HTML parsing (`innerHTML`, `<template>.content.firstElementChild`)
 * - `nodeType`, `tagName`, `childNodes`, `children`, `parentElement`, `parentNode`, `ownerDocument`, `isConnected`
 * - `getAttribute`, `setAttribute`, `removeAttribute`, `hasAttribute`, `attributes`, `id`, `name`, `type`, `value`, `defaultValue`, `checked`, `defaultChecked`, `disabled`, `hidden`, `multiple`, `options`, `files`
 * - `querySelector`, `querySelectorAll`, `matches`, `closest`, `contains`
 * - Event target with bubbling (`addEventListener`, `removeEventListener`, `dispatchEvent`, `CustomEvent`, `Event`)
 * - `focus()` tracking (`document.activeElement`) and `checkValidity()` / `reportValidity()`
 */

const VOID_TAGS = new Set([
  'AREA', 'BASE', 'BR', 'COL', 'EMBED', 'HR', 'IMG', 'INPUT',
  'LINK', 'META', 'PARAM', 'SOURCE', 'TRACK', 'WBR',
]);

function decodeEntities(str) {
  return String(str || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

class MiniEvent {
  constructor(type, init = {}) {
    this.type = String(type);
    this.bubbles = Boolean(init.bubbles);
    this.cancelable = Boolean(init.cancelable);
    this.detail = init.detail !== undefined ? init.detail : null;
    this.submitter = init.submitter || null;
    this.defaultPrevented = false;
    this._propagationStopped = false;
    this._immediateStopped = false;
    this.target = null;
    this.currentTarget = null;
  }

  preventDefault() {
    if (this.cancelable) {
      this.defaultPrevented = true;
    }
  }

  stopPropagation() {
    this._propagationStopped = true;
  }

  stopImmediatePropagation() {
    this._immediateStopped = true;
    this._propagationStopped = true;
  }
}

class MiniCustomEvent extends MiniEvent {
  constructor(type, init = {}) {
    super(type, init);
  }
}

class MiniTextNode {
  constructor(text, ownerDocument = null) {
    this.nodeType = 3;
    this.nodeValue = String(text ?? '');
    this.parentNode = null;
    this.ownerDocument = ownerDocument;
  }

  get parentElement() {
    return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
  }

  get textContent() {
    return this.nodeValue;
  }

  set textContent(v) {
    this.nodeValue = String(v ?? '');
  }

  cloneNode() {
    return new MiniTextNode(this.nodeValue, this.ownerDocument);
  }
}

class MiniElement {
  constructor(tagName, ownerDocument = null) {
    this.nodeType = 1;
    this.tagName = String(tagName || 'DIV').toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.childNodes = [];
    this._attrs = new Map();
    this._listeners = new Map();
    this.style = { display: '' };
    this._value = undefined;
    this._defaultValue = '';
    this._checked = undefined;
    this._defaultChecked = false;
    this._selected = undefined;
    this._defaultSelected = false;
    this.files = null;

    if (this.tagName === 'TEMPLATE') {
      const container = new MiniElement('TEMPLATE-CONTENT', ownerDocument);
      this.content = container;
    }
  }

  get parentElement() {
    return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
  }

  get isConnected() {
    let cur = this;
    while (cur) {
      if (this.ownerDocument && (cur === this.ownerDocument.documentElement || cur === this.ownerDocument.body || cur === this.ownerDocument)) {
        return true;
      }
      cur = cur.parentNode;
    }
    return false;
  }

  get children() {
    return this.childNodes.filter((n) => n.nodeType === 1);
  }

  get firstElementChild() {
    return this.children[0] || null;
  }

  get attributes() {
    const list = [];
    for (const [name, value] of this._attrs.entries()) {
      list.push({ name, value });
    }
    return list;
  }

  getAttribute(name) {
    const k = String(name).toLowerCase();
    return this._attrs.has(k) ? this._attrs.get(k) : null;
  }

  setAttribute(name, value) {
    const k = String(name).toLowerCase();
    const strVal = String(value);
    const hadAttr = this._attrs.has(k);
    this._attrs.set(k, strVal);
    if (k === 'value' && !hadAttr && this._value === undefined) {
      this._defaultValue = strVal;
    }
    if (k === 'checked' && !hadAttr && this._checked === undefined) {
      this._defaultChecked = true;
    }
    if (k === 'selected' && !hadAttr && this._selected === undefined) {
      this._defaultSelected = true;
    }
  }

  removeAttribute(name) {
    const k = String(name).toLowerCase();
    this._attrs.delete(k);
  }

  hasAttribute(name) {
    return this._attrs.has(String(name).toLowerCase());
  }

  get id() {
    return this.getAttribute('id') || '';
  }

  set id(v) {
    if (v) this.setAttribute('id', v);
    else this.removeAttribute('id');
  }

  get className() {
    return this.getAttribute('class') || '';
  }

  set className(v) {
    if (v) this.setAttribute('class', v);
    else this.removeAttribute('class');
  }

  get classList() {
    const self = this;
    function getTokens() {
      return (self.className || '').split(/\s+/).filter(Boolean);
    }
    return {
      add(...tokens) {
        const set = new Set(getTokens());
        for (const t of tokens) if (t) set.add(t);
        self.className = Array.from(set).join(' ');
      },
      remove(...tokens) {
        const set = new Set(getTokens());
        for (const t of tokens) set.delete(t);
        self.className = Array.from(set).join(' ');
      },
      contains(token) {
        return getTokens().includes(token);
      },
      toggle(token, force) {
        const has = this.contains(token);
        const next = force !== undefined ? Boolean(force) : !has;
        if (next) this.add(token);
        else this.remove(token);
        return next;
      },
    };
  }

  get name() {
    return this.getAttribute('name') || '';
  }

  set name(v) {
    this.setAttribute('name', v);
  }

  get type() {
    const raw = this.getAttribute('type');
    if (raw) return raw.toLowerCase();
    if (this.tagName === 'BUTTON') return 'submit';
    if (this.tagName === 'INPUT') return 'text';
    if (this.tagName === 'SELECT') return this.multiple ? 'select-multiple' : 'select-one';
    if (this.tagName === 'TEXTAREA') return 'textarea';
    return '';
  }

  set type(v) {
    this.setAttribute('type', v);
  }

  get disabled() {
    return this.hasAttribute('disabled');
  }

  set disabled(v) {
    if (v) this.setAttribute('disabled', '');
    else this.removeAttribute('disabled');
  }

  get hidden() {
    return this.hasAttribute('hidden');
  }

  set hidden(v) {
    if (v) this.setAttribute('hidden', '');
    else this.removeAttribute('hidden');
  }

  get multiple() {
    return this.hasAttribute('multiple');
  }

  set multiple(v) {
    if (v) this.setAttribute('multiple', '');
    else this.removeAttribute('multiple');
  }

  get dataset() {
    const data = {};
    for (const [k, v] of this._attrs.entries()) {
      if (k.startsWith('data-')) {
        const camel = k.slice(5).replace(/-([a-z])/g, (_, g) => g.toUpperCase());
        data[camel] = v;
      }
    }
    return data;
  }

  get value() {
    if (this.tagName === 'SELECT') {
      const opts = this.options;
      const sel = opts.find((o) => o.selected);
      return sel ? sel.value : (opts[0] ? opts[0].value : '');
    }
    if (this.tagName === 'OPTION') {
      return this.hasAttribute('value') ? this.getAttribute('value') : this.textContent.trim();
    }
    if (this.tagName === 'TEXTAREA') {
      return this._value !== undefined ? this._value : this._defaultValue;
    }
    if (this._value !== undefined) return this._value;
    if (this.hasAttribute('value')) return this.getAttribute('value');
    return '';
  }

  set value(v) {
    const str = String(v ?? '');
    if (this.tagName === 'SELECT') {
      for (const opt of this.options) {
        opt.selected = opt.value === str;
      }
      return;
    }
    this._value = str;
  }

  get defaultValue() {
    if (this.tagName === 'TEXTAREA') {
      return this._defaultValue || '';
    }
    return this._defaultValue || this.getAttribute('value') || '';
  }

  set defaultValue(v) {
    this._defaultValue = String(v ?? '');
  }

  get checked() {
    if (this._checked !== undefined) return Boolean(this._checked);
    return this.hasAttribute('checked');
  }

  set checked(v) {
    this._checked = Boolean(v);
  }

  get defaultChecked() {
    return Boolean(this._defaultChecked || this.hasAttribute('checked'));
  }

  set defaultChecked(v) {
    this._defaultChecked = Boolean(v);
  }

  get selected() {
    if (this._selected !== undefined) return Boolean(this._selected);
    return this.hasAttribute('selected');
  }

  set selected(v) {
    this._selected = Boolean(v);
  }

  get defaultSelected() {
    return Boolean(this._defaultSelected || this.hasAttribute('selected'));
  }

  set defaultSelected(v) {
    this._defaultSelected = Boolean(v);
  }

  get options() {
    if (this.tagName !== 'SELECT') return [];
    return this.querySelectorAll('option');
  }

  get textContent() {
    let out = '';
    for (const child of this.childNodes) {
      out += child.textContent;
    }
    return out;
  }

  set textContent(v) {
    this.childNodes = [];
    const str = String(v ?? '');
    if (str.length > 0) {
      this.appendChild(new MiniTextNode(str, this.ownerDocument));
    }
  }

  get innerHTML() {
    if (this.tagName === 'TEMPLATE') {
      return this.content.innerHTML;
    }
    return this.childNodes.map((c) => serializeNode(c)).join('');
  }

  set innerHTML(html) {
    const target = this.tagName === 'TEMPLATE' ? this.content : this;
    target.childNodes = [];
    const nodes = parseHtmlNodes(String(html ?? ''), this.ownerDocument);
    for (const n of nodes) {
      target.appendChild(n);
    }
  }

  get outerHTML() {
    return serializeNode(this);
  }

  appendChild(child) {
    if (!child) return child;
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    this.childNodes.push(child);
    if (this.tagName === 'TEXTAREA' && child.nodeType === 3 && this._value === undefined) {
      this._defaultValue = this.textContent;
    }
    return child;
  }

  insertBefore(newNode, refNode) {
    if (!refNode) return this.appendChild(newNode);
    if (newNode === refNode) return newNode;
    if (newNode.parentNode) {
      newNode.parentNode.removeChild(newNode);
    }
    const idx = this.childNodes.indexOf(refNode);
    newNode.parentNode = this;
    newNode.ownerDocument = this.ownerDocument;
    if (idx === -1) {
      this.childNodes.push(newNode);
    } else {
      this.childNodes.splice(idx, 0, newNode);
    }
    return newNode;
  }

  removeChild(child) {
    const idx = this.childNodes.indexOf(child);
    if (idx !== -1) {
      this.childNodes.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  replaceWith(newNode) {
    if (!this.parentNode) return;
    this.parentNode.insertBefore(newNode, this);
    this.parentNode.removeChild(this);
  }

  cloneNode(deep = false) {
    const clone = new MiniElement(this.tagName, this.ownerDocument);
    for (const [k, v] of this._attrs.entries()) {
      clone._attrs.set(k, v);
    }
    clone._value = this._value;
    clone._defaultValue = this._defaultValue;
    clone._checked = this._checked;
    clone._defaultChecked = this._defaultChecked;
    clone._selected = this._selected;
    clone._defaultSelected = this._defaultSelected;
    clone.style = { ...this.style };
    if (deep) {
      for (const child of this.childNodes) {
        clone.appendChild(child.cloneNode(true));
      }
    }
    return clone;
  }

  contains(other) {
    let cur = other;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentNode;
    }
    return false;
  }

  matches(selector) {
    return matchSelectorList(this, selector);
  }

  closest(selector) {
    let cur = this;
    while (cur && cur.nodeType === 1) {
      if (cur.matches(selector)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    function walk(node) {
      for (const child of node.childNodes) {
        if (child.nodeType === 1) {
          if (child.matches(selector)) {
            results.push(child);
          }
          walk(child);
        }
      }
    }
    walk(this);
    return results;
  }

  focus() {
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this;
    }
  }

  reset() {
    if (this.tagName !== 'FORM') return;
    const controls = this.querySelectorAll('input, textarea, select');
    for (const ctrl of controls) {
      if (ctrl.tagName === 'INPUT') {
        const t = ctrl.type;
        if (t === 'checkbox' || t === 'radio') {
          ctrl.checked = ctrl.defaultChecked;
        } else {
          ctrl.value = ctrl.defaultValue;
        }
      } else if (ctrl.tagName === 'TEXTAREA') {
        ctrl.value = ctrl.defaultValue;
      } else if (ctrl.tagName === 'SELECT') {
        for (const opt of ctrl.options) {
          opt.selected = opt.defaultSelected;
        }
      }
    }
  }

  checkValidity() {
    if (this.tagName === 'FORM') {
      const controls = this.querySelectorAll('input, textarea, select');
      return controls.every((c) => c.checkValidity());
    }
    if (this.disabled) return true;
    if (this.hasAttribute('required') && !String(this.value || '').trim()) {
      return false;
    }
    return true;
  }

  reportValidity() {
    return this.checkValidity();
  }

  addEventListener(type, listener, options = {}) {
    if (typeof listener !== 'function') return;
    const t = String(type);
    if (!this._listeners.has(t)) {
      this._listeners.set(t, []);
    }
    const list = this._listeners.get(t);
    const once = Boolean(options && options.once);
    const signal = options && options.signal ? options.signal : null;
    if (signal && signal.aborted) return;

    const entry = { listener, once };
    list.push(entry);

    if (signal && typeof signal.addEventListener === 'function') {
      signal.addEventListener(
        'abort',
        () => {
          this.removeEventListener(t, listener);
        },
        { once: true }
      );
    }
  }

  removeEventListener(type, listener) {
    const t = String(type);
    const list = this._listeners.get(t);
    if (!list) return;
    const idx = list.findIndex((e) => e.listener === listener);
    if (idx !== -1) list.splice(idx, 1);
  }

  dispatchEvent(event) {
    if (!event.target) event.target = this;
    const pathNodes = [this];
    if (event.bubbles) {
      let p = this.parentNode;
      while (p) {
        pathNodes.push(p);
        p = p.parentNode;
      }
    }

    for (const node of pathNodes) {
      if (event._propagationStopped) break;
      event.currentTarget = node;
      const list = node._listeners ? [...(node._listeners.get(event.type) || [])] : [];
      for (const entry of list) {
        if (event._immediateStopped) break;
        if (entry.once) {
          node.removeEventListener(event.type, entry.listener);
        }
        entry.listener.call(node, event);
      }
    }

    return !event.defaultPrevented;
  }

  click() {
    const evt = new MiniEvent('click', { bubbles: true, cancelable: true });
    this.dispatchEvent(evt);
  }
}

class MiniDocument extends MiniElement {
  constructor() {
    super('#DOCUMENT', null);
    this.nodeType = 9;
    this.ownerDocument = this;
    this.readyState = 'complete';
    this.visibilityState = 'visible';
    this.cookie = '';
    this.documentElement = new MiniElement('HTML', this);
    this.head = new MiniElement('HEAD', this);
    this.body = new MiniElement('BODY', this);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
    this.activeElement = this.body;
  }

  createElement(tag) {
    return new MiniElement(tag, this);
  }

  createTextNode(text) {
    return new MiniTextNode(text, this);
  }

  importNode(node, deep = true) {
    const cloned = node.cloneNode(deep);
    setOwnerDocRecursive(cloned, this);
    return cloned;
  }

  getElementById(id) {
    if (!id) return null;
    return this.querySelector(`#${id}`);
  }
}

function setOwnerDocRecursive(node, doc) {
  node.ownerDocument = doc;
  if (node.childNodes) {
    for (const c of node.childNodes) {
      setOwnerDocRecursive(c, doc);
    }
  }
}

function serializeNode(node) {
  if (node.nodeType === 3) return node.nodeValue;
  if (node.nodeType !== 1) return '';
  const tag = node.tagName.toLowerCase();
  const attrs = node.attributes
    .map((a) => (a.value === '' ? a.name : `${a.name}="${a.value}"`))
    .join(' ');
  const open = attrs ? `<${tag} ${attrs}>` : `<${tag}>`;
  if (VOID_TAGS.has(node.tagName)) return open;
  return `${open}${node.innerHTML}</${tag}>`;
}

function parseHtmlNodes(html, doc) {
  const root = new MiniElement('ROOT', doc);
  const stack = [root];
  let i = 0;
  const len = html ? html.length : 0;

  while (i < len) {
    const nextLt = html.indexOf('<', i);
    if (nextLt === -1) {
      const text = html.slice(i);
      if (text) {
        stack[stack.length - 1].appendChild(new MiniTextNode(decodeEntities(text), doc));
      }
      break;
    }

    if (nextLt > i) {
      const text = html.slice(i, nextLt);
      stack[stack.length - 1].appendChild(new MiniTextNode(decodeEntities(text), doc));
      i = nextLt;
    }

    // Now html[i] === '<'
    if (html.startsWith('<!--', i)) {
      const commentEnd = html.indexOf('-->', i + 4);
      i = commentEnd === -1 ? len : commentEnd + 3;
      continue;
    }

    if (html.startsWith('<!', i)) {
      const docEnd = html.indexOf('>', i + 2);
      i = docEnd === -1 ? len : docEnd + 1;
      continue;
    }

    if (html.startsWith('</', i)) {
      const closeEnd = html.indexOf('>', i + 2);
      if (closeEnd !== -1) {
        const tag = html.slice(i + 2, closeEnd).trim().toUpperCase();
        for (let s = stack.length - 1; s > 0; s--) {
          if (stack[s].tagName === tag) {
            stack.length = s;
            break;
          }
        }
        i = closeEnd + 1;
        continue;
      }
    }

    // Opening or self-closing tag: <tag ...>
    // Find closing '>' taking quotes into account
    let inQuote = null;
    let tagEnd = -1;
    for (let j = i + 1; j < len; j++) {
      const ch = html[j];
      if (inQuote) {
        if (ch === inQuote) inQuote = null;
      } else if (ch === '"' || ch === "'") {
        inQuote = ch;
      } else if (ch === '>') {
        tagEnd = j;
        break;
      }
    }

    if (tagEnd === -1) {
      const text = html.slice(i);
      stack[stack.length - 1].appendChild(new MiniTextNode(decodeEntities(text), doc));
      break;
    }

    let tagContent = html.slice(i + 1, tagEnd).trim();
    let selfClosing = false;
    if (tagContent.endsWith('/')) {
      selfClosing = true;
      tagContent = tagContent.slice(0, -1).trim();
    }

    const firstSpace = tagContent.search(/\s/);
    const rawTagName = firstSpace === -1 ? tagContent : tagContent.slice(0, firstSpace);
    const rawAttrs = firstSpace === -1 ? '' : tagContent.slice(firstSpace + 1);

    if (rawTagName && /^[a-zA-Z0-9_-]+$/.test(rawTagName)) {
      const upperOpen = rawTagName.toUpperCase();
      const el = new MiniElement(upperOpen, doc);
      if (rawAttrs) parseAttributesInto(el, rawAttrs);
      stack[stack.length - 1].appendChild(el);
      if (!selfClosing && !VOID_TAGS.has(upperOpen)) {
        stack.push(el);
      }
    } else {
      stack[stack.length - 1].appendChild(new MiniTextNode(decodeEntities(html.slice(i, tagEnd + 1)), doc));
    }

    i = tagEnd + 1;
  }

  return [...root.childNodes];
}

function parseAttributesInto(el, attrStr) {
  const attrRegex = /([a-zA-Z0-9_:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = attrRegex.exec(attrStr)) !== null) {
    const name = m[1];
    const val = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '';
    el.setAttribute(name, decodeEntities(val));
  }
}

function matchSelectorList(el, selectorList) {
  const parts = String(selectorList || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.some((sel) => matchSingleSelector(el, sel));
}

function matchSingleSelector(el, sel) {
  let rem = sel.trim();
  if (!rem) return false;

  // Handle simple descendant combinator `A B`
  const spaceParts = splitOutsideBrackets(rem);
  if (spaceParts.length > 1) {
    const lastSel = spaceParts[spaceParts.length - 1];
    if (!matchCompoundSelector(el, lastSel)) return false;
    let cur = el.parentElement;
    for (let i = spaceParts.length - 2; i >= 0; i--) {
      const ancestorSel = spaceParts[i];
      while (cur && !matchCompoundSelector(cur, ancestorSel)) {
        cur = cur.parentElement;
      }
      if (!cur) return false;
      cur = cur.parentElement;
    }
    return true;
  }

  return matchCompoundSelector(el, rem);
}

function splitOutsideBrackets(sel) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i];
    if (ch === '[') depth++;
    else if (ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ' ' && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function matchCompoundSelector(el, compound) {
  let rem = compound.trim();

  // Extract attribute selectors `[attr="val"]` or `[attr]`
  const attrRegex = /\[([a-zA-Z0-9_:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]/g;
  let m;
  while ((m = attrRegex.exec(rem)) !== null) {
    const attrName = m[1];
    const expected = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4];
    if (expected === undefined) {
      if (!el.hasAttribute(attrName)) return false;
    } else {
      if (el.getAttribute(attrName) !== expected) return false;
    }
  }
  rem = rem.replace(attrRegex, '').trim();

  // Extract `#id`
  const idMatch = rem.match(/#([a-zA-Z0-9_-]+)/);
  if (idMatch) {
    if (el.id !== idMatch[1]) return false;
    rem = rem.replace(idMatch[0], '').trim();
  }

  // Extract `.class`
  const classMatches = rem.match(/\.[a-zA-Z0-9_-]+/g);
  if (classMatches) {
    const elClasses = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
    for (const cm of classMatches) {
      if (!elClasses.includes(cm.slice(1))) return false;
    }
    rem = rem.replace(/\.[a-zA-Z0-9_-]+/g, '').trim();
  }

  if (rem && rem !== '*') {
    if (el.tagName !== rem.toUpperCase()) return false;
  }

  return true;
}

/**
 * Create a fresh isolated browser-like DOM environment and install globals (`document`, `window`, `CustomEvent`, `Event`, `HTMLElement`).
 */
function createMiniDomEnvironment(html = '', url = 'http://localhost/notes') {
  const doc = new MiniDocument();
  if (html) {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    doc.body.innerHTML = bodyMatch ? bodyMatch[1] : html;
  }

  const parsedUrl = new URL(url, 'http://localhost');
  const winTarget = new MiniElement('#WINDOW', null);
  const win = {
    document: doc,
    location: {
      pathname: parsedUrl.pathname,
      search: parsedUrl.search,
      href: parsedUrl.href,
      assign(nextUrl) {
        this.href = String(nextUrl);
      },
    },
    addEventListener(type, listener, options) {
      return winTarget.addEventListener(type, listener, options);
    },
    removeEventListener(type, listener) {
      return winTarget.removeEventListener(type, listener);
    },
    dispatchEvent(event) {
      return winTarget.dispatchEvent(event);
    },
    CustomEvent: MiniCustomEvent,
    Event: MiniEvent,
    HTMLElement: MiniElement,
    Element: MiniElement,
    HTMLFormElement: MiniElement,
    HTMLInputElement: MiniElement,
    HTMLSelectElement: MiniElement,
    HTMLTextAreaElement: MiniElement,
  };
  doc.defaultView = win;

  const prevGlobals = {
    document: globalThis.document,
    window: globalThis.window,
    CustomEvent: globalThis.CustomEvent,
    Event: globalThis.Event,
    HTMLElement: globalThis.HTMLElement,
  };

  globalThis.document = doc;
  globalThis.window = win;
  globalThis.CustomEvent = MiniCustomEvent;
  globalThis.Event = MiniEvent;
  globalThis.HTMLElement = MiniElement;

  return {
    document: doc,
    window: win,
    restore() {
      globalThis.document = prevGlobals.document;
      globalThis.window = prevGlobals.window;
      globalThis.CustomEvent = prevGlobals.CustomEvent;
      globalThis.Event = prevGlobals.Event;
      globalThis.HTMLElement = prevGlobals.HTMLElement;
    },
  };
}

module.exports = {
  MiniEvent,
  MiniCustomEvent,
  MiniElement,
  MiniDocument,
  createMiniDomEnvironment,
};
