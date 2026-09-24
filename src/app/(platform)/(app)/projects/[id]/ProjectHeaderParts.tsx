"use client";

import { useRef, useState } from "react";
import { WeekScene } from "@/components/platform/art";
import { IconCamera } from "@/components/platform/icons";
import { Button } from "@/components/platform/ui";
import { UploadProgress } from "@/components/platform/UploadProgress";
import { useStore } from "@/lib/store";
import { uploadFile } from "@/lib/use-handoff";

const COVER_TYPES = "image/png,image/jpeg,image/webp,image/gif";

/**
 * The project's thumbnail — what its card and the review queue show.
 *
 * Until one is uploaded the newest picture in the journal stands in, and
 * before there is one of those, the week's own scene on the week's colour, so
 * an empty project still looks like the week it belongs to rather than a grey
 * box. Changing it is one button on the image itself: pick a file, it
 * uploads, the page re-reads.
 */
export function CoverImage({
  projectId,
  url,
  fallbackUrl,
  theme,
  accent,
  locked,
}: {
  projectId: string;
  /** The one the maker chose. */
  url: string | null;
  /** The newest journal image, shown until they choose one. */
  fallbackUrl: string | null;
  theme: string;
  accent: string;
  locked: string | null;
}) {
  const shown = url ?? fallbackUrl;
  const { updateProject } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // How much of a new thumbnail has gone up; null when none is uploading.
  const [progress, setProgress] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setUploading(true);
    setProgress(null);
    setError(null);
    try {
      const { objectKey } = await uploadFile(file, "covers", setProgress);
      const refused = await updateProject(projectId, { coverImageKey: objectKey });
      if (refused) setError(refused);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  async function clear() {
    setBusy(true);
    setError(null);
    const refused = await updateProject(projectId, { coverImageKey: null });
    if (refused) setError(refused);
    setBusy(false);
  }

  return (
    <div>
      <div
        className="relative grid aspect-[21/9] place-items-center overflow-hidden rounded-2xl @3xl:aspect-[4/3]"
        style={{ background: shown ? "var(--color-navy)" : accent }}
      >
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element -- R2's public URL, or one pasted into a journal
          <img src={shown} alt="" className="h-full w-full object-cover" />
        ) : (
          <WeekScene theme={theme} className="h-full w-auto max-w-full p-5 drop-shadow-lg" />
        )}
        {/* The bar sits on the picture it is replacing, where the eye already
            is, on a veil dark enough to read over any thumbnail. */}
        {uploading && (
          <div className="absolute inset-0 grid items-end bg-navy/45 p-3">
            <div className="rounded-xl bg-white/95 px-3 py-2">
              <UploadProgress progress={progress} name="New thumbnail" />
            </div>
          </div>
        )}
        {busy && !uploading && (
          <span className="hand absolute inset-0 grid place-items-center bg-navy/55 text-[0.9rem] text-white">
            saving…
          </span>
        )}
      </div>

      {!locked && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <input
            ref={input}
            type="file"
            accept={COVER_TYPES}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => void pick(e.target.files?.[0])}
          />
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => input.current?.click()} className="-ml-3.5">
            <IconCamera className="text-base" /> {url ? "Change thumbnail" : "Add a thumbnail"}
          </Button>
          {url && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void clear()}
              className="hand text-[0.8rem] text-navy-soft underline decoration-dashed underline-offset-4 hover:text-coral-deep"
            >
              remove
            </button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-[0.8rem] font-semibold text-coral-deep">
          {error}
        </p>
      )}
    </div>
  );
}
