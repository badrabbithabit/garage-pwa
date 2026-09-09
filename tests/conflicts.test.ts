import { describe, expect, it } from 'vitest';
import { foldEvents } from '../src/core/state';
import { GEvent, Provenance } from '../src/core/types';

const mk = (id: string, field: string, value: unknown, tier: number, kind: string, date: string): GEvent => ({
  v: 1, id, ts: `${date}T12:00:00Z`, type: 'vehicle_fact_claimed', vehicle: 'X', field, value,
  date, provenance: { tier: tier as 1 | 2 | 3 | 4, kind } as Provenance,
} as GEvent);

describe('conflicts (spec §5)', () => {
  it('higher tier (smaller number) wins regardless of age', () => {
    const { state } = foldEvents([
      mk('20260101-b-f-1', 'mileage', '143,000', 4, 'listing', '2026-01-01'),
      mk('20260601-b-f-2', 'mileage', 87231, 2, 'service_record', '2026-06-01'),
    ]);
    const m = state.vehicles.get('X')!.mileage!;
    expect(m.value).toBe(87231);
    expect(m.kind).toBe('service_record');
    expect(m.confidence).toBe('high');
  });

  it('same tier → later date wins', () => {
    const { state } = foldEvents([
      mk('20260101-b-f-1', 'mileage', '90,000', 2, 'service_record', '2026-01-01'),
      mk('20260501-b-f-2', 'mileage', '92,000', 2, 'service_record', '2026-05-01'),
    ]);
    expect(state.vehicles.get('X')!.mileage!.value).toBe(92000);
  });

  it('lower tier later claim does NOT overwrite higher tier', () => {
    const { state } = foldEvents([
      mk('20260101-b-f-1', 'mileage', 87231, 1, 'manual', '2026-01-01'),
      mk('20260901-b-f-2', 'mileage', '99,000', 4, 'llm', '2026-09-01'),
    ]);
    expect(state.vehicles.get('X')!.mileage!.value).toBe(87231);
  });

  it('tier 4 fact renders with medium confidence and ~ in garage.md', async () => {
    const { state } = foldEvents([
      mk('20260101-b-f-1', 'mileage', '143,000', 4, 'listing', '2026-01-01'),
    ]);
    const { renderGarageMd } = await import('../src/core/render');
    const md = renderGarageMd(state);
    expect(md).toContain('~143,000 (confidence: medium, last verified: 2026-01-01)');
  });

  it('unmappable fact goes to extra, never dropped', () => {
    const { state } = foldEvents([
      mk('20260101-b-f-1', 'paint', 'Sapphire Blue Metallic', 3, 'vin_report', '2026-01-01'),
    ]);
    expect(state.vehicles.get('X')!.extra['paint']?.value).toBe('Sapphire Blue Metallic');
  });
});
