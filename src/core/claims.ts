// Claims: normalize (spec §6 onboarding shape AND agent claim files) and convert approved
// claim sets into concrete events. Conversion is deterministic given state (IDs assigned from max+1).
import { claimSetSchema, tierForKind } from './schema';
import { Claim, GEvent, OrderItem, Provenance, State } from './types';
import { parseNum } from './state';

export interface ClaimParse {
  ok: boolean;
  set?: import('./types').ClaimSet;
  errors: string[];
}

/** Accept raw pasted JSON or a parsed object. Returns a normalized ClaimSet. */
export function parseClaimSet(input: string | unknown): ClaimParse {
  const errors: string[] = [];
  let raw: unknown = input;
  if (typeof input === 'string') {
    let s = input.trim();
    // tolerate code fences
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) s = fence[1].trim();
    // tolerate a leading line of text before the first {
    const start = s.indexOf('{');
    if (start > 0) s = s.slice(start);
    try {
      raw = JSON.parse(s);
    } catch (e: any) {
      return { ok: false, errors: [`JSON parse error: ${e.message}`] };
    }
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as any).claims)) {
    return { ok: false, errors: ['Not a claim set: expected an object with a "claims" array (see spec §6 / the PASTE panel examples).'] };
  }
  const parsed = claimSetSchema.safeParse(raw);
  if (!parsed.success) {
    for (const iss of parsed.error.issues) errors.push(`${fmtPath(iss.path)}: ${iss.message}`);
    return { ok: false, errors };
  }
  // cross-populate snake_case ⇄ camelCase key pairs so downstream code can use either spelling
  const set = parsed.data as import('./types').ClaimSet;
  for (const c of set.claims) {
    for (const [snake, camel] of KEY_PAIRS) {
      const s = (c as any)[snake];
      const k = (c as any)[camel];
      if (s !== undefined && k === undefined) (c as any)[camel] = s;
      if (k !== undefined && s === undefined) (c as any)[snake] = k;
    }
  }
  // individual claim sanity (non-fatal — surfaced in review UI)
  set.claims.forEach((c: Claim, i: number) => {
    if (c.type === 'part' && !c.description) errors.push(`claims[${i}]: part claim missing description`);
    if ((c.type === 'vehicle' || c.type === 'fact')) {
      const isFact = c.type === 'fact' || c.field !== undefined;
      if (isFact && (!c.field || c.value === undefined)) errors.push(`claims[${i}]: ${c.type} claim needs field and value`);
      else if (!isFact && !(c.make || c.model || c.year !== undefined || c.vin || c.status)) errors.push(`claims[${i}]: vehicle claim needs a description (make/model/year/…) or a field+value`);
    }
    if ((c.type === 'maintenance' || c.type === 'modification') && !c.item) errors.push(`claims[${i}]: ${c.type} claim missing item`);
  });
  return { ok: errors.length === 0, set, errors };
}

