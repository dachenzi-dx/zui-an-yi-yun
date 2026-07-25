import {
  DISTRICTS,
  STATIONS,
  MAP_WIDTH,
  MAP_HEIGHT,
  CORE_OFFSET_X,
  CORE_OFFSET_Y,
  getStation,
  canTravelTo,
  getReachableStationIds,
  getStationLabel,
  getStationDistrictNames,
  isBorderStation,
  getPoliceStations,
  MAP_IMAGE,
  stationCanvasX,
  stationCanvasY,
  offsetDistrictPoints,
} from './map-data.js?v=20260725-expand';
import {
  createInitialState,
  startGame,
  moveTo,
  investigate,
  interrogateUseChip,
  interrogateNoChip,
  gainChip,
  gainStress,
  undoLastAction,
  addStressManually,
  modifyChips,
  getChipCount,
  addSuspect,
  addLocationNote,
  removeLocationNote,
  getLocationNotesAt,
  searchBody,
  endGame,
  buildGameRecord,
  canUseAction,
  getSuspectsAtLocation,
  ACTIONS_PER_DAY,
  MAX_DAY,
  MAX_STRESS,
  getActionLabel,
  formatLogDetail,
} from './game.js?v=20260725-undo';
import { loadHistory, saveGameRecord, formatRecordSummary } from './storage.js?v=20260725-note';

/** @type {ReturnType<typeof createInitialState>} */
let state = createInitialState();
let selectedStationId = null;
/** @type {string | null} 当前盘问流程中的嫌疑人 id */
let pendingInterrogateId = null;
let toastTimer = null;
const svgNS = 'http://www.w3.org/2000/svg';
const dragView = {
  active: false,
  pending: false,
  startX: 0,
  startY: 0,
  centerX: MAP_WIDTH / 2,
  centerY: MAP_HEIGHT / 2,
  zoom: 1.8,
};
const DRAG_THRESHOLD_PX = 6;

/** 缓存站点文字节点，避免拖拽时反复 querySelectorAll */
let stationIdTexts = [];
let stationLabelTexts = [];
let labelUpdateRaf = 0;
let viewportRaf = 0;
let zoomIdleTimer = 0;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const svgEl = (tag) => document.createElementNS(svgNS, tag);

function init() {
  document.documentElement.setAttribute('data-theme', 'dark');
  renderMap();
  bindEvents();
  updateUI();
}

function showToast(msg, type = 'info') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2800);
}

function openModal(id) {
  $(`#${id}`).classList.remove('hidden');
}

function closeModal(id) {
  $(`#${id}`).classList.add('hidden');
}

function bindEvents() {
  $('#btn-start').addEventListener('click', openSetup);
  $('#btn-end').addEventListener('click', handleEndGame);
  $('#btn-history').addEventListener('click', showHistory);
  $('#btn-interrogate').addEventListener('click', handleInterrogate);
  $('#btn-search-sidebar').addEventListener('click', () => openSearchModal('sidebar'));
  $('#btn-go').addEventListener('click', handleGo);
  $('#btn-investigate').addEventListener('click', handleInvestigate);
  $('#btn-add-suspect').addEventListener('click', () => addSuspectRow());
  $('#btn-add-suspect-ingame').addEventListener('click', openAddSuspectModal);
  $('#btn-add-suspect-confirm').addEventListener('click', confirmAddSuspect);
  $('#btn-add-suspect-cancel').addEventListener('click', () => closeModal('add-suspect-modal'));
  $('#btn-add-location-note').addEventListener('click', openLocationNoteModal);
  $('#btn-location-note-confirm').addEventListener('click', confirmAddLocationNote);
  $('#btn-location-note-cancel').addEventListener('click', () => closeModal('location-note-modal'));
  $('#input-note-loc').addEventListener('input', refreshLocationNoteList);
  $('#btn-setup-confirm').addEventListener('click', confirmSetup);
  $('#btn-setup-cancel').addEventListener('click', () => closeModal('setup-modal'));
  $('#btn-chip-yes').addEventListener('click', () => resolveInterrogateChip(true));
  $('#btn-chip-no').addEventListener('click', () => resolveInterrogateChip(false));
  $('#btn-gain-chip').addEventListener('click', () => resolveInterrogateReward('chip'));
  $('#btn-gain-stress').addEventListener('click', () => resolveInterrogateReward('stress'));
  $('#btn-interrogate-close').addEventListener('click', () => closeModal('interrogate-result-modal'));
  $('#btn-undo').addEventListener('click', handleUndo);
  $('#btn-add-stress').addEventListener('click', handleAddStress);
  $('#btn-modify-chips').addEventListener('click', openModifyChipsModal);
  $('#btn-restart').addEventListener('click', () => {
    closeModal('end-modal');
    openSetup();
  });

  $$('.modal-close').forEach((btn) => {
    btn.addEventListener('click', () => {
      // 盘问奖励必须二选一，不允许直接关掉
      if (btn.dataset.close === 'interrogate-result-modal') {
        showToast('请选择获得筹码或压力', 'info');
        return;
      }
      if (btn.dataset.close === 'interrogate-chip-modal') {
        pendingInterrogateId = null;
      }
      closeModal(btn.dataset.close);
    });
  });

  $$('.modal-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (e) => {
      if (e.target !== backdrop) return;
      if (backdrop.id === 'interrogate-result-modal') {
        showToast('请选择获得筹码或压力', 'info');
        return;
      }
      if (backdrop.id === 'interrogate-chip-modal') {
        pendingInterrogateId = null;
      }
      backdrop.classList.add('hidden');
    });
  });

  bindMapDrag();
  window.addEventListener('resize', () => {
    applyViewport();
  });
}

