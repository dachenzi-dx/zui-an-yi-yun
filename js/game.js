import { canTravelTo, getStation, getStationLabel, isPoliceStation } from './map-data.js';

export const MAX_DAY = 12;
export const MIN_DAY = 1;
export const ACTIONS_PER_DAY = 4;
export const MAX_STRESS = 3;

export function createInitialState() {
  return {
    phase: 'idle', // idle | setup | playing | ended
    day: MAX_DAY,
    actionPoints: ACTIONS_PER_DAY,
    playerLocation: null,
    suspects: [],
    /** @type {{ id: string, locationId: number, text: string }[]} 地点备注 */
    locationNotes: [],
    /** @type {Record<string, number>} 每局从 0 开始的筹码 */
    chips: {},
    /** 压力 0~3，满 3 则天天数 -1 并清零 */
    stress: 0,
    log: [],
    /** 历史快照，用于撤回 */
    history: [],
    startedAt: null,
    endedAt: null,
    endReason: null,
  };
}

export function canUseAction(state) {
  return state.phase === 'playing' && state.actionPoints > 0;
}

export function getSuspectsAtLocation(state, locationId) {
  return state.suspects.filter((s) => s.locationId === locationId);
}

export function getLocationNotesAt(state, locationId) {
  return (state.locationNotes ?? []).filter((n) => n.locationId === locationId);
}

export function getChipCount(state, suspectId) {
  return state.chips?.[suspectId] ?? 0;
}

export function consumeAction(state, actionType, detail) {
  if (!canUseAction(state)) {
    return { ok: false, message: '行动点不足或游戏未进行中' };
  }

  // 保存当前状态快照（用于撤回）
  saveSnapshot(state);

  const entry = {
    day: state.day,
    action: actionType,
    detail,
    remainingAP: state.actionPoints - 1,
    timestamp: Date.now(),
  };

  state.actionPoints -= 1;
  state.log.push(entry);

  if (state.actionPoints === 0) {
    advanceDay(state);
  }

  return { ok: true, entry };
}

/** 保存状态快照（用于撤回） */
function saveSnapshot(state) {
  if (!state.history) state.history = [];
  
  const snapshot = {
    day: state.day,
    actionPoints: state.actionPoints,
    playerLocation: state.playerLocation,
    suspects: JSON.parse(JSON.stringify(state.suspects)),
    locationNotes: JSON.parse(JSON.stringify(state.locationNotes ?? [])),
    chips: JSON.parse(JSON.stringify(state.chips)),
    stress: state.stress,
    logLength: state.log.length,
    timestamp: Date.now(),
  };
  
  // 最多保留最近10个快照
  if (state.history.length >= 10) {
    state.history.shift();
  }
  state.history.push(snapshot);
}

/** 撤回上一次行动 */
export function undoLastAction(state) {
  if (state.phase !== 'playing') return { ok: false, message: '游戏未进行中' };
  if (!state.history || state.history.length === 0) {
    return { ok: false, message: '没有可撤回的操作' };
  }

  const snapshot = state.history.pop();
  
  // 恢复状态
  state.day = snapshot.day;
  state.actionPoints = snapshot.actionPoints;
  state.playerLocation = snapshot.playerLocation;
  state.suspects = JSON.parse(JSON.stringify(snapshot.suspects));
  state.locationNotes = JSON.parse(JSON.stringify(snapshot.locationNotes));
  state.chips = JSON.parse(JSON.stringify(snapshot.chips));
  state.stress = snapshot.stress;
  
  // 移除撤回的日志条目
  const removedLogs = state.log.splice(snapshot.logLength);
  
  return { 
    ok: true, 
    message: '已撤回上一次操作',
    removedLogs 
  };
}

/** 直接补充压力（不消耗行动点） */
export function addStressManually(state, amount = 1) {
  if (state.phase !== 'playing') return { ok: false, message: '游戏未进行中' };
  
  const oldStress = state.stress ?? 0;
  state.stress = Math.min(MAX_STRESS, oldStress + amount);
  
  let dayLost = false;
  let ended = false;

  if (state.stress >= MAX_STRESS) {
    state.stress = 0;
    const penalty = penalizeDayKeepAp(state);
    dayLost = penalty.dayLost;
    ended = penalty.ended;
  } else {
    state.log.push({
      day: state.day,
      action: 'add_stress_manual',
      detail: `手动补充压力（${state.stress}/${MAX_STRESS}）`,
      remainingAP: state.actionPoints,
      timestamp: Date.now(),
    });
  }

  return { ok: true, stress: state.stress, dayLost, ended };
}

