// Shared DOS-panel UI components (pixel garage theme).
import React from 'react';
import { Fact, Item, Vehicle } from './core/types';

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const SPRITES: string[][] = [
  [
    '   _______   ',
    '  /  ___ \\  ',
    ' |__|___|__| ',
    ' |_________| ',
    '  o       o  ',
  ],
  [
    '   ________  ',
    '  /   __  \\  ',
    ' |___|  |___|',
    ' |___________|',
    '   o     o   ',
  ],
  [
    '  ___________ ',
    ' /  _     _  \\',
    '|__| |___| |__|',
    '|_____________|',
    '  o         o  ',
  ],
  [
    '    ______    ',
    '   /  __  \\   ',
    '  |__|  |__|  ',
    ' |___________| ',
    '  o       o   ',
  ],
];

export function CarSprite({ name, size = 14 }: { name: string; size?: number }) {
  const s = SPRITES[hashStr(name) % SPRITES.length];
  return (
    <pre className="sprite" style={{ fontSize: size * 0.66 }}>
      {s.join('\n')}
    </pre>
  );
}

export function Panel({
  title,
  accent = 'default',
  right,
  children,
}: {
  title: string;
  accent?: 'default' | 'green' | 'amber' | 'red';
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={`panel ${accent === 'default' ? '' : accent}`}>
      <header className="panel-title">
        <span>▚ {title}</span>
        {right}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Btn({
  children,
  onClick,
  variant = 'default',
  small,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'amber' | 'red' | 'ghost';
  small?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      className={`btn ${variant === 'default' ? '' : variant} ${small ? 'small' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

export function Tag({ tone, children }: { tone: 'ok' | 'warn' | 'err' | 'info' | 'dim'; children: React.ReactNode }) {
  return <span className={`tag ${tone}`}>{children}</span>;
}

export function confidenceTag(f?: Fact): React.ReactNode {
  if (!f) return null;
  const tone = f.confidence === 'high' ? 'ok' : f.confidence === 'medium' ? 'warn' : 'err';
  return <Tag tone={tone as 'ok' | 'warn' | 'err'}>{f.confidence.toUpperCase()} · T{f.tier}</Tag>;
}

export function KV({ k, v, right }: { k: string; v: React.ReactNode; right?: React.ReactNode }) {
  if (v === undefined || v === null || v === '') return null;
  return (
    <div className="kv">
      <span className="kv-k">{k}</span>
      <span className="kv-v">{v}</span>
      {right && <span className="kv-r">{right}</span>}
    </div>
  );
}

export function fmtDate(s?: string): string {
  if (!s) return '—';
  const d = s.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m) return s;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function fmtMi(mi?: number): string {
  if (mi === undefined) return '—';
  return `${Math.round(mi).toLocaleString()} mi`;
}

export function statusTag(status?: string) {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s.includes('active') || s.includes('running') || s.includes('ok')) return <Tag tone="ok">{status}</Tag>;
  if (s.includes('project') || s.includes('in progress') || s.includes('ordered')) return <Tag tone="info">{status}</Tag>;
  if (s.includes('storage') || s.includes('parked')) return <Tag tone="dim">{status}</Tag>;
  if (s.includes('sold') || s.includes('retired')) return <Tag tone="err">{status}</Tag>;
  return <Tag tone="dim">{status}</Tag>;
}

export function itemStatusTone(s: Item['status']): 'ok' | 'warn' | 'err' | 'info' | 'dim' {
  if (s === 'installed') return 'ok';
  if (s === 'in_inventory') return 'info';
  if (s === 'ordered') return 'warn';
  return 'dim';
}

export function vehicleSummary(v: Vehicle): string {
  const parts = [
    v.year?.value ? String(v.year.value) : undefined,
    v.make?.value,
    v.model?.value,
  ].filter(Boolean);
  return parts.join(' ') || v.id;
}

export function Empty({ text }: { text: string }) {
  return <div className="empty">— {text} —</div>;
}

export function levelTag(level: number): React.ReactNode {
  if (level === 3) return <Tag tone="err">OVERDUE</Tag>;
  if (level === 2) return <Tag tone="err">DUE</Tag>;
  if (level === 1) return <Tag tone="warn">SOON</Tag>;
  return <Tag tone="info">WATCH</Tag>;
}
