import React, { useState } from 'react';
import { AppData } from '../store';
import { Empty, Panel, Tag, fmtDate, itemStatusTone } from '../ui';
import { ItemStatus } from '../core/types';

const ORDER: ItemStatus[] = ['ordered', 'in_inventory', 'installed', 'retired'];

export default function Parts({ data }: { data: AppData }) {
  const [filter, setFilter] = useState<'all' | ItemStatus>('all');
  const items = [...data.state.items.values()]
    .filter((it) => filter === 'all' || it.status === filter)
    .sort((a, b) => a.id.localeCompare(b.id));

  return (
    <div className="stack">
      <Panel
        title="PARTS INVENTORY"
        right={<Tag tone="info">{data.state.items.size} TOTAL</Tag>}
      >
        <div className="row wrap">
          <button
            className={`chip ${filter === 'all' ? 'on' : ''}`}
            onClick={() => setFilter('all')}
          >
            ALL
          </button>
          {ORDER.map((s) => (
            <button
              key={s}
              className={`chip ${filter === s ? 'on' : ''}`}
              onClick={() => setFilter(s)}
            >
              {s.toUpperCase()}
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="STOCK">
        {items.length === 0 ? (
          <Empty text="no parts match" />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>ID</th>
                <th>PART</th>
                <th>QTY</th>
                <th>STATUS</th>
                <th>CAR</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td className="mono dim">{it.id}</td>
                  <td>
                    {it.description}
                    {it.partNumber ? <div className="dim small">P/N {it.partNumber} {it.manufacturer ? `· ${it.manufacturer}` : ''}</div> : null}
                    {it.price !== undefined ? <div className="dim small">${it.price}</div> : null}
                  </td>
                  <td className="mono">{it.quantity}</td>
                  <td>
                    <Tag tone={itemStatusTone(it.status)}>{it.status.toUpperCase()}</Tag>
                  </td>
                  <td>{it.vehicle || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
