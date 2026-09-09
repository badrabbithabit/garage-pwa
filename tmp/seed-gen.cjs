// src/core/render.ts
var money = (n) => n === void 0 ? void 0 : `$${n.toFixed(2)}`;
var comma = (n) => n.toLocaleString("en-US");
function confSuffix(fact) {
  if (fact.confidence === "high") return "";
  const day = fact.ts.slice(0, 10);
  return ` (confidence: ${fact.confidence}, last verified: ${day})`;
}
function mileageLine(v) {
  if (!v.mileage) return null;
  const m = v.mileage.value;
  const tilde = v.mileage.confidence === "high" ? "" : "~";
  return `- Mileage: ${tilde}${comma(m)}${confSuffix(v.mileage)}`;
}
function vinMasked(vin) {
  return vin.length <= 4 ? vin : `...${vin.slice(-4)}`;
}
function renderVehicle(v) {
  const out2 = [`### ${v.id}`];
  out2.push(`- Status: ${v.status || "Active"}`);
  if (v.year || v.make || v.model) {
    out2.push(`- Year: ${v.year?.value ?? "?"}`);
    out2.push(`- Make/Model: ${[v.make?.value, v.model?.value].filter(Boolean).join(" ") || "?"}`);
  }
  if (v.vin) out2.push(`- VIN: ${vinMasked(String(v.vin.value))}${confSuffix(v.vin)}`);
  const ml = mileageLine(v);
  if (ml) out2.push(ml);
  const reg = [];
  if (v.regState) reg.push(String(v.regState.value));
  if (v.regExpires) reg.push(`expires ${v.regExpires.value}`);
  if (v.smogRequired) {
    reg.push("smog required");
    if (v.lastSmog) reg.push(`last smog ${v.lastSmog.value}`);
  }
  if (reg.length) out2.push(`- Registration: ${reg.join(", ")}`);
  if (v.notes) out2.push(`- Notes: ${v.notes.value}`);
  for (const [k, f] of Object.entries(v.extra)) out2.push(`- ${k}: ${String(f.value)}`);
  return out2.join("\n");
}
function renderItem(it) {
  const out2 = [`### ${it.id} \u2014 ${it.description}`];
  if (it.partNumber) out2.push(`- Part #: ${it.partNumber}`);
  if (it.manufacturer) out2.push(`- Manufacturer: ${it.manufacturer}`);
  out2.push(`- Quantity: ${it.quantity}`);
  out2.push(`- Status: ${it.status === "in_inventory" ? "In inventory" : it.status === "ordered" ? "Ordered" : it.status === "installed" ? "Installed" : "Retired"}`);
  if (it.vehicle) out2.push(`- Vehicle: ${it.vehicle}`);
  if (it.history.length) {
    out2.push("- Install history:");
    for (const h of it.history) out2.push(`  - ${h.vehicle} \u2014 installed: ${h.installed ?? "\u2014"} \u2014 removed: ${h.removed ?? "\u2014"}`);
  }
  if (it.vendor) out2.push(`- Vendor: ${it.vendor}`);
  if (it.orderNumber) out2.push(`- Order #: ${it.orderNumber}`);
  if (it.ordered) out2.push(`- Ordered: ${it.ordered}`);
  if (it.received) out2.push(`- Received: ${it.received}`);
  if (it.status === "installed") {
    const last = it.history[it.history.length - 1];
    if (last?.installed) out2.push(`- Installed: ${last.installed}`);
  }
  if (it.price !== void 0) out2.push(`- Price: ${money(it.price)}`);
  if (it.retiredReason) out2.push(`- Retired: ${it.retiredDate ?? "\u2014"} (${it.retiredReason})`);
  if (it.notes) out2.push(`- Notes: ${it.notes}`);
  return out2.join("\n");
}
function renderGarageMd(state) {
  const sections = [];
  const vehicles = [...state.vehicles.values()].sort(
    (a, b) => a.addedTs < b.addedTs ? -1 : a.addedTs > b.addedTs ? 1 : 0
  );
  const items = [...state.items.values()].sort((a, b) => a.id.localeCompare(b.id));
  const projects = [...state.projects.values()].sort((a, b) => a.name.localeCompare(b.name));
  const now = /* @__PURE__ */ new Date();
  const ts = `${now.toISOString().slice(0, 10)} ${now.toTimeString().slice(0, 5)}`;
  sections.push(`# Garage
`);
  sections.push(`_Generated ${ts} \u2014 do not hand-edit. Data lives in events/._
`);
  if (vehicles.length) {
    sections.push(`## Vehicles
`);
    for (const v of vehicles) sections.push(`${renderVehicle(v)}
`);
  }
  if (items.length) {
    sections.push(`---
## Inventory
`);
    for (const it of items) sections.push(`${renderItem(it)}
`);
  }
  if (projects.length) {
    sections.push(`---
## Projects
`);
    for (const p of projects) {
      const out2 = [`### ${p.name}`];
      if (p.vehicle) out2.push(`- Vehicle: ${p.vehicle}`);
      out2.push(`- Status: ${p.status}`);
      if (p.parts.length) out2.push(`- Parts: ${p.parts.join(", ")}`);
      if (p.notes) out2.push(`- Notes: ${p.notes}`);
      sections.push(`${out2.join("\n")}
`);
    }
  }
  {
    const byVehicle = /* @__PURE__ */ new Map();
    for (const e of state.maintenance) {
      const arr = byVehicle.get(e.vehicle) ?? [];
      arr.push({ date: e.date, item: e.item, mileage: e.mileage, notes: e.notes, mod: e.modification });
      byVehicle.set(e.vehicle, arr);
    }
    if (byVehicle.size) {
      sections.push(`---
## Maintenance
`);
      for (const [veh, entries] of [...byVehicle.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        sections.push(`### ${veh}`);
        for (const e of entries.sort((a, b) => a.date.localeCompare(b.date))) {
          const bits = [`${e.date} \u2014 ${e.mod ? "MOD: " : ""}${e.item}`];
          if (e.mileage !== void 0) bits.push(`${comma(e.mileage)} mi`);
          if (e.notes) bits.push(e.notes);
          sections.push(`- ${bits.join(", ")}`);
        }
        sections.push("");
      }
    }
  }
  {
    const byVehicle = /* @__PURE__ */ new Map();
    for (const r of state.recurring.values()) {
      const arr = byVehicle.get(r.vehicle) ?? [];
      arr.push(r);
      byVehicle.set(r.vehicle, arr);
    }
    if (byVehicle.size) {
      sections.push(`---
## Recurring Maintenance
`);
      for (const [veh, recs] of [...byVehicle.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        sections.push(`### ${veh}`);
        for (const r of recs.sort((a, b) => a.item.localeCompare(b.item))) {
          const interval = [
            r.intervalMiles ? `${comma(r.intervalMiles)} mi` : null,
            r.intervalMonths ? `${r.intervalMonths} months` : null
          ].filter(Boolean).join(" / ");
          const last = r.lastDate ? `last: ${r.lastDate}${r.lastMileage !== void 0 ? ` (${comma(r.lastMileage)} mi)` : ""}` : "last: \u2014";
          sections.push(`- ${r.item} \u2014 interval: ${interval || "\u2014"} \u2014 ${last}`);
        }
        sections.push("");
      }
    }
  }
  {
    const byVehicle = /* @__PURE__ */ new Map();
    for (const w of state.wishlist) {
      const arr = byVehicle.get(w.vehicle) ?? [];
      arr.push(w);
      byVehicle.set(w.vehicle, arr);
    }
    if (byVehicle.size) {
      sections.push(`---
## Wishlist
`);
      for (const [veh, ws] of [...byVehicle.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        sections.push(`### ${veh}`);
        for (const w of ws) {
          const bits = [`- ${w.item}`];
          if (w.targetPrice !== void 0) bits.push(`target: ${money(w.targetPrice)}`);
          if (w.watch) bits.push(`watch: ${w.watch}`);
          sections.push(bits.join(" \u2014 "));
        }
        sections.push("");
      }
    }
  }
  return sections.join("\n");
}
function renderGarageMdDeterministic(state) {
  return renderGarageMd(state).replace(/^_Generated .*?_\n?/m, "");
}

// src/core/types.ts
function emptyState() {
  return {
    vehicles: /* @__PURE__ */ new Map(),
    items: /* @__PURE__ */ new Map(),
    projects: /* @__PURE__ */ new Map(),
    maintenance: [],
    recurring: /* @__PURE__ */ new Map(),
    wishlist: [],
    remindersSent: [],
    snoozes: /* @__PURE__ */ new Map(),
    notes: []
  };
}

// ../seed-gen-entry.ts
var import_node_fs = require("node:fs");
(0, import_node_fs.mkdirSync)("garage", { recursive: true });
var out = renderGarageMdDeterministic(emptyState());
(0, import_node_fs.writeFileSync)("garage/garage.md", out);
console.log("seed garage.md written:", out.length, "chars");
console.log("---");
console.log(out);
