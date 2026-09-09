import { describe, expect, it } from 'vitest';
import { foldEvents } from '../src/core/state';
import { GEvent, Provenance } from '../src/core/types';

const P1: Provenance = { tier: 1, kind: 'manual' };
const P2: Provenance = { tier: 2, kind: 'service_record', ref: 'receipt.pdf' };
const P4: Provenance = { tier: 4, kind: 'llm' };

function ev(e: Partial<GEvent> & { type: string; id: string }): GEvent {
  return { v: 1, ts: e.ts ?? '2026-09-01T12:00:00Z', provenance: P1, ...(e as any) } as GEvent;
}

describe('fold: vehicles', () => {
  it('creates vehicles with facts', () => {
    const { state, issues } = foldEvents([
      ev({ id: '20260901-a-veh-add-w124', type: 'vehicle_added', vehicle: 'W124', year: 1984, make: 'Mercedes-Benz', model: '300 SD Turbo', status: 'Project' }),
      ev({ id: '20260901-b-fact-w124-mileage', type: 'vehicle_fact_claimed', vehicle: 'W124', field: 'mileage', value: '143,000', date: '1997-06-01', provenance: P2 }),
    ]);
    const v = state.vehicles.get('W124')!;
    expect(v.year?.value).toBe(1984);
    expect(v.mileage?.value).toBe(143000);
    expect(v.mileage?.confidence).toBe('high');
    expect(issues.filter(i => i.level === 'error')).toHaveLength(0);
  });

  it('auto-creates stub vehicle leniently (warn), errors strict', () => {
    const events = [ev({ id: '20260901-b-maint', type: 'maintenance_logged', vehicle: 'Rabbit', date: '2026-08-01', item: 'Brake pads replaced' })];
    const lenient = foldEvents(events);
    expect(lenient.state.vehicles.has('Rabbit')).toBe(true);
    expect(lenient.issues.some(i => i.level === 'warn' && i.message.includes('stub'))).toBe(true);
    const strict = foldEvents(events, { strict: true });
    expect(strict.issues.some(i => i.level === 'error' && i.message.includes('no vehicle_added'))).toBe(true);
  });

  it('miles from free-text parse (143,000 / 143k / "143000 mi")', () => {
    for (const [input, want] of [['143,000', 143000], ['143k', 143000], ['143000 mi', 143000], [87231.5, 87231.5], ['87,231 as of rebuild (1997)', 87231]] as const) {
      const { state } = foldEvents([
        ev({ id: '20260901-a-veh-x', type: 'vehicle_added', vehicle: 'X' }),
        ev({ id: `20260901-b-f-x-${String(input).replace(/[^a-z0-9]/gi, '')}`, type: 'vehicle_fact_claimed', vehicle: 'X', field: 'mileage', value: input }),
      ]);
      expect(state.vehicles.get('X')!.mileage?.value).toBe(want);
    }
  });
});

