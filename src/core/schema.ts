// Zod schemas for events (strict) and claim sets (permissive).
// Event schemas double as the source for JSON schemas shipped in garage/schemas/.
import { z } from 'zod';
import { GEvent } from './types';

export const sourceTier = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

export const provenanceSchema = z.object({
  tier: sourceTier,
  kind: z.string().min(1),
  ref: z.string().optional(),
  detail: z.string().optional(),
});

const dateStr = z.string().regex(/^\d{4}-?\d{2}-?\d{2}/, 'expected a date like 2026-08-08');
const idStr = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/i, 'id must be filename-safe (no spaces/slashes)');

const base = (extra: Record<string, z.ZodTypeAny>) =>
  z.object({ v: z.literal(1), id: idStr, ts: z.string().datetime({ offset: true }), provenance: provenanceSchema.optional(), ...extra }).strict();

const orderItemSchema = z.object({
  partId: z.string().optional(),
  description: z.string().min(1),
  partNumber: z.string().optional(),
  manufacturer: z.string().optional(),
  quantity: z.number().int().positive().default(1),
  vehicle: z.string().optional(),
  price: z.number().optional(),
}).strict();

export const vehicleAdded = base({ type: z.literal('vehicle_added'), vehicle: z.string().min(1), year: z.number().int().optional(), make: z.string().optional(), model: z.string().optional(), vin: z.string().optional(), status: z.string().optional(), notes: z.string().optional() });
export const vehicleFactClaimed = base({ type: z.literal('vehicle_fact_claimed'), vehicle: z.string().min(1), field: z.string().min(1), value: z.unknown(), date: dateStr.optional() });
export const vehicleRemoved = base({ type: z.literal('vehicle_removed'), vehicle: z.string().min(1), reason: z.string().optional() });
export const partsOrdered = base({ type: z.literal('parts_ordered'), vendor: z.string().min(1), orderNumber: z.string().min(1), date: dateStr.optional(), items: z.array(orderItemSchema).min(1) });
export const orderDelivered = base({ type: z.literal('order_delivered'), orderNumber: z.string().min(1), date: dateStr.optional(), notes: z.string().optional() });
export const partAdded = base({ type: z.literal('part_added'), partId: z.string().regex(/^PART-\d{5,}$/), description: z.string().min(1), partNumber: z.string().optional(), manufacturer: z.string().optional(), quantity: z.number().int().positive().optional(), vehicle: z.string().optional(), status: z.enum(['ordered', 'in_inventory', 'installed', 'retired']).optional(), vendor: z.string().optional(), price: z.number().optional(), notes: z.string().optional(), date: dateStr.optional() });
export const partInstalled = base({ type: z.literal('part_installed'), partId: z.string().min(1), vehicle: z.string().min(1), date: dateStr.optional(), notes: z.string().optional() });
export const partRemoved = base({ type: z.literal('part_removed'), partId: z.string().min(1), date: dateStr.optional(), reason: z.string().optional() });
export const partReassigned = base({ type: z.literal('part_reassigned'), partId: z.string().min(1), toVehicle: z.string().min(1), date: dateStr.optional(), notes: z.string().optional() });
export const partRetired = base({ type: z.literal('part_retired'), partId: z.string().min(1), reason: z.string().optional(), date: dateStr.optional(), notes: z.string().optional() });
export const maintenanceLogged = base({ type: z.literal('maintenance_logged'), vehicle: z.string().min(1), date: dateStr.min(1), mileage: z.number().optional(), item: z.string().min(1), notes: z.string().optional(), isModification: z.boolean().optional() });
export const recurringSet = base({ type: z.literal('recurring_set'), vehicle: z.string().min(1), item: z.string().min(1), intervalMiles: z.number().positive().optional(), intervalMonths: z.number().positive().optional(), notes: z.string().optional() });
export const projectAdded = base({ type: z.literal('project_added'), name: z.string().min(1), vehicle: z.string().optional(), status: z.string().optional(), parts: z.array(z.string()).optional(), notes: z.string().optional() });
export const projectStatusChanged = base({ type: z.literal('project_status_changed'), project: z.string().min(1), status: z.string().min(1), notes: z.string().optional() });
export const projectPartAdded = base({ type: z.literal('project_part_added'), project: z.string().min(1), partId: z.string().min(1) });
export const wishlistAdded = base({ type: z.literal('wishlist_added'), vehicle: z.string().min(1), item: z.string().min(1), targetPrice: z.number().optional(), watch: z.string().optional(), notes: z.string().optional() });
export const reminderSent = base({ type: z.literal('reminder_sent'), key: z.string().min(1), level: z.string().optional(), summary: z.string().optional() });
export const reminderSnoozed = base({ type: z.literal('reminder_snoozed'), key: z.string().min(1), until: z.string().datetime({ offset: true }), reason: z.string().optional() });
export const claimResolved = base({ type: z.literal('claim_resolved'), claimId: z.string().min(1), action: z.enum(['approved', 'discarded', 'edited']), detail: z.string().optional() });
export const note = base({ type: z.literal('note'), target: z.string().optional(), text: z.string().min(1) });