function renderMap() {
  renderCityBackdrop();
  renderConnections(); // 清空连线层（不再绘制）
  renderStations();
  applyViewport();
  // 等布局完成后再按屏幕像素校正字号（避免刷新全览时文字看起来“没变大”）
  requestAnimationFrame(() => {
    updateScreenSpaceLabels();
  });
}

/**
 * 全览时整张地图被压进屏幕，SVG user-unit 字号会跟着缩得很小。
 * 这里按当前 zoom / 视口，反算字号，让文字在屏幕上大致保持固定像素大小。
 */
function updateScreenSpaceLabels() {
  const svg = $('#map-overlay');
  if (!svg) return;

  const rect = svg.getBoundingClientRect();
  if (rect.width < 20 || rect.height < 20) return;

  // preserveAspectRatio=meet：真实缩放取宽高较小者，否则会把字算得偏小
  const unitToPx =
    dragView.zoom * Math.min(rect.width / MAP_WIDTH, rect.height / MAP_HEIGHT);
  if (!Number.isFinite(unitToPx) || unitToPx <= 0) return;

  // 约为原先一半的屏幕像素字号
  const idPx = 11;
  const namePx = 10;
  let idSize = idPx / unitToPx;
  let nameSize = namePx / unitToPx;

  idSize = Math.max(2.2, Math.min(18, idSize));
  nameSize = Math.max(2.0, Math.min(16, nameSize));

  const idFs = idSize.toFixed(2);
  const idSw = (idSize * 0.08).toFixed(2);
  const nameFs = nameSize.toFixed(2);
  const nameSw = (nameSize * 0.1).toFixed(2);
  const nameLift = 3.4 + nameSize * 0.42;

  for (let i = 0; i < stationIdTexts.length; i += 1) {
    const el = stationIdTexts[i];
    el.setAttribute('font-size', idFs);
    el.setAttribute('stroke-width', idSw);
  }

  for (let i = 0; i < stationLabelTexts.length; i += 1) {
    const el = stationLabelTexts[i];
    const cy = Number(el.dataset.cy);
    el.setAttribute('font-size', nameFs);
    el.setAttribute('stroke-width', nameSw);
    el.setAttribute('y', (cy - nameLift).toFixed(2));
  }
}

function scheduleLabelUpdate() {
  if (labelUpdateRaf) return;
  labelUpdateRaf = requestAnimationFrame(() => {
    labelUpdateRaf = 0;
    updateScreenSpaceLabels();
  });
}

