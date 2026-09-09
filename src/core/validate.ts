// Repo validator: the single source of truth for "is this garage repo healthy?"
// Runs in the Paseo agent (node, before commit) and in the PWA (browser, on pull).
import { eventSchema } from './schema';
import { foldEvents } from './state';
import { renderGarageMdDeterministic } from './render';
import { parseClaimSet } from './claims';
import { GEvent } from './types';

export interface RepoFile {
  path: string;
  content: string;
}

export interface Report {
  ok: boolean;
  errors: string[];
  warnings: string[];
  eventCount: number;
  pendingClaims: number;
}

export function validateRepo(files: RepoFile[]): Report {
  const errors: string[] = [];
  const warnings: string[] = [];
  const events: GEvent[] = [];
  const eventPaths = files.filter(f => f.path.startsWith('events/') && f.path.endsWith('.json'));
  const claimFiles = files.filter(f => f.path.startsWith('claims/') && f.path.endsWith('.json'));
  const garage = files.find(f => f.path === 'garage.md');

  for (const f of eventPaths) {
    let ev: any;
    try {
      ev = JSON.parse(f.content);
    } catch (e: any) {
      errors.push(`${f.path}: invalid JSON — ${e.message}`);
      continue;
    }
    const knownTypes = ['vehicle_added','vehicle_fact_claimed','vehicle_removed','parts_ordered','order_delivered','part_added','part_installed','part_removed','part_reassigned','part_retired','maintenance_logged','recurring_set','project_added','project_status_changed','project_part_added','wishlist_added','reminder_sent','reminder_snoozed','claim_resolved','note'];
    if (ev && ev.type && !knownTypes.includes(ev.type)) {
      warnings.push(`${f.path}: unknown event type "${ev.type}" (stored, not applied — extend the fold to use it)`);
    }
    const r = eventSchema.safeParse(ev);
    if (!r.success) {
      const first = r.error.issues[0];
      errors.push(`${f.path}: schema — ${first.path.join('.')}: ${first.message}`);
      continue;
    }
    const idm = ev.id.match(/^(\d{4})(\d{2})(\d{2})-/);
    if (idm && ev.ts.slice(0, 10) < `${idm[1]}-${idm[2]}-${idm[3]}`) {
      errors.push(`${f.path}: event ts (${ev.ts}) is before its dated id prefix (${ev.id}) — id should be the recording date`);
    }
    events.push(r.data as GEvent);
  }

  // strict fold: unknown references are errors
  const { state, issues } = foldEvents(events, { strict: true });
  for (const iss of issues) {
    if (iss.level === 'error') errors.push(`events/${iss.event}.json: ${iss.message}`);
    else warnings.push(`events/${iss.event}.json: ${iss.message}`);
  }

  // part id uniqueness (duplicate part_added is a hard error — merge instead)
  const seenParts = new Map<string, string>();
  for (const ev of events) {
    if (ev.type === 'part_added') {
      const pid = (ev as { partId: string }).partId;
      if (seenParts.has(pid)) errors.push(`events/${ev.id}.json: duplicate part_added for ${pid} (${seenParts.get(pid)}) — merge into one`);
      else seenParts.set(pid, ev.id);
    }
  }

  // claims
  let pending = 0;
  for (const f of claimFiles) {
    const isPending = f.path.startsWith('claims/pending/');
    if (isPending) pending += 1;
    const p = parseClaimSet(f.content);
    if (!p.ok) {
      (isPending ? warnings : warnings).push(`${f.path}: does not parse as a claim set — ${p.errors[0]}`);
      continue;
    }
    if (!isPending && !(f.content.includes('"resolution"'))) {
      warnings.push(`${f.path}: archived claim has no resolution stamp`);
    }
  }

  // garage.md freshness (deterministic compare, ignoring the generated timestamp)
  if (events.length || garage) {
    const expected = renderGarageMdDeterministic(state).replace(/\s+$/, '');
    const actual = (garage?.content ?? '')
      .replace(/^_Generated .*?_\n?/m, '')
      .replace(/\s+$/, '');
    if (actual !== expected) {
      errors.push('garage.md is out of date with events/ — re-run the renderer (node tools/validate.mjs --write in the garage repo)');
    }
  }

  return { ok: errors.length === 0, errors, warnings, eventCount: events.length, pendingClaims: pending };
}
