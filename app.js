'use strict';

(() => {
  // ---------- 기본값 ----------
  // 티어 줄은 이 5개로 고정 (이름은 바꿀 수 없고 색상만 바꿀 수 있음)
  const TIERS = [
    { id: 's', name: 'S급 빌런', color: '#EF000C' },
    { id: 'a', name: 'A급 빌런', color: '#A50000' },
    { id: 'b', name: 'B급 빌런', color: '#6300A3' },
    { id: 'c', name: 'C급 빌런', color: '#1B29AF' },
    { id: 'reject', name: '빌런 기각', color: '#565656' },
  ];
  const PALETTE = [
    '#EF000C', '#A50000', '#6300A3', '#1B29AF', '#565656', '#FFA94D',
    '#FFD43B', '#8CE99A', '#74C0FC', '#B197FC', '#F783AC', '#E9ECEF',
  ];
  const IMAGE_MAX_SIDE = 256; // 저장 용량을 줄이기 위해 이미지 크기를 줄여서 보관
  const FILE_NAME = '빌런 티어표'; // PNG·내보내기 파일 이름

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const defaultState = () => ({
    version: 2,
    tiers: TIERS.map((t) => ({ ...t, items: [] })),
    pool: [],
    images: {},
  });

  // ---------- 요소 ----------
  const $ = (id) => document.getElementById(id);
  const boardEl = $('board');
  const poolEl = $('pool');
  const popEl = $('tier-popover');
  const popTitle = $('pop-title');
  const popColor = $('pop-color');
  const popSwatches = $('pop-swatches');
  const moreMenu = $('more-menu');
  const fileImages = $('file-images');
  const fileImport = $('file-import');
  const toastEl = $('toast');

  let state = defaultState();

  // ---------- 저장 (브라우저 IndexedDB) ----------
  const DB_NAME = 'tiermaker';
  const STORE = 'kv';
  let dbPromise = null;

  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function dbGet(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbSet(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  let saveTimer = null;
  let saveWarned = false;
  async function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      await dbSet('state', state);
    } catch (err) {
      if (!saveWarned) {
        saveWarned = true;
        toast('이 브라우저에서는 자동 저장이 안 돼요. "파일로 내보내기"로 보관하세요.');
      }
    }
  }
  // 글자 입력처럼 연속으로 바뀌는 것만 잠깐 모아서 저장하고, 나머지는 바로 저장
  function save({ debounce = false } = {}) {
    clearTimeout(saveTimer);
    if (debounce) saveTimer = setTimeout(saveNow, 300);
    else saveNow();
  }
  // 창을 닫거나 새로고침하기 직전에 남은 변경을 바로 저장
  const flushSave = () => { if (saveTimer) saveNow(); };
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushSave());

  // 불러온 데이터가 깨져 있어도 최대한 살려서 사용
  function normalize(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tiers)) return null;
    const images = {};
    if (raw.images && typeof raw.images === 'object') {
      for (const [id, url] of Object.entries(raw.images)) {
        if (typeof url === 'string' && url.startsWith('data:image/')) images[id] = url;
      }
    }
    const used = new Set();
    const takeItems = (list) => (Array.isArray(list) ? list : []).filter((id) => {
      if (!images[id] || used.has(id)) return false;
      used.add(id);
      return true;
    });
    // 예전 버전(이름을 바꿀 수 있던 때) 파일은 줄 순서대로 고정 티어에 맞춤
    const isOld = raw.version !== 2;
    const tiers = TIERS.map((base, i) => {
      const src = isOld ? raw.tiers[i] : raw.tiers.find((t) => t && t.id === base.id);
      return {
        ...base,
        color: !isOld && /^#[0-9a-f]{6}$/i.test(src?.color) ? src.color : base.color,
        items: takeItems(src?.items),
      };
    });
    // 고정 티어에 들어가지 못한 이미지는 대기 칸으로
    const pool = takeItems(raw.pool);
    for (const id of Object.keys(images)) if (!used.has(id)) pool.push(id);
    return {
      version: 2,
      tiers,
      pool,
      images,
    };
  }

  // ---------- 화면 그리기 ----------
  function textColorFor(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#1a1a1a' : '#ffffff';
  }

  function applyLabel(label, tier) {
    label.textContent = tier.name;
    label.style.setProperty('--tier-color', tier.color);
    label.style.setProperty('--tier-text', textColorFor(tier.color));
  }

  function renderItem(id) {
    const el = document.createElement('div');
    el.className = 'item';
    el.dataset.id = id;
    const img = document.createElement('img');
    img.src = state.images[id];
    img.alt = '';
    img.draggable = false;
    el.append(img);
    if (selected.has(id)) el.classList.add('selected');
    return el;
  }

  function renderTier(tier) {
    const row = document.createElement('div');
    row.className = 'tier';
    row.dataset.id = tier.id;

    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'tier-label';
    label.title = '클릭해서 색상 바꾸기';
    applyLabel(label, tier);

    const items = document.createElement('div');
    items.className = 'tier-items items';
    items.dataset.zone = 'tier';
    items.dataset.id = tier.id;
    items.append(...tier.items.map(renderItem));

    const gear = document.createElement('button');
    gear.type = 'button';
    gear.className = 'tier-gear';
    gear.title = '색상 바꾸기';
    gear.setAttribute('aria-label', `${tier.name} 색상 바꾸기`);
    gear.textContent = '⚙';

    row.append(label, items, gear);
    return row;
  }

  function render() {
    boardEl.replaceChildren(...state.tiers.map(renderTier));
    poolEl.replaceChildren(...state.pool.map(renderItem));
  }

  // 드래그로 바뀐 화면 순서를 데이터에 반영
  function syncFromDom() {
    const ids = (zone) => [...zone.children].filter((c) => c.classList.contains('item')).map((c) => c.dataset.id);
    for (const tier of state.tiers) {
      const zone = boardEl.querySelector(`.tier-items[data-id="${tier.id}"]`);
      if (zone) tier.items = ids(zone);
    }
    state.pool = ids(poolEl);
    save();
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }

  // ---------- 이미지 추가 ----------
  function resizeImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const w0 = img.naturalWidth || IMAGE_MAX_SIDE;
        const h0 = img.naturalHeight || IMAGE_MAX_SIDE;
        const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(w0, h0));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w0 * scale));
        canvas.height = Math.max(1, Math.round(h0 * scale));
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        let out = canvas.toDataURL('image/webp', 0.9);
        if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/png');
        resolve(out);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('이미지를 읽을 수 없음'));
      };
      img.src = url;
    });
  }

  async function addFiles(fileList) {
    const files = [...fileList].filter((f) => f.type.startsWith('image/'));
    if (!files.length) {
      toast('이미지 파일만 추가할 수 있어요.');
      return;
    }
    let added = 0;
    for (const file of files) {
      try {
        const id = uid();
        state.images[id] = await resizeImage(file);
        state.pool.push(id);
        added++;
      } catch {
        // 읽지 못한 파일은 건너뜀
      }
    }
    render();
    save();
    const failed = files.length - added;
    toast(failed ? `${added}개 추가, ${failed}개는 읽을 수 없었어요.` : `이미지 ${added}개를 추가했어요.`);
  }

  // ---------- 이미지 선택 / Delete 키로 삭제 ----------
  // 클릭하면 선택, Ctrl(또는 Shift)+클릭이면 여러 개 선택, 빈 곳을 클릭하면 선택 해제
  const selected = new Set();

  function selectItem(item, additive) {
    const id = item.dataset.id;
    if (additive) {
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
    } else {
      selected.clear();
      selected.add(id);
    }
    for (const el of document.querySelectorAll('.item')) el.classList.toggle('selected', selected.has(el.dataset.id));
  }

  function clearSelection() {
    if (!selected.size) return;
    selected.clear();
    for (const el of document.querySelectorAll('.item.selected')) el.classList.remove('selected');
  }

  function deleteSelected() {
    const ids = [...selected].filter((id) => state.images[id]);
    selected.clear();
    if (!ids.length) return;
    const gone = new Set(ids);
    for (const tier of state.tiers) tier.items = tier.items.filter((id) => !gone.has(id));
    state.pool = state.pool.filter((id) => !gone.has(id));
    for (const id of ids) delete state.images[id];
    render();
    save();
    toast(ids.length > 1 ? `이미지 ${ids.length}개를 삭제했어요.` : '이미지를 삭제했어요.');
  }

  // ---------- 드래그 앤 드롭 (마우스·터치 공통) ----------
  let drag = null;

  function onPointerDown(e) {
    const item = e.target.closest('.item');
    if (!item || item.classList.contains('ghost') || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    drag = {
      item,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      additive: e.ctrlKey || e.metaKey || e.shiftKey,
      active: false,
      origin: { parent: item.parentNode, next: item.nextSibling },
    };
  }

  function startDrag(e) {
    const rect = drag.item.getBoundingClientRect();
    drag.active = true;
    drag.offX = drag.startX - rect.left;
    drag.offY = drag.startY - rect.top;
    const ghost = drag.item.cloneNode(true);
    ghost.classList.add('ghost');
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    document.body.append(ghost);
    drag.ghost = ghost;
    drag.item.classList.add('placeholder');
    document.body.classList.add('dragging');
    closePopover();
  }

  function placeInZone(zone, x, y) {
    const item = drag.item;
    let before = null;
    for (const child of zone.children) {
      if (child === item || !child.classList.contains('item')) continue;
      const r = child.getBoundingClientRect();
      if (y < r.top || (y <= r.bottom && x < r.left + r.width / 2)) {
        before = child;
        break;
      }
    }
    if (before) {
      if (item.nextSibling !== before) zone.insertBefore(item, before);
    } else if (item.parentNode !== zone || zone.lastElementChild !== item) {
      zone.append(item);
    }
  }

  function setOver(zone) {
    if (drag.overZone === zone) return;
    drag.overZone?.classList.remove('over');
    zone?.classList.add('over');
    drag.overZone = zone;
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const x = e.clientX, y = e.clientY;
    if (!drag.active) {
      if (Math.hypot(x - drag.startX, y - drag.startY) < 5) return;
      startDrag(e);
    }
    drag.ghost.style.transform = `translate(${x - drag.offX}px, ${y - drag.offY}px)`;

    // 화면 끝 근처로 가면 자동으로 스크롤
    if (y < 70) window.scrollBy(0, -14);
    else if (y > window.innerHeight - 70) window.scrollBy(0, 14);

    const under = document.elementFromPoint(x, y);
    // 티어 라벨이나 줄 어디에 놓아도 그 줄로 들어가게
    const zone = under?.closest('.items') || under?.closest('.tier')?.querySelector('.tier-items');
    setOver(zone || null);
    if (zone) placeInZone(zone, x, y);
  }

  function finishDrag(cancelled) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.active) {
      // 끌지 않고 그냥 누른 거면 선택
      if (!cancelled) selectItem(d.item, d.additive);
      return;
    }
    d.ghost.remove();
    d.item.classList.remove('placeholder');
    d.overZone?.classList.remove('over');
    document.body.classList.remove('dragging');

    if (cancelled) {
      d.origin.parent.insertBefore(d.item, d.origin.next);
      return;
    }
    syncFromDom();
  }

  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', (e) => e.pointerId === drag?.pointerId && finishDrag(false));
  document.addEventListener('pointercancel', (e) => e.pointerId === drag?.pointerId && finishDrag(true));

  // ---------- 티어 설정 창 ----------
  let popTierId = null;
  const getPopTier = () => state.tiers.find((t) => t.id === popTierId);

  function renderSwatches(selected) {
    popSwatches.replaceChildren(...PALETTE.map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.setProperty('--c', c);
      b.dataset.color = c;
      b.title = c;
      b.classList.toggle('selected', c.toLowerCase() === selected.toLowerCase());
      return b;
    }));
  }

  function positionPopover(anchor) {
    const r = anchor.getBoundingClientRect();
    const pw = popEl.offsetWidth, ph = popEl.offsetHeight;
    let left = r.right + 8;
    if (left + pw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - pw - 8);
    let top = r.top;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, window.innerHeight - ph - 8);
    popEl.style.left = `${left}px`;
    popEl.style.top = `${top}px`;
  }

  function openPopover(tierId) {
    popTierId = tierId;
    const tier = getPopTier();
    if (!tier) return;
    popTitle.textContent = tier.name;
    popColor.value = tier.color.toLowerCase();
    renderSwatches(tier.color);
    popEl.hidden = false;
    positionPopover(boardEl.querySelector(`.tier[data-id="${tierId}"] .tier-label`));
  }

  function closePopover() {
    popEl.hidden = true;
    popTierId = null;
  }

  function updateTierLabel(tier) {
    const label = boardEl.querySelector(`.tier[data-id="${tier.id}"] .tier-label`);
    if (label) applyLabel(label, tier);
  }

  function setTierColor(color, debounce = false) {
    const tier = getPopTier();
    if (!tier) return;
    tier.color = color;
    popColor.value = color.toLowerCase();
    for (const s of popSwatches.children) s.classList.toggle('selected', s.dataset.color.toLowerCase() === color.toLowerCase());
    updateTierLabel(tier);
    save({ debounce });
  }

  boardEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.tier-label, .tier-gear');
    if (!btn) return;
    const id = btn.closest('.tier').dataset.id;
    if (popTierId === id && !popEl.hidden) closePopover();
    else openPopover(id);
  });

  popSwatches.addEventListener('click', (e) => {
    const s = e.target.closest('.swatch');
    if (s) setTierColor(s.dataset.color);
  });
  popColor.addEventListener('input', () => setTierColor(popColor.value, true));

  popEl.querySelector('.pop-buttons').addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    const tier = getPopTier();
    if (!act || !tier) return;
    if (act === 'clear') {
      state.pool.push(...tier.items);
      tier.items = [];
      render();
      openPopover(tier.id);
      save();
    }
  });

  document.addEventListener('pointerdown', (e) => {
    if (!popEl.hidden && !popEl.contains(e.target) && !e.target.closest('.tier-label, .tier-gear')) closePopover();
    if (!moreMenu.hidden && !e.target.closest('.menu-wrap')) moreMenu.hidden = true;
    if (!e.target.closest('.item')) clearSelection();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      // 글자 입력 칸에서 누른 건 무시
      if (e.target.closest('input, textarea, [contenteditable]')) return;
      if (!selected.size) return;
      e.preventDefault();
      deleteSelected();
      return;
    }
    if (e.key !== 'Escape') return;
    if (drag) finishDrag(true);
    closePopover();
    clearSelection();
    moreMenu.hidden = true;
  });
  window.addEventListener('resize', closePopover);

  // ---------- 이미지 추가 (버튼 / 파일 끌어오기 / 붙여넣기) ----------
  $('btn-add-images').addEventListener('click', () => fileImages.click());
  fileImages.addEventListener('change', () => {
    if (fileImages.files.length) addFiles(fileImages.files);
    fileImages.value = '';
  });

  let fileDragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  document.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    fileDragDepth++;
    document.body.classList.add('file-over');
  });
  document.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  document.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    if (--fileDragDepth <= 0) {
      fileDragDepth = 0;
      document.body.classList.remove('file-over');
    }
  });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    fileDragDepth = 0;
    document.body.classList.remove('file-over');
    addFiles(e.dataTransfer.files);
  });

  document.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.some((f) => f.type.startsWith('image/'))) {
      e.preventDefault();
      addFiles(files);
    }
  });

  // ---------- PNG로 저장 ----------
  function loadImg(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function drawCover(ctx, img, x, y, w, h) {
    const s = Math.max(w / img.width, h / img.height);
    const sw = w / s, sh = h / s;
    ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  // 띄어쓰기 단위로 줄을 바꾸고, 한 단어가 너무 길면 글자 단위로 자름
  function wrapLines(ctx, text, maxW) {
    const lines = [];
    let line = '';
    for (const word of text.split(' ')) {
      const joined = line ? `${line} ${word}` : word;
      if (ctx.measureText(joined).width <= maxW) {
        line = joined;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      for (const ch of word) {
        if (line && ctx.measureText(line + ch).width > maxW) {
          lines.push(line);
          line = ch;
        } else {
          line += ch;
        }
      }
    }
    lines.push(line);
    return lines;
  }

  // PNG도 화면과 같은 색이 되도록 style.css의 색을 읽어옴
  function cssVar(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  async function exportPng() {
    const FONT = 'SBAggro, "Pretendard Variable", Pretendard, "Segoe UI", "Malgun Gothic", sans-serif';
    // W는 한 줄에 이미지가 12개 들어가는 폭
    const W = 1312, LABEL = 150, LABEL_GAP = 12, CELL = 90, GAP = 4, PAD = 0, ROW_GAP = 10;
    const SCALE = 2;
    const perRow = Math.floor((W - PAD * 2 - LABEL - LABEL_GAP + GAP) / (CELL + GAP));

    // 캔버스는 글꼴이 다 받아진 뒤에 그려야 어그로체로 나옴
    try { await document.fonts?.load('500 20px SBAggro', '가A'); } catch { /* 글꼴 대기 실패는 무시 */ }
    const imgs = {};
    await Promise.all(Object.entries(state.images).map(async ([id, src]) => { imgs[id] = await loadImg(src); }));

    const rows = state.tiers.map((t) => {
      const lines = Math.max(1, Math.ceil(t.items.length / perRow));
      return { tier: t, h: lines * CELL + (lines - 1) * GAP }; // 줄 높이 = 이미지 높이
    });
    const boardH = rows.reduce((s, r) => s + r.h, 0) + ROW_GAP * (rows.length - 1) + PAD * 2;
    const H = boardH;

    const canvas = document.createElement('canvas');
    canvas.width = W * SCALE;
    canvas.height = H * SCALE;
    const ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = cssVar('--bg', '#e2e3e6'); // 뒤판 없이 페이지 배경색
    ctx.fillRect(0, 0, W, H);

    let y = PAD;
    for (const { tier, h } of rows) {
      const x = PAD;
      const rowW = W - PAD * 2;
      ctx.save();
      roundRect(ctx, x, y, rowW, h, 0);
      ctx.clip();
      ctx.fillStyle = cssVar('--row-bg', '#f4f5f7');
      ctx.fillRect(x, y, rowW, h);
      ctx.fillStyle = tier.color;
      ctx.fillRect(x, y, LABEL, h);

      // 라벨 글자: 되도록 한 줄에 들어가게 크기를 줄이고, 너무 작아지면 줄바꿈
      ctx.fillStyle = textColorFor(tier.color);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let size = 30, lines;
      for (; size >= 12; size -= 2) {
        ctx.font = `500 ${size}px ${FONT}`;
        lines = wrapLines(ctx, tier.name, LABEL - 16);
        const fitsHeight = lines.length * size * 1.2 <= h - 12;
        if (fitsHeight && (lines.length === 1 || size <= 18)) break;
      }
      const lh = size * 1.2;
      lines.forEach((ln, i) => ctx.fillText(ln, x + LABEL / 2, y + h / 2 + (i - (lines.length - 1) / 2) * lh));

      tier.items.forEach((id, i) => {
        const img = imgs[id];
        if (!img) return;
        const cx = x + LABEL + LABEL_GAP + (i % perRow) * (CELL + GAP);
        const cy = y + Math.floor(i / perRow) * (CELL + GAP);
        ctx.save();
        roundRect(ctx, cx, cy, CELL, CELL, 0);
        ctx.clip();
        drawCover(ctx, img, cx, cy, CELL, CELL);
        ctx.restore();
      });
      ctx.restore();
      y += h + ROW_GAP;
    }

    canvas.toBlob((blob) => {
      if (!blob) {
        toast('PNG를 만들지 못했어요.');
        return;
      }
      download(blob, `${FILE_NAME}.png`);
      toast('PNG 이미지를 저장했어요.');
    }, 'image/png');
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  $('btn-save-png').addEventListener('click', exportPng);

  // ---------- 더보기 메뉴: 내보내기 / 불러오기 / 초기화 ----------
  $('btn-more').addEventListener('click', () => { moreMenu.hidden = !moreMenu.hidden; });

  moreMenu.addEventListener('click', (e) => {
    const action = e.target.closest('button')?.dataset.action;
    if (!action) return;
    moreMenu.hidden = true;
    if (action === 'export') {
      const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
      download(blob, `${FILE_NAME}.tiermaker.json`);
      toast('파일로 내보냈어요. 다른 PC에서 "파일 불러오기"로 열 수 있어요.');
    } else if (action === 'import') {
      fileImport.click();
    } else if (action === 'reset') {
      if (!confirm('모든 티어와 이미지를 지우고 처음 상태로 돌릴까요?')) return;
      state = defaultState();
      closePopover();
      render();
      save();
      toast('처음 상태로 돌렸어요.');
    }
  });

  fileImport.addEventListener('change', async () => {
    const file = fileImport.files[0];
    fileImport.value = '';
    if (!file) return;
    try {
      const next = normalize(JSON.parse(await file.text()));
      if (!next) throw new Error('형식 오류');
      const hasWork = Object.keys(state.images).length > 0;
      if (hasWork && !confirm('지금 작업 중인 티어표가 불러온 파일로 바뀌어요. 계속할까요?')) return;
      state = next;
      closePopover();
      render();
      save();
      toast('티어표를 불러왔어요.');
    } catch {
      toast('티어메이커 파일이 아니거나 손상된 파일이에요.');
    }
  });

  // ---------- 시작 ----------
  (async () => {
    try {
      const saved = normalize(await dbGet('state'));
      if (saved) state = saved;
    } catch {
      // 저장소를 못 쓰면 기본 상태로 시작
    }
    render();
  })();
})();
