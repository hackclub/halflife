"use client";

import { useId, useState } from "react";
import { IconPencil } from "@/components/platform/icons";
import { Button, Chip, OptionRow, cx } from "@/components/platform/ui";
import { TIERS } from "@/lib/curriculum";
import { submitFloorFor, tierBankedFloor } from "@/lib/config/printers";
import { fmtHours } from "@/lib/projects";
import { displayRepo, normalizeRepo } from "@/lib/repo";
import { useStore } from "@/lib/store";
import type { Project } from "@/lib/types";

/**
 * The project's own details — name, description, repo and tier — read as the
 * page's heading, and changed together behind one pencil.
 *
 * One editor rather than a pencil per field, because they are one decision:
 * what this project is, where it lives, and what it is asking for. Editing
 * swaps the block for a form in place, so nothing around it moves far, and
 * Save sends everything that changed in one request, which is also how the
 * server's refusal comes back as one message rather than four.
 *
 * The tier has two rules the form keeps. A starter project is scoped to tier
 * 1, so its tier is never offered. And once the design week is handed in the
 * tier is the claim a reviewer is deciding on, so it is shown but not
 * editable. Every other tier stays pickable, including ones the hours do not
 * cover yet: until you submit, a tier is a plan, and the line under each one
 * says what it costs. The refusal stays in the submit sheet, where the claim
 * is made.
 */
export function ProjectDetails({
  project,
  hours,
  tierLocked,
  locked,
  stats,
  chips,
}: {
  project: Project;
  /** Hours logged in the design week, for what each tier would ask. */
  hours: number;
  /** The design week is handed in, so the tier is final. */
  tierLocked: boolean;
  /** Why nothing here can change right now, or null when it can. */
  locked: string | null;
  /** The stat line, shown under the name while reading. */
  stats: React.ReactNode;
  /** The week chips, shown under the description while reading. */
  chips: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <DetailsForm
        project={project}
        hours={hours}
        tierLocked={tierLocked}
        onDone={() => setEditing(false)}
      />
    );
  }

  return (
    <div>
      <div className="flex items-start gap-3">
        <h1 className="min-w-0 flex-1 text-[1.5rem] leading-tight font-extrabold tracking-[-0.03em] text-balance [overflow-wrap:anywhere] text-navy sm:text-[1.9rem]">
          {project.name}
        </h1>
        {!locked && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="mt-1">
            <IconPencil className="text-sm" /> Edit details
          </Button>
        )}
      </div>

      {stats}

      <p className="mt-3.5 max-w-[62ch] text-[0.95rem] leading-relaxed whitespace-pre-line [overflow-wrap:anywhere] text-navy-soft">
        {project.description || <span className="hand">no description yet.</span>}
      </p>

      {chips}

      <dl className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-8">
        <div className="min-w-0">
          <dt className="label mb-1.5 text-violet-deep">GitHub repo</dt>
          <dd className="min-w-0">
            {project.githubRepo ? (
              <a
                href={project.githubRepo}
                target="_blank"
                rel="noopener noreferrer"
                title={project.githubRepo}
                className="block truncate text-[0.88rem] font-semibold text-navy underline decoration-line-strong decoration-2 underline-offset-4 transition-colors hover:decoration-violet"
              >
                {displayRepo(project.githubRepo)}
              </a>
            ) : (
              <span className="hand text-[0.86rem] text-navy-soft">none yet</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="label mb-1.5 text-violet-deep">Tier</dt>
          <dd>
            <Chip tone="violet">Tier {project.tier}</Chip>
          </dd>
        </div>
      </dl>

      {project.starter ? (
        <p className="hand mt-2 text-[0.8rem] text-navy-soft">
          Starter projects are scoped to tier 1, so the tier is fixed.
        </p>
      ) : tierLocked ? (
        <p className="hand mt-2 text-[0.8rem] text-navy-soft">
          Week {project.weekId} is submitted, so the tier is final.
        </p>
      ) : null}

      {locked && <p className="hand mt-4 text-[0.82rem] text-navy-soft">{locked}.</p>}
    </div>
  );
}

// Not inputClass: its drawn outline cannot render on a field, which leaves a
// white box on the white panel that reads as plain text rather than an input.
const field =
  "block w-full rounded-xl border-2 border-line bg-black/[.02] px-4 py-3 text-navy outline-none placeholder:text-navy-soft/70 transition-colors hover:border-line-strong focus:border-violet focus:bg-white aria-invalid:border-coral";

