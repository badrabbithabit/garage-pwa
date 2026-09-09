// Renders State → garage.md. The ONLY writer of garage.md (spec §1 format).
import { GEvent, Item, State, Vehicle } from './types';

const money = (n?: number) => (n === undefined ? undefined : `$${n.toFixed(2)}`);
const comma = (n: number) => n.toLocaleString('en-US');

function confSuffix(fact: { confidence: string; ts: string }): string {
  if (fact.confidence === 'high') return '';
  const day = fact.ts.slice(0, 10);
  return ` (confidence: ${fact.confidence}, last verified: ${day})`;
}

function mileageLine(v: Vehicle): string | null {
  if (!v.mileage) return null;
  const m = v.mileage.value as number;
  const tilde = v.mileage.confidence === 'high' ? '' : '~';
  return `- Mileage: ${tilde}${comma(m)}${confSuffix(v.mileage)}`;
}

function vinMasked(vin: string): string {
  return vin.length <= 4 ? vin : `...${vin.slice(-4)}`;
}

function renderVehicle(v: Vehicle): string {
  const out: string[] = [`### ${v.id}`];
  out.push(`- Status: ${v.status || 'Active'}`);
  if (v.year || v.make || v.model) {
    out.push(`- Year: ${v.year?.value ?? '?'}`);
    out.push(`- Make/Model: ${[v.make?.value, v.model?.value].filter(Boolean).join(' ') || '?'}`);
  }
  if (v.vin) out.push(`- VIN: ${vinMasked(String(v.vin.value))}${confSuffix(v.vin)}`);
  const ml = mileageLine(v);
  if (ml) out.push(ml);
  const reg: string[] = [];
  if (v.regState) reg.push(String(v.regState.value));
  if (v.regExpires) reg.push(`expires ${v.regExpires.value}`);
  if (v.smogRequired) {
    reg.push('smog required');
    if (v.lastSmog) reg.push(`last smog ${v.lastSmog.value}`);
  }
  if (reg.length) out.push(`- Registration: ${reg.join(', ')}`);
  if (v.notes) out.push(`- Notes: ${v.notes.value}`);
  for (const [k, f] of Object.entries(v.extra)) out.push(`- ${k}: ${String(f.value)}`);
  return out.join('\n');
}

function renderItem(it: Item): string {
  const out: string[] = [`### ${it.id} — ${it.description}`];
  if (it.partNumber) out.push(`- Part #: ${it.partNumber}`);
  if (it.manufacturer) out.push(`- Manufacturer: ${it.manufacturer}`);
  out.push(`- Quantity: ${it.quantity}`);
  out.push(`- Status: ${it.status === 'in_inventory' ? 'In inventory' : it.status === 'ordered' ? 'Ordered' : it.status === 'installed' ? 'Installed' : 'Retired'}`);
  if (it.vehicle) out.push(`- Vehicle: ${it.vehicle}`);
  if (it.history.length) {
    out.push('- Install history:');
    for (const h of it.history) out.push(`  - ${h.vehicle} — installed: ${h.installed ?? '—'} — removed: ${h.removed ?? '—'}`);
  }
  if (it.vendor) out.push(`- Vendor: ${it.vendor}`);
  if (it.orderNumber) out.push(`- Order #: ${it.orderNumber}`);
  if (it.ordered) out.push(`- Ordered: ${it.ordered}`);
  if (it.received) out.push(`- Received: ${it.received}`);
  if (it.status === 'installed') {
    const last = it.history[it.history.length - 1];
    if (last?.installed) out.push(`- Installed: ${last.installed}`);
  }
  if (it.price !== undefined) out.push(`- Price: ${money(it.price)}`);
  if (it.retiredReason) out.push(`- Retired: ${it.retiredDate ?? '—'} (${it.retiredReason})`);
  if (it.notes) out.push(`- Notes: ${it.notes}`);
  return out.join('\n');
}

