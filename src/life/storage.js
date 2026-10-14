import { STORAGE_KEY, emptyArchive, validateArchive } from './model.js';

export function readArchive(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  return raw === null ? emptyArchive() : validateArchive(JSON.parse(raw));
}
export function updateArchive(storage, transform) {
  const next = validateArchive(transform(readArchive(storage)));
  storage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
export function replaceArchive(storage, archive) {
  const next = validateArchive(archive);
  storage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
