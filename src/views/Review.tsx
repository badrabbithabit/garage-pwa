import React, { useState } from 'react';
import { AppData } from '../store';
import { Claim } from '../core/types';
import { Btn, Empty, Panel, Tag } from '../ui';

export default function Review({
  data,
  onApprove,
  onReject,
  busy,
}: {
  data: AppData;
  onApprove: (paths: string[]) => void;
  onReject: (paths: string[]) => void;
  busy: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(data.pendingClaims.map((p) => p.path)));
  const pending = data.pendingClaims;

  function toggle(path: string) {
    const next = new Set(selected);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setSelected(next);
  }

  return (
    <div className="stack">
      <Panel
        title="CLAIM REVIEW"
        accent={pending.length ? 'amber' : 'default'}
        right={
          <span className="row">
            <Btn
              small
              variant="amber"
              disabled={busy || selected.size === 0}
              onClick={() => onApprove([...selected])}
            >
              ✓ APPROVE {selected.size || ''}
            </Btn>
            <Btn
              small
              variant="red"
              disabled={busy || selected.size === 0}
              onClick={() => {
                if (confirm(`Discard ${selected.size} claim file(s)? They move to claims/archived (not deleted).`))
                  onReject([...selected]);
              }}
            >
              ✗ DISCARD {selected.size || ''}
            </Btn>
          </span>
        }
      >
        <p className="hint">
          Claims arrive here from the agent (<code>claims/pending/</code>) or from the PASTE panel.
          Approving converts them into validated events and pushes a commit — nothing hits your data
          unreviewed.
        </p>
        <div className="row wrap">
          <button className="chip" onClick={() => setSelected(new Set(pending.map((p) => p.path)))}>
            SELECT ALL
          </button>
          <button className="chip" onClick={() => setSelected(new Set())}>
            NONE
          </button>
        </div>
      </Panel>

      {pending.length === 0 && <Empty text="review queue empty — agent has nothing pending" />}

      {pending.map((pc) => {
        const set = pc.parsed.set as any;
        const selectedThis = selected.has(pc.path);
        return (
          <Panel
            key={pc.path}
            title={pc.path.replace('claims/pending/', '')}
            accent={pc.parsed.ok ? 'default' : 'red'}
            right={
              <span className="row">
                <Btn small variant="amber" disabled={busy || !pc.parsed.ok} onClick={() => onApprove([pc.path])}>
                  ✓ APPROVE
                </Btn>
                <Btn small variant="red" disabled={busy} onClick={() => onReject([pc.path])}>
                  ✗
                </Btn>
              </span>
            }
          >
            {!pc.parsed.ok ? (
              <div className="msg err" dangerouslySetInnerHTML={{ __html: pc.parsed.errors.join('<br/>') }} />
            ) : (
              <>
                <div className="dim small">
                  source: {set?.source}
                  {set?.source_kind ? ` · kind: ${set.source_kind}` : ''}
                  {set?.date_captured ? ` · ${set.date_captured}` : ''}
                </div>
                {set?.summary ? <div className="small">{set.summary}</div> : null}
                {pc.parsed.errors.length > 0 ? (
                  <div
                    className="msg warn"
                    style={{ margin: '6px 0' }}
                    dangerouslySetInnerHTML={{ __html: pc.parsed.errors.join('<br/>') }}
                  />
                ) : null}
                <table className="tbl" style={{ marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th></th>
                      <th>TYPE</th>
                      <th>DETAIL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(pc.parsed.set?.claims || []).map((c: Claim, i: number) => (
                      <tr key={i}>
                        <td>
                          <input type="checkbox" checked={selectedThis} readOnly />
                        </td>
                        <td>
                          <Tag tone={c.type === 'vehicle' ? 'info' : c.type === 'part' || c.type === 'order' ? 'warn' : 'dim'}>
                            {String(c.type).toUpperCase()}
                          </Tag>
                        </td>
                        <td>{claimDetail(c)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </Panel>
        );
      })}
    </div>
  );
}

function claimDetail(c: Claim): string {
  switch (c.type) {
    case 'vehicle':
      if (c.field) return `${c.field} = ${String(c.value)}`;
      return [c.year, c.make, c.model].filter(Boolean).join(' ') || c.vin || '(vehicle)';
    case 'fact':
      return `${c.vehicle || '?'}: ${c.field} = ${String(c.value)}`;
    case 'part':
      return `${c.description || '(part)'} ${c.partNumber || c.part_number ? `P/N ${c.partNumber || c.part_number}` : ''} ${
        c.quantity ? `×${c.quantity}` : ''
      } ${c.status ? `[${c.status}]` : ''}`;
    case 'order':
      return `${c.vendor || 'order'} ${c.orderNumber || c.order_number ? `#${c.orderNumber || c.order_number}` : ''} · ${
        (c.items || c.lines || []).length
      } line(s)`;
    case 'maintenance':
    case 'modification':
      return `${c.vehicle || '?'}: ${c.item} ${c.date ? `(${c.date})` : ''} ${c.mileage !== undefined ? `@ ${c.mileage}mi` : ''}`;
    case 'recurring':
      return `${c.vehicle || '?'}: ${c.item} every ${c.intervalMiles || c.interval_miles ? `${c.intervalMiles || c.interval_miles}mi` : ''}${
        c.intervalMonths || c.interval_months ? `${(c.intervalMonths ?? c.interval_months) + 'mo'}` : ''
      }`;
    case 'wishlist':
      return `${c.vehicle || '?'}: ${c.item || c.description} ${c.targetPrice || c.target_price ? `target $${c.targetPrice || c.target_price}` : ''}`;
    case 'project':
      return `${c.vehicle || 'garage'}: ${c.item || c.description} ${c.status ? `[${c.status}]` : ''}`;
    default:
      return JSON.stringify(c).slice(0, 120);
  }
}