/** 修改嫌疑人筹码（不消耗行动点） */
export function modifyChips(state, suspectId, newAmount) {
  if (state.phase !== 'playing') return { ok: false, message: '游戏未进行中' };
  
  const suspect = state.suspects.find((s) => s.id === suspectId);
  if (!suspect) return { ok: false, message: '嫌疑人不存在' };
  
  const amount = Math.max(0, parseInt(newAmount) || 0);
  const oldAmount = state.chips[suspectId] ?? 0;
  state.chips[suspectId] = amount;
  
  state.log.push({
    day: state.day,
    action: 'modify_chips',
    detail: {
      suspectId,
      name: suspect.name,
      oldAmount,
      newAmount: amount,
      label: `修改「${suspect.name}」筹码：${oldAmount} → ${amount}`,
    },
    remainingAP: state.actionPoints,
    timestamp: Date.now(),
  });

  return { ok: true, suspect, oldAmount, newAmount: amount };
}

function advanceDay(state) {
  if (state.day <= MIN_DAY) {
    endGame(state, 'timeout');
    return;
  }
  state.day -= 1;
  state.actionPoints = ACTIONS_PER_DAY;
  state.log.push({
    day: state.day,
    action: 'day_change',
    detail: `进入第 ${state.day} 天，行动点重置为 ${ACTIONS_PER_DAY}`,
    remainingAP: ACTIONS_PER_DAY,
    timestamp: Date.now(),
  });
}

/** 压力爆表：天数 -1，行动点不变 */
function penalizeDayKeepAp(state) {
  if (state.day <= MIN_DAY) {
    endGame(state, 'timeout');
    return { dayLost: true, ended: true };
  }
  state.day -= 1;
  state.log.push({
    day: state.day,
    action: 'stress_penalty',
    detail: `压力满 ${MAX_STRESS} 点，天数降至第 ${state.day} 天（行动点不变）`,
    remainingAP: state.actionPoints,
    timestamp: Date.now(),
  });
  return { dayLost: true, ended: false };
}

export function endGame(state, reason = 'manual') {
  state.phase = 'ended';
  state.endedAt = Date.now();
  state.endReason = reason;
}

export function moveTo(state, targetId) {
  if (state.phase !== 'playing') return { ok: false, message: '游戏未开始' };
  if (state.playerLocation === targetId) return { ok: false, message: '你已在该地点' };
  if (!canTravelTo(state.playerLocation, targetId)) {
    return { ok: false, message: '目标不在同一区域，无法直接前往' };
  }

  const result = consumeAction(state, 'move', {
    from: state.playerLocation,
    to: targetId,
    fromLabel: getStationLabel(state.playerLocation),
    toLabel: getStationLabel(targetId),
  });

  if (result.ok) {
    state.playerLocation = targetId;
  }
  return result;
}

export function investigate(state, locationId) {
  if (state.phase !== 'playing') return { ok: false, message: '游戏未开始' };
  if (state.playerLocation !== locationId) {
    return { ok: false, message: '必须身处该地点才能调查' };
  }

  return consumeAction(state, 'investigate', {
    locationId,
    label: getStationLabel(locationId),
  });
}

function assertSuspectHere(state, suspectId) {
  if (state.phase !== 'playing') return { ok: false, message: '游戏未开始' };
  const suspect = state.suspects.find((s) => s.id === suspectId);
  if (!suspect) return { ok: false, message: '嫌疑人不存在' };
  if (suspect.locationId !== state.playerLocation) {
    return { ok: false, message: '必须与嫌疑人在同一地点才能盘问' };
  }
  return { ok: true, suspect };
}

/** 使用筹码盘问：消耗 1 筹码 + 1 行动，直接结束 */
export function interrogateUseChip(state, suspectId) {
  const check = assertSuspectHere(state, suspectId);
  if (!check.ok) return check;

  const chips = getChipCount(state, suspectId);
  if (chips <= 0) {
    return { ok: false, message: `当前没有对「${check.suspect.name}」的筹码` };
  }

  state.chips[suspectId] = chips - 1;
  return consumeAction(state, 'interrogate', {
    locationId: state.playerLocation,
    suspectId,
    name: check.suspect.name,
    usedChip: true,
    chipsAfter: state.chips[suspectId],
    label: `${check.suspect.name}（使用筹码）@ ${getStationLabel(state.playerLocation)}`,
  });
}

/** 不使用筹码：仅消耗行动，随后由 UI 选择获得筹码/压力 */
export function interrogateNoChip(state, suspectId) {
  const check = assertSuspectHere(state, suspectId);
  if (!check.ok) return check;

  return consumeAction(state, 'interrogate', {
    locationId: state.playerLocation,
    suspectId,
    name: check.suspect.name,
    usedChip: false,
    label: `${check.suspect.name} @ ${getStationLabel(state.playerLocation)}`,
  });
}

