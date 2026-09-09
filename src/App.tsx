import React, { useCallback, useEffect, useState } from 'react';
import { AppConfig, kvDel } from './db';
import {
  allRepoFiles,
  commitAndPush,
  createRemoteRepo,
  currentHead,
  resetToRemote,
  sync,
  testConnection,
  wipeLocal,
} from './sync/git';
import { AppData, approvePending, loadAppData, pasteToPendingFile, rejectPending } from './store';
import { Btn, Tag } from './ui';
import Dashboard from './views/Dashboard';
import Cars from './views/Cars';
import Parts from './views/Parts';
import Review from './views/Review';
import Import from './views/Import';
import Settings from './views/Settings';
import Setup from './views/Setup';

const NAV = [
  ['#/garage', 'GARAGE'],
  ['#/cars', 'CARS'],
  ['#/parts', 'PARTS'],
  ['#/review', 'REVIEW'],
  ['#/import', 'PASTE'],
  ['#/more', 'MORE'],
] as const;

function seedFiles(): { path: string; content: string }[] {
  return [
    { path: 'garage.md', content: '# GARAGE\n\n_No cars on file yet. Paste your first one in the PASTE panel._\n' },
    { path: 'events/.gitkeep', content: '' },
    { path: 'claims/pending/.gitkeep', content: '' },
    { path: 'claims/archived/.gitkeep', content: '' },
    { path: 'attachments/.gitkeep', content: '' },
    {
      path: 'README.md',
      content:
        '# garage (private data repo)\n\nSource of truth for Garage Tracker. Managed by the PWA + the local agent.\nDo not hand-edit garage.md — it is regenerated from events/.\n',
    },
  ];
}

