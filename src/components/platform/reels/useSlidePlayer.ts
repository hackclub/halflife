"use client"

import { type RefObject, useCallback, useEffect, useRef, useState } from "react"
import type { FeedItem } from "@/lib/feed"
import { prefersStill } from "@/lib/reduced-motion"
import { notePlaying, noteStopped, playExclusive } from "./ReelCard"

export interface SlidePlayer {
	/** The progress fill inside the seek bar. */
	fill: RefObject<HTMLDivElement | null>
	handleLoadedMetadata(event: React.SyntheticEvent<HTMLVideoElement>): void
	handlePause(event: React.SyntheticEvent<HTMLVideoElement>): void
	handlePlay(event: React.SyntheticEvent<HTMLVideoElement>): void
	handleTime(): void
	playing: boolean
	/** Move the video to a pointer's position along the seek bar. */
	seekTo(clientX: number, track: HTMLElement): void
	time: { now: number; total: number }
	/** Play or pause, for the surface, the keyboard and the strip. */
	toggle(): void
	video: RefObject<HTMLVideoElement | null>
}

/**
 * One slide's video: play/pause, the clock, the progress bar and the view count.
 *
 * Playback follows `active` and nothing else. The page decides which slide is current; the slide plays when it is, from the top, and stops when it is not.
 */
export function useSlidePlayer({
	active,
	muted,
	onAutoMuted,
	rate,
	reel,
	register,
}: {
	active: boolean
	muted: boolean
	onAutoMuted(): void
	rate: number
	reel: FeedItem
	register(handle: { toggle(): void } | null): void
}): SlidePlayer {
	const video = useRef<HTMLVideoElement>(null)
	const fill = useRef<HTMLDivElement>(null)
	const [playing, setPlaying] = useState(false)
	const [time, setTime] = useState({ now: 0, total: reel.durationSeconds ?? 0 })
	const counted = useRef(false)

	// `muted` as a prop is not reflected after mount in React, so both are set on the element directly.
	useEffect(() => {
		const el = video.current
		if (!el) return
		el.muted = muted
		el.playbackRate = rate
	}, [muted, rate])

	useEffect(() => {
		const el = video.current
		if (!el) return
		if (!active) {
			el.pause()
			return
		}
		// Arriving is asking to watch – except for anyone who has asked for less motion, who gets the play button instead of a video that starts moving.
		if (prefersStill()) return
		el.currentTime = 0
		let cancelled = false
		void (async () => {
			const ok = await playExclusive(el)
			if (ok || cancelled || el.muted) return
			// Sound before the reader has touched the page is the browser's to refuse, and it does. Muted playback it always allows, so the reel plays silently and the page offers the sound back.
			el.muted = true
			onAutoMuted()
			await playExclusive(el)
		})()
		return () => {
			cancelled = true
		}
	}, [active, onAutoMuted])

	// Smooth rather than stepped: `timeupdate` fires four times a second, which makes a thin bar visibly tick. Only the playing slide pays for a frame loop.
	useEffect(() => {
		if (!active || !playing) return
		let raf = 0
		const tick = () => {
			const el = video.current
			if (el && fill.current && el.duration) fill.current.style.transform = `scaleX(${el.currentTime / el.duration})`
			raf = requestAnimationFrame(tick)
		}
		raf = requestAnimationFrame(tick)
		return () => cancelAnimationFrame(raf)
	}, [active, playing])

	const toggle = useCallback(() => {
		const el = video.current
		if (!el || !reel.videoUrl) return
		if (el.paused) void playExclusive(el)
		else el.pause()
	}, [reel.videoUrl])

	useEffect(() => {
		if (!active) return
		register({ toggle })
		return () => register(null)
	}, [active, register, toggle])

	// The clock, the bar while it is not being driven by the frame loop, and the view. A view is a second of actual playback, not an arrival that a quick flick scrolled straight past – once per slide; the server counts once per person.
	function handleTime() {
		const el = video.current
		if (!el) return
		setTime({ now: el.currentTime, total: el.duration || reel.durationSeconds || 0 })
		if (!playing && fill.current && el.duration)
			fill.current.style.transform = `scaleX(${el.currentTime / el.duration})`
		if (counted.current) return
		let watched = 0
		for (let i = 0; i < el.played.length; i++) watched += el.played.end(i) - el.played.start(i)
		if (watched < 1) return
		counted.current = true
		void fetch(`/api/posts/${reel.id}/view`, { method: "POST" })
	}

	function seekTo(clientX: number, track: HTMLElement) {
		const el = video.current
		if (!el?.duration) return
		const box = track.getBoundingClientRect()
		const f = Math.min(1, Math.max(0, (clientX - box.left) / box.width))
		el.currentTime = f * el.duration
		if (fill.current) fill.current.style.transform = `scaleX(${f})`
		setTime({ now: el.currentTime, total: el.duration })
	}

	return {
		fill,
		handleLoadedMetadata: e => setTime({ now: e.currentTarget.currentTime, total: e.currentTarget.duration }),
		handlePause: e => {
			noteStopped(e.currentTarget)
			setPlaying(false)
		},
		handlePlay: e => {
			notePlaying(e.currentTarget)
			setPlaying(true)
		},
		handleTime,
		playing,
		seekTo,
		time,
		toggle,
		video,
	}
}