function applyViewport({ updateLabels = true } = {}) {
  const svg = $('#map-overlay');
  if (!svg) return;

  const vw = MAP_WIDTH / dragView.zoom;
  const vh = MAP_HEIGHT / dragView.zoom;
  let vx = dragView.centerX - vw / 2;
  let vy = dragView.centerY - vh / 2;
  vx = Math.max(0, Math.min(MAP_WIDTH - vw, vx));
  vy = Math.max(0, Math.min(MAP_HEIGHT - vh, vy));
  dragView.centerX = vx + vw / 2;
  dragView.centerY = vy + vh / 2;
  svg.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`);
  if (updateLabels) scheduleLabelUpdate();
}

function scheduleViewport(opts) {
  if (viewportRaf) return;
  viewportRaf = requestAnimationFrame(() => {
    viewportRaf = 0;
    applyViewport(opts);
  });
}

function isMapInteractiveTarget(target) {
  const el = target instanceof Element ? target : target?.parentElement;
  return Boolean(el?.closest?.('.station-group, .suspect-marker, .tooltip-btn'));
}

function bindMapDrag() {
  const shell = $('.map-scene-shell');
  if (!shell) return;

  // 阻止地图区域的右键菜单（用于拖动）
  shell.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  shell.addEventListener('pointerdown', (e) => {
    // 改为右键（button 2）触发拖动
    if (e.button !== 2) return;
    // 点在站点/嫌疑人上：不抢事件，保证 click 能弹出操作窗
    if (isMapInteractiveTarget(e.target)) return;

    e.preventDefault(); // 防止浏览器手势
    dragView.pending = true;
    dragView.active = false;
    dragView.startX = e.clientX;
    dragView.startY = e.clientY;
  });

  shell.addEventListener('pointermove', (e) => {
    if (!dragView.pending && !dragView.active) return;

    const dxTotal = e.clientX - dragView.startX;
    const dyTotal = e.clientY - dragView.startY;

    // 超过阈值才真正进入拖拽，并开始 pointer capture
    if (!dragView.active) {
      if (Math.hypot(dxTotal, dyTotal) < DRAG_THRESHOLD_PX) return;
      dragView.active = true;
      dragView.pending = false;
      shell.classList.add('dragging');
      try {
        shell.setPointerCapture(e.pointerId);
      } catch (_) {
        /* ignore */
      }
      dragView.startX = e.clientX;
      dragView.startY = e.clientY;
      return;
    }

    const rect = shell.getBoundingClientRect();
    const dx = e.clientX - dragView.startX;
    const dy = e.clientY - dragView.startY;
    dragView.startX = e.clientX;
    dragView.startY = e.clientY;

    const vw = MAP_WIDTH / dragView.zoom;
    const vh = MAP_HEIGHT / dragView.zoom;
    dragView.centerX -= (dx / rect.width) * vw;
    dragView.centerY -= (dy / rect.height) * vh;
    // 拖拽中只更新 viewBox，松手后再校正字号
    scheduleViewport({ updateLabels: false });
  });

  const stopDrag = (e) => {
    const wasDragging = dragView.active;
    dragView.active = false;
    dragView.pending = false;
    shell.classList.remove('dragging');
    if (shell.hasPointerCapture?.(e.pointerId)) shell.releasePointerCapture(e.pointerId);
    if (wasDragging) applyViewport({ updateLabels: true });
  };

  shell.addEventListener('pointerup', stopDrag);
  shell.addEventListener('pointercancel', stopDrag);
  shell.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const nextZoom = Math.max(1.2, Math.min(3.5, dragView.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
      const rect = shell.getBoundingClientRect();
      const mx = (e.clientX - rect.left) / rect.width;
      const my = (e.clientY - rect.top) / rect.height;

      const oldVw = MAP_WIDTH / dragView.zoom;
      const oldVh = MAP_HEIGHT / dragView.zoom;
      const oldVx = dragView.centerX - oldVw / 2;
      const oldVy = dragView.centerY - oldVh / 2;
      const mapX = oldVx + mx * oldVw;
      const mapY = oldVy + my * oldVh;

      dragView.zoom = nextZoom;
      const newVw = MAP_WIDTH / dragView.zoom;
      const newVh = MAP_HEIGHT / dragView.zoom;
      dragView.centerX = mapX - mx * newVw + newVw / 2;
      dragView.centerY = mapY - my * newVh + newVh / 2;

      shell.classList.add('is-zooming');
      clearTimeout(zoomIdleTimer);
      zoomIdleTimer = setTimeout(() => shell.classList.remove('is-zooming'), 140);
      scheduleViewport({ updateLabels: true });
    },
    { passive: false }
  );
}

function renderCityBackdrop() {
  const g = $('#city-backdrop');
  g.innerHTML = '';

  // 百度卫星影像底图（扩展到 480x300，核心区域 320x200 居中）
  if (MAP_IMAGE) {
    const sat = svgEl('image');
    sat.setAttribute('href', MAP_IMAGE);
    sat.setAttributeNS('http://www.w3.org/1999/xlink', 'href', MAP_IMAGE);
    sat.setAttribute('x', '0');
    sat.setAttribute('y', '0');
    sat.setAttribute('width', String(MAP_WIDTH));
    sat.setAttribute('height', String(MAP_HEIGHT));
    sat.setAttribute('preserveAspectRatio', 'none');
    sat.classList.add('satellite-basemap');
    sat.setAttribute('pointer-events', 'none');
    g.appendChild(sat);
  }

  // 五区边界（放在暗角之前，确保可见）
  DISTRICTS.forEach((district) => {
    const polygon = svgEl('polygon');
    polygon.setAttribute('points', offsetDistrictPoints(district.points));
    polygon.classList.add('district-zone');
    polygon.style.setProperty('--district-color', district.color);
    g.appendChild(polygon);
  });

  // 轻微暗角，让标记更易读（放在五区边界之后）
  if (MAP_IMAGE) {
    const veil = svgEl('rect');
    veil.setAttribute('x', '0');
    veil.setAttribute('y', '0');
    veil.setAttribute('width', String(MAP_WIDTH));
    veil.setAttribute('height', String(MAP_HEIGHT));
    veil.classList.add('satellite-veil');
    g.appendChild(veil);
  }

  [
    { text: '西区', x: 48 + CORE_OFFSET_X, y: 88 + CORE_OFFSET_Y },
    { text: '好莱坞', x: 120 + CORE_OFFSET_X, y: 28 + CORE_OFFSET_Y },
    { text: '中央城区', x: 160 + CORE_OFFSET_X, y: 96 + CORE_OFFSET_Y },
    { text: '南湾', x: 120 + CORE_OFFSET_X, y: 168 + CORE_OFFSET_Y },
    { text: '圣盖博谷', x: 270 + CORE_OFFSET_X, y: 90 + CORE_OFFSET_Y },
  ].forEach((label) => {
    const text = svgEl('text');
    text.setAttribute('x', label.x);
    text.setAttribute('y', label.y);
    text.classList.add('district-label');
    text.textContent = label.text;
    g.appendChild(text);
  });
}

function renderConnections() {
  // 地图不再绘制点间连线；邻接关系仍由 map-data 的 EDGES 提供给移动逻辑
  const g = $('#connection-lines');
  if (g) g.innerHTML = '';
}

function renderStations() {
  const g = $('#station-markers');
  g.innerHTML = '';
  stationIdTexts = [];
  stationLabelTexts = [];

  STATIONS.forEach((s) => {
    const group = svgEl('g');
    group.classList.add('station-group');
    if (s.siteType === 'police') group.classList.add('station-police');
    if (s.siteType === 'gang') group.classList.add('station-gang');
    group.dataset.id = s.id;

    // 扩大可点热区，避免点不准
    const hit = svgEl('circle');
    hit.setAttribute('cx', stationCanvasX(s));
    hit.setAttribute('cy', stationCanvasY(s));
    hit.setAttribute('r', '7.5');
    hit.classList.add('station-hit');

    const halo = svgEl('circle');
    halo.setAttribute('cx', stationCanvasX(s));
    halo.setAttribute('cy', stationCanvasY(s));
    halo.setAttribute('r', '4.2');
    halo.classList.add('station-halo');

    const circle = svgEl('circle');
    circle.setAttribute('cx', stationCanvasX(s));
    circle.setAttribute('cy', stationCanvasY(s));
    circle.setAttribute('r', '2.6');
    circle.classList.add('station-circle');

    const ring = svgEl('circle');
    ring.setAttribute('cx', stationCanvasX(s));
    ring.setAttribute('cy', stationCanvasY(s));
    ring.setAttribute('r', '3.3');
    ring.classList.add('station-ring');

    const idText = svgEl('text');
    idText.setAttribute('x', stationCanvasX(s));
    idText.setAttribute('y', stationCanvasY(s));
    idText.classList.add('station-id-text');
    idText.textContent = s.id;
    stationIdTexts.push(idText);

    const nameText = svgEl('text');
    nameText.setAttribute('x', stationCanvasX(s));
    nameText.setAttribute('y', stationCanvasY(s) - 5.2);
    nameText.dataset.cy = String(stationCanvasY(s));
    nameText.classList.add('station-label-text');
    nameText.textContent = s.name;
    stationLabelTexts.push(nameText);

    const noteTip = svgEl('g');
    noteTip.classList.add('location-note-tip');
    noteTip.dataset.role = 'location-note-tip';

    const presenceTip = svgEl('g');
    presenceTip.classList.add('presence-tip');
    presenceTip.dataset.role = 'presence-tip';

    group.append(hit, halo, circle, ring, idText, nameText, noteTip, presenceTip);
    group.style.cursor = 'pointer';
    group.addEventListener('pointerdown', (e) => {
      // 阻止冒泡到地图壳层，避免拖拽逻辑干扰点击
      e.stopPropagation();
    });
    group.addEventListener('click', (e) => {
      e.stopPropagation();
      onStationClick(s.id);
    });
    g.appendChild(group);
  });

  updateStationTips();
}

function measureTipBox(lines) {
  const lineH = 3.4;
  const padY = 1.2;
  const width = Math.max(22, ...lines.map((t) => Math.min(t.length, 24) * 2.6 + 4));
  const height = lines.length * lineH + padY * 2;
  return { lineH, padY, width, height };
}

/** 在 anchorY 上方绘制提示框，返回占用高度（含间距） */
function fillTipGroup(tip, station, lines, anchorY, bgClass, textClass) {
  tip.innerHTML = '';
  if (!lines.length) return 0;

  const { lineH, padY, width, height } = measureTipBox(lines);
  const x = stationCanvasX(station) - width / 2;
  const y = anchorY - height;

  const bg = svgEl('rect');
  bg.setAttribute('x', x.toFixed(1));
  bg.setAttribute('y', y.toFixed(1));
  bg.setAttribute('width', width.toFixed(1));
  bg.setAttribute('height', height.toFixed(1));
  bg.setAttribute('rx', '1.2');
  bg.classList.add(bgClass);
  tip.appendChild(bg);

  lines.forEach((text, i) => {
    const t = svgEl('text');
    t.setAttribute('x', stationCanvasX(station).toFixed(1));
    t.setAttribute('y', (y + padY + lineH * (i + 0.55)).toFixed(1));
    t.classList.add(textClass);
    t.textContent = text.length > 28 ? `${text.slice(0, 27)}…` : text;
    tip.appendChild(t);
  });

  return height + 0.6;
}

/** 地点备注常显；玩家/嫌疑人悬停提示叠在备注上方 */
function updateStationTips() {
  const playing = state.phase === 'playing' || state.phase === 'ended';
  $$('.station-group').forEach((el) => {
    const id = Number(el.dataset.id);
    const noteTip = el.querySelector('[data-role="location-note-tip"]');
    const presenceTip = el.querySelector('[data-role="presence-tip"]');
    if (!noteTip || !presenceTip) return;

    noteTip.innerHTML = '';
    presenceTip.innerHTML = '';
    el.classList.remove('has-presence');

    if (!playing) return;

    const s = getStation(id);
    if (!s) return;

    let anchorY = stationCanvasY(s) - 8;

    const noteLines = getLocationNotesAt(state, id).map((n) => n.text);
    if (noteLines.length) {
      anchorY -= fillTipGroup(
        noteTip,
        s,
        noteLines,
        anchorY,
        'presence-tip-bg',
        'presence-tip-text'
      );
    }

    const presenceLines = [];
    if (state.playerLocation === id) presenceLines.push('您在这里');
    getSuspectsAtLocation(state, id).forEach((sus) => {
      presenceLines.push(`${sus.name}在这里`);
    });

    if (presenceLines.length) {
      el.classList.add('has-presence');
      fillTipGroup(
        presenceTip,
        s,
        presenceLines,
        anchorY - 0.4,
        'presence-tip-bg',
        'presence-tip-text'
      );
    }
  });
}

function renderEntities() {
  const g = $('#entity-markers');
  g.innerHTML = '';

  if (state.phase !== 'playing' && state.phase !== 'ended') return;

  if (state.playerLocation) {
    const ps = getStation(state.playerLocation);
    if (ps) {
      const pg = svgEl('g');
      pg.classList.add('entity-group', 'player-marker');
      pg.setAttribute('pointer-events', 'none');
      const icon = svgEl('text');
      icon.setAttribute('x', stationCanvasX(ps));
      icon.setAttribute('y', stationCanvasY(ps) - 7.5);
      icon.classList.add('entity-icon');
      icon.textContent = '🕵️';
      pg.appendChild(icon);
      g.appendChild(pg);
    }
  }

  state.suspects.forEach((sus) => {
    const st = getStation(sus.locationId);
    if (!st) return;

    const sg = svgEl('g');
    sg.classList.add('entity-group', 'suspect-marker');

    // 红色人形，与图例嫌疑色一致
    const icon = svgEl('g');
    icon.setAttribute('transform', `translate(${stationCanvasX(st)}, ${stationCanvasY(st) + 7.2})`);
    icon.setAttribute('pointer-events', 'none');
    const head = svgEl('circle');
    head.setAttribute('cx', '0');
    head.setAttribute('cy', '-2.6');
    head.setAttribute('r', '1.55');
    head.classList.add('suspect-icon');
    const body = svgEl('path');
    body.setAttribute(
      'd',
      'M -2.7 0.2 C -2.7 -0.7 -1.7 -1.2 0 -1.2 C 1.7 -1.2 2.7 -0.7 2.7 0.2 L 2.7 3.6 C 2.7 4.2 2.2 4.6 1.6 4.6 L -1.6 4.6 C -2.2 4.6 -2.7 4.2 -2.7 3.6 Z'
    );
    body.classList.add('suspect-icon');
    icon.append(head, body);

    const tip = svgEl('g');
    tip.classList.add('suspect-tooltip');

    const bg = svgEl('rect');
    bg.setAttribute('x', stationCanvasX(st) - 10);
    bg.setAttribute('y', stationCanvasY(st) + 10);
    bg.setAttribute('width', 20);
    bg.setAttribute('height', 9);
    bg.classList.add('tooltip-bg');

    const nameText = svgEl('text');
    nameText.setAttribute('x', stationCanvasX(st));
    nameText.setAttribute('y', stationCanvasY(st) + 13.2);
    nameText.classList.add('tooltip-text');
    nameText.textContent = sus.name;

    const btnRect = svgEl('rect');
    btnRect.setAttribute('x', stationCanvasX(st) - 6.5);
    btnRect.setAttribute('y', stationCanvasY(st) + 14.8);
    btnRect.setAttribute('width', 13);
    btnRect.setAttribute('height', 3.4);
    btnRect.classList.add('tooltip-btn');

    const btnText = svgEl('text');
    btnText.setAttribute('x', stationCanvasX(st));
    btnText.setAttribute('y', stationCanvasY(st) + 16.7);
    btnText.classList.add('tooltip-btn-text');
    btnText.textContent = '搜身';

    btnRect.addEventListener('click', (e) => {
      e.stopPropagation();
      handleSearchSuspect(sus.id);
    });

    tip.append(bg, nameText, btnRect, btnText);
    sg.append(icon, tip);
    g.appendChild(sg);
  });
}

function highlightStations() {
  $$('.station-group').forEach((el) => {
    el.classList.remove('current', 'adjacent');
    const id = Number(el.dataset.id);
    if (state.playerLocation === id) el.classList.add('current');
    else if (state.phase === 'playing' && canTravelTo(state.playerLocation, id)) {
      el.classList.add('adjacent');
    }
  });
}

function onStationClick(stationId) {
  selectedStationId = stationId;
  const s = getStation(stationId);
  if (!s) return;

  $('#station-modal-title').textContent = `#${s.id} ${s.name}`;
  const district = getStationDistrictNames(s);
  const borderTag = isBorderStation(s) ? '（交界）' : '';
  const siteTag = s.siteType === 'police' ? ' · 警局' : s.siteType === 'gang' ? ' · 黑帮据点' : '';
  const reachableCount = getReachableStationIds(stationId).length;
  $('#station-modal-desc').textContent = `${district}${borderTag}${siteTag} · 同区可前往 ${reachableCount} 个地点`;

  const isPlaying = state.phase === 'playing';
  const isHere = state.playerLocation === stationId;
  const canGo = isPlaying && canTravelTo(state.playerLocation, stationId);

  $('#btn-go').disabled = !isPlaying || !canGo || !canUseAction(state);
  $('#btn-investigate').disabled = !isPlaying || !isHere || !canUseAction(state);

  openModal('station-modal');
}

