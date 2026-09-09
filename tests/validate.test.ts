import { test, expect } from 'vitest';
import { validateRepo, RepoFile } from '../src/core/validate';
import { foldEvents } from '../src/core/state';
import { renderGarageMdDeterministic } from '../src/core/render';
import { GEvent } from '../src/core/types';

const RABBIT = { type: 'vehicle_added', vehicle: '1985 VW Rabbit', make: 'Volkswagen', model: 'Rabbit GTI', year: 1985, status: 'active' };

function ev(p: Record<string, unknown>): GEvent {
  return { v: 1, id: '20260801-x', ts: '2026-08-01T12:00:00Z', ...p } as unknown as GEvent;
}

/** Build a repo file list: one file per event + a FRESH garage.md rendered from the same events. */
function repoWith(events: GEvent[], extra: RepoFile[] = []): RepoFile[] {
  const { state } = foldEvents(events);
  const files: RepoFile[] = events.map(e => ({ path: `events/${e.id}.json`, content: JSON.stringify(e) }));
  files.push({ path: 'garage.md', content: renderGarageMdDeterministic(state) });
  return [...files, ...extra];
}

test('clean repo passes', () => {
  const r = validateRepo(repoWith([ev({ ...RABBIT, id: '20260801-aveh-rabbit' })]));
  expect(r.errors, r.errors.join(' | ')).toHaveLength(0);
  expect(r.ok).toBe(true);
  expect(r.eventCount).toBe(1);
  expect(r.pendingClaims).toBe(0);
});

test('detects stale garage.md', () => {
  const files = repoWith([ev({ ...RABBIT, id: '20260801-aveh-rabbit' })]);
  const i = files.findIndex(f => f.path === 'garage.md');
  files[i] = { path: 'garage.md', content: 'STALE' };
  const r = validateRepo(files);
  expect(r.ok).toBe(false);
  expect(r.errors.some(e => e.includes('garage.md'))).toBe(true);
});

test('detects malformed JSON in an event file', () => {
  const r = validateRepo(
    repoWith([ev({ ...RABBIT, id: '20260801-aveh-rabbit' })], [{ path: 'events/20260801-bad.json', content: '{ no json' }]),
  );
  expect(r.ok).toBe(false);
  expect(r.errors.some(e => e.includes('invalid JSON'))).toBe(true);
});

test('detects unknown part references in strict fold', () => {
  const r = validateRepo(
    repoWith([
      ev({ ...RABBIT, id: '20260801-aveh-rabbit' }),
      ev({ type: 'part_installed', partId: 'PART-99999', vehicle: '1985 VW Rabbit', id: '20260801-binst' }),
    ]),
  );
  expect(r.ok).toBe(false);
  expect(r.errors.join(' | ')).toMatch(/PART-99999|unknown/i);
});

test('detects duplicate part_added for the same part id', () => {
  const r = validateRepo(
    repoWith([
      ev({ type: 'part_added', partId: 'PART-00001', description: 'bolt', id: '20260801-bpart-1' }),
      ev({ type: 'part_added', partId: 'PART-00001', description: 'bolt again', id: '20260801-bpart-2' }),
    ]),
  );
  expect(r.ok).toBe(false);
  expect(r.errors.some(e => e.includes('duplicate part_added'))).toBe(true);
});

test('flags unknown event types (stored by fold, rejected by validator)', () => {
  const r = validateRepo(
    repoWith([ev({ ...RABBIT, id: '20260801-aveh-rabbit' }), ev({ type: 'alien_signal', id: '20260801-zz', strength: 42 })]),
  );
  expect(r.warnings.some(w => w.includes('unknown event type'))).toBe(true);
  expect(r.ok).toBe(false);
});

test('counts pending claims and warns on unparseable ones', () => {
  const good = JSON.stringify({ source: 'forum', claims: [{ type: 'vehicle', vehicle: '1985 VW Rabbit', make: 'Volkswagen', model: 'Rabbit GTI', year: 1985 }] });
  const r = validateRepo(
    repoWith([ev({ ...RABBIT, id: '20260801-aveh-rabbit' })], [
      { path: 'claims/pending/001.json', content: good },
      { path: 'claims/pending/002.json', content: '{ oops' },
    ]),
  );
  expect(r.pendingClaims).toBe(2);
  expect(r.warnings.some(w => w.includes('002.json'))).toBe(true);
  expect(r.ok).toBe(true);
});
