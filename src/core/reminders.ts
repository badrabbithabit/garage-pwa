// Attention engine: registrations, smog, recurring maintenance (4/2/1-week escalation + overdue).
// Pure function: State + now + settings → sorted attention list. Snoozes come from state
// (reminder_snoozed events), so they are device-independent and audited.
import { AttentionItem, State } from './types';
import { recurringKey } from './state';

export interface ReminderSettings {
  /** estimated miles driven per month, per vehicle (for mileage-based estimates) */
  accrualMiPerMonth?: Record<string, number>;
  /** fallback accrual when unknown */
  defaultAccrualMiPerMonth?: number;
}

const DAY = 86400000;

function monthsForward(date: string, months: number): string {
  const d = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}

function levelForDays(days: number): 0 | 1 | 2 | 3 {
  if (days < 0) return 3;
  if (days <= 7) return 2;
  if (days <= 14) return 1;
  if (days <= 28) return 0;
  return -1 as unknown as 0; // not yet in the window
}

export function bestMileage(state: State, vehicle: string): number | undefined {
  const v = state.vehicles.get(vehicle);
  if (v?.mileage) return v.mileage.value as number;
  let latest: { date: string; mi: number } | undefined;
  for (const e of state.maintenance) {
    if (e.vehicle === vehicle && e.mileage !== undefined) {
      if (!latest || e.date > latest.date) latest = { date: e.date, mi: e.mileage };
    }
  }
  return latest?.mi;
}

/** Estimated miles/month for a vehicle from its maintenance history, else fallback. */
export function accrualRate(state: State, vehicle: string, settings: ReminderSettings = {}): number {
  if (settings.accrualMiPerMonth?.[vehicle]) return settings.accrualMiPerMonth[vehicle]!;
  const pts: { date: string; mi: number }[] = [];
  for (const e of state.maintenance) {
    if (e.vehicle === vehicle && e.mileage !== undefined) pts.push({ date: e.date, mi: e.mileage });
  }
  pts.sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length >= 2) {
    const a = pts[0], b = pts[pts.length - 1];
    const days = Math.max(1, (Date.parse(b.date) - Date.parse(a.date)) / DAY);
    const perMonth = ((b.mi - a.mi) / days) * 30.44;
    if (perMonth > 0) return perMonth;
  }
  return settings.defaultAccrualMiPerMonth ?? 25;
}

export interface AttentionResult {
  items: AttentionItem[];
  skipped: { key: string; reason: string }[];
}

export function computeAttention(state: State, now = new Date(), settings: ReminderSettings = {}): AttentionResult {
  const items: AttentionItem[] = [];
  const skipped: { key: string; reason: string }[] = [];
  const today = new Date(now); today.setUTCHours(0, 0, 0, 0);

  const consider = (it: Omit<AttentionItem, 'level'> & { level?: number }) => {
    const snoozedUntil = state.snoozes.get(it.key);
    if (snoozedUntil && new Date(snoozedUntil) > now) {
      items.push({ ...it, level: it.level as 0 | 1 | 2 | 3, snoozedUntil });
      return;
    }
    if (it.level === undefined || (it.level as number) < 0) {
      skipped.push({ key: it.key, reason: 'outside 4-week window' });
      return;
    }
    items.push({ ...it, level: it.level as 0 | 1 | 2 | 3, snoozedUntil });
  };

  for (const v of state.vehicles.values()) {
    if (v.status === 'Sold' || v.status === 'Storage') continue;
    // Registration
    if (v.regExpires) {
      const due = new Date(`${String(v.regExpires.value).slice(0, 10)}T00:00:00Z`);
      const days = Math.ceil((due.getTime() - today.getTime()) / DAY);
      consider({
        key: `reg:${v.id}`, vehicle: v.id, kind: 'registration',
        label: `Registration${v.regState ? ` (${v.regState.value})` : ''} expires ${v.regExpires.value}`,
        due: due.toISOString(), days, level: levelForDays(days),
      });
    }
    // Smog
    if (v.smogRequired) {
      if (v.lastSmog) {
        const dueIso = monthsForward(String(v.lastSmog.value), 12);
        const days = Math.ceil((new Date(dueIso).getTime() - today.getTime()) / DAY);
        consider({
          key: `smog:${v.id}`, vehicle: v.id, kind: 'smog',
          label: `Smog due (last: ${v.lastSmog.value})`,
          due: dueIso, days, level: levelForDays(days),
        });
      } else {
        consider({
          key: `smog:${v.id}`, vehicle: v.id, kind: 'smog',
          label: 'Smog required — no last-smog date on file',
          due: now.toISOString(), days: 0, level: 2,
        });
      }
    }
  }

  // Recurring maintenance
  for (const r of state.recurring.values()) {
    const key = `maint:${recurringKey(r.vehicle, r.item)}`;
    if (r.intervalMonths && r.lastDate) {
      const dueIso = monthsForward(r.lastDate, r.intervalMonths);
      const days = Math.ceil((new Date(dueIso).getTime() - today.getTime()) / DAY);
      consider({
        key, vehicle: r.vehicle, kind: 'maintenance',
        label: `${r.item} due (last: ${r.lastDate})`,
        due: dueIso, days, level: levelForDays(days),
      });
    } else if (r.intervalMiles) {
      let lastMi = r.lastMileage;
      if (lastMi === undefined) {
        // derive from maintenance history for this vehicle+item (order-independent)
        let latest: { date: string; mi: number } | undefined;
        for (const e of state.maintenance) {
          if (e.vehicle === r.vehicle && e.item === r.item && e.mileage !== undefined) {
            if (!latest || e.date > latest.date) latest = { date: e.date, mi: e.mileage };
          }
        }
        lastMi = latest?.mi;
      }
      const current = bestMileage(state, r.vehicle);
      if (lastMi === undefined || current === undefined) {
        skipped.push({ key, reason: 'mileage-based interval but no mileage on file (add a maintenance log with mileage)' });
        continue;
      }
      const dueMi = lastMi + r.intervalMiles;
      if (current >= dueMi) {
        consider({ key, vehicle: r.vehicle, kind: 'maintenance', label: `${r.item} due (~${current.toLocaleString()} mi, interval ${r.intervalMiles.toLocaleString()} mi)`, due: now.toISOString(), days: 0, level: 3 });
      } else {
        const perDay = Math.max(1, accrualRate(state, r.vehicle, settings) / 30.44);
        const days = Math.ceil((dueMi - current) / perDay);
        consider({ key, vehicle: r.vehicle, kind: 'maintenance', label: `${r.item} est. in ~${days}d (at ${Math.round(perDay * 30.44)} mi/mo)`, due: new Date(now.getTime() + days * DAY).toISOString(), days, level: levelForDays(days) });
      }
    } else {
      skipped.push({ key, reason: 'no interval set' });
    }
  }

  const order = { 3: 0, 2: 1, 1: 2, 0: 3 } as const;
  items.sort((a, b) => (order[a.level] - order[b.level]) || a.days - b.days);
  return { items, skipped };
}
