'use strict';

(() => {
  // ---------- 기본값 ----------
  // 티어 줄은 이 5개로 고정 (이름과 색상 모두 바꿀 수 없음)
  // color = 육각형 색, base = 이름 칸 바닥 네모 색
  const TIERS = [
    { id: 's', name: 'S', color: '#EF0000', base: '#680000' },
    { id: 'a', name: 'A', color: '#EF0000', base: '#B70000' },
    { id: 'b', name: 'B', color: '#F45252', base: '#F78181' },
    { id: 'c', name: 'C', color: '#F89494', base: '#F9CDCD' },
    { id: 'reject', name: '기각', color: '#B8BCC4', base: '#D3D5DA' },
  ];
  // 이미지를 이 크기(긴 변)까지 줄여서 보관. 더블클릭해서 크게 봐도 선명하도록 넉넉하게
  const IMAGE_MAX_SIDE = 1200; // 1200×1200 원본이 줄어들지 않고 그대로 보관됨
  const FILE_NAME = '티어표'; // PNG·내보내기 파일 이름

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

  // 바뀔 때마다 바로 저장
  let saveWarned = false;
  async function save() {
    try {
      await dbSet('state', state);
    } catch (err) {
      if (!saveWarned) {
        saveWarned = true;
        toast('이 브라우저에서는 자동 저장이 안 돼요. "파일로 내보내기"로 보관하세요.');
      }
    }
  }

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
    // 예전 버전(이름을 바꿀 수 있던 때) 파일은 줄 순서대로 고정 티어에 맞춤.
    // 이름과 색상은 저장된 값과 상관없이 항상 고정값을 사용
    const isOld = raw.version !== 2;
    const tiers = TIERS.map((base, i) => {
      const src = isOld ? raw.tiers[i] : raw.tiers.find((t) => t && t.id === base.id);
      return { ...base, items: takeItems(src?.items) };
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
  const LABEL_TEXT = '#000000'; // 티어 이름 글자는 모두 검은색

  // S 칸 육각형 위쪽 비스듬한 변에서 솟은 악마 뿔. 육각형 왼쪽 어깨가 (0,0), 육각형 폭이
  // 100인 좌표로 그림 (화면과 PNG에서 같이 씀). 어깨보다 위로 10, 안쪽으로 17 올라간 자리에
  // 붙어서, 어깨에서 위로 37까지 솟음
  const HORNS_PATH = 'M17 6C13 -4 13 -16 19 -24Q22 -31 25.5 -36Q26 -18 35.5 -10Z '
    + 'M83 6C87 -4 87 -16 81 -24Q78 -31 74.5 -36Q74 -18 64.5 -10Z';

  // 꼭짓점을 반지름 r만큼 둥글린 다각형 경로
  function roundedPolygonPath(points, r) {
    const n = points.length;
    let d = '';
    points.forEach(([x, y], i) => {
      const [px, py] = points[(i + n - 1) % n];
      const [nx, ny] = points[(i + 1) % n];
      const toward = (tx, ty) => {
        const len = Math.hypot(tx - x, ty - y);
        return [x + ((tx - x) * r) / len, y + ((ty - y) * r) / len];
      };
      const [ax, ay] = toward(px, py);
      const [bx, by] = toward(nx, ny);
      d += `${i ? 'L' : 'M'}${ax.toFixed(2)} ${ay.toFixed(2)}Q${x} ${y} ${bx.toFixed(2)} ${by.toFixed(2)}`;
    });
    return `${d}Z`;
  }

  // 이름 칸 육각형 (꼭짓점이 위아래인 정육각형, 폭 86.6 × 높이 100 좌표, 모서리 살짝 둥글게)
  const HEX_W = 86.6, HEX_H = 100;
  const HEX_PATH = roundedPolygonPath(
    [[43.3, 0], [86.6, 25], [86.6, 75], [43.3, 100], [0, 75], [0, 25]], 3,
  );

  function svgShape(className, viewBox, d) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', className);
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
    return svg;
  }

  function applyLabel(label, tier) {
    label.replaceChildren(svgShape('hex', `0 0 ${HEX_W} ${HEX_H}`, HEX_PATH));
    if (tier.id === 's') label.append(svgShape('horns', '-5 -37 110 43', HORNS_PATH));
    const name = document.createElement('span');
    name.textContent = tier.name;
    label.append(name);
    label.style.setProperty('--tier-color', tier.color);
    label.style.setProperty('--tier-base', tier.base);
    label.style.setProperty('--tier-text', LABEL_TEXT);
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

    const label = document.createElement('div');
    label.className = 'tier-label';
    applyLabel(label, tier);

    const items = document.createElement('div');
    items.className = 'tier-items items';
    items.dataset.zone = 'tier';
    items.dataset.id = tier.id;
    items.append(...tier.items.map(renderItem));

    row.append(label, items);
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
    // 확대(scale)는 이동(translate) 뒤에 붙여야 위치는 그대로 두고 크기만 커짐
    drag.ghost.style.transform = `translate(${x - drag.offX}px, ${y - drag.offY}px) scale(1.06)`;

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

  document.addEventListener('pointerdown', (e) => {
    if (!moreMenu.hidden && !e.target.closest('.menu-wrap')) moreMenu.hidden = true;
    if (!e.target.closest('.item')) clearSelection();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      // 글자 입력 칸에서 누른 건 무시
      if (e.target.closest?.('input, textarea, [contenteditable]')) return;
      if (!selected.size) return;
      e.preventDefault();
      deleteSelected();
      return;
    }
    if (e.key !== 'Escape') return;
    if (drag) finishDrag(true);
    closeLightbox();
    clearSelection();
    moreMenu.hidden = true;
  });

  // ---------- 이미지 크게 보기 ----------
  // 이미지를 더블클릭하면 화면 가운데에 크게 띄우고, 이미지 바깥 빈 곳을 누르면 닫힘
  const lightbox = $('lightbox');
  const lightboxImg = $('lightbox-img');
  // 원래 크기와 상관없이 화면(가로 90%, 세로 88%)에 꽉 맞게 키우거나 줄여서 보여줌
  function fitLightboxImage() {
    const nw = lightboxImg.naturalWidth, nh = lightboxImg.naturalHeight;
    if (!nw || !nh) return;
    const scale = Math.min((window.innerWidth * 0.9) / nw, (window.innerHeight * 0.88) / nh);
    lightboxImg.style.width = `${Math.round(nw * scale)}px`;
    lightboxImg.style.height = `${Math.round(nh * scale)}px`;
  }
  function openLightbox(id) {
    if (!state.images[id]) return;
    lightboxImg.onload = fitLightboxImage;
    lightboxImg.src = state.images[id];
    lightbox.hidden = false;
    if (lightboxImg.complete) fitLightboxImage();
  }
  window.addEventListener('resize', () => { if (!lightbox.hidden) fitLightboxImage(); });
  function closeLightbox() {
    lightbox.hidden = true;
    lightboxImg.removeAttribute('src');
  }
  document.addEventListener('dblclick', (e) => {
    const item = e.target.closest('.item');
    if (item && !item.classList.contains('ghost')) openLightbox(item.dataset.id);
  });
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox(); // 이미지 자체를 누른 건 무시
  });

  // ---------- 이미지 추가 (버튼 / 파일 끌어오기 / 붙여넣기) ----------
  $('btn-add-images').addEventListener('click', () => fileImages.click());
  fileImages.addEventListener('change', () => {
    if (fileImages.files.length) addFiles(fileImages.files);
    fileImages.value = '';
  });

  // 파일을 창에 끌어다 놓으면 추가 (안내 화면 없이)
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  document.addEventListener('dragenter', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  document.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
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
    const FONT = '"Noto Sans KR", "Malgun Gothic", sans-serif';
    // W는 한 줄에 이미지가 12개 들어가는 폭
    const W = 1274, LABEL = 112, LABEL_GAP = 12, CELL = 90, GAP = 4, PAD = 0, ROW_GAP = 10;
    const SCALE = 2;
    const perRow = Math.floor((W - PAD * 2 - LABEL - LABEL_GAP + GAP) / (CELL + GAP));

    // 캔버스는 글꼴이 다 받아진 뒤에 그려야 노토산스로 나옴 (티어 이름 글자를 미리 받아둠)
    const labelText = TIERS.map((t) => t.name).join('');
    try { await document.fonts?.load(`700 20px "Noto Sans KR"`, labelText); } catch { /* 글꼴 대기 실패는 무시 */ }
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

      // 이름 칸: 티어별 바닥 네모 위 가운데에 작은 정육각형
      // (꼭짓점이 위아래, 높이 = 이미지 한 칸의 62%, 화면 style.css와 같은 비율)
      ctx.fillStyle = tier.base;
      ctx.fillRect(x, y, LABEL, h);
      const rowBg = tier.id === 'reject' ? cssVar('--reject-bg', '#d3d5da') : cssVar('--row-bg', '#f4f5f7');
      const hexH = CELL * 0.62, hexW = hexH * 0.866;
      const hexX = x + (LABEL - hexW) / 2, hexY = y + (h - hexH) / 2;
      ctx.fillStyle = tier.color;
      ctx.save();
      ctx.translate(hexX, hexY);
      ctx.scale(hexW / HEX_W, hexH / HEX_H);
      ctx.fill(new Path2D(HEX_PATH));
      ctx.restore();
      // S 칸은 육각형 위쪽 변에서 같은 색 뿔이 솟음 (화면 style.css .horns와 같은 배치)
      if (tier.id === 's') {
        ctx.save();
        ctx.translate(hexX, hexY + hexH * 0.25);
        ctx.scale(hexW / 100, hexW / 100);
        ctx.fill(new Path2D(HORNS_PATH));
        ctx.restore();
      }

      ctx.save();
      roundRect(ctx, x, y, rowW, h, 0);
      ctx.clip();
      // 이미지 칸은 이름 칸과 LABEL_GAP만큼 떨어진 별도 상자
      ctx.fillStyle = rowBg;
      ctx.fillRect(x + LABEL + LABEL_GAP, y, rowW - LABEL - LABEL_GAP, h);

      // 라벨 글자: 육각형 안에 들어가게 크기를 줄이고, 너무 작아지면 줄바꿈
      ctx.fillStyle = LABEL_TEXT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      let size = tier.id === 'reject' ? 20 : 24, lines; // S·A·B·C는 조금 더 크게
      for (; size >= 10; size -= 2) {
        ctx.font = `700 ${size}px ${FONT}`;
        lines = wrapLines(ctx, tier.name, hexW * 0.85);
        const fitsHeight = lines.length * size * 1.2 <= hexH * 0.7;
        if (fitsHeight && (lines.length === 1 || size <= 18)) break;
      }
      const lh = size * 1.2;
      // 글자 실제 모양(잉크)의 위아래 가운데가 줄 자리 가운데에 오도록 기준선을 계산
      lines.forEach((ln, i) => {
        const m = ctx.measureText(ln);
        const midY = y + h / 2 + (i - (lines.length - 1) / 2) * lh;
        ctx.fillText(ln, x + LABEL / 2, midY + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
      });

      tier.items.forEach((id, i) => {
        const img = imgs[id];
        if (!img) return;
        const cx = x + LABEL + LABEL_GAP + (i % perRow) * (CELL + GAP);
        const cy = y + Math.floor(i / perRow) * (CELL + GAP);
        ctx.save();
        roundRect(ctx, cx, cy, CELL, CELL, 0);
        ctx.clip();
        if (tier.id === 'reject') ctx.globalAlpha = parseFloat(cssVar('--reject-opacity', '.5'));
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
      render();
      save();
      toast('티어표를 불러왔어요.');
    } catch {
      toast('티어메이커 파일이 아니거나 손상된 파일이에요.');
    }
  });

  // ---------- 악마 포인터 ----------
  // 기본 포인터 대신 악마가 마우스 위치에 그대로 붙어 다님. 악마 가운데가 클릭 지점
  const buddy = $('cursor-buddy');
  const BUDDY_OFFSET_X = -48; // 96px 그림의 가운데를 마우스 위치에 맞춤
  const BUDDY_OFFSET_Y = -48;

  // 마우스를 움직이는 동안만 두 그림을 번갈아 보여줘서 날갯짓하는 것처럼 보이게 함
  const BUDDY_FRAMES = ['assets/cursor-buddy.png', 'assets/cursor-buddy-2.png'];
  const BUDDY_FRAME_MS = 200; // 그림이 바뀌는 간격
  const BUDDY_STOP_MS = 150;  // 이 시간 동안 안 움직이면 멈춘 것으로 봄
  BUDDY_FRAMES.forEach((src) => { new Image().src = src; }); // 미리 받아둬서 바뀔 때 깜빡이지 않게
  let buddyFrame = 0;
  let buddyFlap = null;
  let buddyStop = null;
  function setBuddyFrame(i) {
    buddyFrame = i;
    buddy.src = BUDDY_FRAMES[i];
  }

  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    buddy.style.transform = `translate(${e.clientX + BUDDY_OFFSET_X}px, ${e.clientY + BUDDY_OFFSET_Y}px)`;
    buddy.classList.add('visible');

    if (!buddyFlap) {
      buddyFlap = setInterval(() => setBuddyFrame(1 - buddyFrame), BUDDY_FRAME_MS);
    }
    clearTimeout(buddyStop);
    buddyStop = setTimeout(() => {
      clearInterval(buddyFlap);
      buddyFlap = null;
      setBuddyFrame(0); // 멈추면 첫 번째 그림으로
    }, BUDDY_STOP_MS);
  });
  // 마우스가 창 밖으로 나가면 숨김
  document.documentElement.addEventListener('mouseleave', () => buddy.classList.remove('visible'));

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
