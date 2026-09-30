"use client"

import { useId, useState } from "react"
import { IconPencil } from "@/components/platform/icons"
import { Button, cx, Field, inputClass } from "@/components/platform/ui"
import { displayRepo, normalizeRepo } from "@/lib/repo"
import { useStore } from "@/lib/store"
import type { Project } from "@/lib/types"

/**
 * The repo field in a project-creation form. Optional on purpose: a first
 * board often has no repo until it has a schematic worth pushing, and the link
 * can be added from the project page whenever it exists.
 *
 * Checked on blur rather than per keystroke, so half a URL is not told off
 * while it is still being typed. The form reads the same check back through
 * `repoIsValid` to hold its own submit button.
 */
export function RepoInput({ value, onChange, id }: { value: string; onChange: (value: string) => void; id: string }) {
  const [touched, setTouched] = useState(false)
  const { error } = normalizeRepo(value)
  return (
    <Field
      label="GitHub repo"
      hint="Where the code, schematics and CAD live. Optional, and you can add or change it later on the project page."
      id={id}
    >
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTouched(true)}
        inputMode="url"
        autoComplete="url"
        spellCheck={false}
        placeholder="github.com/you/your-project"
        aria-invalid={(touched && !!error) || undefined}
        aria-describedby={touched && error ? `${id}-err` : undefined}
        className={inputClass}
      />
      {touched && error && (
        <p id={`${id}-err`} className="mt-1.5 text-[0.8rem] font-semibold text-coral-deep">
          {error}
        </p>
      )}
    </Field>
  )
}

/** Whether a creation form may submit with this in its repo field. */
export function repoIsValid(value: string) {
  return normalizeRepo(value).error === null
}

/**
 * A project's repo, read or edited in place.
 *
 * One line when it is set — the link itself, shortened to what anyone reads —
 * and one quiet prompt when it is not, so an empty repo does not take up the
 * room of a form on every card. Editing swaps the line for an input and two
 * buttons without moving what is around it much, and the server's refusal
 * (a phase in review is locked) is said right there rather than lost.
 */
export function RepoEditor({ project, className }: { project: Project; className?: string }) {
  const { setProjectRepo } = useStore()
  const id = useId()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(project.githubRepo ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const current = project.githubRepo ?? null

  async function save() {
    const { url, error: invalid } = normalizeRepo(draft)
    if (invalid) {
      setError(invalid)
      return
    }
    if (url === current) {
      setEditing(false)
      return
    }
    setSaving(true)
    setError(null)
    const refused = await setProjectRepo(project.id, url)
    setSaving(false)
    if (refused) setError(refused)
    else setEditing(false)
  }

  if (!editing) {
    return (
      <div className={cx("flex min-w-0 items-center gap-2", className)}>
        {current ? (
          <>
            <a
              href={current}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 truncate text-[0.85rem] font-semibold text-navy underline decoration-line-strong decoration-2 underline-offset-4 transition-colors hover:decoration-violet"
              title={current}
            >
              {displayRepo(current)}
            </a>
            <button
              type="button"
              onClick={() => {
                setDraft(current)
                setError(null)
                setEditing(true)
              }}
              aria-label="Change the repo link"
              className="grid size-7 shrink-0 place-items-center rounded-full text-navy-soft transition-colors hover:bg-black/5 hover:text-navy"
            >
              <IconPencil className="text-sm" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft("")
              setError(null)
              setEditing(true)
            }}
            className="hand text-[0.82rem] text-violet-deep underline decoration-dashed underline-offset-4 transition-colors hover:text-navy"
          >
            add a GitHub repo
          </button>
        )}
      </div>
    )
  }

  return (
    <form
      className={cx("grid gap-2", className)}
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <label htmlFor={id} className="sr-only">
        GitHub repo
      </label>
      <input
        id={id}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          if (error) setError(null)
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false)
        }}
        autoFocus
        inputMode="url"
        autoComplete="url"
        spellCheck={false}
        placeholder="github.com/you/your-project"
        aria-invalid={!!error || undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        className={cx(inputClass, "py-2 text-[0.88rem]")}
      />
      {error && (
        <p id={`${id}-err`} role="alert" className="text-[0.8rem] font-semibold text-coral-deep">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="solid" size="sm" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setEditing(false)}>
          Cancel
        </Button>
        {current && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving}
            className="ml-auto"
            onClick={() => {
              setDraft("")
              void (async () => {
                setSaving(true)
                const refused = await setProjectRepo(project.id, null)
                setSaving(false)
                if (refused) setError(refused)
                else setEditing(false)
              })()
            }}
          >
            Remove
          </Button>
        )}
      </div>
    </form>
  )
}
