import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import type { RGB } from "@core/types";
import { faceAtAtlasPixel, facesInAtlasCircle, paintAtlasImage, paintAtlasOverlay, type AtlasMasks, type FaceAtlas } from "../engine/atlas";
import type { PickInfo } from "./MeshViewer";

export interface ColourMapHandle {
  /** Repaint the pixels of these faces from `colourOf`. */
  repaintFaces(faces: ArrayLike<number>): void;
  /** Brush circle mirrored from the 3D view (atlas pixels), or null to hide. */
  setRemoteCursor(position: [number, number] | null): void;
  /** Centre the view on an atlas-pixel box [x0, y0, x1, y1], zooming only when it is too small or too large to see. */
  focusOn(box: [number, number, number, number]): void;
}

export interface ColourMapProps {
  atlas: FaceAtlas | null;
  building: boolean;
  /** Reads the colour of a face (current colours, including an in-progress stroke). */
  colourOf: (face: number) => RGB;
  /** Bump to repaint every pixel. */
  coloursVersion: number;
  masks: AtlasMasks;
  brush: { active: boolean; radiusPx: number; hex: string };
  onPick?: (face: number | null, info: PickInfo) => void;
  onHover?: (face: number | null) => void;
  onBrushStart?: () => void;
  onBrushPaint?: (faces: Int32Array) => void;
  onBrushEnd?: () => void;
  label: string;
  hint: string;
  emptyLabel: string;
  buildingLabel: string;
}

interface ViewTransform {
  scale: number;
  tx: number;
  ty: number;
}

