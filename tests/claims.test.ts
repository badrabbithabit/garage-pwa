import { describe, expect, it } from 'vitest';
import { parseClaimSet, emitClaimSet } from '../src/core/claims';
import { foldEvents } from '../src/core/state';
import { State, emptyState } from '../src/core/types';

// The exact example from spec §6
const SPEC_EXAMPLE = JSON.stringify({
  source: "pasted-from-forum",
  date_captured: "2026-08-01",
  claims: [
    { type: "vehicle", vehicle: "1985 VW Rabbit", make: "Volkswagen", model: "Rabbit GTI", year: 1985, status: "active" },
    { type: "part", vehicle: "1985 VW Rabbit", status: "installed", part_number: "801-101-111", description: "80mm conical bore exhaust headers", notes: "replaced the stock manifolds", price: 289.50 },
    { type: "maintenance", vehicle: "1985 VW Rabbit", date: "1997-06-15", item: "Full engine rebuild", notes: "16v conversion, 80mm headers, forged pistons", is_modification: true, mileage: 87231 },
    { type: "order", vendor: "RockAuto", order_number: "RA-48291", date: "2026-08-01", lines: [
      { vehicle: "1985 VW Rabbit", part_number: "G6157", description: "Engine mounts (pair)", price: 48.99, quantity: 1 },
      { part_number: "T25-201", description: "T2 front lower control arms (pair)", price: 152.00, quantity: 1 },
    ] },
    { type: "fact", vehicle: "1985 VW Rabbit", field: "mileage", value: "87,231 as of rebuild (1997)", date: "1997-06-15", source_detail: "forum post" },
  ],
});

const NOW = new Date('2026-09-01T12:00:00Z');

describe('claims: parse (spec §6 example)', () => {
  const p = parseClaimSet(SPEC_EXAMPLE);
  it('parses cleanly', () => { expect(p.ok).toBe(true); });
  it('normalizes camelCase + snake_case keys', () => {
    if (!p.ok) return;
    expect(p.set!.claims).toHaveLength(5);
    expect(p.set!.claims[1].part_number).toBe('801-101-111');
    expect(p.set!.claims[1].partNumber).toBe('801-101-111');
  });
});

describe('claims: bad input', () => {
  it('rejects non-JSON', () => expect(parseClaimSet('hello').ok).toBe(false));
  it('rejects missing claims', () => expect(parseClaimSet('{"source":"x"}').ok).toBe(false));
  it('flags unknown claim types with index', () => {
    const p = parseClaimSet('{"source":"x","claims":[{"type":"warp"}]}');
    expect(p.ok).toBe(false);
    expect(p.errors[0]).toMatch(/claims\[0\]/);
  });
  it('per-claim errors carry index', () => {
    const p = parseClaimSet('{"source":"x","claims":[{"type":"part","status":"installed"}]}');
    expect(p.ok).toBe(false);
    expect(p.errors.join(' ')).toMatch(/claims\[0\]/);
  });
});

describe('claims: emit events', () => {
  const p = parseClaimSet(SPEC_EXAMPLE)!;
  const state: State = emptyState();

  it('produces events that fold cleanly in strict mode', () => {
    const events = emitClaimSet(p.set!, state, NOW);
    expect(events.length).toBe(5); // 1 vehicle + 1 part + 1 maint + 1 order + 1 fact (vehicle already known → no auto-adds)
    const { issues, state: folded } = foldEvents(events, { strict: true });
    expect(issues.filter(i => i.level === 'error')).toHaveLength(0);
    expect(folded.vehicles.has('1985 VW Rabbit')).toBe(true);
    const part = [...folded.items.values()][0];
    expect(part.description).toBe('80mm conical bore exhaust headers');
    expect(part.partNumber).toBe('801-101-111');
    expect(part.status).toBe('installed');
  });

  it('order lines become parts with pending status + vehicle mapping', () => {
    const events = emitClaimSet(p.set!, state, NOW);
    const order = events.find(e => e.type === 'parts_ordered')!;
    expect(order.items).toHaveLength(2);
    expect(order.items[1].vehicle).toBeUndefined();
  });

  it('auto-adds missing referenced vehicles (a-group ids sort first)', () => {
    const set = {
      source: 'forum', source_kind: 'forum', date_captured: '2026-08-01',
      claims: [{ type: 'maintenance', vehicle: 'Mystery Car', date: '2026-08-01', item: 'tires' }],
    };
    const events = emitClaimSet(set as any, emptyState(), NOW);
    const { state, issues } = foldEvents(events, { strict: true });
    expect(issues.filter(i => i.level === 'error')).toHaveLength(0);
    expect(state.vehicles.has('Mystery Car')).toBe(true);
  });

  it('emits are deterministic for the same input', () => {
    const a = emitClaimSet(p.set!, state, NOW);
    const b = emitClaimSet(p.set!, state, NOW);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