describe('fold: parts lifecycle', () => {
  it('assigns sequential ids from orders and tracks installed→removed', () => {
    const { state, issues } = foldEvents([
      ev({ id: '20260901-a-veh-add-rabbit', type: 'vehicle_added', vehicle: 'Rabbit', status: 'Active' }),
      ev({ id: '20260901-b-order-1', type: 'parts_ordered', vendor: 'RockAuto', orderNumber: 'RA-991', date: '2026-08-01', items: [
        { description: 'Front brake pads (ceramic)', partNumber: 'BP-1234', quantity: 2 },
        { description: 'Brake rotor pair', partNumber: 'BR-456', quantity: 1 },
      ] }),
      ev({ id: '20260902-b-delivered', type: 'order_delivered', orderNumber: 'RA-991', date: '2026-08-05' }),
      ev({ id: '20260903-b-inst', type: 'part_installed', partId: 'PART-00001', vehicle: 'Rabbit', date: '2026-08-10' }),
      ev({ id: '20260904-b-removed', type: 'part_removed', partId: 'PART-00002', reason: 'superseded' }),
    ]);
    expect(issues.filter(i => i.level === 'error')).toHaveLength(0);
    const p1 = state.items.get('PART-00001')!;
    expect(p1.description).toBe('Front brake pads (ceramic)');
    expect(p1.status).toBe('installed');
    expect(p1.vehicle).toBe('Rabbit');
    expect(p1.received).toBe('2026-08-05');
    const p2 = state.items.get('PART-00002')!;
    expect(p2.status).toBe('in_inventory');
    expect(p2.vendor).toBe('RockAuto');
  });

  it('part_added with explicit id + installed status seeds history', () => {
    const { state } = foldEvents([
      ev({ id: '20260901-a-veh-add-a', type: 'vehicle_added', vehicle: 'A' }),
      ev({ id: '20260901-b-part-p7', type: 'part_added', partId: 'PART-00007', description: 'Exhaust manifold', status: 'installed', vehicle: 'A', date: '2026-07-01' }),
    ]);
    const it = state.items.get('PART-00007')!;
    expect(it.status).toBe('installed');
    expect(it.history).toHaveLength(1);
    expect(it.history[0].installed).toBe('2026-07-01');
  });

  it('reassign moves installed part between vehicles', () => {
    const { state } = foldEvents([
      ev({ id: '20260901-a-veh-add-a', type: 'vehicle_added', vehicle: 'A' }),
      ev({ id: '20260901-a-veh-add-b', type: 'vehicle_added', vehicle: 'B' }),
      ev({ id: '20260902-b-part', type: 'part_added', partId: 'PART-00001', description: 'Alternator', status: 'installed', vehicle: 'A' }),
      ev({ id: '20260903-b-re', type: 'part_reassigned', partId: 'PART-00001', toVehicle: 'B', date: '2026-09-01' }),
    ]);
    const it = state.items.get('PART-00001')!;
    expect(it.vehicle).toBe('B');
    expect(it.history).toHaveLength(2);
    expect(it.history[0].removed).toBe('2026-09-01');
  });
});

describe('fold: projects & wishlist', () => {
  it('tracks project status and parts', () => {
    const { state } = foldEvents([
      ev({ id: '20260901-a-veh-add-w124', type: 'vehicle_added', vehicle: 'W124' }),
      ev({ id: '20260901-b-proj', type: 'project_added', name: 'W124 restoration', vehicle: 'W124', parts: ['PART-00001'] }),
      ev({ id: '20260902-b-proj-st', type: 'project_status_changed', project: 'W124 restoration', status: 'In progress' }),
    ]);
    const p = state.projects.get('W124 restoration')!;
    expect(p.status).toBe('In progress');
    expect(p.parts).toContain('PART-00001');
  });

  it('assigns wishlist ids sequentially', () => {
    const { state } = foldEvents([
      ev({ id: '20260901-a-veh-add-r', type: 'vehicle_added', vehicle: 'R' }),
      ev({ id: '20260901-b-w1', type: 'wishlist_added', vehicle: 'R', item: 'Fuel gauge', targetPrice: 150, watch: 'ebay' }),
      ev({ id: '20260901-b-w2', type: 'wishlist_added', vehicle: 'R', item: 'Oval gauge bezels' }),
    ]);
    expect(state.wishlist.map(w => w.id)).toEqual(['WL-0001', 'WL-0002']);
    expect(state.wishlist[0].targetPrice).toBe(150);
  });
});

describe('fold: determinism', () => {
  it('same events in any order → same state', () => {
    const mk = (): GEvent[] => [
      ev({ id: '20260901-b-w1', type: 'wishlist_added', vehicle: 'R', item: 'x' }),
      ev({ id: '20260901-b-m', type: 'maintenance_logged', vehicle: 'R', date: '2026-08-01', item: 'oil' }),
      ev({ id: '20260901-a-veh-add-r', type: 'vehicle_added', vehicle: 'R' }),
    ];
    const a = JSON.stringify(foldEvents(mk()).state.items.size);
    const b = JSON.stringify(foldEvents(mk().reverse()).state.items.size);
    expect(a).toBe(b);
  });
});
