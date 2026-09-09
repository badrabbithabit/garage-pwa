import React from 'react';
import { AppData } from '../store';
import { Btn, CarSprite, Empty, Panel, Tag, fmtDate, fmtMi, levelTag, statusTag, vehicleSummary } from '../ui';

export default function Dashboard({
  data,
  nav,
}: {
  data: AppData;
  nav: (h: string) => void;
}) {
  const vehicles = [...data.state.vehicles.values()];
  const attention = data.attention.items;
  const pending = data.pendingClaims.length;
  const items = [...data.state.items.values()];

  return (
    <div className="stack">
      <Panel title="GARAGE" accent="green" right={<Tag tone="info">{vehicles.length} CAR{vehicles.length === 1 ? '' : 'S'}</Tag>}>
        {vehicles.length === 0 ? (
          <Empty text="no cars yet — paste your first car below or drop a claim file for the agent" />
        ) : (
          <div className="car-grid">
            {vehicles.map((v) => (
              <div key={v.id} className="car-card" onClick={() => nav(`#/cars/${encodeURIComponent(v.id)}`)}>
                <div className="car-head">
                  <span className="car-name">{vehicleSummary(v)}</span>
                  {statusTag(v.status)}
                </div>
                <CarSprite name={v.id} />
                <div className="car-foot">
                  <span>{v.mileage ? fmtMi(v.mileage.value as number) : 'od —'}</span>
                  {attention.some((a) => a.vehicle === v.id) && <Tag tone="err">! ATTENTION</Tag>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="ATTENTION"
        accent={attention.length ? 'amber' : 'default'}
        right={attention.length ? <Tag tone="warn">{attention.length}</Tag> : undefined}
      >
        {attention.length === 0 ? (
          <Empty text="nothing due in the next 4 weeks" />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>CAR</th>
                <th>ITEM</th>
                <th>DUE</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {attention.map((a) => (
                <tr key={a.key} onClick={() => nav(`#/cars/${encodeURIComponent(a.vehicle)}`)}>
                  <td>{a.vehicle}</td>
                  <td>{a.label}</td>
                  <td>{fmtDate(a.due)}</td>
                  <td>{levelTag(a.level)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="STOCKROOM" right={<Tag tone="info">{items.length} PARTS</Tag>}>
        {items.length === 0 ? (
          <Empty text="no parts on file" />
        ) : (
          <div className="mini-list">
            {items.slice(0, 8).map((it) => (
              <div key={it.id} className="mini-row">
                <span className="mono dim">{it.id}</span>
                <span className="grow">{it.description}</span>
                <Tag tone={it.status === 'installed' ? 'ok' : it.status === 'ordered' ? 'warn' : 'info'}>
                  {it.status.toUpperCase()}
                </Tag>
              </div>
            ))}
            {items.length > 8 && <div className="dim small">+{items.length - 8} more in PARTS ▸</div>}
          </div>
        )}
      </Panel>

      <div className="row">
        <Btn variant="amber" onClick={() => nav('#/import')}>
          + PASTE / IMPORT
        </Btn>
        {pending > 0 && (
          <Btn variant="red" onClick={() => nav('#/review')}>
            ⚑ {pending} CLAIM{pending === 1 ? '' : 'S'} TO REVIEW
          </Btn>
        )}
      </div>
    </div>
  );
}