function handleGo() {
  if (!selectedStationId) return;
  const result = moveTo(state, selectedStationId);
  if (!result.ok) {
    showToast(result.message, 'error');
    return;
  }
  closeModal('station-modal');
  showToast(`已前往 ${getStationLabel(selectedStationId)}`, 'success');
  updateUI();
}

function handleInvestigate() {
  if (!selectedStationId) return;
  const result = investigate(state, selectedStationId);
  if (!result.ok) {
    showToast(result.message, 'error');
    return;
  }
  closeModal('station-modal');
  showToast(`调查了 ${getStationLabel(selectedStationId)}`, 'success');
  checkGameEnd();
  updateUI();
}

function handleInterrogate() {
  if (state.phase !== 'playing') {
    showToast('请先开始游戏', 'error');
    return;
  }
  if (!canUseAction(state)) {
    showToast('行动点不足', 'error');
    return;
  }
  const here = getSuspectsAtLocation(state, state.playerLocation);
  if (here.length === 0) {
    showToast('当前地点没有嫌疑人', 'error');
    return;
  }
  if (here.length === 1) {
    openInterrogateChipModal(here[0]);
    return;
  }

  const list = $('#interrogate-suspect-list');
  list.innerHTML = '';
  here.forEach((s) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = `${s.name}（筹码 ${getChipCount(state, s.id)}）`;
    btn.addEventListener('click', () => {
      closeModal('interrogate-pick-modal');
      openInterrogateChipModal(s);
    });
    li.appendChild(btn);
    list.appendChild(li);
  });
  openModal('interrogate-pick-modal');
}

