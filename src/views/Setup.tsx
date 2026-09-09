import React, { useState } from 'react';
import { AppConfig } from '../db';
import { createRemoteRepo, testConnection } from '../sync/git';
import { Btn, Panel } from '../ui';

export default function Setup({
  onSaved,
  onBusy,
}: {
  onSaved: (cfg: AppConfig) => void;
  onBusy: (m: string | null) => void;
}) {
  const [user, setUser] = useState('');
  const [repo, setRepo] = useState('garage');
  const [pat, setPat] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(label: string, fn: () => Promise<{ ok: boolean; message: string }>) {
    setBusy(true);
    onBusy(label);
    try {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.message });
      return r.ok;
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
      return false;
    } finally {
      setBusy(false);
      onBusy(null);
    }
  }

  const cfg: AppConfig = {
    user: user.trim(),
    repo: repo.trim() || 'garage',
    pat: pat.trim(),
    name: name.trim(),
    email: email.trim(),
  };

  async function test() {
    const ok = await run('Testing connection…', () => testConnection(cfg));
    if (ok) {
      const c = await createRemoteRepo(cfg);
      setMsg({ ok: c.ok, text: c.message });
    }
  }

  function save() {
    if (!cfg.user || !cfg.pat || !cfg.email) {
      setMsg({ ok: false, text: 'Owner, PAT and commit email are required.' });
      return;
    }
    if (!/^[^/]+\/[^/]+$/.test(`${cfg.user}/${cfg.repo}`)) {
      setMsg({ ok: false, text: 'Bad owner/repo.' });
      return;
    }
    onSaved(cfg);
  }

  return (
    <div className="setup">
      <Panel title="GARAGE TRACKER // LINK TO GARAGE" accent="green">
        <p className="hint">
          The app syncs a <b>private</b> GitHub repo (your data) straight from this device.
          Make a fine-grained PAT at <code>github.com → Settings → Developer settings → Fine-grained tokens</code>:
          content <b>github.com</b> (and api.github.com), permission <b>Contents: Read/Write</b> on your{' '}
          <code>{cfg.repo || 'garage'}</code> repo. The PAT never leaves this browser except to GitHub.
        </p>
        <label>GitHub owner / username
          <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="jdjes" autoFocus />
        </label>
        <label>Data repo (private)
          <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="garage" />
        </label>
        <label>Fine-grained PAT
          <input type="password" value={pat} onChange={(e) => setPat(e.target.value)} placeholder="github_pat_…" />
        </label>
        <label>Commit name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jon" />
        </label>
        <label>Commit email (noreply is fine)
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </label>
        <div className="row">
          <Btn variant="amber" onClick={test} disabled={busy}>
            TEST + CREATE REPO
          </Btn>
          <Btn onClick={save} disabled={busy}>
            START TRACKING ▸
          </Btn>
        </div>
        {msg && <div className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}
      </Panel>
    </div>
  );
}