function DetailsForm({
  project,
  hours,
  tierLocked,
  onDone,
}: {
  project: Project;
  hours: number;
  tierLocked: boolean;
  onDone: () => void;
}) {
  const { updateProject } = useStore();
  const id = useId();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [repo, setRepo] = useState(project.githubRepo ?? "");
  const [tier, setTier] = useState<1 | 2 | 3>(project.tier);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ field: "name" | "repo" | null; message: string } | null>(null);

  const tierEditable = !project.starter && !tierLocked;

  async function save() {
    if (!name.trim()) return setError({ field: "name", message: "A project needs a name." });
    const { url, error: repoError } = normalizeRepo(repo);
    if (repoError) return setError({ field: "repo", message: repoError });

    // Only what changed, so an untouched tier is never re-sent against a
    // server rule it does not need to meet.
    const patch = {
      ...(name.trim() !== project.name ? { name: name.trim() } : {}),
      ...(description.trim() !== project.description.trim() ? { description: description.trim() } : {}),
      ...(url !== (project.githubRepo ?? null) ? { githubRepo: url } : {}),
      ...(tierEditable && tier !== project.tier ? { tier } : {}),
    };
    if (Object.keys(patch).length === 0) return onDone();

    setSaving(true);
    setError(null);
    const refused = await updateProject(project.id, patch);
    setSaving(false);
    if (refused) setError({ field: null, message: refused });
    else onDone();
  }

  return (
    <form
      aria-label="Edit project details"
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !saving) onDone();
      }}
    >
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-name`} className="label text-violet-deep">
          Project name
        </label>
        <input
          id={`${id}-name`}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
          maxLength={120}
          autoFocus
          aria-invalid={error?.field === "name" || undefined}
          className={cx(field, "text-[1.05rem] font-extrabold")}
        />
      </div>

      <div className="grid gap-1.5">
        <label htmlFor={`${id}-desc`} className="label text-violet-deep">
          Description
        </label>
        <textarea
          id={`${id}-desc`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          maxLength={4000}
          placeholder="What it is, and what it will do when it works."
          className={cx(field, "resize-y text-[0.92rem] leading-relaxed")}
        />
      </div>

      <div className="grid gap-1.5">
        <label htmlFor={`${id}-repo`} className="label text-violet-deep">
          GitHub repo
        </label>
        <input
          id={`${id}-repo`}
          value={repo}
          onChange={(e) => {
            setRepo(e.target.value);
            if (error) setError(null);
          }}
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder="github.com/you/your-project"
          aria-invalid={error?.field === "repo" || undefined}
          className={cx(field, "text-[0.9rem]")}
        />
      </div>

      <fieldset className="grid gap-2.5">
        <legend className="label mb-1.5 text-violet-deep">Tier</legend>
        {tierEditable ? (
          <>
            <p className="text-[0.82rem] leading-snug text-navy-soft">
              A tier funds its own block of hours and those hours bank nothing, so the printer money
              has to be worked on top of them. You have{" "}
              <span className="font-bold text-navy tabular-nums">{fmtHours(hours)}</span> in week{" "}
              {project.weekId}.
            </p>
            {TIERS.map((t) => {
              const floor = submitFloorFor(t.fundingHours);
              const short = Math.max(0, floor - hours);
              return (
                <OptionRow
                  key={t.id}
                  selected={tier === t.id}
                  onClick={() => setTier(t.id)}
                  hint={
                    <span className="block">
                      {fmtHours(t.fundingHours)} funds the project ·{" "}
                      {fmtHours(tierBankedFloor(t.fundingHours))} banks toward your printer
                    </span>
                  }
                >
                  <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <span className="text-[0.98rem] font-extrabold text-navy">Tier {t.id}</span>
                    <span className="hand text-[0.86rem] text-teal-deep">${t.grantUsd} funding</span>
                    <span className="hand text-[0.82rem] text-navy-soft">
                      · {fmtHours(floor)} per design week
                    </span>
                    <span
                      className={cx(
                        "hand text-[0.8rem] tabular-nums",
                        short > 0 ? "text-coral-deep" : "text-teal-deep",
                      )}
                    >
                      {short > 0 ? `${fmtHours(short)} to go` : "hours covered"}
                    </span>
                  </span>
                </OptionRow>
              );
            })}
          </>
        ) : (
          <p className="flex flex-wrap items-center gap-2 text-[0.82rem] text-navy-soft">
            <Chip tone="violet">Tier {project.tier}</Chip>
            <span className="hand">
              {project.starter
                ? "starter projects are scoped to tier 1."
                : `week ${project.weekId} is submitted, so the tier is final.`}
            </span>
          </p>
        )}
      </fieldset>

      {error && (
        <p role="alert" className="text-[0.84rem] font-semibold text-coral-deep">
          {error.message}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="solid" size="sm" disabled={saving}>
          {saving ? "Saving…" : "Save details"}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