function openInterrogateChipModal(suspect) {
  pendingInterrogateId = suspect.id;
  const chips = getChipCount(state, suspect.id);
  $('#interrogate-chip-msg').textContent =
    `是否使用对「${suspect.name}」的筹码？（当前拥有 ${chips} 点对「${suspect.name}」的筹码）`;
  $('#btn-chip-yes').disabled = chips <= 0;
  openModal('interrogate-chip-modal');
}

function resolveInterrogateChip(useChip) {
  const suspectId = pendingInterrogateId;
  if (!suspectId) return;

  closeModal('interrogate-chip-modal');

  if (useChip) {
    const result = interrogateUseChip(state, suspectId);
    pendingInterrogateId = null;
    if (!result.ok) {
      showToast(result.message, 'error');
      return;
    }
    showToast('已使用筹码完成盘问', 'success');
    checkGameEnd();
    updateUI();
    return;
  }

  const result = interrogateNoChip(state, suspectId);
  if (!result.ok) {
    pendingInterrogateId = null;
    showToast(result.message, 'error');
    updateUI();
    return;
  }

  const suspect = state.suspects.find((s) => s.id === suspectId);
  $('#interrogate-result-msg').textContent =
    `盘问结束！是否获得对「${suspect?.name ?? '该嫌疑人'}」的筹码，或获得压力？`;
  openModal('interrogate-result-modal');
  checkGameEnd();
  updateUI();
}