/** `claims.0.field` → `claims[0].field` for friendlier review messages. */
function fmtPath(path: (string | number)[]): string {
  return path.map((p, i) => (typeof p === 'number' ? `${path[i - 1]}[${p}]` : String(p))).join('.').replace(/\.(?=[a-zA-Z_]*\[)/g, '[').replace(/\[(\d+)\]\.([a-zA-Z_$][\w$]*)/g, '[$1].$2');
}

/** snake_case ⇄ camelCase key pairs we accept interchangeably (LLMs vary). */
const KEY_PAIRS: [string, string][] = [
  ['part_number', 'partNumber'],
  ['order_number', 'orderNumber'],
  ['target_price', 'targetPrice'],
  ['source_detail', 'sourceDetail'],
  ['interval_miles', 'intervalMiles'],
  ['interval_months', 'intervalMonths'],
];

function provFor(kind: string, ref?: string, detail?: string): Provenance {
  return { tier: tierForKind(kind), kind: kind || 'manual', ref, detail };
}

function todayIso(d?: string): string {
  return d ?? new Date().toISOString();
}

// ID prefixes double as intra-batch sort order: all events in one claim batch share a single
// ts, so the id IS the fold order. Ladder (earlier = folded first):
//   a vehicles · b parts · c projects · d recurring · e wishlist · f facts
//   g maintenance/mods · h orders · i future references (delivered/installed/…)
// Creates always sort before the events that reference them.
function makeId(group: 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i', prefix: string, now: Date, extra: string): string {
  const d = now.toISOString().slice(0, 10).replace(/-/g, '');
  const slug = extra.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'change';
  return `${d}-${group}${prefix}-${slug}`;
}

export interface EmitCtx {
  now?: Date;
  /** base provenance for the whole set (from the claim file) */
  baseKind?: string;
  baseRef?: string;
  baseDetail?: string;
}

/**
 * Convert an approved claim set into events, given current state (for ID assignment).
 * Unknown vehicles get a vehicle_added prepended. Returns [] with a warning entry if a claim
 * cannot be mapped — but we never silently drop: unmappable claims throw with a message.
 */
export function claimSetToEvents(set: import('./types').ClaimSet, state: State, ctx: EmitCtx = {}): GEvent[] {
  const now = ctx.now ?? new Date();
  const ts = now.toISOString();
  const events: GEvent[] = [];
  const usedIds = new Set<string>();
  const add = (ev: GEvent) => {
    if (usedIds.has(ev.id)) ev.id = `${ev.id}-x${events.length}`;
    usedIds.add(ev.id);
    events.push(ev);
  };
  const knownVehicles = new Set(state.vehicles.keys());
  const ensureVehicle = (name: string, kind?: string, ref?: string, detail?: string, attrs?: { year?: number; make?: string; model?: string; vin?: string; status?: string }) => {
    const n = (name || '').trim();
    if (!n || n === '?') return;
    if (knownVehicles.has(n)) return;
    knownVehicles.add(n);
    add({
      v: 1, id: makeId('a', 'veh', now, `add-${n}`), ts, type: 'vehicle_added', vehicle: n,
      year: attrs?.year, make: attrs?.make, model: attrs?.model, vin: attrs?.vin, status: attrs?.status,
      provenance: provFor(kind || ctx.baseKind || 'manual', ref, detail ?? 'auto-created from claim reference'),
    });
  };
  const partSeq = { n: 0 };
  const nextPart = () => {
    partSeq.n += 1;
    return nextPartIdOffset(state, partSeq.n);
  };

  set.claims.forEach((c: Claim, i: number) => {
    const detail = c.source_detail || c.sourceDetail || ctx.baseDetail;
    const prov = provFor(ctx.baseKind || 'paste', ctx.baseRef, detail);
    const ref = ctx.baseRef;
    const date = c.date;
    switch (c.type) {
      case 'fact':
      case 'vehicle': {
        const isFactShape = c.type === 'fact' || (c.field !== undefined && c.value !== undefined);
        if (!c.vehicle) {
          if (isFactShape) throw new Error(`claims[${i}]: ${c.type} claim missing vehicle name`);
          // full description with no name yet (first-car onboarding): derive a stable ID
          const rawId: unknown = (c as any).id;
          const base =
            (typeof rawId === 'string' && rawId) ||
            (typeof c.model === 'string' && c.model) ||
            (typeof c.make === 'string' && c.make) ||
            'car';
          const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'car';
          let name = slug;
          let n = 2;
          while (state.vehicles.has(name) || knownVehicles.has(name)) name = `${slug}-${n++}`;
          c.vehicle = name;
        }
        if (isFactShape) {
          // single-fact claim
          ensureVehicle(c.vehicle, prov.kind, ref, detail);
          add({
            v: 1, id: makeId('f', 'fact', now, `${c.vehicle}-${(c.field || 'x').slice(0, 20)}-${i}`), ts,
            type: 'vehicle_fact_claimed', vehicle: c.vehicle, field: String(c.field), value: c.value,
            date: c.date, provenance: prov,
          });
        } else {
          // full vehicle description (spec §6 shape: make/model/year/status/…)
          ensureVehicle(c.vehicle, prov.kind, ref, detail, {
            year: typeof c.year === 'number' ? c.year : undefined,
            make: typeof c.make === 'string' ? c.make : undefined,
            model: typeof c.model === 'string' ? c.model : undefined,
            vin: typeof c.vin === 'string' ? c.vin : undefined,
            status: typeof c.status === 'string' ? c.status : undefined,
          });
        }
        break;
      }
      case 'part': {
        if (!c.description) throw new Error(`claims[${i}]: part claim missing description`);
        const pn = c.part_number ?? c.partNumber;
        const status = (c.status || 'in_inventory') as import('./types').ItemStatus;
        const id = nextPart();
        const ev: GEvent = {
          v: 1, id: makeId('b', 'part', now, `${id}-${i}`), ts, type: 'part_added', partId: id,
          description: c.description, partNumber: pn, manufacturer: c.manufacturer,
          quantity: c.quantity ?? 1, status,
          vehicle: c.vehicle, vendor: c.vendor,
          price: c.price !== undefined ? parseNum(c.price) : undefined,
          notes: c.notes, date, provenance: prov,
        };
        add(ev);
        if (c.vehicle) ensureVehicle(c.vehicle, prov.kind, ref, detail);
        break;
      }
      case 'maintenance': {
        if (!c.item) throw new Error(`claims[${i}]: maintenance claim missing item`);
        ensureVehicle(c.vehicle ?? '', prov.kind, ref, detail);
        add({
          v: 1, id: makeId('g', 'maint', now, `${c.vehicle}-${i}`), ts, type: 'maintenance_logged',
          vehicle: c.vehicle || '?', date: date || now.toISOString().slice(0, 10),
          mileage: c.mileage !== undefined ? parseNum(c.mileage) : undefined,
          item: c.item, notes: c.notes, provenance: prov,
        });
        break;
      }
      case 'modification': {
        if (!c.item) throw new Error(`claims[${i}]: modification claim missing item`);
        ensureVehicle(c.vehicle ?? '', prov.kind, ref, detail);
        add({
          v: 1, id: makeId('g', 'mod', now, `${c.vehicle}-${i}`), ts, type: 'maintenance_logged',
          vehicle: c.vehicle || '?', date: date || now.toISOString().slice(0, 10),
          mileage: c.mileage !== undefined ? parseNum(c.mileage) : undefined,
          item: c.item, notes: c.notes, isModification: true, provenance: prov,
        });
        break;
      }
      case 'order': {
        const rawLines: any[] = (c.items && c.items.length ? c.items : c.lines) || [];
        const items: OrderItem[] = rawLines.length
          ? rawLines.map((l: any) => ({
              description: l.description || l.item || 'order item',
              partNumber: l.part_number ?? l.partNumber,
              manufacturer: l.manufacturer,
              quantity: l.quantity ?? 1,
              vehicle: l.vehicle,
              price: l.price !== undefined ? parseNum(l.price) : undefined,
            }))
          : [
              { description: c.description || c.item || 'order item', partNumber: c.part_number ?? c.partNumber, manufacturer: c.manufacturer, quantity: c.quantity ?? 1, vehicle: c.vehicle, price: c.price !== undefined ? parseNum(c.price) : undefined },
            ];
        add({
          v: 1, id: makeId('h', 'order', now, `${c.vendor || 'vendor'}-${c.order_number ?? c.orderNumber ?? i}`), ts,
          type: 'parts_ordered', vendor: c.vendor || 'Unknown vendor', orderNumber: String(c.order_number ?? c.orderNumber ?? `PASTE-${now.getTime()}`),
          date, items, provenance: prov,
        });
        for (const it of items) if (it.vehicle) ensureVehicle(it.vehicle, prov.kind, ref, detail);
        break;
      }
      case 'wishlist': {
        ensureVehicle(c.vehicle ?? '', prov.kind, ref, detail);
        add({
          v: 1, id: makeId('e', 'wish', now, `${c.vehicle}-${i}`), ts, type: 'wishlist_added',
          vehicle: c.vehicle || '?', item: c.item || c.description || 'wishlist item',
          targetPrice: c.targetPrice ?? c.target_price, watch: c.watch, notes: c.notes, provenance: prov,
        });
        break;
      }
      case 'project': {
        if (!c.item && !c.description) throw new Error(`claims[${i}]: project claim missing item/name`);
        ensureVehicle(c.vehicle ?? '', prov.kind, ref, detail);
        add({
          v: 1, id: makeId('c', 'proj', now, `${c.item ?? c.description}-${i}`), ts, type: 'project_added',
          name: c.item || c.description!, vehicle: c.vehicle, status: c.status,
          parts: Array.isArray(c.parts) ? (c.parts as string[]) : undefined,
          notes: c.notes, provenance: prov,
        });
        break;
      }
      case 'recurring': {
        if (!c.item) throw new Error(`claims[${i}]: recurring claim missing item`);
        ensureVehicle(c.vehicle ?? '', prov.kind, ref, detail);
        add({
          v: 1, id: makeId('d', 'rec', now, `${c.vehicle}-${c.item}-${i}`), ts, type: 'recurring_set',
          vehicle: c.vehicle || '?', item: c.item,
          intervalMiles: (c.interval_miles ?? c.intervalMiles) as number | undefined ?? c.mileage,
          intervalMonths: (c.interval_months ?? c.intervalMonths) as number | undefined ?? c.quantity,
          notes: c.notes, provenance: prov,
        });
        break;
      }
      default:
        throw new Error(`claims[${i}]: unknown claim type "${(c as any).type}"`);
    }
  });

  return events;
}

/**
 * Convenience wrapper: emits events for a claim set with provenance derived from the set.
 * source_kind on the set (agent files) sets the base kind; PWA pastes default to 'paste' (tier 1).
 */
export function emitClaimSet(set: import('./types').ClaimSet, state: State, now?: Date): GEvent[] {
  const anySet = set as any;
  return claimSetToEvents(set, state, {
    now,
    baseKind: anySet.source_kind || 'paste', // 'paste' = human-fed = tier 1; agent files set source_kind (listing/llm/receipt/…)
    baseRef: anySet.source_ref,
    baseDetail: anySet.summary,
  });
}

/** Deterministic next part id that accounts for n parts created earlier in this batch. */
function nextPartIdOffset(state: State, n: number): string {
  let max = 0;
  for (const id of state.items.keys()) {
    const m = id.match(/^PART-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `PART-${String(max + 1 + (n - 1)).padStart(5, '0')}`;
}

/** Stamp a claim file (for the archive) with its resolution. */
export function withResolution<T extends object>(claim: T, resolution: { action: string; ts: string; by: string; eventIds?: string[]; note?: string }): T & { resolution: unknown } {
  return { ...claim, resolution };
}

export { todayIso };
