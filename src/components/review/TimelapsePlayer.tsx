"use client"

import { type KeyboardEvent, useEffect, useRef, useState } from "react"
import { formatDuration } from "@/components/review/format"
import { type LapseVideo, lapseId, loadLapse } from "@/components/review/lapse"
import { Icon, SafeLink } from "@/components/review/ui"

/**
 * A Lapse timelapse played in place – Fabricate's `TimelapsePlayer`, with the same controls, keys and real-time readout.
 *
 * A timelapse compresses hours into minutes, so the scrubber and the clock also say how far into the real sitting a frame is ("1h 20m in, of 2h"), which is what a reviewer checking a claimed hour actually wants to know.
 */

const SPEEDS: readonly number[] = Object.freeze([0.5, 1, 1.5, 2, 4])
const STEP_SECONDS = 5
const LONG_STEP_SECONDS = 10
const FRAME_SECONDS = 1 / 30
const IDLE_MS = 2500
const MEDIA_EVENTS: readonly string[] = Object.freeze([
	"play",
	"pause",
	"ended",
	"timeupdate",
	"ratechange",
	"loadedmetadata",
	"durationchange",
	"progress",
	"seeked",
])
const READY_EVENTS: readonly string[] = Object.freeze(["playing", "canplay", "seeked"])

const clamp = (x: number, min: number, max: number): number => Math.min(Math.max(x, min), max)