// Cast: the base() helper's generic shape erases the 'type' key from TS's view, but every
// member genuinely has it at runtime (zod validates the discriminator).
export const eventSchema: z.ZodType<GEvent> = (z.discriminatedUnion as any)('type', [
  vehicleAdded, vehicleFactClaimed, vehicleRemoved, partsOrdered, orderDelivered,
  partAdded, partInstalled, partRemoved, partReassigned, partRetired,
  maintenanceLogged, recurringSet, projectAdded, projectStatusChanged, projectPartAdded,
  wishlistAdded, reminderSent, reminderSnoozed, claimResolved, note,
]);

export type InferredEvent = GEvent;

// ---------- Claims: PERMISSIVE (this is LLM/paste input; be forgiving, surface problems in review) ----------

// Numbers as numbers or numeric strings (LLMs love "87,231").
const numStr = z.union([z.number(), z.string()]);

export const claimSchema = z
  .object({
    type: z.enum(['vehicle', 'fact', 'part', 'maintenance', 'modification', 'order', 'wishlist', 'project', 'recurring']),
    vehicle: z.string().optional(),
    field: z.string().optional(),
    value: z.unknown().optional(),
    description: z.string().optional(),
    part_number: z.string().optional(),
    partNumber: z.string().optional(),
    manufacturer: z.string().optional(),
    quantity: z.number().int().optional(),
    status: z.string().optional(),
    vendor: z.string().optional(),
    order_number: z.string().optional(),
    orderNumber: z.string().optional(),
    price: numStr.optional(),
    date: z.string().optional(),
    mileage: numStr.optional(),
    item: z.string().optional(),
    notes: z.string().optional(),
    target_price: numStr.optional(),
    targetPrice: numStr.optional(),
    watch: z.string().optional(),
    items: z.array(z.any()).optional(),
    lines: z.array(z.any()).optional(),
    make: z.string().optional(),
    model: z.string().optional(),
    year: z.number().int().optional(),
    vin: z.string().optional(),
    parts: z.array(z.string()).optional(),
    interval_miles: numStr.optional(),
    intervalMiles: numStr.optional(),
    interval_months: numStr.optional(),
    intervalMonths: numStr.optional(),
    source_detail: z.string().optional(),
    sourceDetail: z.string().optional(),
  })
  .passthrough();

export const claimSetSchema = z
  .object({
    id: z.string().optional(),
    source: z.string().min(1),
    date_captured: z.string().optional(),
    claims: z.array(claimSchema).min(1),
    ts: z.string().optional(),
    status: z.string().optional(),
    summary: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    fit: z
      .object({
        project: z.string().optional(),
        assessment: z.string().optional(),
        match: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type ClaimSetInput = z.infer<typeof claimSetSchema>;

// Map a provenance kind to its default tier (the *underlying source* sets the tier, not the extractor).
export function tierForKind(kind: string): 1 | 2 | 3 | 4 {
  const k = (kind || '').toLowerCase();
  if (['manual', 'user', 'measurement', 'paste'].includes(k)) return 1;
  if (['receipt', 'service_record', 'document', 'photo', 'scan'].includes(k)) return 2;
  if (['vin_report', 'dmv', 'registration', 'third_party', 'title'].includes(k)) return 3;
  return 4; // listing, forum, llm, agent, anything else
}
