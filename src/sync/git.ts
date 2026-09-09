/* Sync engine — GitHub REST API, NOT the git wire protocol.
   GitHub's git smart-HTTP endpoints (the .git URLs on github.com)
   send no CORS
   headers, so a browser can never speak git to github.com (fetch dies
   with "Load failed"). The REST API (api.github.com) is CORS-enabled,
   so sync is done with:
     pull: GET default branch → GET tree (recursive) → GET contents
           (base64) for every changed file
     push: POST /git/blobs → POST /git/trees (bottom-up) →
           POST /git/commits → PATCH /git/refs
           (409 "remote moved" → rebase onto remote, retry)
   The working tree lives in IndexedDB (GarageFs); sync meta (branch,
   head sha, path→blob-sha map) lives in the kv store. All auth is the
   user's PAT via Authorization: Bearer. Nothing leaves this browser
   except calls to api.github.com. */
import { GarageFs } from './fsx';
import { kvGet, kvSet, type AppConfig } from '../db';

export const ROOT = '/garage';

const fsx = new GarageFs();
export function getFs() {
  return fsx.promises;
}

type Msg = (m: string) => void;

interface SyncMeta {
  head: string | null; // last known remote commit sha (null = remote empty / never seen)
  branch: string; // default branch
  tree: Record<string, string>; // path → blob sha, last known remote tree
}

function emptyMeta(): SyncMeta {
  return { head: null, branch: 'main', tree: {} };
}

async function meta(): Promise<SyncMeta> {
  const m = await kvGet<SyncMeta>('syncmeta');
  return m ?? emptyMeta();
}

async function setMeta(m: SyncMeta): Promise<void> {
  await kvSet('syncmeta', m);
}

function apiHeaders(pat: string): Record<string, string> {
  return {
    Authorization: `Bearer ${pat}`,
    'User-Agent': 'garage-tracker-pwa',
    Accept: 'application/vnd.github+json',
  };
}

class ApiError extends Error {
  status: number;
  constructor(status: number, body: string) {
    super(`GitHub API ${status}: ${body.slice(0, 200)}`);
    this.status = status;
  }
}

