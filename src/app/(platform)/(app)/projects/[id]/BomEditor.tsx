"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconPencil, IconPlus, IconX } from "@/components/platform/icons";
import { Button, cx, inputClass } from "@/components/platform/ui";
import type { BomLine } from "@/lib/bom";

const usd = (n: number) => `$${n.toFixed(2)}`;

type Draft = {
  name: string;
  purpose: string;
  quantity: string;
  unitCostUsd: string;
  vendor: string;
  link: string;
};

const FIELD_NAMES: Record<keyof Draft, string> = {
  name: "Part",
  purpose: "What it's for",
  quantity: "Qty",
  unitCostUsd: "Unit $",
  vendor: "Vendor",
  link: "Link",
};

/** "Fill out the required fields", naming the ones that are missing. */
function requiredMessage(fields: (keyof Draft)[]) {
  return `Fill out the required fields: ${fields.map((k) => FIELD_NAMES[k]).join(", ")}.`;
}

const EMPTY: Draft = { name: "", purpose: "", quantity: "1", unitCostUsd: "", vendor: "", link: "" };

function draftOf(line: BomLine): Draft {
  return {
    name: line.name,
    purpose: line.purpose ?? "",
    quantity: String(line.quantity),
    unitCostUsd: line.unitCostUsd ? String(line.unitCostUsd) : "",
    vendor: line.vendor ?? "",
    link: line.link ?? "",
  };
}

/**
 * The parts list, kept here rather than typed out at submission time.
 *
 * One table, one form. The form sits under the table and serves both adding
 * and editing, so the table itself never grows inputs and stays readable at
 * phone width with a horizontal scroll. The total is read against the tier's
 * funding because that is the question the list answers: does this project
 * fit the money it is asking for.
 *
 * Tax and shipping close the table as one fixed line for the whole order. It
 * has an amount and nothing else — no edit form and no remove — because every
 * order has it, even at zero.
 */