function clock(seconds: number): string {
	const s = Number.isFinite(seconds) ? Math.max(Math.floor(seconds), 0) : 0
	const h = Math.floor(s / 3600)
	const m = Math.floor((s % 3600) / 60)
	const sec = String(s % 60).padStart(2, "0")
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`
}

const span = (seconds: number): string =>
	seconds < 60 ? `${Math.max(Math.floor(seconds), 0)}s` : formatDuration(seconds)

function readDuration(video: HTMLVideoElement): number {
	if (Number.isFinite(video.duration) && video.duration > 0) return video.duration
	if (video.seekable.length > 0) {
		const end = video.seekable.end(video.seekable.length - 1)
		if (Number.isFinite(end) && end > 0) return end
	}
	return 0
}

function readBufferedEnd(video: HTMLVideoElement): number {
	const t = video.currentTime
	for (let i = 0; i < video.buffered.length; i++)
		if (video.buffered.start(i) <= t + 0.05 && video.buffered.end(i) >= t) return video.buffered.end(i)
	return 0
}

export function TimelapsePlayer({
	defaultOpen,
	playable,
	url,
}: {
	defaultOpen?: boolean
	playable?: boolean
	url: string
}) {
	const canPlay = Boolean(playable) && lapseId(url) !== null
	const [open, setOpen] = useState(Boolean(defaultOpen) && canPlay)
	const [enlarged, setEnlarged] = useState(false)
	const [video, setVideo] = useState<LapseVideo | null>(null)
	const [status, setStatus] = useState<"idle" | "loading" | "failed">(open ? "loading" : "idle")
	const [height, setHeight] = useState<number>()
	const [playing, setPlaying] = useState(false)
	const [ended, setEnded] = useState(false)
	const [waiting, setWaiting] = useState(false)
	const [time, setTime] = useState(0)
	const [duration, setDuration] = useState(0)
	const [buffered, setBuffered] = useState(0)
	const [rate, setRate] = useState(1)
	const [idle, setIdle] = useState(false)
	const slot = useRef<HTMLDivElement>(null)
	const player = useRef<HTMLDivElement>(null)
	const media = useRef<HTMLDivElement>(null)
	const idleTimer = useRef<number>(undefined)
	// The <video> the controls drive, in a ref: seeking and changing speed write to it, which a value held in state must not be.
	const elRef = useRef<HTMLVideoElement | null>(null)
	const hasVideo = video !== null
	const tracked = video?.tracked ?? 0
	const realAt = (t: number): number => (duration > 0 ? (t / duration) * tracked : 0)

	useEffect(() => {
		if (!canPlay) return
		let live = true
		void (async () => {
			try {
				const loaded = await loadLapse(url)
				if (live) setVideo(loaded)
			} catch {
				if (live) setStatus("failed")
			}
		})()
		return () => {
			live = false
		}
	}, [canPlay, url])

	useEffect(() => {
		if (!enlarged) return
		const onKey = (e: globalThis.KeyboardEvent): void => {
			if (e.key === "Escape") setEnlarged(false)
		}
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [enlarged])

	useEffect(() => {
		const host = media.current
		if (!open || !video || !host) return
		const { element } = video
		const sync = (): void => {
			setPlaying(!element.paused && !element.ended)
			setEnded(element.ended)
			setTime(element.currentTime)
			setDuration(readDuration(element))
			setBuffered(readBufferedEnd(element))
			setRate(element.playbackRate)
		}
		const wait = (): void => setWaiting(true)
		const ready = (): void => setWaiting(false)
		elRef.current = element
		host.append(element)
		for (const event of MEDIA_EVENTS) element.addEventListener(event, sync)
		for (const event of READY_EVENTS) element.addEventListener(event, ready)
		element.addEventListener("waiting", wait)
		sync()
		return () => {
			for (const event of MEDIA_EVENTS) element.removeEventListener(event, sync)
			for (const event of READY_EVENTS) element.removeEventListener(event, ready)
			element.removeEventListener("waiting", wait)
			element.pause()
			element.remove()
			elRef.current = null
		}
	}, [open, video])

	useEffect(() => {
		if (!playing || !hasVideo) return
		let frame = requestAnimationFrame(function tick() {
			if (elRef.current) setTime(elRef.current.currentTime)
			frame = requestAnimationFrame(tick)
		})
		return () => cancelAnimationFrame(frame)
	}, [playing, hasVideo])

	useEffect(() => () => window.clearTimeout(idleTimer.current), [])

	async function load(): Promise<void> {
		setStatus("loading")
		try {
			setVideo(await loadLapse(url))
			setStatus("idle")
		} catch {
			setStatus("failed")
		}
	}

	function toggle(): void {
		setOpen(!open)
		setEnlarged(false)
		if (!open && !video && status !== "loading") void load()
	}

	function enlarge(): void {
		setHeight(slot.current?.offsetHeight)
		setEnlarged(true)
	}

	function wake(): void {
		setIdle(false)
		window.clearTimeout(idleTimer.current)
		idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_MS)
	}

	function play(element: HTMLVideoElement): void {
		void (async () => {
			try {
				await element.play()
			} catch {
				// A play() the browser refused (autoplay rules, a pause racing it) leaves the player paused, which the controls already show.
			}
		})()
	}

	function togglePlay(): void {
		const el = elRef.current
		if (!el) return
		player.current?.focus({ preventScroll: true })
		if (el.paused || el.ended) {
			if (el.ended || (duration > 0 && el.currentTime >= duration - 0.05)) el.currentTime = 0
			play(el)
		} else el.pause()
	}

	function seek(to: number): void {
		const el = elRef.current
		if (!el) return
		el.currentTime = clamp(to, 0, duration)
		setTime(el.currentTime)
	}

	function setSpeed(next: number | undefined): void {
		if (elRef.current && next !== undefined) elRef.current.playbackRate = next
	}

	function stepSpeed(by: 1 | -1): void {
		const i = SPEEDS.indexOf(rate)
		setSpeed(SPEEDS[clamp((i === -1 ? 1 : i) + by, 0, SPEEDS.length - 1)])
	}

	function fullscreen(): void {
		if (document.fullscreenElement) void document.exitFullscreen()
		else void player.current?.requestFullscreen()
	}

	function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
		if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey) return
		const k = e.key
		if (k === " " || k === "k") togglePlay()
		else if (k === "ArrowLeft") seek(time - STEP_SECONDS)
		else if (k === "ArrowRight") seek(time + STEP_SECONDS)
		else if (k === "j") seek(time - LONG_STEP_SECONDS)
		else if (k === "l") seek(time + LONG_STEP_SECONDS)
		else if (k === "," || k === ".") {
			elRef.current?.pause()
			seek(time + (k === "," ? -FRAME_SECONDS : FRAME_SECONDS))
		} else if (k === "<") stepSpeed(-1)
		else if (k === ">") stepSpeed(1)
		else if (k === "Home") seek(0)
		else if (k === "End") seek(duration)
		else if (k === "f") fullscreen()
		else if (/^[0-9]$/.test(k)) seek((Number(k) / 10) * duration)
		else return
		e.preventDefault()
		wake()
	}

	return (
		<div className="lapse">
			<p className="field__hint lapse__link">
				Timelapse: <SafeLink href={url} />
				{tracked > 0 ? (
					<span className="lapse__tracked">
						<Icon name="clock" />
						<b>{formatDuration(tracked)}</b> tracked
					</span>
				) : null}
				{canPlay ? (
					<button
						aria-expanded={open}
						aria-label={open ? "Hide timelapse" : "Play timelapse here"}
						className="lapse__toggle"
						onClick={toggle}
						title={open ? "Hide timelapse" : "Play timelapse here"}
						type="button"
					>
						<Icon name={open ? "chevron-up" : "chevron-down"} />
					</button>
				) : null}
			</p>
			{open ? (
				<div className="lapse__slot" ref={slot} style={enlarged ? { height } : undefined}>
					{status === "loading" && !video ? <p className="field__hint">Loading timelapse…</p> : null}
					{status === "failed" ? (
						<p className="field__hint">
							Couldn&rsquo;t load this timelapse here. It may still be processing, so open the link instead.
						</p>
					) : null}
					{video ? (
						<>
							{enlarged ? (
								<button
									aria-label="Shrink the timelapse"
									className="lapse__dim"
									onClick={() => setEnlarged(false)}
									type="button"
								/>
							) : null}
							<div className={enlarged ? "lapse__frame is-enlarged" : "lapse__frame"}>
								{/* biome-ignore lint/a11y/useSemanticElements: a media player, not a set of form controls, so not a <fieldset> */}
								<div
									aria-label="Timelapse player"
									className={playing && idle ? "lapse-player is-idle" : "lapse-player"}
									onKeyDown={onKeyDown}
									onPointerDown={wake}
									onPointerLeave={() => {
										if (playing) setIdle(true)
									}}
									onPointerMove={wake}
									ref={player}
									role="group"
									// biome-ignore lint/a11y/noNoninteractiveTabindex: the player takes focus so its keyboard shortcuts work, as Fabricate's does
									tabIndex={0}
								>
									{/* The video surface: clicking it plays or pauses, as on any player. Its keyboard path is the player's own keys (space, k) and the play button below. */}
									{/* oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
									{/* biome-ignore lint/a11y/noStaticElementInteractions: see above */}
									{/* biome-ignore lint/a11y/useKeyWithClickEvents: see above */}
									<div onClick={togglePlay} onDoubleClick={fullscreen} ref={media} />
									{/* oxlint-enable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
									{waiting ? <span className="lapse-player__wait">Buffering…</span> : null}
									{!playing && !waiting ? (
										<button
											aria-label={ended ? "Replay" : "Play"}
											className="lapse-player__big"
											onClick={togglePlay}
											type="button"
										>
											<Icon name={ended ? "replay" : "play"} />
										</button>
									) : null}
									<div className="lapse-player__controls">
										<Scrubber
											buffered={buffered}
											duration={duration}
											onScrub={ratio => seek(ratio * duration)}
											onScrubEnd={resume => {
												if (resume && elRef.current) play(elRef.current)
											}}
											onScrubStart={() => {
												const el = elRef.current
												const resume = el !== null && !el.paused
												el?.pause()
												return resume
											}}
											time={time}
											tracked={tracked}
										/>
										<div className="lapse-player__row">
											<button
												aria-label={playing ? "Pause (k)" : "Play (k)"}
												className="lapse-player__btn"
												onClick={togglePlay}
												title={playing ? "Pause (k)" : "Play (k)"}
												type="button"
											>
												<Icon name={playing ? "pause" : "play"} />
											</button>
											<button
												aria-label={`Back ${STEP_SECONDS} seconds`}
												className="lapse-player__btn"
												onClick={() => seek(time - STEP_SECONDS)}
												title={`Back ${STEP_SECONDS}s (←)`}
												type="button"
											>
												<Icon name="backward" />
											</button>
											<button
												aria-label={`Forward ${STEP_SECONDS} seconds`}
												className="lapse-player__btn"
												onClick={() => seek(time + STEP_SECONDS)}
												title={`Forward ${STEP_SECONDS}s (→)`}
												type="button"
											>
												<Icon name="forward" />
											</button>
											<span className="lapse-player__time">
												{clock(time)}
												<span className="lapse-player__dim"> / {clock(duration)}</span>
											</span>
											{tracked > 0 ? (
												<span className="lapse-player__real">
													{span(realAt(time))} in
													<span className="lapse-player__dim"> of {formatDuration(tracked)}</span>
												</span>
											) : null}
											<span className="lapse-player__spacer" />
											<button
												aria-label={`Playback speed ${rate}×, change`}
												className="lapse-player__btn lapse-player__speed"
												onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(rate) + 1) % SPEEDS.length])}
												title="Playback speed (< and >)"
												type="button"
											>
												{rate}×
											</button>
											<button
												aria-label={enlarged ? "Shrink" : "Enlarge"}
												className="lapse-player__btn"
												onClick={() => (enlarged ? setEnlarged(false) : enlarge())}
												title={enlarged ? "Shrink" : "Enlarge"}
												type="button"
											>
												<Icon name={enlarged ? "shrink" : "expand"} />
											</button>
											<button
												aria-label="Full screen"
												className="lapse-player__btn"
												onClick={fullscreen}
												title="Full screen (f)"
												type="button"
											>
												<Icon name="fullscreen" />
											</button>
										</div>
									</div>
								</div>
							</div>
						</>
					) : null}
				</div>
			) : null}
		</div>
	)
}

function Scrubber({
	buffered,
	duration,
	onScrub,
	onScrubEnd,
	onScrubStart,
	time,
	tracked,
}: {
	buffered: number
	duration: number
	onScrub(ratio: number): void
	onScrubEnd(resume: boolean): void
	onScrubStart(): boolean
	time: number
	tracked: number
}) {
	const track = useRef<HTMLDivElement>(null)
	const resume = useRef(false)
	const [hover, setHover] = useState<number | null>(null)
	const [dragging, setDragging] = useState(false)
	const played = duration > 0 ? clamp(time / duration, 0, 1) : 0
	const loaded = duration > 0 ? clamp(buffered / duration, 0, 1) : 0

	function ratioAt(x: number): number {
		const rect = track.current?.getBoundingClientRect()
		return rect && rect.width > 0 ? clamp((x - rect.left) / rect.width, 0, 1) : 0
	}

	function end(): void {
		setDragging(false)
		onScrubEnd(resume.current)
	}

	return (
		<div
			aria-label="Seek"
			aria-valuemax={Math.round(duration)}
			aria-valuemin={0}
			aria-valuenow={Math.round(time)}
			aria-valuetext={tracked > 0 ? `${clock(time)}, ${span((played || 0) * tracked)} in` : clock(time)}
			className={dragging || hover !== null ? "lapse-scrub is-active" : "lapse-scrub"}
			onLostPointerCapture={() => {
				if (dragging) end()
			}}
			onPointerDown={e => {
				if (e.button !== 0 || duration <= 0) return
				e.preventDefault()
				e.currentTarget.setPointerCapture(e.pointerId)
				setDragging(true)
				setHover(ratioAt(e.clientX))
				resume.current = onScrubStart()
				onScrub(ratioAt(e.clientX))
			}}
			onPointerLeave={() => {
				if (!dragging) setHover(null)
			}}
			onPointerMove={e => {
				const ratio = ratioAt(e.clientX)
				setHover(ratio)
				if (dragging) onScrub(ratio)
			}}
			onPointerUp={e => {
				if (!dragging) return
				e.currentTarget.releasePointerCapture(e.pointerId)
				end()
				if (e.pointerType !== "mouse") setHover(null)
			}}
			role="slider"
			tabIndex={-1}
		>
			<div className="lapse-scrub__track" ref={track}>
				<div className="lapse-scrub__buffered" style={{ width: `${loaded * 100}%` }} />
				<div className="lapse-scrub__played" style={{ width: `${played * 100}%` }} />
				<div className="lapse-scrub__head" style={{ left: `${played * 100}%` }} />
			</div>
			{hover !== null && duration > 0 ? (
				<div className="lapse-scrub__tip" style={{ left: `${clamp(hover, 0.06, 0.94) * 100}%` }}>
					<span className="lapse-scrub__clock">{clock(hover * duration)}</span>
					{tracked > 0 ? <span>{span(hover * tracked)} in</span> : null}
				</div>
			) : null}
		</div>
	)
}
