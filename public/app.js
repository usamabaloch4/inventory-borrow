// GearTrack Client Application Logic
(function() {
  'use strict';

  // --- STATE ---
  const state = {
    activeTab: 'scan',
    scannerMode: 'smart', // 'smart', 'checkout', 'return', 'register'
    html5QrCode: null,
    cameraRunning: false,
    selectedCameraId: null,
    lastScannedCode: null,
    lastScanTimestamp: 0,
    scanCooldownMs: 1500,

    // Active session
    selectedPhotographer: null,
    basketItems: [], // Array of gear objects

    // Data cache
    gear: [],
    photographers: [],
    history: [],
    networkInfo: null,

    // Fuzzy selects registry
    fuzzySelects: {},

    // WebSockets
    ws: null
  };

  // --- AUDIO & HAPTIC SYNTHESIZER ---
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  function playTone(freq, type = 'sine', duration = 0.1, delay = 0) {
    try {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime + delay);

      gain.gain.setValueAtTime(0.2, audioCtx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + delay + duration);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start(audioCtx.currentTime + delay);
      osc.stop(audioCtx.currentTime + delay + duration);
    } catch (e) {
      // Audio autoplay policy fallback
    }
  }

  function soundScanBeep() {
    playTone(1200, 'sine', 0.08);
    if (navigator.vibrate) navigator.vibrate(50);
  }

  function soundCheckoutSuccess() {
    playTone(587.33, 'triangle', 0.1, 0);      // D5
    playTone(739.99, 'triangle', 0.1, 0.08);   // F#5
    playTone(880.00, 'triangle', 0.2, 0.16);   // A5
    if (navigator.vibrate) navigator.vibrate([40, 60, 80]);
  }

  function soundReturnSuccess() {
    playTone(880.00, 'sine', 0.08, 0);
    playTone(587.33, 'sine', 0.12, 0.08);
    if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
  }

  function soundError() {
    playTone(220.00, 'sawtooth', 0.2, 0);
    playTone(180.00, 'sawtooth', 0.25, 0.1);
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
  }

  // --- SVG ICON SYSTEM ---
  const Icons = {
    camera: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>`,
    lens: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="2"/></svg>`,
    radio: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1"/></svg>`,
    lighting: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>`,
    audio: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>`,
    accessory: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`,
    package: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`,
    tag: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/></svg>`,
    user: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    users: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    phone: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
    badge: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>`,
    edit: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`,
    trash: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,
    plus: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`,
    cross: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
    check: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
    search: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
    info: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
    warning: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>`,
    pause: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`,
    play: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    target: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
    zoom: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/></svg>`,
    chevronDown: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`
  };

  // --- TOAST NOTIFICATIONS ---
  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = Icons.info;
    if (type === 'success') icon = Icons.check;
    if (type === 'error') icon = Icons.warning;

    toast.innerHTML = `<span class="toast-icon-wrap">${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // --- API HELPERS ---
  async function api(path, options = {}) {
    try {
      const res = await fetch(path, {
        headers: { 'Content-Type': 'application/json' },
        ...options
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Server error');
      return data;
    } catch (err) {
      console.error(`API Error on ${path}:`, err);
      throw err;
    }
  }

  // --- WEBSOCKET LIVE SYNC ---
  function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    try {
      state.ws = new WebSocket(wsUrl);

      state.ws.onopen = () => {
        document.getElementById('syncDot').className = 'sync-dot';
        document.getElementById('syncText').textContent = 'Live Sync Active';
      };

      state.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleRemoteEvent(msg.event, msg.data);
        } catch (e) {
          console.error('Failed to parse WS msg:', e);
        }
      };

      state.ws.onclose = () => {
        document.getElementById('syncDot').className = 'sync-dot disconnected';
        document.getElementById('syncText').textContent = 'Reconnecting...';
        setTimeout(initWebSocket, 3000);
      };

      state.ws.onerror = () => {
        state.ws.close();
      };
    } catch (e) {
      console.warn('WS Init failed:', e);
    }
  }

  function handleRemoteEvent(eventName, data) {
    console.log('Realtime event received:', eventName, data);
    
    // When code is scanned from phone camera
    if (eventName === 'remote_code_scanned' && data && data.code) {
      soundScanBeep();
      showToast(`Scanned from Phone: "${data.code}"`, 'success');
      processScannedCode(data.code);
      return;
    }

    // Refresh all data on CRUD updates
    loadAllData();
  }

  // --- FUZZY SEARCH COMBOBOX SYSTEM ---
  function fuzzyMatch(query, text) {
    if (!query) return { match: true, score: 0, indices: [] };
    if (!text) return { match: false, score: 0, indices: [] };

    const q = query.trim().toLowerCase();
    if (!q) return { match: true, score: 0, indices: [] };
    const t = text.toLowerCase();

    // 1. Exact match
    if (t === q) {
      return { match: true, score: 1000, indices: Array.from({ length: t.length }, (_, i) => i) };
    }

    // 2. Starts with query
    if (t.startsWith(q)) {
      return { match: true, score: 800 - (t.length - q.length), indices: Array.from({ length: q.length }, (_, i) => i) };
    }

    // 3. Substring match
    const subIdx = t.indexOf(q);
    if (subIdx !== -1) {
      return { 
        match: true, 
        score: 500 - subIdx - (t.length - q.length), 
        indices: Array.from({ length: q.length }, (_, i) => subIdx + i) 
      };
    }

    // 4. Multi-token match (e.g. "sony 24")
    const tokens = q.split(/\s+/).filter(Boolean);
    if (tokens.length > 1) {
      let allFound = true;
      let indices = [];
      let score = 400;
      for (const tok of tokens) {
        const idx = t.indexOf(tok);
        if (idx === -1) {
          allFound = false;
          break;
        }
        for (let i = 0; i < tok.length; i++) indices.push(idx + i);
      }
      if (allFound) {
        return { match: true, score: score - (t.length - q.length), indices: [...new Set(indices)].sort((a, b) => a - b) };
      }
    }

    // 5. Sequential character fuzzy match with word-boundary bonus
    let qIdx = 0;
    let score = 0;
    let indices = [];
    let prevMatchIdx = -2;

    for (let i = 0; i < t.length && qIdx < q.length; i++) {
      if (t[i] === q[qIdx]) {
        indices.push(i);
        let charScore = 15;
        if (i === 0 || /[\s\-_/([\]:,]/.test(t[i - 1])) {
          charScore += 35; // Word start bonus
        }
        if (i === prevMatchIdx + 1) {
          charScore += 25; // Consecutive character bonus
        }
        score += charScore;
        prevMatchIdx = i;
        qIdx++;
      }
    }

    if (qIdx === q.length) {
      score -= (t.length - q.length);
      return { match: true, score, indices };
    }

    return { match: false, score: 0, indices: [] };
  }

  function highlightFuzzyText(text, indices) {
    if (!text) return '';
    if (!indices || indices.length === 0) return escapeHtml(text);
    const indexSet = new Set(indices);
    let html = '';
    for (let i = 0; i < text.length; i++) {
      const char = escapeHtml(text[i]);
      if (indexSet.has(i)) {
        html += `<span class="fuzzy-match-highlight">${char}</span>`;
      } else {
        html += char;
      }
    }
    return html;
  }

  class FuzzySelect {
    constructor(selectEl, options = {}) {
      if (!selectEl) return;
      this.selectEl = selectEl;
      this.options = {
        placeholder: options.placeholder || selectEl.getAttribute('placeholder') || '-- Select --',
        icon: options.icon || null,
        clearOnSelect: !!options.clearOnSelect,
        allowClear: options.allowClear !== false,
        searchPlaceholder: options.searchPlaceholder || 'Type to fuzzy search...',
        onSelect: options.onSelect || null,
        ...options
      };

      this.isOpen = false;
      this.items = [];
      this.highlightedIndex = -1;
      this.visibleItems = [];

      this.initDom();
      this.bindEvents();
      this.syncFromNative();
    }

    initDom() {
      this.selectEl.style.display = 'none';
      this.selectEl.setAttribute('aria-hidden', 'true');
      this.selectEl.tabIndex = -1;

      let container = this.selectEl.nextElementSibling;
      if (container && container.classList.contains('fuzzy-select-container')) {
        this.container = container;
      } else {
        this.container = document.createElement('div');
        this.container.className = 'fuzzy-select-container';
        if (this.selectEl.id) {
          this.container.id = `fuzzy-${this.selectEl.id}`;
        }
        this.selectEl.parentNode.insertBefore(this.container, this.selectEl.nextSibling);
      }

      if (this.selectEl.style.maxWidth) {
        this.container.style.maxWidth = this.selectEl.style.maxWidth;
        this.container.style.marginLeft = 'auto';
        this.container.style.marginRight = 'auto';
      }
      if (this.selectEl.style.width) {
        this.container.style.width = this.selectEl.style.width;
      }
      if (this.selectEl.style.flex) {
        this.container.style.flex = this.selectEl.style.flex;
      }
      if (this.selectEl.style.margin) {
        this.container.style.margin = this.selectEl.style.margin;
      }

      this.container.innerHTML = `
        <div class="fuzzy-select-trigger" tabindex="0" role="combobox" aria-expanded="false" aria-haspopup="listbox">
          <div class="fuzzy-select-trigger-content">
            <span class="fuzzy-select-trigger-icon" style="${this.options.icon ? 'display:flex; align-items:center;' : 'display:none;'}">${this.options.icon || ''}</span>
            <span class="fuzzy-select-label fuzzy-select-placeholder">${escapeHtml(this.options.placeholder)}</span>
          </div>
          <div class="fuzzy-select-icons">
            <span class="fuzzy-select-clear" title="Clear" style="display: none; cursor: pointer; padding: 2px;">${Icons.cross}</span>
            <span class="fuzzy-select-chevron" style="display: flex; align-items: center;">${Icons.chevronDown}</span>
          </div>
        </div>
        <div class="fuzzy-select-dropdown" role="listbox">
          <div class="fuzzy-select-search-wrap">
            <span style="color: var(--text-muted); display:flex; align-items:center;">${Icons.search}</span>
            <input type="text" class="fuzzy-select-search-input" placeholder="${escapeHtml(this.options.searchPlaceholder)}" autocomplete="off" spellcheck="false" />
          </div>
          <div class="fuzzy-select-list"></div>
        </div>
      `;

      this.trigger = this.container.querySelector('.fuzzy-select-trigger');
      this.labelEl = this.container.querySelector('.fuzzy-select-label');
      this.iconEl = this.container.querySelector('.fuzzy-select-trigger-icon');
      this.clearBtn = this.container.querySelector('.fuzzy-select-clear');
      this.dropdown = this.container.querySelector('.fuzzy-select-dropdown');
      this.searchInput = this.container.querySelector('.fuzzy-select-search-input');
      this.listEl = this.container.querySelector('.fuzzy-select-list');
    }

    bindEvents() {
      this.trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (e.target.closest('.fuzzy-select-clear')) {
          this.clearValue();
          return;
        }
        this.toggle();
      });

      this.trigger.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
          e.preventDefault();
          this.open();
        }
      });

      this.searchInput.addEventListener('input', () => {
        this.renderList(this.searchInput.value);
      });

      this.searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.navigate(1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.navigate(-1);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          this.selectHighlighted();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.close();
        } else if (e.key === 'Tab') {
          this.close();
        }
      });

      // Close when clicking outside
      document.addEventListener('click', (e) => {
        if (!this.container.contains(e.target) && this.isOpen) {
          this.close();
        }
      });
    }

    syncFromNative() {
      this.items = [];
      const children = Array.from(this.selectEl.children);

      for (const node of children) {
        if (node.tagName.toLowerCase() === 'optgroup') {
          const groupLabel = node.getAttribute('label') || '';
          const groupOpts = Array.from(node.querySelectorAll('option'));
          for (const opt of groupOpts) {
            this.items.push(this.parseOption(opt, groupLabel));
          }
        } else if (node.tagName.toLowerCase() === 'option') {
          this.items.push(this.parseOption(node, ''));
        }
      }

      this.updateTriggerDisplay();
      if (this.isOpen) {
        this.renderList(this.searchInput.value);
      }
    }

    parseOption(opt, group = '') {
      const rawText = opt.textContent.trim();
      const isPlaceholder = !opt.value && (rawText.startsWith('--') || rawText.startsWith('+'));

      return {
        value: opt.value,
        label: rawText,
        group,
        disabled: opt.disabled,
        selected: opt.selected,
        isPlaceholder,
        rawText: `${rawText} ${group}`
      };
    }

    updateTriggerDisplay() {
      const selectedVal = this.selectEl.value;
      const selectedItem = this.items.find(i => i.value === selectedVal && !i.isPlaceholder);

      if (selectedItem) {
        this.labelEl.textContent = selectedItem.label;
        this.labelEl.classList.remove('fuzzy-select-placeholder');
        if (this.options.allowClear && !this.options.clearOnSelect) {
          this.clearBtn.style.display = 'inline-flex';
        } else {
          this.clearBtn.style.display = 'none';
        }
      } else {
        const placeholderItem = this.items.find(i => i.isPlaceholder);
        const placeholderText = placeholderItem ? placeholderItem.label : this.options.placeholder;
        this.labelEl.textContent = placeholderText;
        this.labelEl.classList.add('fuzzy-select-placeholder');
        this.clearBtn.style.display = 'none';
      }
    }

    open() {
      document.querySelectorAll('.fuzzy-select-container.open').forEach(c => {
        if (c !== this.container) c.classList.remove('open');
      });

      this.isOpen = true;
      this.container.classList.add('open');
      this.trigger.setAttribute('aria-expanded', 'true');
      this.searchInput.value = '';
      this.renderList('');
      setTimeout(() => {
        this.searchInput.focus();
      }, 15);
    }

    close() {
      this.isOpen = false;
      this.container.classList.remove('open');
      this.trigger.setAttribute('aria-expanded', 'false');
    }

    toggle() {
      if (this.isOpen) this.close();
      else this.open();
    }

    clearValue() {
      this.selectEl.value = '';
      this.selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      this.updateTriggerDisplay();
      if (this.options.onSelect) this.options.onSelect('');
    }

    renderList(query = '') {
      this.listEl.innerHTML = '';
      this.visibleItems = [];

      let scoredItems = [];
      for (const item of this.items) {
        if (item.isPlaceholder && !item.value) continue;
        const res = fuzzyMatch(query, item.rawText);
        if (res.match) {
          scoredItems.push({
            item,
            score: res.score,
            indices: res.indices
          });
        }
      }

      if (query) {
        scoredItems.sort((a, b) => b.score - a.score);
      }

      if (scoredItems.length === 0) {
        this.listEl.innerHTML = `
          <div class="fuzzy-select-empty">
            <div style="opacity: 0.6; margin-bottom: 0.35rem;">${Icons.search}</div>
            <div>No matching results found</div>
          </div>
        `;
        this.highlightedIndex = -1;
        return;
      }

      let currentGroup = null;

      scoredItems.forEach((scored, idx) => {
        const { item, indices } = scored;
        this.visibleItems.push(item);

        if (!query && item.group && item.group !== currentGroup) {
          currentGroup = item.group;
          const groupEl = document.createElement('div');
          groupEl.className = 'fuzzy-select-group-title';
          groupEl.textContent = currentGroup;
          this.listEl.appendChild(groupEl);
        }

        const optEl = document.createElement('div');
        optEl.className = 'fuzzy-select-option';
        optEl.setAttribute('role', 'option');
        optEl.dataset.value = item.value;
        optEl.dataset.index = idx;

        if (this.selectEl.value === item.value && !this.options.clearOnSelect) {
          optEl.classList.add('selected');
        }

        const highlightedText = highlightFuzzyText(item.label, indices);
        optEl.innerHTML = `
          <div class="fuzzy-select-option-main">
            <span class="fuzzy-select-option-text">${highlightedText}</span>
          </div>
          ${item.group && query ? `<span class="fuzzy-select-option-sub">${escapeHtml(item.group)}</span>` : ''}
        `;

        optEl.addEventListener('click', (e) => {
          e.stopPropagation();
          this.selectItem(item);
        });

        this.listEl.appendChild(optEl);
      });

      this.highlightedIndex = 0;
      this.updateHighlight();
    }

    updateHighlight() {
      const opts = this.listEl.querySelectorAll('.fuzzy-select-option');
      opts.forEach((el, idx) => {
        if (idx === this.highlightedIndex) {
          el.classList.add('highlighted');
          el.scrollIntoView({ block: 'nearest' });
        } else {
          el.classList.remove('highlighted');
        }
      });
    }

    navigate(dir) {
      if (this.visibleItems.length === 0) return;
      this.highlightedIndex += dir;
      if (this.highlightedIndex < 0) this.highlightedIndex = this.visibleItems.length - 1;
      if (this.highlightedIndex >= this.visibleItems.length) this.highlightedIndex = 0;
      this.updateHighlight();
    }

    selectHighlighted() {
      if (this.highlightedIndex >= 0 && this.highlightedIndex < this.visibleItems.length) {
        this.selectItem(this.visibleItems[this.highlightedIndex]);
      }
    }

    selectItem(item) {
      this.selectEl.value = item.value;
      this.selectEl.dispatchEvent(new Event('change', { bubbles: true }));

      if (this.options.clearOnSelect) {
        this.selectEl.value = '';
        this.updateTriggerDisplay();
      } else {
        this.updateTriggerDisplay();
      }

      this.close();
      if (this.options.onSelect) {
        this.options.onSelect(item.value, item);
      }
    }
  }

  function initOrUpdateFuzzySelect(selectId, options = {}) {
    const el = document.getElementById(selectId);
    if (!el) return null;
    if (!state.fuzzySelects) state.fuzzySelects = {};

    if (state.fuzzySelects[selectId]) {
      state.fuzzySelects[selectId].syncFromNative();
      return state.fuzzySelects[selectId];
    } else {
      const fs = new FuzzySelect(el, options);
      state.fuzzySelects[selectId] = fs;
      return fs;
    }
  }

  // --- DATA LOADING & RENDERING ---
  async function loadAllData() {
    try {
      const [stats, gearList, photoList, historyList] = await Promise.all([
        api('/api/stats'),
        api('/api/gear'),
        api('/api/photographers'),
        api('/api/history')
      ]);

      state.gear = gearList;
      state.photographers = photoList;
      state.history = historyList;

      if (state.selectedPhotographer) {
        state.selectedPhotographer = state.photographers.find(p => p.id === state.selectedPhotographer.id) || null;
        renderSelectedPhotographer();
      }

      renderStats(stats);
      renderGearInventory();
      renderPhotographers();
      renderHistoryTable();
      renderLabelSheet();
      updatePhotographerDropdowns();
      updateGearDropdowns();
    } catch (err) {
      console.error('Failed to load data:', err);
    }
  }

  function renderStats(stats) {
    document.getElementById('statTotalGear').textContent = stats.totalGear || 0;
    document.getElementById('statAvailableGear').textContent = stats.available || 0;
    document.getElementById('statInUseGear').textContent = stats.inUse || 0;
    document.getElementById('statActivePhotographers').textContent = stats.activePhotographers || 0;

    document.getElementById('badgeGearCount').textContent = stats.totalGear || 0;
    document.getElementById('badgePhotoCount').textContent = stats.totalPhotographers || 0;
  }

  function updatePhotographerDropdowns() {
    const select = document.getElementById('quickSelectPhotographer');
    if (select) {
      const currentVal = select.value;
      select.innerHTML = '<option value="">-- Choose Photographer --</option>';

      for (const p of state.photographers) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.name} (${p.barcode}) ${p.activeGearCount > 0 ? `[${p.activeGearCount} items held]` : ''}`;
        select.appendChild(opt);
      }
      if (currentVal) select.value = currentVal;

      initOrUpdateFuzzySelect('quickSelectPhotographer', {
        placeholder: '-- Choose Photographer --',
        icon: Icons.user,
        searchPlaceholder: 'Search photographer or ID...'
      });
    }

    const modalSelect = document.getElementById('manualModalPhotographerSelect');
    if (modalSelect) {
      const curVal = modalSelect.value;
      modalSelect.innerHTML = '<option value="">-- Choose Crew Member --</option>';
      for (const p of state.photographers) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.name} (${p.role || 'Crew'} - ${p.barcode})`;
        modalSelect.appendChild(opt);
      }
      if (curVal) modalSelect.value = curVal;

      initOrUpdateFuzzySelect('manualModalPhotographerSelect', {
        placeholder: '-- Choose Crew Member --',
        icon: Icons.user,
        searchPlaceholder: 'Search crew member or role...'
      });
    }
  }

  function updateGearDropdowns() {
    const select = document.getElementById('quickSelectGear');
    if (!select) return;

    select.innerHTML = '<option value="">+ Manually add gear to basket...</option>';

    const available = state.gear.filter(g => g.status === 'available');
    const checkedOut = state.gear.filter(g => g.status === 'checked_out');

    if (available.length > 0) {
      const groupAvail = document.createElement('optgroup');
      groupAvail.label = `Available Equipment (${available.length})`;
      for (const g of available) {
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = `${g.name} (${g.category}) - ${g.barcode}`;
        groupAvail.appendChild(opt);
      }
      select.appendChild(groupAvail);
    }

    if (checkedOut.length > 0) {
      const groupOut = document.createElement('optgroup');
      groupOut.label = `Checked Out (Reassign/Transfer) (${checkedOut.length})`;
      for (const g of checkedOut) {
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = `${g.name} [With: ${g.current_photographer_name || 'Assigned'}] - ${g.barcode}`;
        groupOut.appendChild(opt);
      }
      select.appendChild(groupOut);
    }

    initOrUpdateFuzzySelect('quickSelectGear', {
      placeholder: '+ Quick add gear to basket...',
      icon: Icons.plus,
      clearOnSelect: true,
      searchPlaceholder: 'Search gear name, category, barcode...'
    });
  }

  // Render Gear Inventory
  function renderGearInventory() {
    const grid = document.getElementById('gearGrid');
    const search = (document.getElementById('gearSearchInput').value || '').toLowerCase();
    const cat = document.getElementById('gearCategoryFilter').value;
    const status = document.getElementById('gearStatusFilter').value;

    let filtered = state.gear.filter(g => {
      if (cat && g.category !== cat) return false;
      if (status && g.status !== status) return false;
      if (search) {
        const text = `${g.name} ${g.barcode} ${g.serial_number || ''} ${g.current_photographer_name || ''}`.toLowerCase();
        if (!text.includes(search)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1; text-align: center; padding: 3.5rem 1rem; color: var(--text-muted);">
          <div class="empty-state-icon" style="color: var(--text-muted); opacity: 0.6; margin-bottom: 0.75rem;">${Icons.search}</div>
          <div style="font-size: 1.1rem; color: var(--text-main); font-weight: 600;">No Gear Found</div>
          <div style="font-size: 0.85rem; margin-top: 0.25rem;">Try adjusting your filters or click "+ Add Gear Item" to register new equipment.</div>
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered.map(g => {
      let statusClass = 'available';
      let statusLabel = 'Available';
      if (g.status === 'checked_out') {
        statusClass = 'checked_out';
        statusLabel = 'Checked Out';
      } else if (g.status === 'maintenance') {
        statusClass = 'maintenance';
        statusLabel = 'Maintenance';
      }

      const checkedOutTime = g.checked_out_at ? formatRelativeTime(g.checked_out_at) : '';

      return `
        <div class="gear-card" data-id="${g.id}">
          <div class="gear-card-header">
            <div style="display: flex; flex-direction: column; gap: 0.25rem;">
              <span class="category-tag">${getCategoryIcon(g.category)} <span>${escapeHtml(g.category)}</span></span>
              <h4 class="gear-title">${escapeHtml(g.name)}</h4>
            </div>
            <span class="status-pill ${statusClass}">${statusLabel}</span>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;">
            <span class="gear-barcode-tag">${Icons.tag} <span>${escapeHtml(g.barcode)}</span></span>
            ${g.serial_number ? `<span style="font-size: 0.75rem; color: var(--text-muted); font-family: var(--font-mono);">SN: ${escapeHtml(g.serial_number)}</span>` : ''}
          </div>

          ${g.status === 'checked_out' ? `
            <div class="gear-holder-info">
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span class="icon-wrap" style="color: #60a5fa;">${Icons.user}</span>
                <div>
                  <strong style="color: var(--text-main); font-size: 0.88rem;">${escapeHtml(g.current_photographer_name || 'Assigned')}</strong>
                  <div style="font-size: 0.72rem; opacity: 0.85;">Out ${checkedOutTime}</div>
                </div>
              </div>
              <button class="btn btn-sm btn-amber" onclick="window.GearTrack.returnSingleItem(${g.id})">
                Check In
              </button>
            </div>
          ` : ''}

          ${g.notes ? `<div style="font-size: 0.75rem; color: var(--text-muted); font-style: italic;">"${escapeHtml(g.notes)}"</div>` : ''}

          <div class="gear-actions">
            ${g.status === 'available' ? `
              <button class="btn btn-sm btn-primary" onclick="window.GearTrack.addToSessionBasket(${g.id})" style="flex: 1;">
                ${Icons.plus} Add to Basket
              </button>
            ` : ''}
            <button class="btn btn-sm" onclick="window.GearTrack.openSingleBarcodeModal(${g.id})" title="Print or View Barcode / QR">
              ${Icons.tag} Label
            </button>
            <button class="btn btn-sm" onclick="window.GearTrack.editGear(${g.id})" title="Edit Details">
              ${Icons.edit}
            </button>
            <button class="btn btn-sm btn-danger" onclick="window.GearTrack.deleteGear(${g.id})" title="Delete">
              ${Icons.trash}
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Render Photographers
  function renderPhotographers() {
    const grid = document.getElementById('photographersGrid');
    const search = (document.getElementById('photoSearchInput').value || '').toLowerCase();

    let filtered = state.photographers.filter(p => {
      if (search) {
        const text = `${p.name} ${p.barcode} ${p.role || ''} ${p.phone || ''}`.toLowerCase();
        if (!text.includes(search)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1; text-align: center; padding: 3.5rem 1rem; color: var(--text-muted);">
          <div class="empty-state-icon" style="color: var(--text-muted); opacity: 0.6; margin-bottom: 0.75rem;">${Icons.users}</div>
          <div style="font-size: 1.1rem; color: var(--text-main); font-weight: 600;">No Photographers Found</div>
          <div style="font-size: 0.85rem; margin-top: 0.25rem;">Click "+ Add Photographer / Staff" to register team members.</div>
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered.map(p => {
      const initials = p.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
      const heldGear = state.gear.filter(g => g.current_photographer_id == p.id);
      const isActive = heldGear.length > 0;

      // Find active checkout notes from audit log for this crew member's currently held gear
      const activeCheckoutNotes = [];
      const gearCheckoutMap = {};
      for (const g of heldGear) {
        const log = state.history.find(h => h.action === 'checkout' && h.gear_id === g.id && h.photographer_id == p.id && h.notes);
        if (log && log.notes) {
          gearCheckoutMap[g.id] = log.notes;
          if (!activeCheckoutNotes.includes(log.notes)) {
            activeCheckoutNotes.push(log.notes);
          }
        }
      }

      return `
        <div class="gear-card photographer-card" data-id="${p.id}">
          <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem;">
            <div style="display: flex; align-items: center; gap: 0.75rem; min-width: 0;">
              <div class="photo-avatar" style="flex-shrink: 0;">${initials}</div>
              <div style="min-width: 0;">
                <h4 style="font-size: 1.05rem; font-weight: 700; color: var(--text-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(p.name)}</h4>
                <div style="font-size: 0.78rem; color: var(--accent-blue); font-weight: 600;">${escapeHtml(p.role || 'Photographer')}</div>
              </div>
            </div>
            ${isActive ? `
              <span class="badge badge-warning" style="font-size: 0.7rem; flex-shrink: 0;">Active (${heldGear.length})</span>
            ` : `
              <span class="badge badge-success" style="font-size: 0.7rem; flex-shrink: 0;">Ready</span>
            `}
          </div>

          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
            <span class="gear-barcode-tag">${Icons.badge} <span>ID: ${escapeHtml(p.barcode)}</span></span>
            ${p.phone ? `<span style="font-size: 0.78rem; color: var(--text-muted); display: inline-flex; align-items: center; gap: 0.3rem;">${Icons.phone} <span>${escapeHtml(p.phone)}</span></span>` : ''}
            ${p.email ? `<span style="font-size: 0.78rem; color: var(--text-muted); display: inline-flex; align-items: center; gap: 0.3rem;">@ <span>${escapeHtml(p.email)}</span></span>` : ''}
          </div>

          <!-- Active Checkout Notes (from audit transaction log) -->
          ${activeCheckoutNotes.length > 0 ? `
            <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: var(--radius-sm); padding: 0.5rem 0.75rem; font-size: 0.8rem; display: flex; flex-direction: column; gap: 0.25rem;">
              <div style="color: #f59e0b; font-weight: 700; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; display: flex; align-items: center; gap: 0.35rem;">
                <span style="display: inline-flex;">${Icons.tag}</span>
                <span>Active Checkout Notes:</span>
              </div>
              ${activeCheckoutNotes.map(n => `<div style="color: var(--text-main); font-weight: 500; font-style: italic; word-break: break-word;">"${escapeHtml(n)}"</div>`).join('')}
            </div>
          ` : ''}

          <!-- Permanent Profile Notes -->
          ${p.notes ? `
            <div style="background: rgba(0,0,0,0.2); border: 1px dashed var(--border-color); border-radius: var(--radius-sm); padding: 0.45rem 0.65rem; font-size: 0.78rem; color: var(--text-muted); display: flex; align-items: flex-start; gap: 0.45rem;">
              <span style="color: var(--accent-blue); font-weight: 600; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; flex-shrink: 0;">Profile Note:</span>
              <span style="color: var(--text-main); font-style: italic; word-break: break-word;">${escapeHtml(p.notes)}</span>
            </div>
          ` : ''}

          <!-- Active Gear Held -->
          <div style="background: rgba(0,0,0,0.25); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 0.75rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem;">
              <span style="font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">
                Assigned Gear (${heldGear.length})
              </span>
              ${heldGear.length > 0 ? `
                <button class="btn btn-sm btn-amber" style="font-size: 0.7rem; padding: 0.2rem 0.5rem;" onclick="window.GearTrack.returnAllPhotographerGear(${p.id})">
                  Return All
                </button>
              ` : ''}
            </div>

            ${heldGear.length === 0 ? `
              <div style="font-size: 0.78rem; color: var(--text-sub);">No gear currently checked out.</div>
            ` : `
              <div style="display: flex; flex-direction: column; gap: 0.35rem; max-height: 140px; overflow-y: auto;">
                ${heldGear.map(g => {
                  const chkNote = gearCheckoutMap[g.id] || g.notes;
                  return `
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; background: rgba(255,255,255,0.03); padding: 0.35rem 0.5rem; border-radius: 4px;">
                      <div style="display: flex; align-items: center; gap: 0.4rem; min-width: 0;">
                        ${getCategoryIcon(g.category)}
                        <div style="min-width: 0;">
                          <div style="font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(g.name)}</div>
                          <div style="font-size: 0.7rem; color: var(--text-muted); font-family: var(--font-mono);">${escapeHtml(g.barcode)}</div>
                          ${chkNote ? `<div style="font-size: 0.7rem; color: #f59e0b; font-style: italic; margin-top: 1px;">"${escapeHtml(chkNote)}"</div>` : ''}
                        </div>
                      </div>
                      <button class="btn btn-sm" style="padding: 0.15rem 0.4rem; font-size: 0.7rem; flex-shrink: 0;" onclick="window.GearTrack.returnSingleItem(${g.id})">
                        Return
                      </button>
                    </div>
                  `;
                }).join('')}
              </div>
            `}
          </div>

          <div class="gear-actions">
            <button class="btn btn-sm btn-primary" onclick="window.GearTrack.selectPhotographerForSession(${p.id})" style="flex: 1;">
              ${Icons.target} Start Checkout
            </button>
            <button class="btn btn-sm" onclick="window.GearTrack.openPhotographerBadgeModal(${p.id})" title="Print ID Badge">
              ${Icons.badge} Badge
            </button>
            <button class="btn btn-sm" onclick="window.GearTrack.editPhotographer(${p.id})" title="Edit Member">
              ${Icons.edit}
            </button>
            <button class="btn btn-sm btn-danger" onclick="window.GearTrack.deletePhotographer(${p.id})" title="Delete Member">
              ${Icons.trash}
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Render History Table
  function renderHistoryTable() {
    const tbody = document.getElementById('historyTableBody');
    if (state.history.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-muted);">No activity recorded yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = state.history.map(t => {
      let actionBadge = `<span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #34d399;">Return</span>`;
      if (t.action === 'checkout') {
        actionBadge = `<span class="badge" style="background: rgba(59, 130, 246, 0.2); color: #60a5fa;">Check Out</span>`;
      } else if (t.action === 'transfer_out') {
        actionBadge = `<span class="badge" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24;">Transfer</span>`;
      }

      return `
        <tr style="border-bottom: 1px solid var(--border-color);">
          <td style="padding: 0.75rem 1rem; color: var(--text-muted); font-size: 0.78rem;">${formatDate(t.timestamp)}</td>
          <td style="padding: 0.75rem 1rem;">${actionBadge}</td>
          <td style="padding: 0.75rem 1rem; font-weight: 600;">${escapeHtml(t.gear_name)}</td>
          <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-size: 0.8rem; color: #93c5fd;">${escapeHtml(t.gear_barcode)}</td>
          <td style="padding: 0.75rem 1rem;"><span style="display: inline-flex; align-items: center; gap: 0.35rem;">${Icons.user} <span>${escapeHtml(t.photographer_name)}</span></span></td>
          <td style="padding: 0.75rem 1rem; color: var(--text-muted); font-size: 0.78rem;">${escapeHtml(t.notes || '—')}</td>
        </tr>
      `;
    }).join('');
  }

  // Render Printable Label Sheet
  function renderLabelSheet() {
    const container = document.getElementById('printableLabelsContainer');
    if (state.gear.length === 0) {
      container.innerHTML = '<div style="color: var(--text-muted); padding: 2rem;">No items available to generate labels.</div>';
      return;
    }

    container.innerHTML = state.gear.map(g => `
      <div class="label-preview-card" style="page-break-inside: avoid;">
        <div class="label-title">${escapeHtml(g.name)}</div>
        <div class="label-meta">${getCategoryIcon(g.category)} ${escapeHtml(g.category)} ${g.serial_number ? `| SN: ${escapeHtml(g.serial_number)}` : ''}</div>
        <svg id="barcode-svg-${g.id}" style="margin: 0.35rem 0; width: 100%; max-height: 60px;"></svg>
        <div style="font-family: monospace; font-size: 0.75rem; font-weight: 700;">${escapeHtml(g.barcode)}</div>
      </div>
    `).join('');

    // Generate barcodes for all items in printable sheet
    setTimeout(() => {
      for (const g of state.gear) {
        try {
          if (window.JsBarcode) {
            JsBarcode(`#barcode-svg-${g.id}`, g.barcode, {
              format: 'CODE128',
              width: 1.5,
              height: 40,
              displayValue: false,
              margin: 0
            });
          }
        } catch (e) {
          console.warn('JsBarcode render error for', g.barcode, e);
        }
      }
    }, 100);
  }

  // Initialize ZXing-WASM configuration for client
  if (window.ZXingWASM) {
    try {
      window.ZXingWASM.setZXingModuleOverrides({
        locateFile: (file, prefix) => 'libs/zxing-wasm/' + file
      });
    } catch (e) {
      console.warn('ZXingWASM config notice:', e);
    }
  }

  // --- NATIVE CAMERA & WASM 360° ENGINE ---
  let cameraMediaStream = null;
  let wasmVideoScanInterval = null;
  const wasmOffscreenCanvas = document.createElement('canvas');
  const wasmOffscreenCtx = wasmOffscreenCanvas.getContext('2d', { willReadFrequently: true });
  let isScanningFrame = false;

  function startWasmVideoScanner() {
    stopWasmVideoScanner();
    wasmVideoScanInterval = setInterval(async () => {
      if (!state.cameraRunning || !window.ZXingWASM || isScanningFrame) return;
      const video = document.querySelector('#reader video');
      if (!video || video.readyState < 2 || video.paused) return;

      isScanningFrame = true;
      try {
        const vw = video.videoWidth || 1280;
        const vh = video.videoHeight || 720;
        
        // Downscale to optimal processing resolution for high speed & accuracy
        const targetW = Math.min(vw, 1280);
        const targetH = Math.round(targetW * (vh / vw)) || 720;

        if (wasmOffscreenCanvas.width !== targetW || wasmOffscreenCanvas.height !== targetH) {
          wasmOffscreenCanvas.width = targetW;
          wasmOffscreenCanvas.height = targetH;
        }

        wasmOffscreenCtx.drawImage(video, 0, 0, targetW, targetH);
        const imgData = wasmOffscreenCtx.getImageData(0, 0, targetW, targetH);

        const results = await window.ZXingWASM.readBarcodesFromImageData(imgData, {
          tryHarder: true,
          tryRotate: true,     // Full 360-degree rotation (0°, 90°, 180°, 270°, angled)
          tryInvert: true,     // Light-on-dark inverted codes
          tryDownscale: true
        });

        if (results && results.length > 0) {
          const match = results[0];
          if (match.text) {
            handleRawScanCandidate(match.text, match.format || 'ZXingWASM');
          }
        }
      } catch (err) {
        // Silent frame catch
      } finally {
        isScanningFrame = false;
      }
    }, 90);
  }

  function stopWasmVideoScanner() {
    if (wasmVideoScanInterval) {
      clearInterval(wasmVideoScanInterval);
      wasmVideoScanInterval = null;
    }
    isScanningFrame = false;
  }

  function stopCameraStream() {
    stopWasmVideoScanner();
    if (cameraMediaStream) {
      cameraMediaStream.getTracks().forEach(t => t.stop());
      cameraMediaStream = null;
    }
    state.cameraRunning = false;
  }

  // --- CAMERA SCANNER ENGINE ---
  async function initCameraScanner() {
    startCamera();
  }

  async function populateCameraDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      const select = document.getElementById('cameraSelect');
      if (!select) return;

      select.innerHTML = '';
      if (videoDevices.length > 0) {
        videoDevices.forEach((device, index) => {
          const opt = document.createElement('option');
          opt.value = device.deviceId;
          opt.textContent = device.label || `Camera ${index + 1}`;
          if (state.selectedCameraId === device.deviceId) {
            opt.selected = true;
          }
          select.appendChild(opt);
        });
      } else {
        select.innerHTML = '<option value="">Default Camera</option>';
      }
    } catch (e) {
      console.warn('Enumerate devices warning:', e);
    }
  }

  async function startCamera(cameraId = null) {
    const readerElement = document.getElementById('reader');
    if (!readerElement) return;

    try {
      stopCameraStream();

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        document.getElementById('cameraStatusBadge').textContent = 'Camera API Unsupported (Needs HTTPS/Localhost)';
        readerElement.innerHTML = `
          <div style="text-align:center; padding: 2rem 1rem; color: var(--text-muted); display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%;">
            <div style="margin-bottom:0.5rem; color: var(--accent-blue);">${Icons.camera}</div>
            <div style="font-weight:600; color: var(--text-main); font-size: 0.95rem;">Camera API requires Secure Context</div>
            <div style="font-size: 0.8rem; margin-top: 0.25rem;">Open via <strong>http://localhost:3000</strong> on laptop or use Companion Camera on phone.</div>
          </div>
        `;
        return;
      }

      document.getElementById('cameraStatusBadge').textContent = 'Connecting Camera...';

      let constraints = {
        video: cameraId ? { deviceId: { exact: cameraId } } : { facingMode: { ideal: 'environment' } },
        audio: false
      };

      try {
        cameraMediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (firstErr) {
        console.warn('Exact camera constraint failed, falling back to default video:', firstErr);
        cameraMediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }

      readerElement.innerHTML = '';
      const video = document.createElement('video');
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      video.srcObject = cameraMediaStream;
      video.style.width = '100%';
      video.style.height = '100%';
      video.style.objectFit = 'cover';
      readerElement.appendChild(video);

      await video.play().catch(() => {});

      state.cameraRunning = true;
      state.selectedCameraId = cameraMediaStream.getVideoTracks()[0]?.getSettings()?.deviceId || cameraId;

      startWasmVideoScanner();
      document.getElementById('cameraStatusBadge').textContent = 'Camera Live (360° Precision Engine)';
      document.getElementById('cameraToggleIcon').innerHTML = Icons.pause;

      // Update camera selector list with labels
      populateCameraDevices();
    } catch (err) {
      console.error('Failed to start camera:', err);
      document.getElementById('cameraStatusBadge').textContent = 'Camera Blocked / In Use';
      readerElement.innerHTML = `
        <div style="text-align:center; padding: 2rem 1rem; color: var(--text-muted); display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%;">
          <div style="margin-bottom:0.5rem; color: var(--text-sub);">${Icons.camera}</div>
          <div style="font-weight:600; color: var(--text-main); font-size: 0.95rem;">Camera Access Blocked or In Use</div>
          <div style="font-size: 0.8rem; margin-top: 0.25rem; max-width: 260px;">Ensure browser camera permission is allowed.</div>
          <button class="btn btn-sm btn-primary" onclick="window.GearTrack.startCamera()" style="margin-top: 0.75rem;">
            Retry Camera
          </button>
        </div>
      `;
    }
  }

  // Digital Zoom State
  let currentZoomLevel = 1.0;

  function toggleDigitalZoom() {
    const video = document.querySelector('#reader video');
    const btn = document.getElementById('btnZoomToggle');
    if (!video) return;

    if (currentZoomLevel === 1.0) {
      currentZoomLevel = 2.0;
      video.style.transform = 'scale(2.0)';
      video.style.transformOrigin = 'center center';
      if (btn) btn.innerHTML = `${Icons.zoom} <span>3x Zoom</span>`;
      showToast('Digital Zoom: 2x (Macro Mode)', 'info');
    } else if (currentZoomLevel === 2.0) {
      currentZoomLevel = 3.0;
      video.style.transform = 'scale(3.0)';
      video.style.transformOrigin = 'center center';
      if (btn) btn.innerHTML = `${Icons.zoom} <span>1x Normal</span>`;
      showToast('Digital Zoom: 3x (High Precision)', 'info');
    } else {
      currentZoomLevel = 1.0;
      video.style.transform = 'scale(1.0)';
      if (btn) btn.innerHTML = `${Icons.zoom} <span>2x Zoom</span>`;
      showToast('Digital Zoom: 1x (Wide)', 'info');
    }
  }

  // Snap & Scan High-Res Frame (Decodes Micro QR, Data Matrix, Inverted Codes)
  async function snapAndScanCurrentFrame() {
    const video = document.querySelector('#reader video');
    if (!video || video.readyState < 2) {
      showToast('Camera is not active or still warming up', 'error');
      return;
    }

    try {
      showToast('Capturing and analyzing high-resolution frame...', 'info');
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const base64 = canvas.toDataURL('image/jpeg', 0.92);
      await processImageBase64(base64);
    } catch (err) {
      console.error('Snap error:', err);
      showToast('Snap error: ' + err.message, 'error');
    }
  }

  // Process image from file upload / camera roll
  async function scanUploadedImageFile(file) {
    if (!file) return;
    try {
      showToast('Analyzing uploaded photo for codes (Micro QR, DataMatrix, Barcodes)...', 'info');
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64 = e.target.result;
        await processImageBase64(base64);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      showToast('File read error: ' + err.message, 'error');
    }
  }

  async function processImageBase64(base64) {
    try {
      const res = await api('/api/scan/image', {
        method: 'POST',
        body: JSON.stringify({ imageBase64: base64 })
      });

      if (res.found && res.code) {
        showToast(`Decoded ${res.format}: "${res.code}"`, 'success');
        await commitSuccessfulScan(res.code, res.format);
      } else {
        soundError();
        showToast('No barcode or Micro QR code found in photo. Try zooming in closer or using more light.', 'error');
      }
    } catch (err) {
      showToast('Scan analysis error: ' + err.message, 'error');
    }
  }

  // Target input field when scanning specifically for a form
  let scanTargetInputId = null;

  // --- MULTI-FRAME CONSENSUS & ACCURACY FILTER ---
  function is2DFormat(format) {
    const f = (format || '').toUpperCase();
    return f.includes('QR') || f.includes('MATRIX') || f.includes('AZTEC') || f.includes('PDF');
  }

  const consensusFilter = {
    code: null,
    format: null,
    count: 0,
    lastTime: 0
  };

  function onCodeScanned(decodedText, decodedResult) {
    const format = decodedResult && decodedResult.result && decodedResult.result.format 
      ? decodedResult.result.format.formatName 
      : 'Auto';
    handleRawScanCandidate(decodedText, format);
  }

  // Routes raw camera readings through multi-frame verification
  async function handleRawScanCandidate(decodedText, formatName) {
    const cleanCode = (decodedText || '').trim();
    if (!cleanCode) return;

    const now = Date.now();

    // Prevent re-triggering code recently committed in cooldown window
    if (cleanCode === state.lastScannedCode && (now - state.lastScanTimestamp) < state.scanCooldownMs) {
      return;
    }

    // 2D Matrix codes (QR Code, Data Matrix, Aztec) have Reed-Solomon polynomial math with ~0% false positives
    if (is2DFormat(formatName)) {
      await commitSuccessfulScan(cleanCode, formatName);
      return;
    }

    // 1D Linear Barcodes (EAN-13, UPC, Code 128, etc.):
    // Require 2 consecutive frames agreeing on identical digits within 650ms
    if (consensusFilter.code === cleanCode && (now - consensusFilter.lastTime) < 650) {
      consensusFilter.count++;
      consensusFilter.lastTime = now;
      if (consensusFilter.count >= 2) {
        // Multi-frame consensus confirmed!
        consensusFilter.code = null;
        consensusFilter.count = 0;
        await commitSuccessfulScan(cleanCode, formatName);
      }
    } else {
      // First frame candidate observation
      consensusFilter.code = cleanCode;
      consensusFilter.format = formatName;
      consensusFilter.count = 1;
      consensusFilter.lastTime = now;
    }
  }

  // CORE SCAN PROCESSOR (Triggered only after verified consensus)
  async function commitSuccessfulScan(cleanCode, formatName) {
    const now = Date.now();
    state.lastScannedCode = cleanCode;
    state.lastScanTimestamp = now;

    console.log(`[Verified Scan] Accepted: "${cleanCode}" (${formatName})`);
    soundScanBeep();

    // If scanning for a specific input field
    if (scanTargetInputId) {
      const input = document.getElementById(scanTargetInputId);
      if (input) {
        input.value = cleanCode;
        showToast(`Captured code: ${cleanCode}`, 'success');
        if (scanTargetInputId === 'gearFormBarcode') openModal('modalGearForm');
        if (scanTargetInputId === 'photoFormBarcode') openModal('modalPhotographerForm');
      }
      scanTargetInputId = null;
      return;
    }

    await processScannedCode(cleanCode);
  }

  async function processScannedCode(code) {
    try {
      const lookup = await api('/api/scan/lookup', {
        method: 'POST',
        body: JSON.stringify({ code })
      });

      if (state.scannerMode === 'register') {
        // Explicit Register Mode
        if (lookup.type === 'photographer') {
          showToast(`This barcode belongs to Photographer: ${lookup.data.name}`, 'info');
          openPhotographerFormModal(lookup.data);
          return;
        } else if (lookup.type === 'gear') {
          showToast(`This barcode belongs to Gear: ${lookup.data.name}`, 'info');
          openGearFormModal(lookup.data);
          return;
        } else {
          // New Unregistered Code -> Open Quick Register
          openQuickRegisterModal(code);
          return;
        }
      }

      if (lookup.type === 'photographer') {
        // SCANNED PHOTOGRAPHER
        handlePhotographerScanned(lookup.data);
      } else if (lookup.type === 'gear') {
        // SCANNED GEAR ITEM
        handleGearScanned(lookup.data);
      } else {
        // UNKNOWN CODE -> PROMPT QUICK ONBOARDING
        soundError();
        showToast(`Unregistered Code "${code}" detected. Register it below:`, 'info');
        openQuickRegisterModal(code);
      }
    } catch (err) {
      showToast('Scan lookup error: ' + err.message, 'error');
    }
  }

  function handlePhotographerScanned(photographer) {
    state.selectedPhotographer = photographer;
    renderSelectedPhotographer();
    showToast(`Photographer identified: ${photographer.name}`, 'success');

    // If photographer already has items, show info
    if (photographer.assignedGear && photographer.assignedGear.length > 0) {
      showToast(`${photographer.name} currently holds ${photographer.assignedGear.length} items`, 'info');
    }
  }

  function handleGearScanned(gear) {
    if (state.scannerMode === 'return') {
      // Return Mode: immediately check in
      returnGearItem(gear);
      return;
    }

    if (state.scannerMode === 'smart') {
      // Smart Mode logic:
      if (gear.status === 'checked_out' && (!state.selectedPhotographer || state.selectedPhotographer.id == gear.current_photographer_id)) {
        // If it's already checked out to current person or no person selected, offer / perform Return!
        returnGearItem(gear);
        return;
      }
    }

    // Otherwise, add to current checkout basket
    addGearToBasket(gear);
  }

  function addGearToBasket(gear) {
    // Check if already in basket
    const exists = state.basketItems.some(item => item.id === gear.id);
    if (exists) {
      showToast(`"${gear.name}" is already in checkout basket`, 'info');
      return;
    }

    if (gear.status === 'checked_out') {
      showToast(`Warning: "${gear.name}" is currently with ${gear.current_photographer_name}. It will be transferred upon checkout.`, 'info');
    }

    state.basketItems.push(gear);
    renderBasket();
    showToast(`Added "${gear.name}" to checkout basket`, 'success');
  }

  async function returnGearItem(gear) {
    try {
      await api('/api/return', {
        method: 'POST',
        body: JSON.stringify({ gearId: gear.id, notes: 'Returned via scanner' })
      });
      soundReturnSuccess();
      showToast(`Returned: "${gear.name}" (Checked In Successfully)`, 'success');
      loadAllData();
    } catch (err) {
      soundError();
      showToast('Failed to return gear: ' + err.message, 'error');
    }
  }

  // --- RENDER ACTIVE SESSION & BASKET ---
  function renderSelectedPhotographer() {
    const container = document.getElementById('selectedPhotographerContainer');
    const subtitle = document.getElementById('sessionSubtitle');
    const clearBtn = document.getElementById('btnClearSession');

    if (!state.selectedPhotographer) {
      container.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 0.85rem 0.75rem; border: 1px dashed var(--border-color); border-radius: var(--radius-md); color: var(--text-muted);">
          <div style="margin-bottom: 0.25rem; color: var(--text-sub);">
            <svg class="icon icon-lg" viewBox="0 0 24 24">
              <rect x="2" y="5" width="20" height="14" rx="2" />
              <line x1="2" y1="10" x2="22" y2="10" />
            </svg>
          </div>
          <div style="font-weight: 600; font-size: 0.85rem; color: var(--text-main); margin-bottom: 0.15rem;">No Crew Member Selected</div>
          <div style="font-size: 0.75rem; margin-bottom: 0.5rem;">Scan badge barcode or select from directory:</div>
          <select id="quickSelectPhotographer" class="select-input" style="max-width: 260px; width: 100%; margin: 0 auto;">
            <option value="">-- Choose Photographer --</option>
          </select>
        </div>
      `;
      updatePhotographerDropdowns();
      subtitle.textContent = 'Scan a crew member ID badge or select below';
      clearBtn.style.display = 'none';
      updateCheckoutButtonState();
      return;
    }

    const p = state.selectedPhotographer;
    const initials = p.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

    const heldGear = state.gear.filter(g => g.current_photographer_id == p.id);
    const activeCheckoutNotes = [];
    const gearCheckoutMap = {};
    for (const g of heldGear) {
      const log = state.history.find(h => h.action === 'checkout' && h.gear_id === g.id && h.photographer_id == p.id && h.notes);
      if (log && log.notes) {
        gearCheckoutMap[g.id] = log.notes;
        if (!activeCheckoutNotes.includes(log.notes)) {
          activeCheckoutNotes.push(log.notes);
        }
      }
    }

    container.innerHTML = `
      <div class="photographer-card-selected" style="flex-direction: column; align-items: stretch; gap: 0.65rem; padding: 0.85rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;">
          <div style="display: flex; align-items: center; gap: 0.65rem; min-width: 0;">
            <div class="photo-avatar" style="flex-shrink: 0; width: 38px; height: 38px; font-size: 0.9rem;">${initials}</div>
            <div style="min-width: 0;">
              <div style="font-weight: 700; color: var(--text-main); font-size: 0.98rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(p.name)}</div>
              <div style="font-size: 0.75rem; color: var(--accent-blue); font-family: var(--font-mono); font-weight: 600;">${Icons.badge} ID: ${escapeHtml(p.barcode)}</div>
              <div style="font-size: 0.72rem; color: var(--text-muted);">${escapeHtml(p.role || 'Photographer')} ${p.phone ? `• ${Icons.phone} ${escapeHtml(p.phone)}` : ''}</div>
            </div>
          </div>
          <button class="btn btn-sm btn-danger" onclick="window.GearTrack.clearSelectedPhotographer()" title="Switch crew member" style="flex-shrink: 0; padding: 0.3rem 0.6rem; font-size: 0.75rem;">Change</button>
        </div>

        ${activeCheckoutNotes.length > 0 ? `
          <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: var(--radius-sm); padding: 0.45rem 0.65rem; font-size: 0.78rem; display: flex; flex-direction: column; gap: 0.2rem;">
            <div style="color: #f59e0b; font-weight: 700; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; display: flex; align-items: center; gap: 0.3rem;">
              <span style="display: inline-flex;">${Icons.tag}</span>
              <span>Active Checkout Notes:</span>
            </div>
            ${activeCheckoutNotes.map(n => `<div style="color: var(--text-main); font-weight: 500; font-style: italic; word-break: break-word;">"${escapeHtml(n)}"</div>`).join('')}
          </div>
        ` : ''}

        ${p.notes ? `
          <div style="background: rgba(0, 0, 0, 0.2); border: 1px dashed var(--border-color); border-radius: var(--radius-sm); padding: 0.4rem 0.6rem; font-size: 0.75rem; color: var(--text-muted); display: flex; align-items: flex-start; gap: 0.35rem;">
            <span style="color: var(--accent-blue); font-weight: 600; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.03em; flex-shrink: 0;">Profile Note:</span>
            <span style="color: var(--text-main); font-style: italic; word-break: break-word;">${escapeHtml(p.notes)}</span>
          </div>
        ` : ''}

        <!-- Currently Borrowed Gear Section -->
        <div style="background: rgba(0,0,0,0.25); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 0.6rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: ${heldGear.length > 0 ? '0.45rem' : '0'};">
            <div style="font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted); display: flex; align-items: center; gap: 0.35rem;">
              <span>Currently Borrowed (${heldGear.length})</span>
            </div>
            ${heldGear.length > 0 ? `
              <button class="btn btn-sm btn-amber" style="font-size: 0.68rem; padding: 0.18rem 0.45rem;" onclick="window.GearTrack.returnAllPhotographerGear(${p.id})">
                Return All
              </button>
            ` : ''}
          </div>

          ${heldGear.length === 0 ? `
            <div style="font-size: 0.75rem; color: var(--text-sub); font-style: italic;">No equipment currently borrowed.</div>
          ` : `
            <div style="display: flex; flex-direction: column; gap: 0.35rem; max-height: 150px; overflow-y: auto;">
              ${heldGear.map(g => {
                const chkNote = gearCheckoutMap[g.id] || g.notes;
                return `
                  <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); padding: 0.35rem 0.5rem; border-radius: 4px;">
                    <div style="display: flex; align-items: center; gap: 0.4rem; min-width: 0;">
                      <span style="flex-shrink: 0;">${getCategoryIcon(g.category)}</span>
                      <div style="min-width: 0;">
                        <div style="font-weight: 600; color: var(--text-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(g.name)}</div>
                        <div style="font-size: 0.68rem; color: var(--text-muted); font-family: var(--font-mono);">${escapeHtml(g.barcode)}</div>
                        ${chkNote ? `<div style="font-size: 0.68rem; color: #f59e0b; font-style: italic; margin-top: 1px;">"${escapeHtml(chkNote)}"</div>` : ''}
                      </div>
                    </div>
                    <button class="btn btn-sm" style="padding: 0.15rem 0.45rem; font-size: 0.68rem; flex-shrink: 0; margin-left: 0.4rem;" onclick="window.GearTrack.returnSingleItem(${g.id})">
                      Return
                    </button>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>
      </div>
    `;

    subtitle.textContent = `Active Checkout for ${p.name}. Now scan gear to check out!`;
    clearBtn.style.display = 'inline-flex';
    updateCheckoutButtonState();
  }

  function renderBasket() {
    const list = document.getElementById('basketList');
    const countBadge = document.getElementById('basketCount');
    const clearBtn = document.getElementById('btnClearBasket');

    countBadge.textContent = state.basketItems.length;

    if (state.basketItems.length === 0) {
      list.innerHTML = `
        <div style="text-align: center; padding: 2rem 1rem; color: var(--text-sub); font-size: 0.85rem;">
          Scan gear barcodes / QR codes to add to this checkout session.
        </div>
      `;
      clearBtn.style.display = 'none';
      updateCheckoutButtonState();
      return;
    }

    clearBtn.style.display = 'inline-flex';

    list.innerHTML = state.basketItems.map((item, index) => `
      <div class="scanned-item-card">
        <div class="scanned-item-details">
          <div class="item-name">${getCategoryIcon(item.category)} <span>${escapeHtml(item.name)}</span></div>
          <div class="item-code">${Icons.tag} <span>${escapeHtml(item.barcode)}</span> ${item.serial_number ? `| SN: ${escapeHtml(item.serial_number)}` : ''}</div>
        </div>
        <button class="btn btn-sm btn-danger" onclick="window.GearTrack.removeFromBasket(${index})" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;" title="Remove">
          ${Icons.cross}
        </button>
      </div>
    `).join('');

    updateCheckoutButtonState();
  }

  function updateCheckoutButtonState() {
    const btn = document.getElementById('btnConfirmCheckout');
    const countSpan = document.getElementById('btnCheckoutCount');
    const count = state.basketItems.length;
    countSpan.textContent = count;

    if (state.selectedPhotographer && count > 0) {
      btn.disabled = false;
      btn.classList.add('btn-success');
    } else {
      btn.disabled = true;
    }
  }

  // --- COMPLETE CHECKOUT ACTION ---
  async function completeCheckout() {
    if (!state.selectedPhotographer || state.basketItems.length === 0) return;

    const notes = document.getElementById('checkoutNotesInput').value.trim();
    const gearIds = state.basketItems.map(item => item.id);

    try {
      await api('/api/checkout', {
        method: 'POST',
        body: JSON.stringify({
          photographerId: state.selectedPhotographer.id,
          gearIds,
          notes
        })
      });

      soundCheckoutSuccess();
      showToast(`Successfully checked out ${gearIds.length} items to ${state.selectedPhotographer.name}!`, 'success');

      // Clear basket and reset notes
      state.basketItems = [];
      document.getElementById('checkoutNotesInput').value = '';
      renderBasket();
      loadAllData();
    } catch (err) {
      soundError();
      showToast('Checkout failed: ' + err.message, 'error');
    }
  }

  // --- MODALS HANDLING ---
  function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('open');
  }

  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('open');
  }

  // 1. Connect Phone Modal Setup
  async function openConnectPhoneModal(selectedIp = '') {
    if (typeof selectedIp !== 'string') selectedIp = '';
    try {
      const url = selectedIp ? `/api/network-info?ip=${encodeURIComponent(selectedIp)}` : '/api/network-info';
      const info = await api(url);
      state.networkInfo = info;

      document.getElementById('pairingQrImg').src = info.qrDataUrl;
      const link = document.getElementById('mobileHttpsLink');
      link.href = info.httpsUrl;
      link.textContent = info.httpsUrl;

      const adapterWrap = document.getElementById('adapterSelectWrapper');
      const adapterSelect = document.getElementById('networkAdapterSelect');

      if (info.interfaces && info.interfaces.length > 1 && adapterWrap && adapterSelect) {
        adapterWrap.style.display = 'block';
        adapterSelect.innerHTML = info.interfaces.map(iface => {
          const type = iface.isWiFi ? '📶 Wi-Fi' : (iface.isEthernet ? '🔌 Ethernet' : (iface.isVirtual ? '⚙️ Virtual' : '🌐 LAN'));
          const selected = iface.address === info.primaryIp ? 'selected' : '';
          return `<option value="${iface.address}" ${selected}>${type}: ${iface.address} (${iface.name})</option>`;
        }).join('');

        adapterSelect.onchange = (e) => {
          openConnectPhoneModal(e.target.value);
        };
      } else if (adapterWrap) {
        adapterWrap.style.display = 'none';
      }

      openModal('modalConnectPhone');
    } catch (err) {
      showToast('Could not load network pairing info: ' + err.message, 'error');
    }
  }

  // 2. Quick Register Modal Setup
  function openQuickRegisterModal(code = '') {
    document.getElementById('quickRegCodeDisplay').textContent = code;
    document.getElementById('quickRegGearName').value = '';
    document.getElementById('quickRegGearSerial').value = '';
    document.getElementById('quickRegPhotoName').value = '';
    document.getElementById('quickRegPhotoPhone').value = '';
    document.getElementById('quickRegNotes').value = '';

    // Default to gear registration
    setQuickRegType('gear');
    openModal('modalQuickRegister');
  }

  function setQuickRegType(type) {
    const gearBtn = document.getElementById('btnTypeIsGear');
    const photoBtn = document.getElementById('btnTypeIsPhoto');
    const gearSec = document.getElementById('quickRegGearSection');
    const photoSec = document.getElementById('quickRegPhotoSection');

    if (type === 'gear') {
      gearBtn.className = 'btn btn-primary';
      photoBtn.className = 'btn';
      gearSec.style.display = 'flex';
      photoSec.style.display = 'none';
      document.getElementById('quickRegGearName').required = true;
      document.getElementById('quickRegPhotoName').required = false;
    } else {
      photoBtn.className = 'btn btn-primary';
      gearBtn.className = 'btn';
      photoSec.style.display = 'flex';
      gearSec.style.display = 'none';
      document.getElementById('quickRegGearName').required = false;
      document.getElementById('quickRegPhotoName').required = true;
    }
  }

  function setScannerMode(mode) {
    state.scannerMode = mode;
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
  }

  // --- EVENT LISTENERS & SETUP ---
  function initEventListeners() {
    // Nav Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        switchTab(tab);
      });
    });

    // Scanner Mode Buttons
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.scannerMode = btn.dataset.mode;
        showToast(`Scanner mode set to: ${btn.textContent}`, 'info');
      });
    });

    // Camera switcher
    document.getElementById('cameraSelect').addEventListener('change', (e) => {
      state.selectedCameraId = e.target.value;
      startCamera(state.selectedCameraId);
    });

    // Toggle Camera Pause/Resume
    document.getElementById('btnToggleCamera').addEventListener('click', async () => {
      if (state.cameraRunning) {
        stopCameraStream();
        document.getElementById('cameraStatusBadge').textContent = 'Camera Paused';
        document.getElementById('cameraToggleIcon').innerHTML = Icons.play;
      } else {
        startCamera(state.selectedCameraId);
      }
    });

    // 2x / 3x Digital Macro Zoom
    const zoomBtn = document.getElementById('btnZoomToggle');
    if (zoomBtn) zoomBtn.addEventListener('click', toggleDigitalZoom);

    // Snap & Deep Scan High-Res Frame
    const snapBtn = document.getElementById('btnSnapHighRes');
    if (snapBtn) snapBtn.addEventListener('click', snapAndScanCurrentFrame);

    // Upload & Scan Photo File (From Gallery or Camera Roll)
    const fileInput = document.getElementById('filePhotoScanInput');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          scanUploadedImageFile(e.target.files[0]);
          e.target.value = '';
        }
      });
    }

    // Manual Scan Form
    document.getElementById('manualScanForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('manualCodeInput');
      const val = input.value.trim();
      if (val) {
        processScannedCode(val);
        input.value = '';
      }
    });

    // Quick select photographer dropdown
    document.getElementById('quickSelectPhotographer').addEventListener('change', (e) => {
      const id = e.target.value;
      if (id) {
        const p = state.photographers.find(x => x.id == id);
        if (p) handlePhotographerScanned(p);
      }
    });

    // Quick select gear dropdown directly in checkout panel
    const quickGearSel = document.getElementById('quickSelectGear');
    if (quickGearSel) {
      quickGearSel.addEventListener('change', (e) => {
        const gearId = parseInt(e.target.value, 10);
        if (gearId) {
          const gear = state.gear.find(g => g.id === gearId);
          if (gear) {
            addGearToBasket(gear);
          }
          e.target.value = '';
        }
      });
    }

    // Manual Checkout Modal Triggers
    const btnManualHeader = document.getElementById('btnManualCheckoutTrigger');
    if (btnManualHeader) {
      btnManualHeader.addEventListener('click', () => openManualCheckoutModal(state.selectedPhotographer ? state.selectedPhotographer.id : null));
    }

    const btnManualGear = document.getElementById('btnManualCheckoutFromGear');
    if (btnManualGear) {
      btnManualGear.addEventListener('click', () => openManualCheckoutModal(state.selectedPhotographer ? state.selectedPhotographer.id : null));
    }

    // Modal Search Gear Input
    const modalGearSearch = document.getElementById('manualModalGearSearch');
    if (modalGearSearch) {
      modalGearSearch.addEventListener('input', () => {
        renderManualCheckoutGearList();
      });
    }

    // Modal Photographer Select Change
    const modalPhotoSel = document.getElementById('manualModalPhotographerSelect');
    if (modalPhotoSel) {
      modalPhotoSel.addEventListener('change', updateManualModalSubmitState);
    }

    // Manual Checkout Form Submit
    const manualForm = document.getElementById('manualCheckoutForm');
    if (manualForm) {
      manualForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const photoId = parseInt(document.getElementById('manualModalPhotographerSelect').value, 10);
        const notes = document.getElementById('manualModalNotes').value.trim();
        const checkedBoxes = document.querySelectorAll('#manualModalGearList input[type="checkbox"]:checked');
        const gearIds = Array.from(checkedBoxes).map(cb => parseInt(cb.value, 10));

        if (!photoId || gearIds.length === 0) {
          showToast('Please select a crew member and at least one equipment item', 'error');
          return;
        }

        try {
          const photo = state.photographers.find(p => p.id === photoId);
          await api('/api/checkout', {
            method: 'POST',
            body: JSON.stringify({
              photographerId: photoId,
              gearIds,
              notes
            })
          });

          soundCheckoutSuccess();
          showToast(`Checked out ${gearIds.length} items to ${photo ? photo.name : 'crew member'}!`, 'success');
          closeModal('modalManualCheckout');
          loadAllData();
        } catch (err) {
          soundError();
          showToast('Manual checkout failed: ' + err.message, 'error');
        }
      });
    }

    // Clear Session & Basket
    document.getElementById('btnClearSession').addEventListener('click', () => {
      state.selectedPhotographer = null;
      renderSelectedPhotographer();
    });

    document.getElementById('btnClearBasket').addEventListener('click', () => {
      state.basketItems = [];
      renderBasket();
    });

    document.getElementById('btnConfirmCheckout').addEventListener('click', completeCheckout);

    // Filter Listeners
    document.getElementById('gearSearchInput').addEventListener('input', renderGearInventory);
    document.getElementById('gearCategoryFilter').addEventListener('change', renderGearInventory);
    document.getElementById('gearStatusFilter').addEventListener('change', renderGearInventory);
    document.getElementById('photoSearchInput').addEventListener('input', renderPhotographers);

    initOrUpdateFuzzySelect('gearCategoryFilter', {
      placeholder: 'All Categories',
      icon: Icons.tag,
      searchPlaceholder: 'Filter category...'
    });
    initOrUpdateFuzzySelect('gearStatusFilter', {
      placeholder: 'All Statuses',
      icon: Icons.target,
      searchPlaceholder: 'Filter status...'
    });

    // Modal Triggers
    document.getElementById('btnConnectPhone').addEventListener('click', () => openConnectPhoneModal(''));
    document.getElementById('btnQuickRegister').addEventListener('click', () => openQuickRegisterModal(''));
    document.getElementById('btnAddGearModalTrigger').addEventListener('click', () => openGearFormModal());
    document.getElementById('btnAddPhotographerModalTrigger').addEventListener('click', () => openPhotographerFormModal());
    document.getElementById('btnRefreshHistory').addEventListener('click', loadAllData);

    // Scan & Add Gear from Inventory Tab
    document.getElementById('btnScanAddGear').addEventListener('click', () => {
      switchTab('scan');
      setScannerMode('register');
      setQuickRegType('gear');
      showToast('Scan Gear barcode or QR code with camera to register it', 'info');
    });

    // Scan & Add Photographer from Directory Tab
    document.getElementById('btnScanAddPhotographer').addEventListener('click', () => {
      switchTab('scan');
      setScannerMode('register');
      setQuickRegType('photo');
      showToast('Scan Photographer ID card barcode to register new staff', 'info');
    });

    // Scan Barcode Button directly inside Gear Form Modal
    document.getElementById('btnScanCodeForGearForm').addEventListener('click', () => {
      closeModal('modalGearForm');
      scanTargetInputId = 'gearFormBarcode';
      switchTab('scan');
      showToast('Point camera at gear barcode/QR to fill form', 'info');
    });

    // Scan Barcode Button directly inside Photographer Form Modal
    document.getElementById('btnScanCodeForPhotoForm').addEventListener('click', () => {
      closeModal('modalPhotographerForm');
      scanTargetInputId = 'photoFormBarcode';
      switchTab('scan');
      showToast('Point camera at ID badge barcode to fill form', 'info');
    });

    document.getElementById('btnExportCSV').addEventListener('click', () => {
      window.location.href = '/api/export/csv';
    });

    const backupBtn = document.getElementById('btnDownloadBackup');
    if (backupBtn) {
      backupBtn.addEventListener('click', () => {
        showToast('Generating SQLite database snapshot...', 'info');
        window.location.href = '/api/backup/download';
      });
    }

    // Close Modals
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        closeModal(btn.dataset.close);
      });
    });

    // Quick Register Form Buttons
    document.getElementById('btnTypeIsGear').addEventListener('click', () => setQuickRegType('gear'));
    document.getElementById('btnTypeIsPhoto').addEventListener('click', () => setQuickRegType('photo'));

    // Category chips in quick register
    document.querySelectorAll('#quickCategoryPresets .preset-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#quickCategoryPresets .preset-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      });
    });

    // Quick Register Submit
    document.getElementById('quickRegisterForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = document.getElementById('quickRegCodeDisplay').textContent.trim();
      const isGear = document.getElementById('quickRegGearSection').style.display !== 'none';
      const notes = document.getElementById('quickRegNotes').value.trim();

      try {
        if (isGear) {
          const name = document.getElementById('quickRegGearName').value.trim();
          const activeChip = document.querySelector('#quickCategoryPresets .preset-chip.active');
          const category = activeChip ? activeChip.dataset.cat : 'Accessory';
          const serial_number = document.getElementById('quickRegGearSerial').value.trim();

          const newGear = await api('/api/gear', {
            method: 'POST',
            body: JSON.stringify({ barcode: code, name, category, serial_number, notes })
          });

          closeModal('modalQuickRegister');
          showToast(`Registered "${newGear.name}" successfully!`, 'success');
          loadAllData();

          // Auto-add to basket if checking out
          if (state.selectedPhotographer) {
            addGearToBasket(newGear);
          }
        } else {
          const name = document.getElementById('quickRegPhotoName').value.trim();
          const role = document.getElementById('quickRegPhotoRole').value.trim();
          const phone = document.getElementById('quickRegPhotoPhone').value.trim();

          const newPhoto = await api('/api/photographers', {
            method: 'POST',
            body: JSON.stringify({ barcode: code, name, role, phone, notes })
          });

          closeModal('modalQuickRegister');
          showToast(`Registered photographer "${newPhoto.name}"!`, 'success');
          loadAllData();
          handlePhotographerScanned(newPhoto);
        }
      } catch (err) {
        soundError();
        showToast('Registration failed: ' + err.message, 'error');
      }
    });

    // Gear Form Modal
    document.getElementById('gearForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('gearFormId').value;
      const barcode = document.getElementById('gearFormBarcode').value.trim();
      const name = document.getElementById('gearFormName').value.trim();
      const category = document.getElementById('gearFormCategory').value;
      const serial_number = document.getElementById('gearFormSerial').value.trim();
      const status = document.getElementById('gearFormStatus').value;
      const notes = document.getElementById('gearFormNotes').value.trim();

      try {
        if (id) {
          await api(`/api/gear/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ barcode, name, category, serial_number, status, notes })
          });
          showToast(`Updated "${name}"`, 'success');
        } else {
          await api('/api/gear', {
            method: 'POST',
            body: JSON.stringify({ barcode, name, category, serial_number, notes })
          });
          showToast(`Created "${name}"`, 'success');
        }
        closeModal('modalGearForm');
        loadAllData();
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
    });

    document.getElementById('btnGenRandomGearBarcode').addEventListener('click', () => {
      const cat = document.getElementById('gearFormCategory').value.toUpperCase().slice(0, 3);
      const rand = Math.floor(1000 + Math.random() * 9000);
      document.getElementById('gearFormBarcode').value = `${cat}-${rand}`;
    });

    // Photographer Form Modal
    document.getElementById('photographerForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('photoFormId').value;
      const barcode = document.getElementById('photoFormBarcode').value.trim();
      const name = document.getElementById('photoFormName').value.trim();
      const role = document.getElementById('photoFormRole').value.trim();
      const phone = document.getElementById('photoFormPhone').value.trim();
      const email = document.getElementById('photoFormEmail').value.trim();

      try {
        if (id) {
          await api(`/api/photographers/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ barcode, name, role, phone, email })
          });
          showToast(`Updated "${name}"`, 'success');
        } else {
          await api('/api/photographers', {
            method: 'POST',
            body: JSON.stringify({ barcode, name, role, phone, email })
          });
          showToast(`Added photographer "${name}"`, 'success');
        }
        closeModal('modalPhotographerForm');
        loadAllData();
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
    });

    document.getElementById('btnGenRandomPhotoBarcode').addEventListener('click', () => {
      const rand = Math.floor(100 + Math.random() * 900);
      document.getElementById('photoFormBarcode').value = `PHOTO-${rand}`;
    });

    document.getElementById('btnPrintSingleLabel').addEventListener('click', () => {
      window.print();
    });

    // Label format toggle buttons in single preview modal
    document.getElementById('btnLabelFmt1D').addEventListener('click', () => switchLabelFormat('1d'));
    document.getElementById('btnLabelFmtQR').addEventListener('click', () => switchLabelFormat('qr'));
    document.getElementById('btnLabelFmtDataMatrix').addEventListener('click', () => switchLabelFormat('dm'));
  }

  function switchTab(tabId) {
    state.activeTab = tabId;
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-content').forEach(sec => {
      sec.style.display = sec.id === `tab-${tabId}` ? 'block' : 'none';
    });

    // If switching to labels, re-render barcode SVGs
    if (tabId === 'labels') {
      renderLabelSheet();
    }
  }

  function openGearFormModal(gear = null) {
    document.getElementById('gearFormId').value = gear ? gear.id : '';
    document.getElementById('gearModalTitle').textContent = gear ? 'Edit Gear' : 'Add New Gear';
    document.getElementById('gearFormBarcode').value = gear ? gear.barcode : '';
    document.getElementById('gearFormName').value = gear ? gear.name : '';
    document.getElementById('gearFormCategory').value = gear ? gear.category : 'Camera';
    document.getElementById('gearFormSerial').value = gear ? gear.serial_number || '' : '';
    document.getElementById('gearFormStatus').value = gear ? gear.status : 'available';
    document.getElementById('gearFormNotes').value = gear ? gear.notes || '' : '';
    openModal('modalGearForm');
  }

  function openPhotographerFormModal(photo = null) {
    document.getElementById('photoFormId').value = photo ? photo.id : '';
    document.getElementById('photoModalTitle').textContent = photo ? 'Edit Photographer' : 'Add Photographer / Staff';
    document.getElementById('photoFormBarcode').value = photo ? photo.barcode : '';
    document.getElementById('photoFormName').value = photo ? photo.name : '';
    document.getElementById('photoFormRole').value = photo ? photo.role || 'Photographer' : 'Photographer';
    document.getElementById('photoFormPhone').value = photo ? photo.phone || '' : '';
    document.getElementById('photoFormEmail').value = photo ? photo.email || '' : '';
    openModal('modalPhotographerForm');
  }

  // --- MANUAL CHECKOUT MODAL LOGIC ---
  let manualCheckoutSelectedGearIds = new Set();

  function openManualCheckoutModal(defaultPhotoId = null, preselectedGearIds = []) {
    manualCheckoutSelectedGearIds = new Set(preselectedGearIds || []);
    
    // If items currently in basket, preselect them
    if (state.basketItems.length > 0 && manualCheckoutSelectedGearIds.size === 0) {
      state.basketItems.forEach(item => manualCheckoutSelectedGearIds.add(item.id));
    }

    updatePhotographerDropdowns();

    const photoSel = document.getElementById('manualModalPhotographerSelect');
    if (photoSel && defaultPhotoId) {
      photoSel.value = defaultPhotoId;
    } else if (photoSel && state.selectedPhotographer) {
      photoSel.value = state.selectedPhotographer.id;
    }

    if (state.fuzzySelects && state.fuzzySelects['manualModalPhotographerSelect']) {
      state.fuzzySelects['manualModalPhotographerSelect'].updateTriggerDisplay();
    }

    document.getElementById('manualModalNotes').value = '';
    document.getElementById('manualModalGearSearch').value = '';

    renderManualCheckoutGearList();
    updateManualModalSubmitState();
    openModal('modalManualCheckout');
  }

  function renderManualCheckoutGearList() {
    const container = document.getElementById('manualModalGearList');
    if (!container) return;

    const query = (document.getElementById('manualModalGearSearch').value || '').toLowerCase();

    let filtered = state.gear.filter(g => {
      if (query) {
        const text = `${g.name} ${g.category} ${g.barcode} ${g.serial_number || ''} ${g.current_photographer_name || ''}`.toLowerCase();
        if (!text.includes(query)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      container.innerHTML = `<div style="padding: 1.5rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">No equipment matches your search.</div>`;
      return;
    }

    container.innerHTML = filtered.map(g => {
      const isChecked = manualCheckoutSelectedGearIds.has(g.id);
      const isOut = g.status === 'checked_out';
      const isMaint = g.status === 'maintenance';

      let statusBadge = `<span class="badge badge-success" style="font-size: 0.7rem;">Available</span>`;
      if (isOut) {
        statusBadge = `<span class="badge badge-warning" style="font-size: 0.7rem;">Out with ${escapeHtml(g.current_photographer_name || 'Assigned')}</span>`;
      } else if (isMaint) {
        statusBadge = `<span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171; font-size: 0.7rem;">Maintenance</span>`;
      }

      return `
        <label style="display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; padding: 0.45rem 0.6rem; background: ${isChecked ? 'rgba(59, 130, 246, 0.12)' : 'rgba(255,255,255,0.02)'}; border: 1px solid ${isChecked ? 'rgba(59, 130, 246, 0.4)' : 'rgba(255,255,255,0.06)'}; border-radius: 6px; cursor: pointer; transition: all 0.15s ease;">
          <div style="display: flex; align-items: center; gap: 0.6rem; flex: 1; min-width: 0;">
            <input type="checkbox" value="${g.id}" ${isChecked ? 'checked' : ''} onchange="window.GearTrack.toggleManualGearSelection(${g.id}, this.checked)" style="width: 16px; height: 16px; accent-color: var(--accent-blue);">
            <div style="min-width: 0;">
              <div style="font-weight: 600; font-size: 0.85rem; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${escapeHtml(g.name)}
              </div>
              <div style="font-size: 0.72rem; color: var(--text-muted); font-family: var(--font-mono);">
                ${escapeHtml(g.category)} | Code: ${escapeHtml(g.barcode)} ${g.serial_number ? `| SN: ${escapeHtml(g.serial_number)}` : ''}
              </div>
            </div>
          </div>
          <div>${statusBadge}</div>
        </label>
      `;
    }).join('');
  }

  function updateManualModalSubmitState() {
    const photoSel = document.getElementById('manualModalPhotographerSelect');
    const btn = document.getElementById('btnSubmitManualModalCheckout');
    const countSpan = document.getElementById('manualModalSubmitCount');
    const headerCount = document.getElementById('manualModalSelectedCount');

    const count = manualCheckoutSelectedGearIds.size;
    if (countSpan) countSpan.textContent = count;
    if (headerCount) headerCount.textContent = `${count} item${count === 1 ? '' : 's'} selected`;

    const isValid = photoSel && photoSel.value && count > 0;
    if (btn) {
      btn.disabled = !isValid;
    }
  }

  // --- HELPER UTILITIES ---
  function getCategoryIcon(cat) {
    const icons = {
      'Camera': Icons.camera,
      'Lens': Icons.lens,
      'Walkie-Talkie': Icons.radio,
      'Lighting': Icons.lighting,
      'Audio': Icons.audio,
      'Accessory': Icons.accessory
    };
    return icons[cat] || Icons.package;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

  function formatDate(isoStr) {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatRelativeTime(isoStr) {
    if (!isoStr) return '';
    const diffMs = Date.now() - new Date(isoStr).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ${mins % 60}m ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  // --- EXPORT TO WINDOW SCOPE ---
  window.GearTrack = {
    startCamera() {
      startCamera();
    },
    stopCamera() {
      stopCameraStream();
    },
    openManualCheckout(photoId = null, gearId = null) {
      const gearIds = gearId ? [gearId] : [];
      openManualCheckoutModal(photoId, gearIds);
    },
    toggleManualGearSelection(gearId, isChecked) {
      if (isChecked) {
        manualCheckoutSelectedGearIds.add(gearId);
      } else {
        manualCheckoutSelectedGearIds.delete(gearId);
      }
      updateManualModalSubmitState();
      renderManualCheckoutGearList();
    },
    addToSessionBasket(gearId) {
      const gear = state.gear.find(g => g.id === gearId);
      if (gear) {
        addGearToBasket(gear);
        switchTab('scan');
      }
    },
    removeFromBasket(index) {
      state.basketItems.splice(index, 1);
      renderBasket();
    },
    clearSelectedPhotographer() {
      state.selectedPhotographer = null;
      renderSelectedPhotographer();
    },
    selectPhotographerForSession(photoId) {
      const p = state.photographers.find(x => x.id === photoId);
      if (p) {
        handlePhotographerScanned(p);
        switchTab('scan');
      }
    },
    async returnSingleItem(gearId) {
      const gear = state.gear.find(g => g.id === gearId);
      if (gear) await returnGearItem(gear);
    },
    async returnAllPhotographerGear(photoId) {
      try {
        const p = state.photographers.find(x => x.id === photoId);
        await api('/api/return', {
          method: 'POST',
          body: JSON.stringify({ photographerId: photoId, notes: 'Batch return from photographer profile' })
        });
        soundReturnSuccess();
        showToast(`All gear returned for ${p ? p.name : 'photographer'}`, 'success');
        loadAllData();
      } catch (err) {
        soundError();
        showToast('Return failed: ' + err.message, 'error');
      }
    },
    editGear(id) {
      const g = state.gear.find(x => x.id === id);
      if (g) openGearFormModal(g);
    },
    async deleteGear(id) {
      const g = state.gear.find(x => x.id === id);
      if (!g || !confirm(`Are you sure you want to delete "${g.name}" (${g.barcode})?`)) return;
      try {
        await api(`/api/gear/${id}`, { method: 'DELETE' });
        showToast(`Deleted "${g.name}"`, 'info');
        loadAllData();
      } catch (err) {
        showToast('Delete error: ' + err.message, 'error');
      }
    },
    editPhotographer(id) {
      const p = state.photographers.find(x => x.id === id);
      if (p) openPhotographerFormModal(p);
    },
    async deletePhotographer(id) {
      const p = state.photographers.find(x => x.id === id);
      if (!p || !confirm(`Are you sure you want to delete photographer "${p.name}"?`)) return;
      try {
        await api(`/api/photographers/${id}`, { method: 'DELETE' });
        showToast(`Deleted "${p.name}"`, 'info');
        loadAllData();
      } catch (err) {
        showToast('Cannot delete: ' + err.message, 'error');
      }
    },
    openSingleBarcodeModal(gearId) {
      const g = state.gear.find(x => x.id === gearId);
      if (!g) return;

      document.getElementById('singleBarcodeTitle').textContent = `Label: ${g.name}`;
      document.getElementById('singleLabelName').textContent = g.name;
      document.getElementById('singleLabelCategory').textContent = `${g.category} | Code: ${g.barcode}`;
      document.getElementById('singleLabelSerial').textContent = g.serial_number ? `SN: ${g.serial_number}` : '';

      renderModalCodeFormats(g.barcode);
      openModal('modalSingleBarcode');
    },
    openPhotographerBadgeModal(photoId) {
      const p = state.photographers.find(x => x.id === photoId);
      if (!p) return;

      document.getElementById('singleBarcodeTitle').textContent = `ID Badge: ${p.name}`;
      document.getElementById('singleLabelName').textContent = `ID BADGE: ${p.name}`;
      document.getElementById('singleLabelCategory').textContent = `${p.role || 'Photographer'} | ID: ${p.barcode}`;
      document.getElementById('singleLabelSerial').textContent = p.phone ? `Phone: ${p.phone}` : '';

      renderModalCodeFormats(p.barcode);
      openModal('modalSingleBarcode');
    }
  };

  function renderModalCodeFormats(codeText) {
    // 1. Render 1D Barcode
    if (window.JsBarcode) {
      try {
        JsBarcode('#singleBarcodeSvg', codeText, {
          format: 'CODE128',
          width: 2,
          height: 60,
          displayValue: true
        });
      } catch (e) {
        console.warn('1D barcode render error:', e);
      }
    }

    // 2. Render QR Code
    const qrContainer = document.getElementById('singleQrCanvas');
    qrContainer.innerHTML = '';
    if (window.QRCode) {
      try {
        new QRCode(qrContainer, {
          text: codeText,
          width: 120,
          height: 120,
          correctLevel: QRCode.CorrectLevel.M
        });
      } catch (e) {
        console.warn('QR render error:', e);
      }
    }

    // 3. Render Data Matrix (2D ECC 200)
    const dmCanvas = document.getElementById('singleDataMatrixCanvas');
    if (window.bwipjs && dmCanvas) {
      try {
        bwipjs.toCanvas(dmCanvas, {
          bcid: 'datamatrix',
          text: codeText,
          scale: 4,
          height: 25,
          width: 25,
          includetext: false
        });
      } catch (e) {
        console.warn('Data Matrix render error:', e);
      }
    }

    // Set default format display to 1D Barcode
    switchLabelFormat('1d');
  }

  function switchLabelFormat(fmt) {
    const wrap1D = document.getElementById('wrapper1DBarcode');
    const wrapQR = document.getElementById('wrapperQrCode');
    const wrapDM = document.getElementById('wrapperDataMatrix');

    const btn1D = document.getElementById('btnLabelFmt1D');
    const btnQR = document.getElementById('btnLabelFmtQR');
    const btnDM = document.getElementById('btnLabelFmtDataMatrix');

    if (btn1D) btn1D.className = fmt === '1d' ? 'btn btn-sm btn-primary' : 'btn btn-sm';
    if (btnQR) btnQR.className = fmt === 'qr' ? 'btn btn-sm btn-primary' : 'btn btn-sm';
    if (btnDM) btnDM.className = fmt === 'dm' ? 'btn btn-sm btn-primary' : 'btn btn-sm';

    if (wrap1D) wrap1D.style.display = fmt === '1d' ? 'block' : 'none';
    if (wrapQR) wrapQR.style.display = fmt === 'qr' ? 'flex' : 'none';
    if (wrapDM) wrapDM.style.display = fmt === 'dm' ? 'flex' : 'none';
  }

  // --- THEME MANAGEMENT ---
  function initTheme() {
    const saved = localStorage.getItem('geartrack_theme') || 'dark';
    setTheme(saved, false);

    const btn = document.getElementById('btnThemeToggle');
    if (btn) {
      btn.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme') || 'dark';
        const next = current === 'dark' ? 'light' : 'dark';
        setTheme(next, true);
      });
    }
  }

  function setTheme(theme, notify = false) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('geartrack_theme', theme);

    const sunIcon = document.getElementById('themeToggleIconSun');
    const moonIcon = document.getElementById('themeToggleIconMoon');
    const btn = document.getElementById('btnThemeToggle');

    if (sunIcon && moonIcon) {
      if (theme === 'light') {
        sunIcon.style.display = 'none';
        moonIcon.style.display = 'inline-flex';
        if (btn) btn.setAttribute('title', 'Switch to Dark mode');
      } else {
        sunIcon.style.display = 'inline-flex';
        moonIcon.style.display = 'none';
        if (btn) btn.setAttribute('title', 'Switch to Light mode');
      }
    }

    if (notify) {
      showToast(`Switched to ${theme === 'light' ? 'Light' : 'Dark'} mode`, 'info');
    }
  }

  // Early theme apply
  try {
    const savedTheme = localStorage.getItem('geartrack_theme');
    if (savedTheme) {
      document.documentElement.setAttribute('data-theme', savedTheme);
    }
  } catch (e) {}

  // --- BOOTSTRAP ---
  window.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initEventListeners();
    initWebSocket();
    loadAllData();
    initCameraScanner();
  });

})();