export function gainChip(state, suspectId) {
  const suspect = state.suspects.find((s) => s.id === suspectId);
  if (!suspect) return { ok: false, message: '嫌疑人不存在' };
  state.chips[suspectId] = getChipCount(state, suspectId) + 1;
  state.log.push({
    day: state.day,
    action: 'gain_chip',
    detail: {
      suspectId,
      name: suspect.name,
      chips: state.chips[suspectId],
      label: `获得对「${suspect.name}」的筹码（当前 ${state.chips[suspectId]}）`,
    },
    remainingAP: state.actionPoints,
    timestamp: Date.now(),
  });
  return { ok: true, chips: state.chips[suspectId] };
}

export function gainStress(state) {
  state.stress = (state.stress ?? 0) + 1;
  let dayLost = false;
  let ended = false;

  if (state.stress >= MAX_STRESS) {
    state.stress = 0;
    const penalty = penalizeDayKeepAp(state);
    dayLost = penalty.dayLost;
    ended = penalty.ended;
  } else {
    state.log.push({
      day: state.day,
      action: 'gain_stress',
      detail: `获得压力（${state.stress}/${MAX_STRESS}）`,
      remainingAP: state.actionPoints,
      timestamp: Date.now(),
    });
  }

  return { ok: true, stress: state.stress, dayLost, ended };
}

export function searchBody(state, suspectId) {
  if (state.phase !== 'playing') return { ok: false, message: '游戏未开始' };

  const suspect = state.suspects.find((s) => s.id === suspectId);
  if (!suspect) return { ok: false, message: '嫌疑人不存在' };
  if (suspect.locationId !== state.playerLocation) {
    return { ok: false, message: '必须与嫌疑人在同一地点才能搜身' };
  }

  return consumeAction(state, 'search_body', {
    suspectId,
    name: suspect.name,
    locationId: suspect.locationId,
    label: `${suspect.name} @ ${getStationLabel(suspect.locationId)}`,
  });
}

export function buildGameRecord(state) {
  const daysUsed = MAX_DAY - state.day + (state.actionPoints < ACTIONS_PER_DAY ? 1 : 0);
  return {
    startedAt: state.startedAt,
    endedAt: state.endedAt ?? Date.now(),
    endReason: state.endReason ?? 'manual',
    startDay: MAX_DAY,
    endDay: state.day,
    daysUsed,
    playerStart: state.log.find((e) => e.action === 'game_start')?.detail?.startLocation ?? null,
    suspects: state.suspects.map((s) => ({ name: s.name, locationId: s.locationId })),
    locationNotes: (state.locationNotes ?? []).map((n) => ({
      locationId: n.locationId,
      text: n.text,
    })),
    log: state.log.map((e) => ({
      day: e.day,
      action: e.action,
      detail: e.detail,
      timestamp: e.timestamp,
    })),
  };
}

export function validateSetup(playerStart, suspects) {
  if (!playerStart || !getStation(playerStart)) {
    return { ok: false, message: '请选择有效的出生地点（警局）' };
  }
  if (!isPoliceStation(playerStart)) {
    return { ok: false, message: '出生地点只能选择警局' };
  }
  for (const s of suspects) {
    if (!s.name.trim()) return { ok: false, message: '嫌疑人姓名不能为空' };
    if (!getStation(s.locationId)) {
      return { ok: false, message: `嫌疑人「${s.name}」的地点序号无效` };
    }
  }
  return { ok: true };
}