function resolveInterrogateReward(kind) {
  const suspectId = pendingInterrogateId;
  closeModal('interrogate-result-modal');
  pendingInterrogateId = null;
  if (!suspectId) return;

  if (kind === 'chip') {
    const result = gainChip(state, suspectId);
    if (!result.ok) {
      showToast(result.message, 'error');
      return;
    }
    showToast(`筹码 +1（当前 ${result.chips}）`, 'success');
  } else {
    const result = gainStress(state);
    if (result.dayLost) {
      showToast(
        result.ended
          ? '压力已满，天数耗尽，游戏结束'
          : `压力已满 3 点，天数降至第 ${state.day} 天（行动点不变）`,
        result.ended ? 'error' : 'info'
      );
    } else {
      showToast(`压力 +1（${result.stress}/${MAX_STRESS}）`, 'info');
    }
    checkGameEnd();
  }
  updateUI();
}

function handleSearchSuspect(suspectId) {
  const result = searchBody(state, suspectId);
  if (!result.ok) {
    showToast(result.message, 'error');
    return;
  }
  closeModal('search-modal');
  showToast('完成搜身', 'success');
  checkGameEnd();
  updateUI();
}

function openSearchModal(source) {
  if (state.phase !== 'playing') {
    showToast('请先开始游戏', 'error');
    return;
  }
  const here = getSuspectsAtLocation(state, state.playerLocation);
  if (here.length === 0) {
    showToast('当前地点没有嫌疑人', 'error');
    return;
  }
  if (!canUseAction(state)) {
    showToast('行动点不足', 'error');
    return;
  }

  const list = $('#search-suspect-list');
  list.innerHTML = '';
  here.forEach((s) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = `${s.name}（${getStationLabel(s.locationId)}）`;
    btn.addEventListener('click', () => handleSearchSuspect(s.id));
    li.appendChild(btn);
    list.appendChild(li);
  });

  if (here.length === 1 && source === 'sidebar') {
    handleSearchSuspect(here[0].id);
    return;
  }

  openModal('search-modal');
}

function checkGameEnd() {
  if (state.phase === 'ended') {
    const record = buildGameRecord(state);
    saveGameRecord(record);
    showEndModal(state.endReason === 'timeout');
  }
}

function showEndModal(isTimeout) {
  $('#end-modal-title').textContent = isTimeout ? '游戏结束 — 天数耗尽' : '游戏已结束';
  $('#end-modal-msg').textContent = isTimeout
    ? `第 ${state.day} 天的行动点已全部用完，案件调查时间耗尽。本次记录已保存，你可以重新开始。`
    : '本次游戏记录已保存。你可以查看历史存档或重新开始。';
  openModal('end-modal');
}

function handleEndGame() {
  if (state.phase !== 'playing') return;
  if (!confirm('确定要结束本次游戏吗？记录将被保存。')) return;
  endGame(state, 'manual');
  saveGameRecord(buildGameRecord(state));
  showEndModal(false);
  state = createInitialState();
  updateUI();
}

function openSetup() {
  if (state.phase === 'playing') {
    if (!confirm('当前游戏进行中，重新开始将放弃本局（不保存），是否继续？')) return;
    state = createInitialState();
  }
  renderSetupForm();
  openModal('setup-modal');
}