export default function App() {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [cfgLoaded, setCfgLoaded] = useState(false);
  const [route, setRoute] = useState(window.location.hash || '#/garage');
  const [data, setData] = useState<AppData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const notify = useCallback((m: string | null) => setToast(m), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const refresh = useCallback(async (c: AppConfig) => {
    const files = await allRepoFiles();
    const head = await currentHead().catch(() => null);
    const d = loadAppData(files, head);
    setData(d);
    return d;
  }, []);

  const boot = useCallback(
    async (c: AppConfig) => {
      setBusy('LINKING…');
      try {
        await sync(c);
        const files = await allRepoFiles();
        if (!files.some((f) => f.path === 'garage.md')) {
          const seed = seedFiles();
          await commitAndPush(c, seed, 'seed: initialize garage');
        }
        await refresh(c);
      } catch (e) {
        notify(`SYNC FAILED: ${(e as Error).message}`);
      } finally {
        setBusy(null);
      }
    },
    [refresh, notify]
  );

  useEffect(() => {
    import('./db')
      .then(({ getCfg }) => getCfg())
      .then((c) => {
        setCfgLoaded(true);
        if (c) {
          setCfg(c);
          void boot(c);
        }
      })
      .catch((e) => {
        setCfgLoaded(true);
        notify(`IndexedDB unavailable: ${(e as Error).message}`);
      });
  }, [boot, notify]);

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash || '#/garage');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const nav = useCallback((h: string) => {
    window.location.hash = h;
  }, []);

  // ---------- actions ----------
  const doSync = useCallback(async () => {
    if (!cfg) return;
    setBusy('SYNCING…');
    try {
      await sync(cfg);
      await refresh(cfg);
      notify('SYNCED');
    } catch (e) {
      notify(`SYNC FAILED: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, [cfg, refresh, notify]);

  const doApprove = useCallback(
    async (paths: string[]) => {
      if (!cfg || !data) return;
      setBusy('APPROVING…');
      try {
        const res = approvePending(data.files, paths, cfg.name || 'you');
        if (!res.ok) throw new Error(res.errors.join('; '));
        if (res.newEvents.length === 0) throw new Error('no events produced — check the claim files');
        await commitAndPush(cfg, res.files, `approve ${paths.length} claim file(s) → ${res.newEvents.length} event(s)`);
        await refresh(cfg);
        notify(`APPROVED: ${res.newEvents.length} EVENTS PUSHED`);
      } catch (e) {
        notify(`APPROVE FAILED: ${(e as Error).message}`);
      } finally {
        setBusy(null);
      }
    },
    [cfg, data, refresh, notify]
  );

  const doReject = useCallback(
    async (paths: string[]) => {
      if (!cfg || !data) return;
      setBusy('DISCARDING…');
      try {
        const res = rejectPending(data.files, paths, cfg.name || 'you');
        await commitAndPush(cfg, res.files, `discard ${paths.length} claim file(s)`);
        await refresh(cfg);
        notify('DISCARDED');
      } catch (e) {
        notify(`DISCARD FAILED: ${(e as Error).message}`);
      } finally {
        setBusy(null);
      }
    },
    [cfg, data, refresh, notify]
  );

  const doPaste = useCallback(
    async (text: string, source: string) => {
      if (!cfg) return;
      setBusy('SENDING…');
      try {
        const p = pasteToPendingFile(text, source);
        if ('error' in p) throw new Error(p.error);
        const files = data ? data.files.filter((f) => f.path !== p.path) : [];
        files.push({ path: p.path, content: p.content });
        await commitAndPush(cfg, files, `new pending claim from paste`);
        await refresh(cfg);
        notify('IN THE REVIEW QUEUE');
        nav('#/review');
      } catch (e) {
        notify(`PASTE FAILED: ${(e as Error).message}`);
      } finally {
        setBusy(null);
      }
    },
    [cfg, data, refresh, notify, nav]
  );

  const doReset = useCallback(async () => {
    if (!cfg) return;
    setBusy('RESETTING…');
    try {
      await resetToRemote(cfg);
      await refresh(cfg);
      notify('RESET TO REMOTE');
    } catch (e) {
      notify(`RESET FAILED: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, [cfg, refresh, notify]);

  const doWipe = useCallback(async () => {
    if (!cfg) return;
    setBusy('WIPING…');
    try {
      await wipeLocal();
      await sync(cfg);
      await refresh(cfg);
      notify('WIPED + RECLONED');
    } catch (e) {
      notify(`WIPE FAILED: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, [cfg, refresh, notify]);

  const saveCfg = useCallback(
    async (c: AppConfig) => {
      setCfg(c);
      try {
        const r = await testConnection(c);
        if (!r.ok) throw new Error(r.message);
        const cr = await createRemoteRepo(c);
        if (!cr.ok) throw new Error(cr.message);
        const { saveCfg: save } = await import('./db');
        await save(c);
        await boot(c);
        notify('LINKED');
      } catch (e) {
        notify(`LINK FAILED: ${(e as Error).message}`);
      }
    },
    [boot, notify]
  );

  const doLogout = useCallback(async () => {
    await wipeLocal().catch(() => {});
    await kvDel('cfg').catch(() => {});
    location.reload();
  }, []);

  // ---------- render ----------
  if (!cfgLoaded) return <div className="boot">BOOTING…</div>;
  if (!cfg)
    return (
      <>
        <Shell route={route} nav={nav} pending={0} busy={busy} toast={toast} cfg={null} onSync={() => {}} />
        <div className="content">
          <Setup onSaved={(c) => void saveCfg(c)} onBusy={(m) => setBusy(m)} />
        </div>
      </>
    );

  if (!data) {
    return (
      <>
        <Shell route={route} nav={nav} pending={0} busy={busy || 'LOADING…'} toast={toast} cfg={cfg} onSync={doSync} />
        <div className="content boot">
          <pre className="ascii">{`  LOADING GARAGE_`}</pre>
        </div>
      </>
    );
  }

  const seg = route.replace(/^#\/?/, '').split('/');
  const view = seg[0] || 'garage';
  let content: React.ReactNode;
  switch (view) {
    case 'cars':
      content = <Cars data={data} id={seg[1] ? decodeURIComponent(seg[1]) : null} nav={nav} />;
      break;
    case 'parts':
      content = <Parts data={data} />;
      break;
    case 'review':
      content = <Review data={data} onApprove={doApprove} onReject={doReject} busy={!!busy} />;
      break;
    case 'import':
      content = <Import onSend={doPaste} busy={!!busy} />;
      break;
    case 'more':
    case 'settings':
      content = (
        <Settings
          cfg={cfg}
          onSave={(c) => void saveCfg(c)}
          onSync={() => void doSync()}
          onReset={() => void doReset()}
          onWipe={() => void doWipe()}
          onLogout={() => void doLogout()}
          busy={!!busy}
        />
      );
      break;
    default:
      content = <Dashboard data={data} nav={nav} />;
  }

  return (
    <>
      <Shell route={route} nav={nav} pending={data.pendingClaims.length} busy={busy} toast={toast} cfg={cfg} onSync={() => void doSync()} />
      <div className="content">{content}</div>
    </>
  );
}

function Shell({
  route,
  nav,
  pending,
  busy,
  toast,
  cfg,
  onSync,
}: {
  route: string;
  nav: (h: string) => void;
  pending: number;
  busy: string | null;
  toast: string | null;
  cfg: AppConfig | null;
  onSync: () => void;
}) {
  const active = (route.startsWith('#/cars') ? '#/cars' : `#/${route.replace(/^#\/?/, '')}`);
  return (
    <>
      <header className="topbar">
        <span className="logo" onClick={() => nav('#/garage')}>
          ▛▜ GARAGE ▟▚
        </span>
        <span className="top-right">
          <button className="chip" onClick={onSync} disabled={!!busy} title="sync now">
            ⟳ {busy ? '…' : ''}
          </button>
        </span>
      </header>
      {toast && <div className={`toast ${toast.startsWith('SYNC FAILED') || toast.includes('FAILED') ? 'err' : 'ok'}`}>{toast}</div>}
      <nav className="bottom-nav">
        {NAV.map(([h, label]) => (
          <a key={h} className={active === h || (h === '#/cars' && active.startsWith('#/cars')) ? 'on' : ''} href={h}>
            {label}
            {h === '#/review' && pending > 0 && <span className="badge">{pending}</span>}
          </a>
        ))}
      </nav>
    </>
  );
}
