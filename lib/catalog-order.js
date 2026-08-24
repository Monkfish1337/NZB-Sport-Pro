'use strict';

// Normalise an order submitted by the account form or loaded from an older
// users.json. Unknown IDs are ignored by cleanOrder; missing/new registry
// entries are appended by orderByIds in their normal registry order.
function normaliseOrder(value) {
  const values = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(',') : []);
  const seen = new Set();
  const out = [];
  for (const raw of values) {
    const id = String(raw || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function cleanOrder(value, validIds) {
  return normaliseOrder(value).filter((id) => validIds.has(id));
}

function orderByIds(items, requestedOrder, getId) {
  const source = Array.isArray(items) ? items : [];
  const byId = new Map(source.map((item) => [String(getId(item)), item]));
  const out = [];
  for (const id of normaliseOrder(requestedOrder)) {
    const item = byId.get(id);
    if (!item) continue;
    out.push(item);
    byId.delete(id);
  }
  for (const item of source) {
    const id = String(getId(item));
    if (!byId.has(id)) continue;
    out.push(item);
    byId.delete(id);
  }
  return out;
}

module.exports = { normaliseOrder, cleanOrder, orderByIds };
