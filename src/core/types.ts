// Garage Tracker — core domain types (framework-agnostic).
// Events are the source of truth; State is a fold over events; garage.md is a render of State.

export type SourceTier = 1 | 2 | 3 | 4;
/**
 * 1 = direct measurement / user manual entry
 * 2 = user-supplied document (receipt, service record, photo)
 * 3 = third-party verifiable (VIN report, DMV/registration record)
 * 4 = unverified (listing, forum, LLM guess)
 */

export type SourceKind =
  | 'manual' | 'user' | 'paste' | 'import'
  | 'receipt' | 'service_record' | 'document'
  | 'vin_report' | 'dmv' | 'registration' | 'third_party'
  | 'listing' | 'forum'
  | 'agent' | 'llm';

export interface Provenance {
  tier: SourceTier;
  kind: SourceKind | string;
  ref?: string;      // URL, file path, order number…
  detail?: string;   // human note ("seller listing", "photo of receipt")
}

export interface EventBase {
  v: 1;
  id: string;        // unique; == events/<id>.json filename stem
  ts: string;        // ISO timestamp of when the change was recorded
  provenance?: Provenance; // optional for hand-edited files; fold defaults to tier-1 manual
}

export interface OrderItem {
  partId?: string;   // optional reference to existing part; omit to create a new one
  description: string;
  partNumber?: string;
  manufacturer?: string;
  quantity: number;
  vehicle?: string;
  price?: number;
}

export type ItemStatus = 'ordered' | 'in_inventory' | 'installed' | 'retired';

export type GEvent =
  | (EventBase & { type: 'vehicle_added'; vehicle: string; year?: number; make?: string; model?: string; vin?: string; status?: string; notes?: string })
  | (EventBase & { type: 'vehicle_fact_claimed'; vehicle: string; field: string; value: unknown; date?: string })
  | (EventBase & { type: 'vehicle_removed'; vehicle: string; reason?: string })
  | (EventBase & { type: 'parts_ordered'; vendor: string; orderNumber: string; date?: string; items: OrderItem[] })
  | (EventBase & { type: 'order_delivered'; orderNumber: string; date?: string; notes?: string })
  | (EventBase & { type: 'part_added'; partId: string; description: string; partNumber?: string; manufacturer?: string; quantity?: number; vehicle?: string; status?: ItemStatus; vendor?: string; price?: number; notes?: string; date?: string })
  | (EventBase & { type: 'part_installed'; partId: string; vehicle: string; date?: string; notes?: string })
  | (EventBase & { type: 'part_removed'; partId: string; date?: string; reason?: string })
  | (EventBase & { type: 'part_reassigned'; partId: string; toVehicle: string; date?: string; notes?: string })
  | (EventBase & { type: 'part_retired'; partId: string; reason?: string; date?: string; notes?: string })
  | (EventBase & { type: 'maintenance_logged'; vehicle: string; date: string; mileage?: number; item: string; notes?: string; isModification?: boolean })
  | (EventBase & { type: 'recurring_set'; vehicle: string; item: string; intervalMiles?: number; intervalMonths?: number; notes?: string })
  | (EventBase & { type: 'project_added'; name: string; vehicle?: string; status?: string; parts?: string[]; notes?: string })
  | (EventBase & { type: 'project_status_changed'; project: string; status: string; notes?: string })
  | (EventBase & { type: 'project_part_added'; project: string; partId: string })
  | (EventBase & { type: 'wishlist_added'; vehicle: string; item: string; targetPrice?: number; watch?: string; notes?: string })
  | (EventBase & { type: 'reminder_sent'; key: string; level?: string; summary?: string })
  | (EventBase & { type: 'reminder_snoozed'; key: string; until: string; reason?: string })
  | (EventBase & { type: 'claim_resolved'; claimId: string; action: 'approved' | 'discarded' | 'edited'; detail?: string })
  | (EventBase & { type: 'note'; target?: string; text: string });

export type GEventType = GEvent['type'];

// ---------- State (fold result) ----------

export type Confidence = 'high' | 'medium' | 'low';

export interface Fact<T = unknown> {
  value: T;
  tier: SourceTier;
  kind: string;
  ref?: string;
  ts: string;           // when this fact was claimed
  confidence: Confidence;
}

export interface Vehicle {
  id: string;            // display name used as ID ("W124", "Rabbit")
  status: string;        // Active | Project | Storage | Sold | …
  make?: Fact<string>;
  model?: Fact<string>;
  year?: Fact<number>;
  vin?: Fact<string>;
  mileage?: Fact<number>;
  regState?: Fact<string>;
  regExpires?: Fact<string>;
  smogRequired?: boolean;
  lastSmog?: Fact<string>;
  notes?: Fact<string>;
  extra: Record<string, Fact<unknown>>;
  addedTs: string;
}

