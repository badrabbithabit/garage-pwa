import React, { useState } from 'react';
import { AppConfig } from '../db';
import {
  currentHead,
  createRemoteRepo,
  resetToRemote,
  testConnection,
  wipeLocal,
} from '../sync/git';
import { Btn, Panel, Tag, fmtDate } from '../ui';

export default function Settings({
  cfg,
  onSave,
  onSync,
  onReset,
  onWipe,
  onLogout,
  busy,
}: {
  cfg: AppConfig;
  onSave: (cfg: AppConfig) => void;
  onSync: () => void;
  onReset: () => void;
  onWipe: () => void;
  onLogout: () => void;
  busy: boolean;
}) {
  const [user, setUser] = useState(cfg.user);
  const [repo, setRepo] = useState(cfg.repo);
  const [pat, setPat] = useState(cfg.pat);
  const [name, setName] = useState(cfg.name);
  const [email, setEmail] = useState(cfg.email);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [head, setHead] = useState<string | null>(null);

  React.useEffect(() => {
    currentHead().then(setHead).catch(() => setHead(null));
  }, [busy]);

  async function act(label: string, fn: () => Promise<{ ok: boolean; message: string }>) {
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.message });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  const next: AppConfig = { user: user.trim(), repo: repo.trim(), pat: pat.trim(), name: name.trim(), email: email.trim() };

  return (
    <div className="stack">
      <Panel title="CONNECTION" accent="green">
        <label>Owner
          <input value={user} onChange={(e) => setUser(e.target.value)} />
        </label>
        <label>Repo
          <input value={repo} onChange={(e) => setRepo(e.target.value)} />
        </label>
        <label>PAT
          <input type="password" value={pat} onChange={(e) => setPat(e.target.value)} />
        </label>
        <div className="row wrap">
          <Btn variant="amber" small onClick={() => onSave(next)} disabled={busy}>
            SAVE
          </Btn>
          <Btn
            small
            onClick={() => act('Testing…', async () => {
              const r = await testConnection(next);
              if (r.ok) {
                const c = await createRemoteRepo(next);
                return c;
              }
              return r;
            })}
            disabled={busy}
          >
            TEST + CREATE
          </Btn>
        </div>
      </Panel>

      <Panel title="SYNC">
        <div className="row wrap">
          <Btn variant="amber" onClick={onSync} disabled={busy}>
            ⟳ SYNC NOW
          </Btn>
          <Btn
            variant="red"
            onClick={() => {
              if (confirm('Reset local clone to the remote? Local-only commits (none — everything pushes) are discarded.')) onReset();
            }}
            disabled={busy}
          >
            RESET TO REMOTE
          </Btn>
          <Btn
            variant="red"
            onClick={() => {
              if (confirm('Wipe ALL local data (clone, cache, settings stay). The remote is untouched.')) onWipe();
            }}
            disabled={busy}
          >
            WIPE LOCAL
          </Btn>
        </div>
        {head && <div className="dim small">local HEAD: <span className="mono">{head}</span></div>}
        <div className="dim small">
          commit identity: {cfg.name || '—'} &lt;{cfg.email || '—'}&gt;
        </div>
      </Panel>

      <Panel title="VALIDATION">
        <div className="hint">
          <Tag tone="ok">RULE</Tag> <code>garage.md</code> is never hand-edited — the agent and the PWA
          regenerate it from events. <code>tools/validate.mjs</code> checks every commit (event schemas,
          id uniqueness, fold cleanliness, garage.md freshness, pending claims parse).
        </div>
      </Panel>

      <Panel title="DANGER ZONE" accent="red">
        <Btn
          variant="red"
          small
          onClick={() => {
            if (confirm('Forget this device (settings, clone, cache)?')) onLogout();
          }}
          disabled={busy}
        >
          FORGET THIS DEVICE
        </Btn>
      </Panel>

      {msg && <div className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}
    </div>
  );
}