export function renderGarageMd(state: State): string {
  const sections: string[] = [];
  const vehicles = [...state.vehicles.values()].sort(
    (a, b) => (a.addedTs < b.addedTs ? -1 : a.addedTs > b.addedTs ? 1 : 0),
  ); // stable: insertion (fold) order breaks addedTs ties
  const items = [...state.items.values()].sort((a, b) => a.id.localeCompare(b.id));
  const projects = [...state.projects.values()].sort((a, b) => a.name.localeCompare(b.name));
  const now = new Date();
  const ts = `${now.toISOString().slice(0, 10)} ${now.toTimeString().slice(0, 5)}`;

  sections.push(`# Garage\n`);
  sections.push(`_Generated ${ts} — do not hand-edit. Data lives in events/._\n`);

  if (vehicles.length) {
    sections.push(`## Vehicles\n`);
    for (const v of vehicles) sections.push(`${renderVehicle(v)}\n`);
  }
  if (items.length) {
    sections.push(`---\n## Inventory\n`);
    for (const it of items) sections.push(`${renderItem(it)}\n`);
  }
  if (projects.length) {
    sections.push(`---\n## Projects\n`);
    for (const p of projects) {
      const out = [`### ${p.name}`];
      if (p.vehicle) out.push(`- Vehicle: ${p.vehicle}`);
      out.push(`- Status: ${p.status}`);
      if (p.parts.length) out.push(`- Parts: ${p.parts.join(', ')}`);
      if (p.notes) out.push(`- Notes: ${p.notes}`);
      sections.push(`${out.join('\n')}\n`);
    }
  }
  {
    const byVehicle = new Map<string, { date: string; item: string; mileage?: number; notes?: string; mod?: boolean }[]>();
    for (const e of state.maintenance) {
      const arr = byVehicle.get(e.vehicle) ?? [];
      arr.push({ date: e.date, item: e.item, mileage: e.mileage, notes: e.notes, mod: e.modification });
      byVehicle.set(e.vehicle, arr);
    }
    if (byVehicle.size) {
      sections.push(`---\n## Maintenance\n`);
      for (const [veh, entries] of [...byVehicle.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        sections.push(`### ${veh}`);
        for (const e of entries.sort((a, b) => a.date.localeCompare(b.date))) {
          const bits = [`${e.date} — ${e.mod ? 'MOD: ' : ''}${e.item}`];
          if (e.mileage !== undefined) bits.push(`${comma(e.mileage)} mi`);
          if (e.notes) bits.push(e.notes);
          sections.push(`- ${bits.join(', ')}`);
        }
        sections.push('');
      }
    }
  }
  {
    const byVehicle = new Map<string, { item: string; intervalMiles?: number; intervalMonths?: number; lastDate?: string; lastMileage?: number }[]>();
    for (const r of state.recurring.values()) {
      const arr = byVehicle.get(r.vehicle) ?? [];
      arr.push(r);
      byVehicle.set(r.vehicle, arr);
    }
    if (byVehicle.size) {
      sections.push(`---\n## Recurring Maintenance\n`);
      for (const [veh, recs] of [...byVehicle.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        sections.push(`### ${veh}`);
        for (const r of recs.sort((a, b) => a.item.localeCompare(b.item))) {
          const interval = [
            r.intervalMiles ? `${comma(r.intervalMiles)} mi` : null,
            r.intervalMonths ? `${r.intervalMonths} months` : null,
          ].filter(Boolean).join(' / ');
          const last = r.lastDate ? `last: ${r.lastDate}${r.lastMileage !== undefined ? ` (${comma(r.lastMileage)} mi)` : ''}` : 'last: —';
          sections.push(`- ${r.item} — interval: ${interval || '—'} — ${last}`);
        }
        sections.push('');
      }
    }
  }
  {
    const byVehicle = new Map<string, { item: string; targetPrice?: number; watch?: string }[]>();
    for (const w of state.wishlist) {
      const arr = byVehicle.get(w.vehicle) ?? [];
      arr.push(w);
      byVehicle.set(w.vehicle, arr);
    }
    if (byVehicle.size) {
      sections.push(`---\n## Wishlist\n`);
      for (const [veh, ws] of [...byVehicle.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        sections.push(`### ${veh}`);
        for (const w of ws) {
          const bits = [`- ${w.item}`];
          if (w.targetPrice !== undefined) bits.push(`target: ${money(w.targetPrice)}`);
          if (w.watch) bits.push(`watch: ${w.watch}`);
          sections.push(bits.join(' — '));
        }
        sections.push('');
      }
    }
  }

  return sections.join('\n');
}

/** Deterministic render (no timestamp) for tests. */
export function renderGarageMdDeterministic(state: State): string {
  return renderGarageMd(state).replace(/^_Generated .*?_\n?/m, '');
}