export interface Item {
  id: string;            // PART-00042
  description: string;
  partNumber?: string;
  manufacturer?: string;
  quantity: number;
  status: ItemStatus;
  vehicle?: string;
  vendor?: string;
  orderNumber?: string;
  ordered?: string;
  received?: string;
  price?: number;
  notes?: string;
  retiredReason?: string;
  retiredDate?: string;
  history: { vehicle: string; installed?: string; removed?: string }[];
  addedTs: string;
}

export interface Project {
  name: string;          // name is the ID
  vehicle?: string;
  status: string;
  parts: string[];
  notes?: string;
  updatedTs: string;
}

export interface MaintEntry {
  eventId: string;
  ts: string;
  vehicle: string;
  date: string;
  mileage?: number;
  item: string;
  notes?: string;
  modification?: boolean;
}

export interface Recurring {
  vehicle: string;
  item: string;
  intervalMiles?: number;
  intervalMonths?: number;
  lastDate?: string;
  lastMileage?: number;
  updatedTs: string;
}

export interface WishItem {
  id: string;            // WL-0001
  vehicle: string;
  item: string;
  targetPrice?: number;
  watch?: string;
  notes?: string;
  ts: string;
}

export interface ReminderAudit { key: string; ts: string; level?: string }

export interface State {
  vehicles: Map<string, Vehicle>;
  items: Map<string, Item>;
  projects: Map<string, Project>;
  maintenance: MaintEntry[];
  recurring: Map<string, Recurring>;   // key: `${vehicle}|${normalizedItem}`
  wishlist: WishItem[];
  remindersSent: ReminderAudit[];
  snoozes: Map<string, string>;        // key → snoozed-until ISO
  notes: { ts: string; target?: string; text: string; eventId: string }[];
}

export function emptyState(): State {
  return {
    vehicles: new Map(),
    items: new Map(),
    projects: new Map(),
    maintenance: [],
    recurring: new Map(),
    wishlist: [],
    remindersSent: [],
    snoozes: new Map(),
    notes: [],
  };
}

// ---------- Claims (LLM / paste → review → events) ----------

export type ClaimType = 'vehicle' | 'fact' | 'part' | 'maintenance' | 'modification' | 'order' | 'wishlist' | 'project' | 'recurring';

/** One claim as accepted in the canonical onboarding shape (spec §6) and by the agent. */
export interface Claim {
  type: ClaimType;
  vehicle?: string;
  // vehicle claims (fact shape: field+value; description shape: make/model/year/…)
  field?: string;
  value?: unknown;
  make?: string;
  model?: string;
  year?: number;
  vin?: string;
  // part / order claims
  description?: string;
  part_number?: string;
  partNumber?: string;
  manufacturer?: string;
  quantity?: number;
  status?: string;
  vendor?: string;
  order_number?: string;
  orderNumber?: string;
  price?: number;
  // maintenance / modification
  date?: string;
  mileage?: number;
  item?: string;
  notes?: string;
  // wishlist
  target_price?: number;
  targetPrice?: number;
  watch?: string;
  // order items (optional) — `lines` is the alias LLMs commonly emit
  items?: OrderItem[];
  lines?: OrderItem[];
  // project
  parts?: string[];
  // recurring intervals
  interval_miles?: number;
  interval_months?: number;
  intervalMiles?: number;
  intervalMonths?: number;
  // provenance for this individual claim
  source_detail?: string;
  sourceDetail?: string;
  // passthrough for anything else (displayed, never dropped)
  [k: string]: unknown;
}

export interface ClaimFit {
  project?: string;
  assessment?: string;
  match?: 'yes' | 'partial' | 'no' | string;
}

/** A reviewable set of claims. Accepts both the spec onboarding shape and agent claim files. */
export interface ClaimSet {
  id?: string;            // agent claim files have one
  source: string;
  date_captured?: string;
  claims: Claim[];
  // agent-file extras:
  ts?: string;
  status?: string;
  summary?: string;
  confidence?: number;
  fit?: ClaimFit;
  [k: string]: unknown;
}

export interface ClaimResolution {
  action: 'approved' | 'discarded' | 'edited';
  ts: string;
  by: string;
  eventIds?: string[];
  note?: string;
}

// ---------- Attention / reminders ----------

export type AttentionLevel = 0 | 1 | 2 | 3; // 0=watch(4w) 1=soon(2w) 2=due(1w) 3=overdue

export interface AttentionItem {
  key: string;            // `reg:W124` | `smog:Rabbit` | `maint:Rabbit|oil`
  vehicle: string;
  kind: 'registration' | 'smog' | 'maintenance';
  label: string;
  due: string;            // ISO date
  days: number;           // whole days from today (negative = overdue)
  level: AttentionLevel;
  snoozedUntil?: string;
}
