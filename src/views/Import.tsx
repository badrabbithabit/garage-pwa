import React, { useState } from 'react';
import { parseClaimSet } from '../core/claims';
import { Btn, Panel, Tag } from '../ui';
import { claimExample } from './import-example';

export default function Import({
  onSend,
  busy,
}: {
  onSend: (text: string, source: string) => void;
  busy: boolean;
}) {
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  const [parsed, setParsed] = useState<ReturnType<typeof parseClaimSet> | null>(null);

  function preview() {
    setParsed(parseClaimSet(text));
  }

  return (
    <div className="stack">
      <Panel title="PASTE / IMPORT" accent="green">
        <p className="hint">
          Paste a claim set (the spec §6 JSON — or just the <code>claims</code> array wrapped in an
          object). It lands in <code>claims/pending/</code> and shows up in REVIEW. Use this for
          receipts, listings, VIN decodes, service records — or anything an LLM has already shaped.
        </p>
        <label>Source (optional — receipt / listing / forum / …)
          <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="listing — fb marketplace" />
        </label>
        <textarea
          className="json"
          rows={12}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={claimExample}
          spellCheck={false}
        />
        <div className="row">
          <Btn variant="amber" onClick={preview} disabled={busy || !text.trim()}>
            PREVIEW
          </Btn>
          <Btn
            onClick={() => {
              if (confirm('Send to the review queue? (a commit is pushed to your private repo)')) onSend(text, source);
            }}
            disabled={busy || !text.trim()}
          >
            SEND TO REVIEW ▸
          </Btn>
          <Btn variant="ghost" small onClick={() => setText(claimExample)}>
            LOAD EXAMPLE
          </Btn>
        </div>
        {parsed &&
          (parsed.ok ? (
            <div className="msg ok">
              <Tag tone="ok">VALID</Tag> {parsed.set!.claims.length} claim(s):{' '}
              {parsed.set!.claims.map((c) => String(c.type)).join(', ')}
            </div>
          ) : (
            <div className="msg err" dangerouslySetInnerHTML={{ __html: parsed.errors.join('<br/>') }} />
          ))}
      </Panel>
    </div>
  );
}