async function api(
  cfg: AppConfig,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<any> {
  const res = await fetch('https://api.github.com' + path, {
    method: init?.method ?? 'GET',
    headers: apiHeaders(cfg.pat),
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) throw new ApiError(res.status, text);
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

/* ---------- base64 <-> bytes (browser-safe for UTF-8) ---------- */

function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function b64decode(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\n/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function encPath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/');
}

/* ---------- small GitHub API wrappers ---------- */

async function repoInfo(cfg: AppConfig): Promise<string> {
  const r = await api(cfg, `/repos/${cfg.user}/${cfg.repo}`);
  return r.default_branch as string;
}

async function branchHead(cfg: AppConfig, branch: string): Promise<string | null> {
  try {
    const b = await api(cfg, `/repos/${cfg.user}/${cfg.repo}/branches/${encPath(branch)}`);
    return b.commit.sha as string;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

async function treeBlobs(cfg: AppConfig, head: string): Promise<Record<string, string>> {
  const t = await api(cfg, `/repos/${cfg.user}/${cfg.repo}/git/trees/${head}?recursive=1`);
  const blobs: Record<string, string> = {};
  for (const e of t.tree ?? []) {
    if (e.type === 'blob') blobs[e.path] = e.sha;
  }
  return blobs;
}

async function downloadFile(cfg: AppConfig, p: string, ref: string): Promise<Uint8Array> {
  const f: any = await api(
    cfg,
    `/repos/${cfg.user}/${cfg.repo}/contents/${encPath(p)}?ref=${encPath(ref)}`
  );
  if (Array.isArray(f)) throw new Error(`expected file, got directory: ${p}`);
  if (typeof f.content === 'string') {
    if (f.encoding === 'base64') return b64decode(f.content);
    return new TextEncoder().encode(f.content);
  }
  // >1 MB file: contents API omits content; fall back to the git blob API
  if (f.sha) {
    const b: any = await api(cfg, `/repos/${cfg.user}/${cfg.repo}/git/blobs/${f.sha}`);
    return b64decode(b.content);
  }
  return new Uint8Array(0);
}

/**
 * Bring fsx + meta in line with the remote.
 * `keep` = paths with pending local writes that must NOT be overwritten.
 */
async function catchUp(
  cfg: AppConfig,
  m: SyncMeta,
  onMsg?: Msg,
  keep?: Set<string>
): Promise<void> {
  m.branch = await repoInfo(cfg);
  const head = await branchHead(cfg, m.branch);
  const fresh = m.head === null && Object.keys(m.tree).length === 0;
  if (!fresh && head === m.head) return; // already current
  if (fresh && head === null) return; // both sides empty

  onMsg?.(fresh ? 'cloning…' : 'fetching…');
  const blobs = head ? await treeBlobs(cfg, head) : {};
  const changed = Object.keys(blobs)
    .filter((p) => m.tree[p] !== blobs[p] && !keep?.has(p))
    .sort();
  const deleted = Object.keys(m.tree)
    .filter((p) => !blobs[p] && !keep?.has(p))
    .sort();
  for (let i = 0; i < changed.length; i++) {
    if (i % 5 === 0 || i === changed.length - 1) {
      onMsg?.(`${fresh ? 'cloning' : 'updating'}… ${i + 1}/${changed.length}`);
    }
    await fsx.promises.writeFile(
      ROOT + '/' + changed[i],
      await downloadFile(cfg, changed[i], head!)
    );
  }
  for (const p of deleted) {
    await fsx.promises.unlink(ROOT + '/' + p).catch(() => {});
  }
  m.tree = blobs;
  m.head = head;
}

/* ---------- public interface (same as the old git-protocol engine) ---------- */

export async function hasLocalClone(): Promise<boolean> {
  await fsx.open();
  const m = await meta();
  return m.head !== null || Object.keys(m.tree).length > 0;
}

export async function currentHead(): Promise<string | null> {
  await fsx.open();
  return (await meta()).head;
}

export async function testConnection(cfg: AppConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const me = await api(cfg, '/user');
    const r = await api(cfg, `/repos/${cfg.user}/${cfg.repo}`);
    return {
      ok: true,
      message: `Authenticated as ${me.login}; ${cfg.user}/${cfg.repo} visible.`,
    };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/**
 * Create the data repo if it doesn't exist. Fine-grained PATs cannot
 * create repos (POST /user/repos → 403 for them); in that case verify
 * the repo is at least visible and let the caller proceed.
 */
export async function createRemoteRepo(
  cfg: AppConfig
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: { ...apiHeaders(cfg.pat), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: cfg.repo,
        private: true,
        description: 'Garage Tracker data (private)',
      }),
    });
    if (res.status === 201) return { ok: true, message: `Created ${cfg.user}/${cfg.repo} (private).` };
    if (res.status === 409) return { ok: true, message: `${cfg.user}/${cfg.repo} already exists — good.` };
    if (res.status === 403) {
      // Fine-grained PATs can't create repos. Verify it exists instead.
      const check = await fetch(`https://api.github.com/repos/${cfg.user}/${cfg.repo}`, {
        headers: apiHeaders(cfg.pat),
      });
      if (check.status === 200) return { ok: true, message: `${cfg.user}/${cfg.repo} exists — good.` };
      return {
        ok: false,
        message:
          `Token can't create repos (fine-grained PATs can't) and ${cfg.user}/${cfg.repo} ` +
          'was not found. Check the owner/repo spelling, or create the repo on GitHub first.',
      };
    }
    const text = await res.text();
    return { ok: false, message: `GitHub API ${res.status}: ${text.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function ensureCloned(cfg: AppConfig, onMsg?: Msg): Promise<void> {
  await fsx.open();
  const m = await meta();
  await catchUp(cfg, m, onMsg);
  await setMeta(m);
  await fsx.flush();
}

export async function sync(
  cfg: AppConfig,
  onMsg?: Msg
): Promise<{ ok: boolean; message: string; head: string | null }> {
  await fsx.open();
  const m = await meta();
  const before = m.head;
  await catchUp(cfg, m, onMsg);
  await setMeta(m);
  await fsx.flush();
  return {
    ok: true,
    message: before === m.head ? 'up to date' : 'updated from remote',
    head: m.head,
  };
}

/**
 * Write files locally, then push as one commit on the default branch.
 * If the remote branch moved (agent or another device pushed), rebase
 * our files onto the new head and retry (up to 3 times).
 */
export async function commitAndPush(
  cfg: AppConfig,
  files: { path: string; content: string }[],
  message: string,
  onMsg?: Msg
): Promise<{ ok: boolean; message: string; head: string | null }> {
  await fsx.open();
  const norm = files.map((f) => ({
    path: f.path.replace(/^\/+/, ''),
    content: f.content,
  }));
  for (const f of norm) {
    await fsx.promises.writeFile(ROOT + '/' + f.path, f.content);
  }
  await fsx.flush();

  const who = { name: cfg.name || cfg.user, email: cfg.email };
  const keep = new Set(norm.map((f) => f.path));

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const m = await meta();
    try {
      m.branch = await repoInfo(cfg);
      const head = await branchHead(cfg, m.branch);
      if (head !== m.head) {
        // Remote differs from our last known head (fresh app, another
        // device, or the agent pushed). Re-download everything except
        // the paths we are about to push (those keep the local version).
        onMsg?.('remote moved, rebasing…');
        const blobs = head ? await treeBlobs(cfg, head) : {};
        const changed = Object.keys(blobs)
          .filter((p) => m.tree[p] !== blobs[p] && !keep.has(p))
          .sort();
        const deleted = Object.keys(m.tree)
          .filter((p) => !blobs[p] && !keep.has(p))
          .sort();
        for (const p of changed) {
          await fsx.promises.writeFile(ROOT + '/' + p, await downloadFile(cfg, p, head!));
        }
        for (const p of deleted) {
          await fsx.promises.unlink(ROOT + '/' + p).catch(() => {});
        }
        m.tree = blobs;
        m.head = head;
      }

      onMsg?.('pushing…');
      const newTree = { ...m.tree };
      for (const f of norm) {
        const blob: any = await api(
          cfg,
          `/repos/${cfg.user}/${cfg.repo}/git/blobs`,
          {
            method: 'POST',
            body: {
              content: 'base64',
              encoding: 'base64',
              data: b64encode(new TextEncoder().encode(f.content)),
            },
          }
        );
        newTree[f.path] = blob.sha;
      }
      const treeSha = await createTree(cfg, buildRoot(newTree));
      const commit: any = await api(
        cfg,
        `/repos/${cfg.user}/${cfg.repo}/git/commits`,
        {
          method: 'POST',
          body: {
            tree: treeSha,
            message,
            author: who,
            committer: who,
            parents: m.head ? [m.head] : [],
          },
        }
      );
      if (m.head) {
        await api(
          cfg,
          `/repos/${cfg.user}/${cfg.repo}/git/refs/heads/${encPath(m.branch)}`,
          {
            method: 'PATCH',
            body: { sha: commit.sha, force: false, oldValue: m.head },
          }
        );
      } else {
        await api(cfg, `/repos/${cfg.user}/${cfg.repo}/git/refs`, {
          method: 'POST',
          body: { ref: `refs/heads/${m.branch}`, sha: commit.sha },
        });
      }
      m.head = commit.sha;
      m.tree = newTree;
      await setMeta(m);
      await fsx.flush();
      return { ok: true, message: 'pushed', head: commit.sha };
    } catch (e) {
      lastErr = e;
      const st = e instanceof ApiError ? e.status : 0;
      if (st !== 409 && st !== 422) throw e;
      onMsg?.('remote changed mid-push, retrying…');
    }
  }
  return {
    ok: false,
    message: `could not push after retries: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    head: null,
  };
}

/* ---------- tree building (bottom-up) ---------- */

type TNode = { files: Map<string, string>; dirs: Map<string, TNode> };

function tnode(): TNode {
  return { files: new Map(), dirs: new Map() };
}

function buildRoot(blobs: Record<string, string>): TNode {
  const root = tnode();
  for (const [p, sha] of Object.entries(blobs)) {
    const parts = p.split('/');
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      let d = cur.dirs.get(parts[i]);
      if (!d) {
        d = tnode();
        cur.dirs.set(parts[i], d);
      }
      cur = d;
    }
    cur.files.set(parts[parts.length - 1], sha);
  }
  return root;
}

async function createTree(cfg: AppConfig, t: TNode): Promise<string> {
  const entries: { path: string; mode: string; type: string; sha: string }[] = [];
  for (const [name, d] of [...t.dirs.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    entries.push({ path: name, mode: '040000', type: 'tree', sha: await createTree(cfg, d) });
  }
  for (const [name, sha] of [...t.files.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    entries.push({ path: name, mode: '100644', type: 'blob', sha });
  }
  const res = await api(cfg, `/repos/${cfg.user}/${cfg.repo}/git/trees`, {
    method: 'POST',
    body: { tree: entries },
  });
  return res.sha as string;
}

/* ---------- destructive ops ---------- */

export async function resetToRemote(
  cfg: AppConfig,
  onMsg?: Msg
): Promise<{ ok: boolean; message: string }> {
  await fsx.open();
  await fsx.reset();
  await setMeta(emptyMeta());
  onMsg?.('re-cloning…');
  await ensureCloned(cfg, onMsg);
  return { ok: true, message: 're-cloned from remote' };
}

export async function wipeLocal(): Promise<void> {
  await fsx.open();
  await fsx.reset();
  await setMeta(emptyMeta());
}

/* ---------- read helpers (unchanged) ---------- */

export async function readRepoFile(path: string): Promise<string | null> {
  await fsx.open();
  const p = GarageFs.key(ROOT + '/' + path.replace(/^\/+/, ''));
  try {
    const data = await fsx.promises.readFile(p, { encoding: 'utf8' });
    return typeof data === 'string' ? data : new TextDecoder().decode(data);
  } catch {
    return null;
  }
}

export async function allRepoFiles(): Promise<{ path: string; content: string; isDir: boolean }[]> {
  await fsx.open();
  const out: { path: string; content: string; isDir: boolean }[] = [];
  const walk = async (dir: string): Promise<void> => {
    // skip .git — an early isomorphic-git build stored its own .git
    // directory in this same IndexedDB; it is not repo content
    const entries = (await fsx.promises.readdir(dir).catch(() => [])).filter(
      (e) => e.name !== '.git'
    );
    for (const e of entries) {
      const full = dir === ROOT ? `${dir}/${e.name}` : `${dir}/${e.name}`;
      if (e.isDirectory()) {
        await walk(full);
      } else {
        try {
          const data = await fsx.promises.readFile(full, { encoding: 'utf8' });
          const content = typeof data === 'string' ? data : new TextDecoder().decode(data);
          out.push({ path: full.slice(ROOT.length + 1), content, isDir: false });
        } catch {
          out.push({ path: full.slice(ROOT.length + 1), content: '', isDir: false });
        }
      }
    }
  };
  await walk(ROOT);
  return out;
}

