/* Git sync engine: isomorphic-git over HTTPS, fs in IndexedDB.
   Repo root is the virtual path /garage. PAT from local config only. */
import * as git from 'isomorphic-git';
import webHttp from 'isomorphic-git/http/web';
import { GarageFs } from './fsx';
import { getCfg, type AppConfig } from '../db';

export const ROOT = '/garage';

const fsx = new GarageFs();

export function getFs() {
  return fsx.promises;
}

type Msg = (m: string) => void;

function apiHeaders(pat: string) {
  return {
    Authorization: `Bearer ${pat}`,
    'User-Agent': 'garage-tracker-pwa',
    Accept: 'application/vnd.github+json',
  };
}

/** Verify PAT + report repo state. */
export async function testConnection(cfg: AppConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const u = await fetch('https://api.github.com/user', { headers: apiHeaders(cfg.pat) });
    if (u.status === 401) return { ok: false, message: 'PAT rejected (401) — check token and that it is active.' };
    if (u.status === 403) return { ok: false, message: 'PAT allowed but no permission (403) — needs repo access.' };
    if (!u.ok) return { ok: false, message: `GitHub API error ${u.status}.` };
    const me = (await u.json()) as { login: string };
    const r = await fetch(`https://api.github.com/repos/${cfg.user}/${cfg.repo}`, { headers: apiHeaders(cfg.pat) });
    const repoState =
      r.status === 200
        ? 'found ✓'
        : r.status === 404
          ? 'not found yet (create it first via the setup button)'
          : `API ${r.status}`;
    return { ok: true, message: `Logged in as @${me.login}. Repo ${cfg.user}/${cfg.repo}: ${repoState}.` };
  } catch (e) {
    return { ok: false, message: `Network error: ${(e as Error).message}` };
  }
}

