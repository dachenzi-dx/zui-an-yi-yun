const STORAGE_KEY = 'doa_game_history';
const MAX_HISTORY = 10;

export function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveGameRecord(record) {
  const history = loadHistory();
  history.unshift(record);
  if (history.length > MAX_HISTORY) {
    history.length = MAX_HISTORY;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

export function formatRecordSummary(record) {
  const start = new Date(record.startedAt).toLocaleString('zh-CN');
  const end = record.endedAt ? new Date(record.endedAt).toLocaleString('zh-CN') : '—';
  const reason = record.endReason === 'timeout' ? '天数耗尽' : record.endReason === 'manual' ? '手动结束' : '未知';
  return { start, end, reason, daysUsed: record.daysUsed, actionCount: record.log.length };
}
