// App-level glue: repo files → fold → view model; approve/reject claim files → new commit.
import { foldEvents } from './core/state';
import { parseClaimSet, emitClaimSet, withResolution, type ClaimParse } from './core/claims';
import { renderGarageMdDeterministic } from './core/render';
import { validateRepo, type Report, type RepoFile } from './core/validate';
import { computeAttention, type AttentionResult } from './core/reminders';
import { GEvent, State } from './core/types';

export type { RepoFile };

export interface PendingClaim {
  path: string;
  parsed: ClaimParse;
  text: string;
}

export interface AppData {
  files: RepoFile[];
  head: string | null;
  events: GEvent[];
  state: State;
  attention: AttentionResult;
  report: Report;
  pendingClaims: PendingClaim[];
  syncedAt: string;
}

export function parseEvents(files: RepoFile[]): GEvent[] {
  const out: GEvent[] = [];
  for (const f of files) {
    if (!f.path.startsWith('events/') || !f.path.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(f.content));
    } catch {
      /* validator reports */
    }
  }
  return out;
}

export function loadAppData(files: RepoFile[], head: string | null, now = new Date()): AppData {
  const events = parseEvents(files);
  const state = foldEvents(events).state;
  return {
    files,
    head,
    events,
    state,
    attention: computeAttention(state, now),
    report: validateRepo(files),
    pendingClaims: files
      .filter((f) => f.path.startsWith('claims/pending/'))
      .map((f) => ({ path: f.path, parsed: parseClaimSet(f.content), text: f.content })),
    syncedAt: now.toISOString(),
  };
}

export interface ApplyResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  files: RepoFile[]; // full new worktree file set
  newEvents: GEvent[];
}

/**
 * Approve the given pending claim files: emit events, archive the claim files with a
 * resolution stamp, regenerate garage.md. Pure — returns the full new file set to commit.
 */
export function approvePending(
  files: RepoFile[],
  pendingPaths: string[],
  by: string,
  now = new Date()
): ApplyResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byPath = new Map(files.map((f) => [f.path, f]));
  const events = parseEvents(files);
  const usedIds = new Set(events.map((e) => e.id));
  const newEvents: GEvent[] = [];
  const out = new Map(files.map((f) => [f.path, f.content]));
  const stamp = now.toISOString();

  for (const p of pendingPaths) {
    const f = byPath.get(p);
    if (!f) {
      errors.push(`${p}: file not found`);
      continue;
    }
    const parsed = parseClaimSet(f.content);
    if (!parsed.ok || !parsed.set) {
      errors.push(`${p}: ${parsed.errors.join('; ')}`);
      continue;
    }
    const state = foldEvents([...events, ...newEvents]).state;
    let evs: GEvent[];
    try {
      evs = emitClaimSet(parsed.set, state, now);
    } catch (e) {
      errors.push(`${p}: ${(e as Error).message}`);
      continue;
    }
    // de-dup IDs across the whole batch
    for (const ev of evs) {
      let id = ev.id;
      while (usedIds.has(id)) id = `${id}x${newEvents.length + 1}`;
      const fixed = id === ev.id ? ev : ({ ...ev, id } as GEvent);
      usedIds.add(id);
      newEvents.push(fixed);
      out.set(`events/${fixed.id}.json`, JSON.stringify(fixed, null, 2) + '\n');
    }
    // archive the claim file with its resolution
    let archived: unknown = null;
    try {
      archived = JSON.parse(f.content);
    } catch {
      /* keep raw text */
    }
    const stampObj =
      archived && typeof archived === 'object'
        ? withResolution(archived as object, { action: 'approved', ts: stamp, by, eventIds: evs.map((e) => e.id) })
        : { raw: f.content, resolution: { action: 'approved', ts: stamp, by, eventIds: evs.map((e) => e.id) } };
    const base = p.split('/').pop() || p;
    out.set(`claims/archived/${base}`, JSON.stringify(stampObj, null, 2) + '\n');
    out.delete(p);
  }

  if (newEvents.length > 0) {
    const state = foldEvents([...events, ...newEvents]).state;
    out.set('garage.md', renderGarageMdDeterministic(state));
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    files: [...out.entries()].map(([path, content]) => ({ path, content })),
    newEvents,
  };
}

/** Reject (archive without events) the given pending claim files. */
export function rejectPending(
  files: RepoFile[],
  pendingPaths: string[],
  by: string,
  note?: string,
  now = new Date()
): ApplyResult {
  const out = new Map(files.map((f) => [f.path, f.content]));
  const stamp = now.toISOString();
  for (const p of pendingPaths) {
    const f = files.find((x) => x.path === p);
    if (!f) continue;
    let archived: unknown = null;
    try {
      archived = JSON.parse(f.content);
    } catch {
      /* raw */
    }
    const stampObj =
      archived && typeof archived === 'object'
        ? withResolution(archived as object, { action: 'discarded', ts: stamp, by, note })
        : { raw: f.content, resolution: { action: 'discarded', ts: stamp, by, note } };
    const base = p.split('/').pop() || p;
    out.set(`claims/archived/${base}`, JSON.stringify(stampObj, null, 2) + '\n');
    out.delete(p);
  }
  return {
    ok: true,
    errors: [],
    warnings: [],
    files: [...out.entries()].map(([path, content]) => ({ path, content })),
    newEvents: [],
  };
}

/** Turn a pasted JSON claim set into a brand-new pending file path (client-side only; commit via UI). */
export function pasteToPendingFile(text: string, source: string, now = new Date()): { path: string; content: string } | { error: string } {
  const parsed = parseClaimSet(text);
  if (!parsed.ok) return { error: parsed.errors.join('; ') };
  const ts = now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  const path = `claims/pending/${ts}-paste.json`;
  const set = {
    ...(parsed.set as object),
    id: `paste-${ts}`,
    source: source || 'paste',
    source_kind: 'paste',
    date_captured: now.toISOString().slice(0, 10),
    ts: now.toISOString(),
    status: 'pending',
  };
  return { path, content: JSON.stringify(set, null, 2) + '\n' };
}
