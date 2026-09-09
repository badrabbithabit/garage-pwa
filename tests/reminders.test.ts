import { describe, expect, it } from 'vitest';
import { foldEvents } from '../src/core/state';
import { computeAttention } from '../src/core/reminders';
import { GEvent, Provenance } from '../src/core/types';

const P: Provenance = { tier: 1, kind: 'manual' };
const NOW = new Date('2026-09-09T12:00:00Z');
const ev = (e: any): GEvent => ({ v: 1, ts: '2026-09-01T12:00:00Z', provenance: P, ...e });

function levelFor(key: string, items: ReturnType<typeof computeAttention>['items']) {
  return items.find(i => i.key === key)?.level;
}

describe('reminders: 4/2/1-week escalation', () => {
  const base = [ev({ id: '20260901-a-veh-add-x', type: 'vehicle_added', vehicle: 'X' })];
  const withReg = (daysOut: number) => {
    const due = new Date(NOW.getTime() + daysOut * 86400000).toISOString().slice(0, 10);
    return [...base,
      ev({ id: '20260901-b-f-reg', type: 'vehicle_fact_claimed', vehicle: 'X', field: 'registration_expires', value: due })];
  };
  const run = (days: number) => computeAttention(foldEvents(withReg(days)).state, NOW).items;

  it('30 days out → outside window', () => expect(levelFor('reg:X', run(30))).toBeUndefined());
  it('20 days out → level 0 (4 weeks)', () => expect(levelFor('reg:X', run(20))).toBe(0));
  it('10 days out → level 1 (2 weeks)', () => expect(levelFor('reg:X', run(10))).toBe(1));
  it('5 days out → level 2 (1 week)', () => expect(levelFor('reg:X', run(5))).toBe(2));
  it('overdue → level 3', () => expect(levelFor('reg:X', run(-3))).toBe(3));
});

describe('reminders: smog', () => {
  it('overdue smog (last 2025-09-01 → due 2026-09-01, today 2026-09-09) → level 3', () => {
    const { state } = foldEvents([
      ev({ id: '20260901-a-veh-add-x', type: 'vehicle_added', vehicle: 'X' }),
      ev({ id: '20260901-b-f-req', type: 'vehicle_fact_claimed', vehicle: 'X', field: 'smog', value: 'yes' }),
      ev({ id: '20260901-b-f-date', type: 'vehicle_fact_claimed', vehicle: 'X', field: 'smog_date', value: '2025-09-01' }),
    ]);
    const items = computeAttention(state, NOW).items;
    const smog = items.find(i => i.key === 'smog:X')!;
    expect(smog.level).toBe(3);
    expect(smog.label).toContain('last: 2025-09-01');
  });

  it('smog required but no date on file → level 2 "unknown"', () => {
    const { state } = foldEvents([
      ev({ id: '20260901-a-veh-add-x', type: 'vehicle_added', vehicle: 'X' }),
      ev({ id: '20260901-b-f-req', type: 'vehicle_fact_claimed', vehicle: 'X', field: 'smog', value: 'yes' }),
    ]);
    const smog = computeAttention(state, NOW).items.find(i => i.key === 'smog:X')!;
    expect(smog.level).toBe(2);
  });
});

describe('reminders: mileage-based maintenance', () => {
  it('estimates days from accrual rate (in window)', () => {
    const { state } = foldEvents([
      ev({ id: '20260901-a-veh-add-x', type: 'vehicle_added', vehicle: 'X' }),
      ev({ id: '20260901-b-mi1', type: 'maintenance_logged', vehicle: 'X', date: '2026-05-01', mileage: 90000, item: 'Engine oil' }),
      ev({ id: '20260901-b-mi2', type: 'maintenance_logged', vehicle: 'X', date: '2026-06-15', mileage: 93000, item: 'other' }),
      ev({ id: '20260901-b-f-mi', type: 'vehicle_fact_claimed', vehicle: 'X', field: 'mileage', value: 94700, date: '2026-08-01' }),
      ev({ id: '20260901-b-rec', type: 'recurring_set', vehicle: 'X', item: 'Engine oil', intervalMiles: 5000 }),
    ]);
    const items = computeAttention(state, NOW).items;
    const m = items.find(i => i.key === 'maint:X|engine oil')!;
    // lastMi 90,000 → due 95,000; current 94,700 → 300 mi; accrual ≈ 2,000 mi/mo ≈ 66 mi/day → ~5d
    expect(m.label).toMatch(/est\. in ~\d+d/);
    expect(m.days).toBeGreaterThanOrEqual(3);
    expect(m.days).toBeLessThanOrEqual(8);
  });

  it('flags overdue when current mileage >= due', () => {
    const { state } = foldEvents([
      ev({ id: '20260901-a-veh-add-x', type: 'vehicle_added', vehicle: 'X' }),
      ev({ id: '20260901-b-mi1', type: 'maintenance_logged', vehicle: 'X', date: '2026-05-01', mileage: 90000, item: 'Engine oil' }),
      ev({ id: '20260901-b-f-mi', type: 'vehicle_fact_claimed', vehicle: 'X', field: 'mileage', value: 96200 }),
      ev({ id: '20260901-b-rec', type: 'recurring_set', vehicle: 'X', item: 'Engine oil', intervalMiles: 5000 }),
    ]);
    const m = computeAttention(state, NOW).items.find(i => i.key === 'maint:X|engine oil')!;
    expect(m.level).toBe(3);
    expect(m.label).toContain('due');
  });
});

describe('reminders: snoozes (audited, device-independent)', () => {
  it('snoozed items are reported as snoozed, not actionable', () => {
    const { state } = foldEvents([
      ev({ id: '20260901-a-veh-add-x', type: 'vehicle_added', vehicle: 'X' }),
      ev({ id: '20260901-b-f-reg', type: 'vehicle_fact_claimed', vehicle: 'X', field: 'registration_expires', value: '2026-09-15' }),
      ev({ id: '20260901-b-snooze', type: 'reminder_snoozed', key: 'reg:X', until: '2026-10-01T00:00:00Z' }),
    ]);
    const items = computeAttention(state, NOW).items;
    const reg = items.find(i => i.key === 'reg:X')!;
    expect(reg.snoozedUntil).toBe('2026-10-01T00:00:00Z');
  });
});