export function BomEditor({
  projectId,
  items: initial,
  taxShippingUsd: initialExtra,
  locked,
  tier,
  grantUsd,
}: {
  projectId: string;
  items: BomLine[];
  taxShippingUsd: number;
  /** Why the list cannot change, or null when it can. */
  locked: string | null;
  tier: number;
  grantUsd: number;
}) {
  const router = useRouter();
  const id = useId();
  const [items, setItems] = useState(initial);
  // null: form closed. "new": adding. Otherwise the id of the line being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const nameInput = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The fields the last save found missing, outlined until they are filled.
  const [invalid, setInvalid] = useState<Set<keyof Draft>>(new Set());

  const [taxShipping, setTaxShipping] = useState(initialExtra);

  const parts = items.reduce((n, l) => n + l.quantity * l.unitCostUsd, 0);
  const total = parts + taxShipping;
  const over = total > grantUsd;

  function open(target: "new" | BomLine) {
    setEditing(target === "new" ? "new" : target.id);
    setDraft(target === "new" ? EMPTY : draftOf(target));
    setError(null);
    setInvalid(new Set());
  }

  async function send(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        // The server's field check says which fields, not just "Invalid
        // request": outline those and say it the way the form's own check
        // does. This catches anything the form let through, like a tab still
        // running an older copy of it.
        const fields = Object.keys(payload?.error?.details?.properties ?? {}).filter(
          (k): k is keyof Draft => k in FIELD_NAMES,
        );
        if (payload?.error?.code === "VALIDATION_FAILED" && fields.length > 0) {
          setInvalid(new Set(fields));
          setError(requiredMessage(fields));
        } else {
          setError(payload?.error?.message ?? "That did not save. Try again.");
        }
        return false;
      }
      setItems(payload.items as BomLine[]);
      router.refresh();
      return true;
    } catch {
      setError("Could not reach the server. Try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    // Every field, because a reviewer prices the tier from this list: a line
    // without a vendor, a link or a price is one they cannot check.
    const quantity = /^\d+$/.test(draft.quantity.trim()) ? Number(draft.quantity) : NaN;
    const unitCostUsd = draft.unitCostUsd.trim() ? Number(draft.unitCostUsd) : NaN;
    let link = draft.link.trim();
    if (link && !/^https?:\/\//i.test(link)) link = `https://${link}`;
    let linkOk = false;
    try {
      linkOk = !!link && new URL(link).hostname.includes(".");
    } catch {
      linkOk = false;
    }

    const bad = new Set<keyof Draft>();
    if (!draft.name.trim()) bad.add("name");
    if (!draft.purpose.trim()) bad.add("purpose");
    if (!(quantity >= 1)) bad.add("quantity");
    if (!(unitCostUsd > 0)) bad.add("unitCostUsd");
    if (!draft.vendor.trim()) bad.add("vendor");
    if (!linkOk) bad.add("link");
    setInvalid(bad);
    if (bad.size > 0) return setError(requiredMessage([...bad]));

    const body = {
      name: draft.name.trim(),
      purpose: draft.purpose.trim(),
      quantity,
      unitCostUsd,
      vendor: draft.vendor.trim(),
      link,
    };
    const done =
      editing === "new"
        ? await send("POST", `/api/projects/${projectId}/bom`, body)
        : await send("PATCH", `/api/projects/${projectId}/bom/${editing}`, body);
    if (done) {
      // Adding is usually several parts in a row, so the form stays open
      // and the cursor goes back to the first field.
      if (editing === "new") {
        setDraft(EMPTY);
        nameInput.current?.focus();
      } else setEditing(null);
    }
  }

  async function remove(line: BomLine) {
    const done = await send("DELETE", `/api/projects/${projectId}/bom/${line.id}`);
    if (done && editing === line.id) setEditing(null);
  }

  async function saveTaxShipping(value: number) {
    if (value === taxShipping) return true;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/bom`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taxShippingUsd: value }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setError(payload?.error?.message ?? "That did not save. Try again.");
        return false;
      }
      setTaxShipping(payload.taxShippingUsd);
      router.refresh();
      return true;
    } catch {
      setError("Could not reach the server. Try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  const field = (key: keyof Draft) => ({
    id: `${id}-${key}`,
    value: draft[key],
    required: true,
    "aria-invalid": invalid.has(key) || undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setDraft((d) => ({ ...d, [key]: e.target.value }));
      if (error) setError(null);
      if (invalid.has(key)) {
        setInvalid((s) => {
          const next = new Set(s);
          next.delete(key);
          return next;
        });
      }
    },
    // A red border rather than a ring: the drawn outline inputClass relies on
    // cannot render on a field, so without its own border an empty one showed
    // nothing at all.
    className: cx(
      inputClass,
      "border-2 py-2 text-[0.88rem]",
      invalid.has(key) ? "border-coral-deep bg-coral/5" : "border-transparent",
    ),
  });

  return (
    <div>
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[480px] text-left text-[0.86rem]">
            <thead>
              <tr className="border-b border-dashed border-line">
                {["Part", "Qty", "Unit", "Total", "Vendor"].map((h) => (
                  <th key={h} scope="col" className="label px-3 py-2 text-navy-soft first:pl-0">
                    {h}
                  </th>
                ))}
                {!locked && (
                  <th scope="col" className="w-0 px-0 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr className="border-b border-dashed border-line/60">
                  <td colSpan={locked ? 5 : 6} className="hand py-4 text-[0.88rem] text-navy-soft">
                    no parts listed yet. Add what the build needs, with a real vendor and price.
                  </td>
                </tr>
              )}
              {items.map((l) => (
                <tr
                  key={l.id}
                  className={cx(
                    "border-b border-dashed border-line/60 align-top",
                    editing === l.id && "bg-violet-pale/50",
                  )}
                >
                  <td className="py-2.5 pr-3">
                    <span className="block font-semibold [overflow-wrap:anywhere] text-navy">{l.name}</span>
                    {l.purpose && (
                      <span className="block text-[0.8rem] leading-snug text-navy-soft">{l.purpose}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">{l.quantity}</td>
                  <td className="px-3 py-2.5 tabular-nums">{usd(l.unitCostUsd)}</td>
                  <td className="px-3 py-2.5 font-semibold text-navy tabular-nums">
                    {usd(l.quantity * l.unitCostUsd)}
                  </td>
                  <td className="hand px-3 py-2.5 text-navy-soft">
                    {l.link ? (
                      <a
                        href={l.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline decoration-line-strong underline-offset-4 hover:text-navy hover:decoration-violet"
                      >
                        {l.vendor || "link"}
                      </a>
                    ) : (
                      l.vendor || "—"
                    )}
                  </td>
                  {!locked && (
                    <td className="py-1.5 pl-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => open(l)}
                        disabled={saving}
                        aria-label={`Edit ${l.name}`}
                        className="inline-grid size-8 place-items-center rounded-full text-navy-soft transition-colors hover:bg-black/5 hover:text-navy"
                      >
                        <IconPencil className="text-sm" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(l)}
                        disabled={saving}
                        aria-label={`Remove ${l.name}`}
                        className="inline-grid size-8 place-items-center rounded-full text-navy-soft transition-colors hover:bg-coral/10 hover:text-coral-deep"
                      >
                        <IconX className="text-sm" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <ExtraRow
                label="Tax & shipping"
                hint="for the whole order"
                value={taxShipping}
                locked={locked}
                disabled={saving}
                onSave={saveTaxShipping}
              />
            </tfoot>
          </table>
        </div>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <p className="text-[0.9rem] text-navy-soft">
          Total{" "}
          <span className={cx("text-[1.05rem] font-extrabold tabular-nums", over ? "text-coral-deep" : "text-navy")}>
            {usd(total)}
          </span>{" "}
          of <span className="font-bold text-navy tabular-nums">${grantUsd}</span> tier {tier} funding
          {over && (
            <span className="hand block text-[0.82rem] text-coral-deep">
              {usd(total - grantUsd)} over. Cut parts, or ask for a higher tier.
            </span>
          )}
        </p>
        {!locked && editing === null && (
          <Button variant="outline" size="sm" onClick={() => open("new")}>
            <IconPlus className="text-base" /> Add a part
          </Button>
        )}
      </div>

      {locked && <p className="hand mt-2 text-[0.82rem] text-navy-soft">{locked}.</p>}

      {!locked && editing !== null && (
        <form
          noValidate
          className="mt-4 grid gap-3 rounded-2xl bg-black/[.03] p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(null);
          }}
        >
          <p className="text-[0.9rem] font-extrabold text-navy">
            {editing === "new" ? "Add a part" : `Edit ${items.find((l) => l.id === editing)?.name ?? "part"}`}
          </p>
          <p className="-mt-2 text-[0.8rem] text-navy-soft">Every field is required, with a price above $0.</p>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <label className="grid gap-1">
              <span className="label text-violet-deep">Part</span>
              <input {...field("name")} ref={nameInput} placeholder="ESP32-C3 SuperMini" autoFocus maxLength={120} />
            </label>
            <label className="grid gap-1">
              <span className="label text-violet-deep">What it&apos;s for</span>
              <input {...field("purpose")} placeholder="Wi-Fi and the main loop" maxLength={200} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[5rem_7rem_minmax(0,1fr)_minmax(0,1.5fr)]">
            <label className="grid gap-1">
              <span className="label text-violet-deep">Qty</span>
              <input {...field("quantity")} inputMode="numeric" />
            </label>
            <label className="grid gap-1">
              <span className="label text-violet-deep">Unit $</span>
              <input {...field("unitCostUsd")} inputMode="decimal" placeholder="0.00" />
            </label>
            <label className="grid gap-1">
              <span className="label text-violet-deep">Vendor</span>
              <input {...field("vendor")} placeholder="LCSC" maxLength={80} />
            </label>
            <label className="grid gap-1">
              <span className="label text-violet-deep">Link</span>
              <input {...field("link")} inputMode="url" spellCheck={false} placeholder="lcsc.com/product-detail/…" />
            </label>
          </div>
          {error && (
            <p role="alert" className="text-[0.82rem] font-semibold text-coral-deep">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="solid" size="sm" disabled={saving}>
              {saving ? "Saving…" : editing === "new" ? "Add part" : "Save"}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setEditing(null)}>
              {editing === "new" ? "Done" : "Cancel"}
            </Button>
          </div>
        </form>
      )}
      {error && editing === null && (
        <p role="alert" className="mt-2 text-[0.82rem] font-semibold text-coral-deep">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The order-wide line. The amount is edited in the row itself and
 * saved when the field is left or Enter is pressed — there is nothing else
 * about it to edit, so it never needs the form.
 */
function ExtraRow({
  label,
  hint,
  value,
  locked,
  disabled,
  onSave,
}: {
  label: string;
  hint: string;
  value: number;
  locked: string | null;
  disabled: boolean;
  onSave: (value: number) => Promise<boolean>;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value ? value.toFixed(2) : "");
  const [invalid, setInvalid] = useState(false);

  async function commit() {
    const n = draft.trim() === "" ? 0 : Number.parseFloat(draft);
    if (!Number.isFinite(n) || n < 0) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const cents = Math.round(n * 100) / 100;
    if (await onSave(cents)) setDraft(cents ? cents.toFixed(2) : "");
  }

  return (
    <tr className="border-b border-dashed border-line/60 align-middle last:border-0">
      <td className="py-2.5 pr-3">
        <label htmlFor={id} className="block font-semibold text-navy">
          {label}
        </label>
        <span className="block text-[0.8rem] leading-snug text-navy-soft">{hint}</span>
      </td>
      <td className="px-3 py-2.5 text-navy-soft">—</td>
      <td className="px-3 py-2.5 text-navy-soft">—</td>
      <td className="px-3 py-1.5 font-semibold text-navy tabular-nums" colSpan={locked ? 2 : 3}>
        {locked ? (
          usd(value)
        ) : (
          <span className="inline-flex items-center gap-1">
            <span aria-hidden="true">$</span>
            <input
              id={id}
              value={draft}
              inputMode="decimal"
              placeholder="0.00"
              disabled={disabled}
              aria-invalid={invalid || undefined}
              onChange={(e) => {
                setDraft(e.target.value);
                if (invalid) setInvalid(false);
              }}
              onBlur={() => void commit()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              // Its own look rather than inputClass: a white field on the white
              // panel reads as a printed number, not one you can change.
              className={cx(
                "block w-24 rounded-lg border-2 border-line bg-black/[.03] px-2.5 py-1.5 text-[0.86rem] text-navy tabular-nums outline-none placeholder:text-navy-soft/70",
                "transition-colors hover:border-line-strong focus:border-violet focus:bg-white",
                invalid && "border-coral text-coral-deep",
              )}
            />
          </span>
        )}
      </td>
    </tr>
  );
}
