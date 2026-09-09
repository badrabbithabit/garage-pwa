// The State Manager: folds append-only events into State.
// LENIENT by default (auto-creates stubs, reports issues) — the strict validator adds errors.
import {
  emptyState, Fact, GEvent, Item, Provenance, Recurring, SourceTier, State, Vehicle, WishItem,
} from './types';

export interface FoldIssue {
  level: 'error' | 'warn';
  event: string;   // event id
  message: string;
}

export interface FoldResult {
  state: State;
  issues: FoldIssue[];
}

export function confidenceForTier(tier: SourceTier): 'high' | 'medium' | 'low' {
  return tier <= 2 ? 'high' : 'medium';
}

export function makeFact<T>(value: T, prov: Provenance, ts: string, date?: string): Fact<T> {
  return {
    value,
    tier: prov.tier,
    kind: prov.kind,
    ref: prov.ref,
    ts: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00.000Z` : ts,
    confidence: confidenceForTier(prov.tier),
  };
}

export function parseNum(v: unknown): number | undefined {
  if (typeof v === 'number') return isFinite(v) ? v : undefined;
  if (typeof v !== 'string') return undefined;
  // First-number extraction: "143,000" / "143k" / "143000 mi" / "87,231 as of rebuild (1997)".
  const m = v.trim().toLowerCase().match(/-?\d[\d,]*(?:\.\d+)?\s*([km])?(?![a-z])/);
  if (!m) return undefined;
  const mult = m[1] === 'k' ? 1e3 : m[1] === 'm' ? 1e6 : 1;
  const n = Number(m[0].replace(/[,\s]/g, '').replace(/[km]$/, '')) * mult;
  return isFinite(n) ? n : undefined;
}

export function normItem(s: string): string {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function recurringKey(vehicle: string, item: string): string {
  return `${vehicle}|${normItem(item)}`;
}

export function fmtDate(d?: string): string | undefined {
  if (!d) return undefined;
  const m = String(d).match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : d;
}

/** Field name (vehicle_fact_claimed / claim) → vehicle property or 'extra:<name>' */
export function fieldTarget(field: string): string {
  const f = (field || '').trim().toLowerCase();
  const map: Record<string, string> = {
    mileage: 'mileage', odo: 'mileage', odometer: 'mileage',
    year: 'year', make: 'make', model: 'model', vin: 'vin',
    status: 'status',
    registration: 'regState', reg: 'regState', registration_state: 'regState', reg_state: 'regState',
    registration_expires: 'regExpires', reg_expires: 'regExpires', expires: 'regExpires', reg_expiration: 'regExpires',
    smog: 'smog', smog_required: 'smog',
    smog_date: 'lastSmog', last_smog: 'lastSmog',
    notes: 'notes', note: 'notes',
  };
  return map[f] ?? `extra:${field.trim()}`;
}

function setVehicleFact(v: Vehicle, target: string, value: unknown, prov: Provenance, ts: string, date?: string): void {
  const applyFact = (key: string, val: unknown, coerce?: (x: unknown) => unknown) => {
    const c = coerce ? coerce(val) : val;
    if (c === undefined || c === null || c === '') return;
    const cur = (v as any)[key] as Fact | undefined;
    const fact = makeFact(c as Fact<never>, prov, ts, date);
    if (!cur) { (v as any)[key] = fact; return; }
    // Higher tier (smaller number) wins. Same tier → later claim wins. Lower tier → ignored.
    if (prov.tier < cur.tier) (v as any)[key] = fact;
    else if (prov.tier === cur.tier && fact.ts >= cur.ts) (v as any)[key] = fact;
  };
  if (target === 'smog') {
    v.smogRequired = /^(true|yes|y|1|required|on)$/i.test(String(value).trim());
    return;
  }
  if (target.startsWith('extra:')) {
    const name = target.slice(6);
    const cur = v.extra[name];
    if (value === undefined || value === null || value === '') return;
    const fact = makeFact(value, prov, ts, date);
    if (!cur || prov.tier <= cur.tier) v.extra[name] = fact;
    return;
  }
  if (target === 'status') {
    const s = String(value).trim();
    if (s) v.status = s;
    return;
  }
  if (target === 'mileage' || target === 'year') applyFact(target, parseNum(value));
  else if (target === 'regExpires' || target === 'lastSmog') applyFact(target, fmtDate(String(value)));
  else if (target === 'vin') applyFact('vin', String(value).trim().toUpperCase());
  else applyFact(target, String(value));
}

function ensureVehicle(state: State, id: string, ts: string, strict: boolean, issues: FoldIssue[], evId: string): Vehicle {
  const cur = state.vehicles.get(id);
  if (cur) return cur;
  const v: Vehicle = { id, status: 'Active', extra: {}, addedTs: ts };
  state.vehicles.set(id, v);
  issues.push({
    level: strict ? 'error' : 'warn',
    event: evId,
    message: strict
      ? `references vehicle "${id}" but no vehicle_added exists for it (add a vehicle_added event first)`
      : `auto-created stub vehicle "${id}" on first reference`,
  });
  return v;
}

export function nextPartId(state: State): string {
  let max = 0;
  for (const id of state.items.keys()) {
    const m = id.match(/^PART-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `PART-${String(max + 1).padStart(5, '0')}`;
}

function nextWishId(state: State): string {
  let max = 0;
  for (const w of state.wishlist) {
    const m = w.id.match(/^WL-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `WL-${String(max + 1).padStart(4, '0')}`;
}

function ensureItem(state: State, id: string, ts: string, strict: boolean, issues: FoldIssue[], evId: string, partial: Partial<Item>): Item {
  const cur = state.items.get(id);
  if (cur) return cur;
  const it: Item = {
    id, description: id, quantity: 1, status: 'in_inventory', history: [], addedTs: ts, ...partial,
  };
  state.items.set(id, it);
  issues.push({
    level: strict ? 'error' : 'warn',
    event: evId,
    message: strict
      ? `references unknown part id "${id}" (add a part_added or parts_ordered for it first)`
      : `auto-created stub part "${id}" on first reference`,
  });
  return it;
}

function closeOpenLine(it: Item, removed?: string) {
  const last = it.history[it.history.length - 1];
  if (last && !last.removed) last.removed = removed;
}

/**
 * Apply one event to state. Returns issues (errors in strict mode, warnings in lenient mode).
 */
export function applyEvent(state: State, ev: GEvent, opts: { strict?: boolean } = {}): FoldIssue[] {
  const issues: FoldIssue[] = [];
  const P = ev.provenance ?? { tier: 1 as const, kind: 'manual' }; // lenient: hand-edited events may omit provenance
  const ts = ev.ts;
  const id = ev.id;
  const strict = !!opts.strict;
  const push = (level: 'error' | 'warn', message: string) => issues.push({ level, event: id, message });

  switch (ev.type) {
    case 'vehicle_added': {
      let v = state.vehicles.get(ev.vehicle);
      if (!v) { v = { id: ev.vehicle, status: ev.status || 'Active', extra: {}, addedTs: ts }; state.vehicles.set(ev.vehicle, v); }
      if (ev.year !== undefined) v.year = makeFact(ev.year, P, ts);
      if (ev.make !== undefined) v.make = makeFact(ev.make, P, ts);
      if (ev.model !== undefined) v.model = makeFact(ev.model, P, ts);
      if (ev.vin !== undefined) v.vin = makeFact(ev.vin, P, ts);
      if (ev.notes !== undefined) v.notes = makeFact(ev.notes, P, ts);
      if (ev.status) v.status = ev.status;
      break;
    }
    case 'vehicle_fact_claimed': {
      const v = ensureVehicle(state, ev.vehicle, ts, strict, issues, id);
      setVehicleFact(v, fieldTarget(ev.field), ev.value, P, ts, ev.date);
      break;
    }
    case 'vehicle_removed': {
      const v = state.vehicles.get(ev.vehicle);
      if (v) { v.status = 'Sold'; if (ev.reason) v.notes = makeFact(ev.reason, P, ts); }
      else push('warn', `vehicle_removed for unknown vehicle "${ev.vehicle}"`);
      break;
    }
    case 'parts_ordered': {
      for (const li of ev.items) {
        let it: Item;
        if (li.partId && state.items.has(li.partId)) {
          it = state.items.get(li.partId)!;
        } else if (li.partId) {
          it = ensureItem(state, li.partId, ts, strict, issues, id, {});
        } else {
          it = ensureItem(state, nextPartId(state), ts, false, issues, id, {});
        }
        it.description = li.description;
        if (li.partNumber) it.partNumber = li.partNumber;
        if (li.manufacturer) it.manufacturer = li.manufacturer;
        if (li.quantity) it.quantity = li.quantity;
        if (li.vehicle) it.vehicle = li.vehicle;
        if (ev.vendor) it.vendor = ev.vendor;
        it.orderNumber = ev.orderNumber;
        if (fmtDate(ev.date)) it.ordered = fmtDate(ev.date);
        if (li.price !== undefined) it.price = li.price;
        if (it.status === 'in_inventory' || it.status === 'ordered' || it.status === 'retired') it.status = 'ordered';
        // an installed part being re-ordered: keep installed, but bump nothing else
      }
      break;
    }
    case 'order_delivered': {
      for (const it of state.items.values()) {
        if (it.orderNumber === ev.orderNumber) {
          if (it.status === 'ordered' || it.status === 'in_inventory') it.status = 'in_inventory';
          if (fmtDate(ev.date)) it.received = fmtDate(ev.date);
        }
      }
      break;
    }
    case 'part_added': {
      const existing = state.items.get(ev.partId);
      if (existing) {
        if (strict) push('error', `duplicate part_added for ${ev.partId} (merge into the existing part)`);
        if (ev.description) existing.description = ev.description;
        if (ev.partNumber) existing.partNumber = ev.partNumber;
        if (ev.manufacturer) existing.manufacturer = ev.manufacturer;
        if (ev.quantity) existing.quantity = ev.quantity;
        if (ev.vehicle) existing.vehicle = ev.vehicle;
        if (ev.status) existing.status = ev.status as Item['status'];
        if (ev.vendor) existing.vendor = ev.vendor;
        if (ev.price !== undefined) existing.price = ev.price;
        if (ev.notes) existing.notes = ev.notes;
        break;
      }
      const item: Item = {
        id: ev.partId, description: ev.description, partNumber: ev.partNumber, manufacturer: ev.manufacturer,
        quantity: ev.quantity ?? 1, status: ev.status || 'in_inventory',
        vehicle: ev.vehicle, vendor: ev.vendor, price: ev.price, notes: ev.notes,
        ordered: fmtDate(ev.date), history: [], addedTs: ts,
      };
      if (item.status === 'installed' && ev.vehicle) item.history.push({ vehicle: ev.vehicle, installed: fmtDate(ev.date) });
      state.items.set(ev.partId, item);
      break;
    }
    case 'part_installed': {
      const it = state.items.has(ev.partId) ? state.items.get(ev.partId)! : ensureItem(state, ev.partId, ts, strict, issues, id, {});
      if (it.status === 'installed') closeOpenLine(it, fmtDate(ev.date));
      it.status = 'installed';
      it.vehicle = ev.vehicle;
      if (ev.notes) it.notes = ev.notes;
      it.history.push({ vehicle: ev.vehicle, installed: fmtDate(ev.date) });
      break;
    }
    case 'part_removed': {
      const it = state.items.has(ev.partId) ? state.items.get(ev.partId)! : ensureItem(state, ev.partId, ts, strict, issues, id, {});
      closeOpenLine(it, fmtDate(ev.date));
      if (it.status === 'installed' || it.status === 'ordered') it.status = 'in_inventory';
      if (ev.reason) it.notes = ev.reason;
      it.vehicle = undefined;
      break;
    }
    case 'part_reassigned': {
      const it = state.items.has(ev.partId) ? state.items.get(ev.partId)! : ensureItem(state, ev.partId, ts, strict, issues, id, {});
      closeOpenLine(it, fmtDate(ev.date));
      it.status = 'installed';
      it.vehicle = ev.toVehicle;
      if (ev.notes) it.notes = ev.notes;
      it.history.push({ vehicle: ev.toVehicle, installed: fmtDate(ev.date) });
      break;
    }
    case 'part_retired': {
      const it = state.items.has(ev.partId) ? state.items.get(ev.partId)! : ensureItem(state, ev.partId, ts, strict, issues, id, {});
      it.status = 'retired';
      it.retiredReason = ev.reason;
      it.retiredDate = fmtDate(ev.date);
      if (ev.notes) it.notes = ev.notes;
      it.vehicle = undefined;
      break;
    }
    case 'maintenance_logged': {
      ensureVehicle(state, ev.vehicle, ts, strict, issues, id);
      const mi = ev.mileage !== undefined ? parseNum(ev.mileage) : undefined;
      state.maintenance.push({
        eventId: id, ts, vehicle: ev.vehicle, date: fmtDate(ev.date) || ev.date,
        mileage: mi, item: ev.item, notes: ev.notes, modification: ev.isModification,
      });
      state.maintenance.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.ts < b.ts ? -1 : 1));
      const rec = state.recurring.get(recurringKey(ev.vehicle, ev.item));
      if (rec) {
        if (fmtDate(ev.date)) rec.lastDate = fmtDate(ev.date);
        if (mi !== undefined) rec.lastMileage = mi;
        rec.updatedTs = ts;
      }
      break;
    }
    case 'recurring_set': {
      ensureVehicle(state, ev.vehicle, ts, strict, issues, id);
      const rk = recurringKey(ev.vehicle, ev.item);
      const cur = state.recurring.get(rk);
      state.recurring.set(rk, {
        vehicle: ev.vehicle, item: ev.item,
        intervalMiles: ev.intervalMiles ?? cur?.intervalMiles,
        intervalMonths: ev.intervalMonths ?? cur?.intervalMonths,
        lastDate: cur?.lastDate, lastMileage: cur?.lastMileage, updatedTs: ts,
      });
      break;
    }
    case 'project_added': {
      if (ev.vehicle) ensureVehicle(state, ev.vehicle, ts, strict, issues, id);
      const cur = state.projects.get(ev.name);
      if (cur) {
        if (ev.vehicle) cur.vehicle = ev.vehicle;
        if (ev.status) cur.status = ev.status;
        for (const p of ev.parts ?? []) if (!cur.parts.includes(p)) cur.parts.push(p);
        if (ev.notes) cur.notes = ev.notes;
        cur.updatedTs = ts;
      } else {
        state.projects.set(ev.name, { name: ev.name, vehicle: ev.vehicle, status: ev.status ?? 'Planned', parts: [...(ev.parts ?? [])], notes: ev.notes, updatedTs: ts });
      }
      break;
    }
    case 'project_status_changed': {
      const cur = state.projects.get(ev.project);
      if (cur) {
        cur.status = ev.status;
        if (ev.notes) cur.notes = ev.notes;
        cur.updatedTs = ts;
      } else {
        if (strict) push('error', `references unknown project "${ev.project}" (add project_added first)`);
        else push('warn', `auto-created project "${ev.project}" on status change`);
        state.projects.set(ev.project, { name: ev.project, status: ev.status, parts: [], updatedTs: ts });
      }
      break;
    }
    case 'project_part_added': {
      const cur = state.projects.get(ev.project);
      if (!cur) { push('warn', `project_part_added for unknown project "${ev.project}" (ignored)`); break; }
      if (!cur.parts.includes(ev.partId)) cur.parts.push(ev.partId);
      cur.updatedTs = ts;
      if (!state.items.has(ev.partId)) push('warn', `project_part_added references unknown part ${ev.partId}`);
      break;
    }
    case 'wishlist_added': {
      if (ev.vehicle) ensureVehicle(state, ev.vehicle, ts, strict, issues, id);
      state.wishlist.push({ id: nextWishId(state), vehicle: ev.vehicle, item: ev.item, targetPrice: ev.targetPrice, watch: ev.watch, notes: ev.notes, ts });
      break;
    }
    case 'reminder_sent': {
      state.remindersSent.push({ key: ev.key, ts, level: ev.level });
      break;
    }
    case 'reminder_snoozed': {
      state.snoozes.set(ev.key, ev.until);
      break;
    }
    case 'claim_resolved': {
      // audit only — full history stays in claims/archived/
      break;
    }
    case 'note': {
      state.notes.push({ ts, target: ev.target, text: ev.text, eventId: id });
      break;
    }
  }
  return issues;
}

/** Fold a list of events into fresh state. Events are sorted by (ts, id) for determinism. */
export function foldEvents(events: GEvent[], opts: { strict?: boolean } = {}): FoldResult {
  const state = emptyState();
  const issues: FoldIssue[] = [];
  const seen = new Set<string>();
  const sorted = [...events].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const ev of sorted) {
    if (seen.has(ev.id)) { issues.push({ level: 'error', event: ev.id, message: 'duplicate event id' }); continue; }
    seen.add(ev.id);
    issues.push(...applyEvent(state, ev, opts));
  }
  return { state, issues };
}
