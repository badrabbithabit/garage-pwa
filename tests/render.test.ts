import { describe, expect, it } from 'vitest';
import { foldEvents } from '../src/core/state';
import { renderGarageMd, renderGarageMdDeterministic } from '../src/core/render';
import { GEvent, Provenance } from '../src/core/types';

const P: Provenance = { tier: 1, kind: 'manual' };
const ev = (e: any): GEvent => ({ v: 1, ts: e.ts ?? '2026-09-01T12:00:00Z', provenance: P, ...e });

function seed() {
  return [
    ev({ id: '20260901-a-veh-add-w124', type: 'vehicle_added', vehicle: 'W124', year: 1984, make: 'Mercedes-Benz', model: '300 SD Turbo', status: 'Project', vin: '1234567890ABCDEF1234', ts: '2026-08-15T12:00:00Z' }),
    ev({ id: '20260901-b-f-mi', type: 'vehicle_fact_claimed', vehicle: 'W124', field: 'mileage', value: 87231, date: '2026-06-01', provenance: { tier: 2, kind: 'service_record' } }),
    ev({ id: '20260901-b-f-reg', type: 'vehicle_fact_claimed', vehicle: 'W124', field: 'registration', value: 'CA' }),
    ev({ id: '20260901-b-f-regexp', type: 'vehicle_fact_claimed', vehicle: 'W124', field: 'registration_expires', value: '2026-10-15' }),
    ev({ id: '20260901-b-f-smogreq', type: 'vehicle_fact_claimed', vehicle: 'W124', field: 'smog', value: 'yes' }),
    ev({ id: '20260901-b-f-smog', type: 'vehicle_fact_claimed', vehicle: 'W124', field: 'smog_date', value: '2025-11-01' }),
    ev({ id: '20260901-a-veh-add-rabbit', type: 'vehicle_added', vehicle: 'Rabbit', year: 1985, make: 'Volkswagen', model: 'Rabbit GTI', status: 'Active' }),
    ev({ id: '20260901-b-order-1', type: 'parts_ordered', vendor: 'RockAuto', orderNumber: 'RA-991', date: '2026-08-01', items: [
      { description: 'Front brake pads (ceramic)', partNumber: 'BP-1234', quantity: 2, price: 89.99 },
    ] }),
    ev({ id: '20260902-b-del', type: 'order_delivered', orderNumber: 'RA-991', date: '2026-08-05' }),
    ev({ id: '20260903-b-inst', type: 'part_installed', partId: 'PART-00001', vehicle: 'Rabbit', date: '2026-08-10' }),
    ev({ id: '20260901-b-proj', type: 'project_added', name: 'W124 restoration', vehicle: 'W124', parts: ['PART-00001'], notes: 'Engine bay + brakes' }),
    ev({ id: '20260901-b-maint1', type: 'maintenance_logged', vehicle: 'Rabbit', date: '2026-08-01', mileage: 91200, item: 'Brake pads replaced (front)', notes: 'ceramic' }),
    ev({ id: '20260901-b-maint2', type: 'maintenance_logged', vehicle: 'Rabbit', date: '2026-07-15', item: 'Engine oil 5W-30 + filter', isModification: false }),
    ev({ id: '20260901-b-rec', type: 'recurring_set', vehicle: 'Rabbit', item: 'Engine oil', intervalMiles: 5000, intervalMonths: 6, notes: 'synthetic' }),
    ev({ id: '20260901-b-wish', type: 'wishlist_added', vehicle: 'Rabbit', item: 'Fuel gauge', targetPrice: 150, watch: 'ebay' }),
  ];
}

describe('garage.md format (spec §1)', () => {
  const { state } = foldEvents(seed());
  const md = renderGarageMd(state);

  it('has the spec sections in order', () => {
    const i = (s: string) => md.indexOf(s);
    expect(i('# Garage')).toBe(0);
    expect(i('## Vehicles')).toBeGreaterThan(0);
    expect(i('## Inventory')).toBeGreaterThan(i('## Vehicles'));
    expect(i('## Projects')).toBeGreaterThan(i('## Inventory'));
    expect(i('## Maintenance')).toBeGreaterThan(i('## Projects'));
    expect(i('## Recurring Maintenance')).toBeGreaterThan(i('## Maintenance'));
    expect(i('## Wishlist')).toBeGreaterThan(i('## Recurring Maintenance'));
  });

  it('renders vehicle block per spec sample (high confidence, no ~)', () => {
    const block = md.slice(md.indexOf('### W124'), md.indexOf('### Rabbit'));
    expect(block).toContain('- Status: Project');
    expect(block).toContain('- Year: 1984');
    expect(block).toContain('- Make/Model: Mercedes-Benz 300 SD Turbo');
    expect(block).toContain('- VIN: ...1234');
    expect(block).toContain('- Mileage: 87,231');
    expect(block).not.toContain('~');
    expect(block).toContain('- Registration: CA, expires 2026-10-15, smog required, last smog 2025-11-01');
  });

  it('masks VIN to last 4', () => {
    expect(md).not.toContain('1234567890ABCDEF1234');
    expect(md).toContain('...1234');
  });

  it('renders inventory per spec sample', () => {
    const block = md.slice(md.indexOf('### PART-00001'), md.indexOf('## Projects'));
    expect(block).toContain('### PART-00001 — Front brake pads (ceramic)');
    expect(block).toContain('- Part #: BP-1234');
    expect(block).toContain('- Quantity: 2');
    expect(block).toContain('- Status: Installed');
    expect(block).toContain('- Vehicle: Rabbit');
    expect(block).toContain('- Vendor: RockAuto');
    expect(block).toContain('- Order #: RA-991');
    expect(block).toContain('- Ordered: 2026-08-01');
    expect(block).toContain('- Received: 2026-08-05');
    expect(block).toContain('- Installed: 2026-08-10');
    expect(block).toContain('- Price: $89.99');
    expect(block).toContain('- Rabbit — installed: 2026-08-10 — removed: —');
  });

  it('renders maintenance sorted by date under vehicle', () => {
    const block = md.slice(md.indexOf('### Rabbit', md.indexOf('## Maintenance')));
    const oil = block.indexOf('2026-07-15 — Engine oil 5W-30 + filter');
    const brakes = block.indexOf('2026-08-01 — Brake pads replaced (front), 91,200 mi, ceramic');
    expect(oil).toBeGreaterThan(-1);
    expect(brakes).toBeGreaterThan(oil);
  });

  it('renders recurring and wishlist', () => {
    expect(md).toContain('- Engine oil — interval: 5,000 mi / 6 months — last: —');
    expect(md).toContain('- Fuel gauge — target: $150.00 — watch: ebay');
  });

  it('deterministic render (minus timestamp) is stable', () => {
    expect(renderGarageMdDeterministic(state)).toBe(renderGarageMdDeterministic(foldEvents(seed()).state));
  });
});