function nextSuspectId(state) {
  const maxNum = state.suspects.reduce((m, s) => {
    const n = Number(String(s.id).replace('suspect-', ''));
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `suspect-${maxNum + 1}`;
}

/** 对局中登记嫌疑人，不消耗行动点 */
export function addSuspect(state, name, locationId) {
  if (state.phase !== 'playing') return { ok: false, message: '游戏未进行中' };

  const trimmed = name.trim();
  if (!trimmed) return { ok: false, message: '嫌疑人姓名不能为空' };
  if (!getStation(locationId)) {
    return { ok: false, message: '地点序号无效（1–100）' };
  }

  const id = nextSuspectId(state);
  const loc = Number(locationId);
  state.suspects.push({ id, name: trimmed, locationId: loc });
  state.chips[id] = 0;

  state.log.push({
    day: state.day,
    action: 'add_suspect',
    detail: {
      suspectId: id,
      name: trimmed,
      locationId: loc,
      label: `${trimmed} @ ${getStationLabel(loc)}`,
    },
    remainingAP: state.actionPoints,
    timestamp: Date.now(),
  });

  return { ok: true, suspect: { id, name: trimmed, locationId: loc } };
}

function nextLocationNoteId(state) {
  const maxNum = (state.locationNotes ?? []).reduce((m, n) => {
    const num = Number(String(n.id).replace('note-', ''));
    return Number.isFinite(num) ? Math.max(m, num) : m;
  }, 0);
  return `note-${maxNum + 1}`;
}

/** 对局中添加地点备注，不消耗行动点 */
export function addLocationNote(state, locationId, text) {
  if (state.phase !== 'playing') return { ok: false, message: '游戏未进行中' };

  const trimmed = text.trim();
  if (!trimmed) return { ok: false, message: '备注内容不能为空' };
  if (!getStation(locationId)) {
    return { ok: false, message: '地点序号无效（1–100）' };
  }

  if (!state.locationNotes) state.locationNotes = [];
  const loc = Number(locationId);
  const note = { id: nextLocationNoteId(state), locationId: loc, text: trimmed };
  state.locationNotes.push(note);

  state.log.push({
    day: state.day,
    action: 'add_location_note',
    detail: {
      noteId: note.id,
      locationId: loc,
      text: trimmed,
      label: `${trimmed} @ ${getStationLabel(loc)}`,
    },
    remainingAP: state.actionPoints,
    timestamp: Date.now(),
  });

  return { ok: true, note };
}

/** 删除地点备注，不消耗行动点 */
export function removeLocationNote(state, noteId) {
  if (state.phase !== 'playing') return { ok: false, message: '游戏未进行中' };

  const idx = (state.locationNotes ?? []).findIndex((n) => n.id === noteId);
  if (idx < 0) return { ok: false, message: '备注不存在' };

  const [removed] = state.locationNotes.splice(idx, 1);
  state.log.push({
    day: state.day,
    action: 'remove_location_note',
    detail: {
      noteId: removed.id,
      locationId: removed.locationId,
      text: removed.text,
      label: `移除「${removed.text}」@ ${getStationLabel(removed.locationId)}`,
    },
    remainingAP: state.actionPoints,
    timestamp: Date.now(),
  });

  return { ok: true, note: removed };
}

export function startGame(state, playerStart, suspects) {
  const check = validateSetup(playerStart, suspects);
  if (!check.ok) return check;

  state.phase = 'playing';
  state.day = MAX_DAY;
  state.actionPoints = ACTIONS_PER_DAY;
  state.playerLocation = playerStart;
  state.suspects = suspects.map((s, i) => ({
    id: `suspect-${i + 1}`,
    name: s.name.trim(),
    locationId: Number(s.locationId),
  }));
  state.chips = {};
  state.suspects.forEach((s) => {
    state.chips[s.id] = 0;
  });
  state.locationNotes = [];
  state.stress = 0;
  state.log = [];
  state.startedAt = Date.now();
  state.endedAt = null;
  state.endReason = null;

  state.log.push({
    day: state.day,
    action: 'game_start',
    detail: {
      startLocation: playerStart,
      startLabel: getStationLabel(playerStart),
      suspects: state.suspects.map((s) => ({
        name: s.name,
        locationId: s.locationId,
        label: getStationLabel(s.locationId),
      })),
    },
    remainingAP: state.actionPoints,
    timestamp: Date.now(),
  });

  return { ok: true };
}

export function getActionLabel(action) {
  const labels = {
    move: '前往',
    investigate: '调查',
    interrogate: '盘问',
    search_body: '搜身',
    day_change: '天数变更',
    stress_penalty: '压力结算',
    gain_chip: '获得筹码',
    gain_stress: '获得压力',
    add_stress_manual: '补充压力',
    modify_chips: '修改筹码',
    add_suspect: '登记嫌疑人',
    add_location_note: '地点备注',
    remove_location_note: '移除备注',
    game_start: '游戏开始',
  };
  return labels[action] ?? action;
}

export function formatLogDetail(entry) {
  const { action, detail } = entry;
  switch (action) {
    case 'move':
      return `${detail.fromLabel} → ${detail.toLabel}`;
    case 'investigate':
      return `调查 ${detail.label}`;
    case 'interrogate':
      return `盘问 ${detail.label}`;
    case 'search_body':
      return `搜身 ${detail.label}`;
    case 'day_change':
    case 'stress_penalty':
    case 'gain_stress':
    case 'add_stress_manual':
      return detail;
    case 'gain_chip':
    case 'modify_chips':
      return detail.label ?? detail;
    case 'add_suspect':
      return detail.label;
    case 'add_location_note':
    case 'remove_location_note':
      return detail.label;
    case 'game_start':
      return `从 ${detail.startLabel} 出发`;
    default:
      return typeof detail === 'string' ? detail : JSON.stringify(detail);
  }
}
