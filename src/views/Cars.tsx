import React from 'react';
import { AppData } from '../store';
import {
  Btn,
  CarSprite,
  Empty,
  KV,
  Panel,
  Tag,
  confidenceTag,
  fmtDate,
  fmtMi,
  statusTag,
  vehicleSummary,
} from '../ui';

export default function Cars({
  data,
  id,
  nav,
}: {
  data: AppData;
  id: string | null;
  nav: (h: string) => void;
}) {
  if (id) return <CarDetail data={data} id={id} nav={nav} />;
  const vehicles = [...data.state.vehicles.values()];
  return (
    <div className="stack">
      <Panel title="FLEET" right={<Tag tone="info">{vehicles.length}</Tag>}>
        {vehicles.length === 0 ? (
          <Empty text="no cars yet" />
        ) : (
          <div className="list">
            {vehicles.map((v) => (
              <div key={v.id} className="list-row" onClick={() => nav(`#/cars/${encodeURIComponent(v.id)}`)}>
                <div>
                  <div className="car-name">{vehicleSummary(v)}</div>
                  <div className="dim small">
                    {v.vin?.value ? `VIN ${maskVin(v.vin.value as string)}` : v.id}
                    {v.mileage ? ` · ${fmtMi(v.mileage.value as number)}` : ''}
                  </div>
                </div>
                {statusTag(v.status)}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function maskVin(vin: string): string {
  const s = String(vin);
  return s.length <= 5 ? s : '••' + s.slice(-5);
}

function CarDetail({ data, id, nav }: { data: AppData; id: string; nav: (h: string) => void }) {
  const v = data.state.vehicles.get(decodeURIComponent(id));
  if (!v) {
    return (
      <div className="stack">
        <Panel title="CAR">
          <Empty text={`no vehicle "${id}"`} />
          <Btn small onClick={() => nav('#/cars')}>
            ◂ back
          </Btn>
        </Panel>
      </div>
    );
  }
  const maint = data.state.maintenance.filter((m) => m.vehicle === v.id).sort((a, b) => b.date.localeCompare(a.date));
  const projects = [...data.state.projects.values()].filter((p) => p.vehicle === v.id);
  const wishes = data.state.wishlist.filter((w) => w.vehicle === v.id);
  const parts = [...data.state.items.values()].filter((it) => it.vehicle === v.id);
  const notes = data.state.notes.filter((n) => n.target === v.id);
  const extras = Object.entries(v.extra);

  return (
    <div className="stack">
      <Panel title={v.id.toUpperCase()} accent="green" right={statusTag(v.status)}>
        <div className="car-detail-head">
          <CarSprite name={v.id} size={18} />
          <div className="grow">
            <div className="car-name big">{vehicleSummary(v)}</div>
            <div className="dim small">since {fmtDate(v.addedTs)}</div>
          </div>
        </div>
        <div className="kv-grid">
          <KV k="YEAR" v={v.year ? v.year.value : undefined} right={confidenceTag(v.year)} />
          <KV k="MAKE" v={v.make?.value} right={confidenceTag(v.make)} />
          <KV k="MODEL" v={v.model?.value} right={confidenceTag(v.model)} />
          <KV k="VIN" v={v.vin ? maskVin(String(v.vin.value)) : undefined} right={confidenceTag(v.vin)} />
          <KV k="MILEAGE" v={fmtMi(v.mileage?.value as number | undefined)} right={confidenceTag(v.mileage)} />
          <KV k="REG STATE" v={v.regState?.value} right={confidenceTag(v.regState)} />
          <KV k="REG EXPIRES" v={fmtDate(v.regExpires?.value as string | undefined)} right={confidenceTag(v.regExpires)} />
          <KV k="SMOG REQ" v={v.smogRequired ? 'YES' : undefined} />
          <KV k="LAST SMOG" v={fmtDate(v.lastSmog?.value as string | undefined)} right={confidenceTag(v.lastSmog)} />
          {extras.map(([k, f]) => (
            <KV key={k} k={k.toUpperCase()} v={String(f.value)} right={confidenceTag(f)} />
          ))}
          <KV k="NOTES" v={v.notes?.value} right={confidenceTag(v.notes)} />
        </div>
      </Panel>

      <Panel title="PARTS ON THIS CAR" right={<Tag tone="info">{parts.length}</Tag>}>
        {parts.length === 0 ? (
          <Empty text="nothing installed" />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>ID</th>
                <th>PART</th>
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((p) => (
                <tr key={p.id} onClick={() => nav('#/parts')}>
                  <td className="mono dim">{p.id}</td>
                  <td>{p.description}</td>
                  <td>
                    <Tag tone={p.status === 'installed' ? 'ok' : 'info'}>{p.status.toUpperCase()}</Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="SERVICE LOG" right={<Tag tone="info">{maint.length}</Tag>}>
        {maint.length === 0 ? (
          <Empty text="no entries" />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>DATE</th>
                <th>OD</th>
                <th>ITEM</th>
              </tr>
            </thead>
            <tbody>
              {maint.map((m) => (
                <tr key={m.eventId}>
                  <td>{fmtDate(m.date)}</td>
                  <td className="mono">{m.mileage !== undefined ? fmtMi(m.mileage) : ''}</td>
                  <td>
                    {m.item} {m.modification && <Tag tone="info">MOD</Tag>}
                    {m.notes ? <div className="dim small">{m.notes}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {projects.length > 0 && (
        <Panel title="PROJECTS" right={<Tag tone="info">{projects.length}</Tag>}>
          <div className="list">
            {projects.map((p) => (
              <div key={p.name} className="list-row">
                <span className="grow">{p.name}</span>
                {statusTag(p.status)}
                <span className="dim small">{p.parts.length} parts</span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {wishes.length > 0 && (
        <Panel title="WISHLIST" right={<Tag tone="info">{wishes.length}</Tag>}>
          <div className="list">
            {wishes.map((w) => (
              <div key={w.id} className="list-row">
                <span className="grow">{w.item}</span>
                <span className="mono dim">{w.targetPrice !== undefined ? `$${w.targetPrice}` : ''}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {notes.length > 0 && (
        <Panel title="NOTES">
          {notes.map((n) => (
            <div key={n.eventId} className="note-line">
              <span className="dim small">{fmtDate(n.ts)}</span> {n.text}
            </div>
          ))}
        </Panel>
      )}

      <Btn small onClick={() => nav('#/cars')}>
        ◂ BACK TO FLEET
      </Btn>
    </div>
  );
}