async function branchName(): Promise<string> {
  const head = (await fsx.promises.readFile(ROOT + '/.git/HEAD', { encoding: 'utf8' })) as string;
  const t = head.trim();
  if (t.startsWith('ref:')) {
    const ref = t.slice(5).trim();
    return ref.replace(/^refs\/heads\//, '');
  }
  return t; // detached
}

/** Clone if not present yet. */
export async function ensureCloned(cfg: AppConfig, onMsg?: Msg): Promise<void> {
  await fsx.open();
  const hasHead = await fsx.promises.readFile(ROOT + '/.git/HEAD').then(() => true, () => false);
  if (!hasHead) {
    onMsg?.('cloning…');
    await git.clone({
      fs: fsx.promises,
      dir: ROOT,
      url: `https://github.com/${cfg.user}/${cfg.repo}.git`,
      http: webHttp,
      onAuth: () => ({ username: 'x-access-token', password: cfg.pat }),
      singleBranch: true,
    } as any);
  }
  await fsx.flush();
}

/** Fetch, then reconcile local vs remote (ff / push / merge). */
export async function sync(cfg: AppConfig, onMsg?: Msg): Promise<{ ok: boolean; message: string; head: string | null }> {
  await ensureCloned(cfg, onMsg);
  const id = { name: cfg.name || cfg.user, email: cfg.email };
  const auth = { onAuth: () => ({ username: 'x-access-token', password: cfg.pat }) };
  onMsg?.('fetching…');
  await git.fetch({ fs: fsx.promises, dir: ROOT, remote: 'origin', http: webHttp, ...auth } as any);
  await fsx.flush();

  const local = await git.resolveRef({ fs: fsx.promises, dir: ROOT, ref: 'HEAD' });
  const br = await branchName();
  const remoteRef = `refs/remotes/origin/${br}`;
  let remote: string | null = null;
  try {
    remote = await git.resolveRef({ fs: fsx.promises, dir: ROOT, ref: remoteRef });
  } catch {
    /* empty repo */
  }

  if (remote && remote !== local) {
    const bases = (await git.findMergeBase({ fs: fsx.promises, dir: ROOT, oids: [local, remote] })) as string[];
    const base = bases[0];
    if (base === local || base === undefined) {
      // behind remote → fast-forward
      onMsg?.('updating from remote…');
      await git.merge({ fs: fsx.promises, dir: ROOT, theirs: remote, fastForward: true, author: id, committer: id } as any);
    } else if (base === remote) {
      // ahead of remote → push local work
      onMsg?.('pushing local commits…');
      await git.push({ fs: fsx.promises, dir: ROOT, remote: 'origin', ref: br, http: webHttp, ...auth } as any);
    } else {
      // diverged → merge commit, then push
      onMsg?.('merging remote changes…');
      try {
        await git.merge({ fs: fsx.promises, dir: ROOT, theirs: remote, author: id, committer: id, message: 'merge: sync PWA with remote' } as any);
        await git.push({ fs: fsx.promises, dir: ROOT, remote: 'origin', ref: br, http: webHttp, ...auth } as any);
      } catch (e) {
        return { ok: false, message: `Merge conflict with remote: ${(e as Error).message}. Use Settings → reset to remote.`, head: local };
      }
    }
  }
  await fsx.flush();
  const head = await git.resolveRef({ fs: fsx.promises, dir: ROOT, ref: 'HEAD' });
  return { ok: true, message: 'up to date', head };
}

/** Write files (create/update), commit, push. Returns new head. */
export async function commitAndPush(
  cfg: AppConfig,
  files: { path: string; content: string }[],
  message: string,
  onMsg?: Msg
): Promise<{ ok: boolean; message: string; head: string | null }> {
  await ensureCloned(cfg, onMsg);
  const id = { name: cfg.name || cfg.user, email: cfg.email };
  const auth = { onAuth: () => ({ username: 'x-access-token', password: cfg.pat }) };

  for (const f of files) {
    const p = ROOT + '/' + f.path.replace(/^\/+/, '');
    await fsx.promises.writeFile(p, f.content);
    await git.add({ fs: fsx.promises, dir: ROOT, filepath: f.path.replace(/^\/+/, '') } as any);
  }
  await fsx.flush();
  onMsg?.('committing…');
  await git.commit({ fs: fsx.promises, dir: ROOT, message, author: id, committer: id } as any);
  await fsx.flush();
  try {
    const br = await branchName();
    onMsg?.('pushing…');
    await git.push({ fs: fsx.promises, dir: ROOT, remote: 'origin', ref: br, http: webHttp, ...auth } as any);
  } catch (e) {
    // remote moved under us → reconcile then retry once
    onMsg?.('retrying after sync…');
    await sync(cfg);
    const br2 = await branchName();
    try {
      await git.push({ fs: fsx.promises, dir: ROOT, remote: 'origin', ref: br2, http: webHttp, ...auth } as any);
    } catch {
      /* already up to date */
    }
  }
  await fsx.flush();
  let head: string | null = null;
  try {
    head = await git.resolveRef({ fs: fsx.promises, dir: ROOT, ref: 'HEAD' });
  } catch {
    /* empty repo edge */
  }
  return { ok: true, message: 'pushed', head };
}

/** Read a worktree file (utf-8). null if missing. */
export async function readRepoFile(path: string): Promise<string | null> {
  await fsx.open();
  try {
    const buf = (await fsx.promises.readFile(ROOT + '/' + path.replace(/^\/+/, ''), { encoding: 'utf8' })) as string;
    return buf;
  } catch {
    return null;
  }
}

/** All worktree files as {path, content} (for the validator). */
export async function allRepoFiles(): Promise<{ path: string; content: string }[]> {
  await fsx.open();
  const fsp = fsx.promises;
  const out: { path: string; content: string }[] = [];
  async function walk(dir: string): Promise<void> {
    let names: { name: string; isFile(): boolean; isDirectory(): boolean }[] = [];
    try {
      names = (await fsp.readdir(dir)) as typeof names;
    } catch {
      return;
    }
    for (const e of names) {
      const p = dir === '/' ? '/' + e.name : dir + '/' + e.name;
      if (e.isDirectory()) {
        if (p === ROOT + '/.git') continue;
        await walk(p);
      } else if (e.isFile()) {
        try {
          const buf = (await fsp.readFile(p)) as Uint8Array;
          out.push({ path: p.replace(/^\//, ''), content: new TextDecoder().decode(buf) });
        } catch {
          /* skip unreadable */
        }
      }
    }
  }
  await walk(ROOT);
  return out;
}

/** Discard everything; fresh clone from remote. */
export async function resetToRemote(cfg: AppConfig, onMsg?: Msg): Promise<{ ok: boolean; message: string }> {
  await fsx.open();
  await fsx.reset();
  onMsg?.('re-cloning…');
  await git.clone({
    fs: fsx.promises,
    dir: ROOT,
    url: `https://github.com/${cfg.user}/${cfg.repo}.git`,
    http: webHttp,
    onAuth: () => ({ username: 'x-access-token', password: cfg.pat }),
    singleBranch: true,
  } as any);
  await fsx.flush();
  return { ok: true, message: 're-cloned from remote' };
}

/** Does a local clone exist? */
export async function hasLocalClone(): Promise<boolean> {
  await fsx.open();
  return fsx.promises.readFile(ROOT + '/.git/HEAD').then(() => true, () => false);
}

/** Wipe local clone (keeps config). */
export async function wipeLocal(): Promise<void> {
  await fsx.open();
  await fsx.reset();
}

/** Create the remote repo via API (first run only). */
export async function createRemoteRepo(cfg: AppConfig): Promise<{ ok: boolean; message: string }> {
  const res = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: apiHeaders(cfg.pat),
    body: JSON.stringify({
      name: cfg.repo,
      private: true,
      auto_init: true,
      description: 'Garage Tracker data (private)',
    }),
  });
  if (res.status === 201) return { ok: true, message: `Created ${cfg.user}/${cfg.repo} (private, initialized with README).` };
  if (res.status === 409) return { ok: true, message: `${cfg.user}/${cfg.repo} already exists — good.` };
  if (res.status === 403) {
    // Fine-grained PATs cannot create repos at all — check whether it already exists.
    const g = await fetch(`https://api.github.com/repos/${cfg.user}/${cfg.repo}`, { headers: apiHeaders(cfg.pat) });
    if (g.status === 200) return { ok: true, message: `${cfg.user}/${cfg.repo} already exists — good.` };
    return {
      ok: false,
      message: `Token can't create repos (fine-grained PATs can't) and ${cfg.user}/${cfg.repo} was not found. Check the owner/repo spelling, or create the repo on GitHub first.`,
    };
  }
  const body = await res.text();
  return { ok: false, message: `GitHub API ${res.status}: ${body.slice(0, 200)}` };
}

export async function currentHead(): Promise<string | null> {
  try {
    await fsx.open();
    if (!(await fsx.promises.readFile(ROOT + '/.git/HEAD').then(() => true, () => false))) return null;
    return await git.resolveRef({ fs: fsx.promises, dir: ROOT, ref: 'HEAD' });
  } catch {
    return null;
  }
}

export async function currentCfg(): Promise<AppConfig | undefined> {
  return getCfg();
}
