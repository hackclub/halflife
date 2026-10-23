/**
 * The video formats a picker offers, and the refusal a wrong file gets.
 *
 * Like `IMAGE_ACCEPT`, the `accept` attribute is a filter for the dialog and not a check; the server is what actually validates the bytes. Three surfaces had written the same type check and the same sentence out, which is how one of them ends up offering a format the upload route refuses.
 */
const VIDEO_ACCEPT = "video/mp4,video/webm,video/quicktime"

const VIDEO_TYPE_MESSAGE = "Choose a video file (MP4, WebM, or MOV)."

/** The client-side check behind `accept`, said the same way everywhere. */
function isVideoFile(file: File): boolean {
	return file.type.startsWith("video/")
}

export { isVideoFile, VIDEO_ACCEPT, VIDEO_TYPE_MESSAGE }
