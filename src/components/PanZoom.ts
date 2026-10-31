/** Position and zoom; kept by the view so it survives re-renders */
export interface PanZoomState {
	scale: number;
	x: number;
	y: number;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 2;
// Pointer movement (px) below which a press still counts as a click
const CLICK_TOLERANCE = 4;

/**
 * Drag to pan and wheel to zoom for a canvas inside a viewport. Buttons
 * inside keep working, and clicks still reach elements unless the pointer
 * was dragged.
 */
export class PanZoom {
	/** True right after a drag, so click handlers can ignore it */
	wasDragged = false;

	constructor(
		private viewport: HTMLElement,
		private canvas: HTMLElement,
		private state: PanZoomState
	) {
		this.attach();
		this.apply();
	}

	private attach() {
		const viewport = this.viewport;
		let startX = 0;
		let startY = 0;
		let originX = 0;
		let originY = 0;
		let pressed = false;

		viewport.addEventListener("pointerdown", (e) => {
			if ((e.target as HTMLElement).closest("button")) return;
			pressed = true;
			this.wasDragged = false;
			startX = e.clientX;
			startY = e.clientY;
			originX = this.state.x;
			originY = this.state.y;
		});
		viewport.addEventListener("pointermove", (e) => {
			if (!pressed) return;
			const dx = e.clientX - startX;
			const dy = e.clientY - startY;
			if (
				!this.wasDragged &&
				Math.abs(dx) + Math.abs(dy) > CLICK_TOLERANCE
			) {
				// Capture only once it's a drag, so clicks still reach cards
				this.wasDragged = true;
				viewport.addClass("is-dragging");
				viewport.setPointerCapture(e.pointerId);
			}
			if (!this.wasDragged) return;
			this.state.x = originX + dx;
			this.state.y = originY + dy;
			this.apply();
		});
		const stop = (e: PointerEvent) => {
			pressed = false;
			viewport.removeClass("is-dragging");
			if (viewport.hasPointerCapture(e.pointerId)) {
				viewport.releasePointerCapture(e.pointerId);
			}
		};
		viewport.addEventListener("pointerup", stop);
		viewport.addEventListener("pointercancel", stop);

		// Zoom around the mouse position
		viewport.addEventListener(
			"wheel",
			(e) => {
				e.preventDefault();
				const rect = viewport.getBoundingClientRect();
				const factor = Math.exp(-e.deltaY * 0.0015);
				this.zoomAt(
					e.clientX - rect.left,
					e.clientY - rect.top,
					this.state.scale * factor
				);
			},
			{ passive: false }
		);
	}

	private zoomAt(x: number, y: number, newScale: number) {
		const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));
		// Keep the point under the mouse in place
		this.state.x = x - ((x - this.state.x) * scale) / this.state.scale;
		this.state.y = y - ((y - this.state.y) * scale) / this.state.scale;
		this.state.scale = scale;
		this.apply();
	}

	apply() {
		const { x, y, scale } = this.state;
		this.canvas.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
	}

	/** Scale (max. 100 %) and center content of the given size */
	fit(width: number, height: number, padding = 40) {
		const availableW = this.viewport.clientWidth - padding * 2;
		const availableH = this.viewport.clientHeight - padding * 2;
		this.state.scale = Math.min(
			1,
			Math.max(MIN_SCALE, Math.min(availableW / width, availableH / height))
		);
		this.state.x = (this.viewport.clientWidth - width * this.state.scale) / 2;
		this.state.y =
			(this.viewport.clientHeight - height * this.state.scale) / 2;
		this.apply();
	}

	/** Put a canvas point in the middle of the viewport */
	centerOn(x: number, y: number) {
		this.state.x = this.viewport.clientWidth / 2 - x * this.state.scale;
		this.state.y = this.viewport.clientHeight / 2 - y * this.state.scale;
		this.apply();
	}
}