export const ColourMap = forwardRef<ColourMapHandle, ColourMapProps>(function ColourMap(
  { atlas, building, colourOf, coloursVersion, masks, brush, onPick, onHover, onBrushStart, onBrushPaint, onBrushEnd, label, hint, emptyLabel, buildingLabel },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseRef = useRef<{ canvas: HTMLCanvasElement; image: ImageData } | null>(null);
  const overlayRef = useRef<{ canvas: HTMLCanvasElement; image: ImageData; any: boolean } | null>(null);
  const viewRef = useRef<ViewTransform>({ scale: 1, tx: 0, ty: 0 });
  const fittedForRef = useRef<FaceAtlas | null>(null);
  const cursorRef = useRef<[number, number] | null>(null);
  const remoteCursorRef = useRef<[number, number] | null>(null);
  const rafRef = useRef<number | null>(null);
  const callbacksRef = useRef({ onPick, onHover, onBrushStart, onBrushPaint, onBrushEnd, colourOf });
  callbacksRef.current = { onPick, onHover, onBrushStart, onBrushPaint, onBrushEnd, colourOf };
  const brushRef = useRef(brush);
  brushRef.current = brush;
  const atlasRef = useRef(atlas);
  atlasRef.current = atlas;

  const draw = useCallback(() => {
    rafRef.current = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#14181d";
    ctx.fillRect(0, 0, width, height);
    const base = baseRef.current;
    const view = viewRef.current;
    canvas.dataset.view = `${view.scale.toFixed(4)},${view.tx.toFixed(1)},${view.ty.toFixed(1)}`;
    if (base) {
      ctx.imageSmoothingEnabled = view.scale < 1;
      ctx.save();
      ctx.translate(view.tx, view.ty);
      ctx.scale(view.scale, view.scale);
      ctx.drawImage(base.canvas, 0, 0);
      const overlay = overlayRef.current;
      if (overlay?.any) ctx.drawImage(overlay.canvas, 0, 0);
      ctx.restore();
      const drawCursor = (position: [number, number], dashed: boolean) => {
        const cx = position[0] * view.scale + view.tx;
        const cy = position[1] * view.scale + view.ty;
        const r = Math.max(2, brushRef.current.radiusPx * view.scale);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.lineWidth = 1.5;
        ctx.setLineDash(dashed ? [4, 3] : []);
        ctx.strokeStyle = "#ff8a3d";
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = "#ff8a3d";
        ctx.fill();
      };
      if (brushRef.current.active && cursorRef.current) drawCursor(cursorRef.current, false);
      if (remoteCursorRef.current) drawCursor(remoteCursorRef.current, true);
    }
  }, []);

  const requestDraw = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(draw);
  }, [draw]);

  const fitView = useCallback(() => {
    const canvas = canvasRef.current;
    const current = atlasRef.current;
    if (!canvas || !current) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    const scale = Math.max(1e-3, (Math.min(width, height) - 12) / current.size);
    viewRef.current = { scale, tx: (width - current.size * scale) / 2, ty: (height - current.size * scale) / 2 };
    requestDraw();
  }, [requestDraw]);

  useImperativeHandle(
    ref,
    () => ({
      repaintFaces(faces) {
        const current = atlasRef.current;
        const base = baseRef.current;
        if (!current || !base || faces.length === 0) return;
        const rect = paintAtlasImage(current, callbacksRef.current.colourOf, base.image.data, faces);
        if (rect.w > 0 && rect.h > 0) base.canvas.getContext("2d")?.putImageData(base.image, 0, 0, rect.x, rect.y, rect.w, rect.h);
        requestDraw();
      },
      setRemoteCursor(position) {
        remoteCursorRef.current = position;
        requestDraw();
      },
      focusOn(box) {
        const canvas = canvasRef.current;
        const current = atlasRef.current;
        if (!canvas || !current) return;
        const dpr = window.devicePixelRatio || 1;
        const width = canvas.width / dpr;
        const height = canvas.height / dpr;
        const bw = Math.max(4, box[2] - box[0]);
        const bh = Math.max(4, box[3] - box[1]);
        const fit = Math.max(1e-3, (Math.min(width, height) - 12) / current.size);
        const view = viewRef.current;
        const shownW = bw * view.scale;
        const shownH = bh * view.scale;
        let scale = view.scale;
        if (shownW > width * 0.6 || shownH > height * 0.6 || Math.max(shownW, shownH) < Math.min(width, height) * 0.06) {
          scale = Math.min((width * 0.45) / bw, (height * 0.45) / bh);
          scale = Math.max(fit, Math.min(scale, Math.max(fit * 12, 8)));
        }
        const cx = (box[0] + box[2]) / 2;
        const cy = (box[1] + box[3]) / 2;
        viewRef.current = { scale, tx: width / 2 - cx * scale, ty: height / 2 - cy * scale };
        requestDraw();
      },
    }),
    [requestDraw],
  );

  // Offscreen buffers follow the atlas; full repaint on colour version changes.
  useEffect(() => {
    if (!atlas) {
      baseRef.current = null;
      overlayRef.current = null;
      requestDraw();
      return;
    }
    if (!baseRef.current || baseRef.current.canvas.width !== atlas.size) {
      const canvas = document.createElement("canvas");
      canvas.width = atlas.size;
      canvas.height = atlas.size;
      baseRef.current = { canvas, image: new ImageData(atlas.size, atlas.size) };
      const overlayCanvas = document.createElement("canvas");
      overlayCanvas.width = atlas.size;
      overlayCanvas.height = atlas.size;
      overlayRef.current = { canvas: overlayCanvas, image: new ImageData(atlas.size, atlas.size), any: false };
    }
    const base = baseRef.current;
    paintAtlasImage(atlas, callbacksRef.current.colourOf, base.image.data);
    base.canvas.getContext("2d")?.putImageData(base.image, 0, 0);
    if (fittedForRef.current !== atlas) {
      fittedForRef.current = atlas;
      fitView();
    }
    requestDraw();
  }, [atlas, coloursVersion, fitView, requestDraw]);

  // Selection overlay.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!atlas || !overlay) return;
    overlay.any = paintAtlasOverlay(atlas, masks, overlay.image.data);
    overlay.canvas.getContext("2d")?.putImageData(overlay.image, 0, 0);
    requestDraw();
  }, [atlas, masks, requestDraw]);

  useEffect(() => {
    requestDraw();
  }, [brush, requestDraw]);

  // Canvas sizing.
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    let first = true;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      if (first || !fittedForRef.current) {
        first = false;
        fitView();
      }
      requestDraw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [fitView, requestDraw]);

  // Pointer interaction: click = pick, left-drag = pan (or paint in brush mode), right/middle-drag = pan, wheel = zoom.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const toAtlas = (event: PointerEvent | WheelEvent): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      const view = viewRef.current;
      return [(event.clientX - rect.left - view.tx) / view.scale, (event.clientY - rect.top - view.ty) / view.scale];
    };
    let down: { x: number; y: number; button: number; moved: boolean; painting: boolean } | null = null;
    let lastClick: { face: number; time: number } | null = null;
    const paintAt = (position: [number, number]) => {
      const current = atlasRef.current;
      if (!current) return;
      const faces = facesInAtlasCircle(current, position[0], position[1], brushRef.current.radiusPx);
      if (faces.length > 0) callbacksRef.current.onBrushPaint?.(faces);
    };
    const onPointerDown = (event: PointerEvent) => {
      canvas.setPointerCapture(event.pointerId);
      const painting = brushRef.current.active && event.button === 0;
      down = { x: event.clientX, y: event.clientY, button: event.button, moved: false, painting };
      if (painting) {
        callbacksRef.current.onBrushStart?.();
        paintAt(toAtlas(event));
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      const position = toAtlas(event);
      cursorRef.current = position;
      if (down) {
        if (down.painting) {
          paintAt(position);
        } else {
          const dx = event.clientX - down.x;
          const dy = event.clientY - down.y;
          if (Math.hypot(dx, dy) > 4) down.moved = true;
          if (down.moved) {
            viewRef.current = { ...viewRef.current, tx: viewRef.current.tx + dx, ty: viewRef.current.ty + dy };
            down.x = event.clientX;
            down.y = event.clientY;
          }
        }
      } else {
        const current = atlasRef.current;
        callbacksRef.current.onHover?.(current ? faceAtAtlasPixel(current, position[0], position[1]) : null);
      }
      requestDraw();
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!down) return;
      const state = down;
      down = null;
      if (state.painting) {
        callbacksRef.current.onBrushEnd?.();
        return;
      }
      if (state.moved || state.button !== 0) return;
      const current = atlasRef.current;
      if (!current) return;
      const position = toAtlas(event);
      const face = faceAtAtlasPixel(current, position[0], position[1]);
      const now = performance.now();
      const double = face >= 0 && lastClick !== null && lastClick.face === face && now - lastClick.time < 400;
      lastClick = double || face < 0 ? null : { face, time: now };
      callbacksRef.current.onPick?.(face >= 0 ? face : null, { double, toggle: event.shiftKey || event.ctrlKey || event.metaKey, source: "map" });
    };
    const onPointerLeave = () => {
      cursorRef.current = null;
      callbacksRef.current.onHover?.(null);
      requestDraw();
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = atlasRef.current;
      if (!current) return;
      const rect = canvas.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      const view = viewRef.current;
      const factor = Math.exp(-event.deltaY * 0.0015);
      const minScale = Math.max(1e-3, (Math.min(rect.width, rect.height) - 12) / current.size) * 0.5;
      const scale = Math.min(64, Math.max(minScale, view.scale * factor));
      const ratio = scale / view.scale;
      viewRef.current = { scale, tx: sx - (sx - view.tx) * ratio, ty: sy - (sy - view.ty) * ratio };
      cursorRef.current = toAtlas(event);
      requestDraw();
    };
    const onContextMenu = (event: MouseEvent) => event.preventDefault();
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContextMenu);
    };
  }, [requestDraw]);

  return (
    <div className={`colour-map${brush.active ? " brushing" : ""}`}>
      <div className="mesh-viewer-label">
        {label}
        {atlas && <span className="muted"> · {atlas.size}px · {hint}</span>}
      </div>
      <div className="colour-map-host" ref={containerRef}>
        <canvas ref={canvasRef} />
      </div>
      {!atlas && <div className="mesh-viewer-empty">{building ? buildingLabel : emptyLabel}</div>}
      <button type="button" className="btn small colour-map-fit" onClick={fitView} title="fit">
        ⤢
      </button>
    </div>
  );
});