function renderSetupForm() {
  const select = $('#input-player-start');
  const police = getPoliceStations();
  select.innerHTML = [
    '<option value="">请选择警局出生点</option>',
    ...police.map((s) => `<option value="${s.id}">#${s.id} ${s.name}</option>`),
  ].join('');
  select.value = String(police[0]?.id ?? '');

  const container = $('#suspect-inputs');
  container.innerHTML = '';
}

function collectSuspectRows() {
  const suspects = [];
  let incomplete = false;
  $$('.suspect-row').forEach((row) => {
    const name = row.querySelector('.suspect-name').value.trim();
    const locationId = Number(row.querySelector('.suspect-loc').value);
    if (!name && !locationId) return;
    if (!name || !locationId) {
      incomplete = true;
      return;
    }
    suspects.push({ name, locationId });
  });
  return { suspects, incomplete };
}

function addSuspectRow(name = '', loc = '') {
  const container = $('#suspect-inputs');
  const row = document.createElement('div');
  row.className = 'suspect-row';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = '嫌疑人姓名';
  nameInput.value = name;
  nameInput.className = 'suspect-name';

  const locInput = document.createElement('input');
  locInput.type = 'number';
  locInput.min = '1';
  locInput.max = '100';
  locInput.placeholder = '地点序号';
  locInput.value = loc;
  locInput.className = 'suspect-loc';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn-remove';
  removeBtn.textContent = '×';
  removeBtn.addEventListener('click', () => row.remove());

  row.append(nameInput, locInput, removeBtn);
  container.appendChild(row);
}

function confirmSetup() {
  const playerStart = Number($('#input-player-start').value);
  const { suspects, incomplete } = collectSuspectRows();
  if (incomplete) {
    showToast('嫌疑人行请填写完整姓名与地点序号，或留空删除', 'error');
    return;
  }

  state = createInitialState();
  const result = startGame(state, playerStart, suspects);
  if (!result.ok) {
    showToast(result.message, 'error');
    return;
  }

  closeModal('setup-modal');
  const suspectHint = suspects.length ? '' : '（尚未登记嫌疑人）';
  showToast(`游戏开始！第 ${MAX_DAY} 天，${ACTIONS_PER_DAY} 点行动${suspectHint}`, 'success');
  updateUI();
}

function openAddSuspectModal() {
  if (state.phase !== 'playing') {
    showToast('请先开始游戏', 'error');
    return;
  }
  $('#input-suspect-name').value = '';
  $('#input-suspect-loc').value = '';
  openModal('add-suspect-modal');
  $('#input-suspect-name').focus();
}

function confirmAddSuspect() {
  const name = $('#input-suspect-name').value;
  const locationId = Number($('#input-suspect-loc').value);
  const result = addSuspect(state, name, locationId);
  if (!result.ok) {
    showToast(result.message, 'error');
    return;
  }
  closeModal('add-suspect-modal');
  showToast(`已登记嫌疑人：${result.suspect.name}`, 'success');
  updateUI();
}

function openLocationNoteModal() {
  if (state.phase !== 'playing') {
    showToast('请先开始游戏', 'error');
    return;
  }
  $('#input-note-text').value = '';
  $('#input-note-loc').value = selectedStationId ? String(selectedStationId) : '';
  refreshLocationNoteList();
  openModal('location-note-modal');
  $('#input-note-text').focus();
}

function refreshLocationNoteList() {
  const list = $('#location-note-list');
  if (!list) return;
  const loc = Number($('#input-note-loc').value);
  if (!loc || !getStation(loc)) {
    list.innerHTML = '<p class="empty-hint">输入有效地点序号后显示已有备注</p>';
    return;
  }
  const notes = getLocationNotesAt(state, loc);
  if (!notes.length) {
    list.innerHTML = `<p class="empty-hint">#${loc} 暂无备注</p>`;
    return;
  }
  list.innerHTML = '';
  notes.forEach((n) => {
    const li = document.createElement('li');
    li.className = 'note-list-item';
    const span = document.createElement('span');
    span.textContent = n.text;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost btn-sm';
    btn.textContent = '删除';
    btn.addEventListener('click', () => {
      const result = removeLocationNote(state, n.id);
      if (!result.ok) {
        showToast(result.message, 'error');
        return;
      }
      refreshLocationNoteList();
      updateUI();
      showToast('已删除备注', 'info');
    });
    li.append(span, btn);
    list.appendChild(li);
  });
}

function confirmAddLocationNote() {
  const locationId = Number($('#input-note-loc').value);
  const text = $('#input-note-text').value;
  const result = addLocationNote(state, locationId, text);
  if (!result.ok) {
    showToast(result.message, 'error');
    return;
  }
  $('#input-note-text').value = '';
  refreshLocationNoteList();
  updateUI();
  showToast(`已添加备注：${result.note.text}`, 'success');
}

