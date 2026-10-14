import { STORAGE_KEY, emptyLedger, validateLedger } from './model.js';

export function readLedger(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  return raw === null ? emptyLedger() : validateLedger(JSON.parse(raw));
}

// 先读最新数据，再同步写入；写入失败时不返回未保存的账本。
export function updateLedger(storage, transform) {
  const next = validateLedger(transform(readLedger(storage)));
  storage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function replaceLedger(storage, ledger) {
  const next = validateLedger(ledger);
  storage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