function showHistory() {
  const history = loadHistory();
  const container = $('#history-list');

  if (history.length === 0) {
    container.innerHTML = '<p class="empty-hint">暂无历史存档</p>';
  } else {
    container.innerHTML = history
      .map((rec, i) => {
        const s = formatRecordSummary(rec);
        const logHtml = rec.log
          .filter((e) => e.action !== 'game_start')
          .map(
            (e) =>
              `<div><span class="log-day">D${e.day}</span> ${getActionLabel(e.action)}：${typeof e.detail === 'string' ? e.detail : formatLogDetail({ action: e.action, detail: e.detail })}</div>`
          )
          .join('');
        const suspects = rec.suspects.map((x) => `${x.name}@${x.locationId}`).join('、');
        return `
          <div class="history-item">
            <h4>#${i + 1} ${s.reason} · 共 ${s.actionCount} 次行动</h4>
            <div class="history-meta">
              开始：${s.start}<br/>
              结束：${s.end}<br/>
              起始地点：#${rec.playerStart ?? '—'} · 嫌疑人：${suspects || '—'}
            </div>
            <div class="history-log">${logHtml || '<span class="empty-hint">无行动记录</span>'}</div>
          </div>`;
      })
      .join('');
  }

  openModal('history-modal');
}

function updateUI() {
  const playing = state.phase === 'playing';

  $('#btn-start').classList.toggle('hidden', playing);
  $('#btn-end').classList.toggle('hidden', !playing);

  if (playing) {
    $('#stat-day').textContent = `第 ${state.day} 天`;
    $('#stat-ap').textContent = `${state.actionPoints} / ${ACTIONS_PER_DAY}`;
    $('#stat-location').textContent = getStationLabel(state.playerLocation);
  } else {
    $('#stat-day').textContent = '—';
    $('#stat-ap').textContent = '—';
    $('#stat-location').textContent = '—';
  }

  renderAPDots();
  renderStressMeter();
  renderActionLog();
  renderConnections();
  renderEntities();
  highlightStations();
  updateStationTips();

  const suspectsHere = playing ? getSuspectsAtLocation(state, state.playerLocation) : [];
  const canAct = playing && canUseAction(state);
  $('#btn-interrogate').disabled = !canAct || suspectsHere.length === 0;
  $('#btn-search-sidebar').disabled = !canAct || suspectsHere.length === 0;
  $('#btn-add-suspect-ingame').disabled = !playing;
  $('#btn-add-location-note').disabled = !playing;
  $('#btn-undo').disabled = !playing;
  $('#btn-add-stress').disabled = !playing;
  $('#btn-modify-chips').disabled = !playing;
}

function renderStressMeter() {
  const stress = state.phase === 'playing' || state.phase === 'ended' ? state.stress ?? 0 : 0;
  $$('#stress-meter .stress-bolt').forEach((el) => {
    const i = Number(el.dataset.i);
    el.classList.toggle('on', i < stress);
  });
}

function renderAPDots() {
  const container = $('#ap-dots');
  container.innerHTML = '';
  if (state.phase !== 'playing') return;

  for (let i = 0; i < ACTIONS_PER_DAY; i++) {
    const dot = document.createElement('div');
    dot.className = 'ap-dot' + (i >= state.actionPoints ? ' used' : '');
    container.appendChild(dot);
  }
}

function renderActionLog() {
  const container = $('#action-log');
  const entries = state.log.filter((e) => e.action !== 'game_start' && e.action !== 'day_change');

  if (entries.length === 0) {
    container.innerHTML = '<p class="empty-hint">开始游戏后显示行动记录</p>';
    return;
  }

  container.innerHTML = [...entries]
    .reverse()
    .slice(0, 50)
    .map(
      (e) =>
        `<div class="log-entry"><span class="log-day">第${e.day}天</span> <span class="log-action">${getActionLabel(e.action)}</span> ${formatLogDetail(e)}</div>`
    )
    .join('');
}

function handleUndo() {
  const result = undoLastAction(state);
  if (!result.ok) { showToast(result.message, 'error'); return; }
  showToast('已撤回上一次操作', 'success');
  renderMap();
  updateUI();
}

function handleAddStress() {
  const result = addStressManually(state);
  if (!result.ok) { showToast(result.message, 'error'); return; }
  if (result.ended) { showToast('压力爆表，游戏结束！', 'error'); updateUI(); return; }
  if (result.dayLost) showToast(`压力满 ${MAX_STRESS}，天数 -1`, 'error');
  else showToast(`压力 +1（${result.stress}/${MAX_STRESS}）`);
  updateUI();
}

function openModifyChipsModal() {
  if (!state.suspects.length) { showToast('当前没有嫌疑人', 'error'); return; }
  const container = $('#modify-chips-list');
  container.innerHTML = state.suspects.map((s) => `
    <div class="suspect-row" style="margin-bottom:0.6rem">
      <span style="font-size:0.88rem">${s.name}</span>
      <input type="number" min="0" max="99" value="${getChipCount(state, s.id)}"
        data-sid="${s.id}" style="width:70px;padding:0.3rem 0.5rem;border:1px solid var(--border);border-radius:8px;background:rgba(1,9,20,0.64);color:var(--text);text-align:center" />
      <button class="btn btn-sm btn-primary" data-sid="${s.id}" onclick="
        const inp = this.parentElement.querySelector('input');
        window.__modifyChips(this.dataset.sid, inp.value);
      ">确认</button>
    </div>`).join('');
  window.__modifyChips = (sid, val) => {
    const result = modifyChips(state, sid, val);
    if (!result.ok) { showToast(result.message, 'error'); return; }
    showToast(`已将「${result.suspect.name}」筹码改为 ${result.newAmount}`, 'success');
    openModifyChipsModal();
    updateUI();
  };
  openModal('modify-chips-modal');
}

init();
