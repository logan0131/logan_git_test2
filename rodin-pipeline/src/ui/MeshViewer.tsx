import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { RGB } from "@core/types";
import type { ViewName } from "../engine/types";
import { srgbToLinear } from "../engine/mesh";

export interface PickInfo {
  /** Second click on the same face within 400 ms. */
  double: boolean;
  /** Shift / Ctrl / Cmd held: add to or remove from the selection. */
  toggle: boolean;
  /** Which view the click came from (the other view re-centres on the patch). */
  source?: "3d" | "map";
}

export interface HighlightOverlay {
  id: string;
  /** Non-indexed face positions (3 corners each). */
  fill: Float32Array;
  /** Boundary line segments (2 points each). */
  edges: Float32Array;
  colour: string;
  pulse?: boolean;
  opacity?: number;
}

export interface ViewerHit {
  faceIndex: number;
  point: [number, number, number];
  normal: [number, number, number];
}

export interface BrushCursor {
  point: [number, number, number];
  normal: [number, number, number];
  radius: number;
}

export interface MeshViewerHandle {
  /** Recolour faces in place (0..255 sRGB) without a React round trip. */
  setFaceColours(faces: ArrayLike<number>, rgb: RGB): void;
  /** Show/hide the brush circle on the surface. */
  setBrushCursor(cursor: BrushCursor | null): void;
  /** Unit vector the camera looks along. */
  viewDirection(): [number, number, number];
  /** Pan so that `point` sits at the screen centre (orientation and distance unchanged). */
  focusOn(point: [number, number, number]): void;
}

export interface MeshViewerProps {
  positions: Float32Array | null;
  colours: Float32Array | null;
  view: ViewName;
  /** Bump to re-fit the camera to the current view. */
  fitNonce: number;
  overlays?: HighlightOverlay[];
  /** Called with the clicked face index (or null when nothing was hit). */
  onPick?: (faceIndex: number | null, info: PickInfo) => void;
  label?: string;
  emptyLabel?: string;
  className?: string;
  /** Unlit rendering: face colours exactly as stored, no shading. */
  flat?: boolean;
  /** Brush mode: left-drag paints (rotate with the right button, zoom with the wheel). */
  brush?: boolean;
  onBrushHover?: (hit: ViewerHit | null) => void;
  onBrushStart?: (hit: ViewerHit | null) => void;
  onBrushDrag?: (hit: ViewerHit | null) => void;
  onBrushEnd?: () => void;
}

function makeMeshMaterial(flat: boolean): THREE.Material {
  if (flat) return new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffffff, side: THREE.DoubleSide });
  return new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xffffff, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
}

/** Renders the face index as a colour so a single pixel read identifies the face under the cursor. */
function makePickMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexShader: `
      attribute float faceId;
      varying vec3 vId;
      void main() {
        float id = faceId;
        float r = mod(id, 256.0);
        float g = mod(floor(id / 256.0), 256.0);
        float b = floor(id / 65536.0);
        vId = vec3(r, g, b) / 255.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vId;
      void main() { gl_FragColor = vec4(vId, 1.0); }
    `,
  });
}

interface OverlayObjects {
  mesh: THREE.Mesh;
  lines: THREE.LineSegments;
  fillMaterial: THREE.MeshBasicMaterial;
  lineMaterial: THREE.LineBasicMaterial;
  baseOpacity: number;
  pulse: boolean;
}

interface ViewerState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  mesh: THREE.Mesh | null;
  geometry: THREE.BufferGeometry | null;
  faceCount: number;
  overlayGroup: THREE.Group;
  overlays: OverlayObjects[];
  cursorGroup: THREE.Group;
  cursorLine: THREE.LineLoop;
  pickMaterial: THREE.ShaderMaterial;
  pickTarget: THREE.WebGLRenderTarget | null;
  needsRender: boolean;
  raf: number | null;
  pulseRaf: number | null;
  bounds: { center: THREE.Vector3; radius: number } | null;
}

const VIEW_DIRECTIONS: Record<ViewName, [number, number, number]> = {
  front: [0, -1, 0],
  back: [0, 1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  top: [0, 0, 1],
  iso: [-0.72, -1.0, 0.68],
};

function requestRender(state: ViewerState): void {
  state.needsRender = true;
  if (state.raf !== null) return;
  state.raf = window.requestAnimationFrame(() => {
    state.raf = null;
    if (!state.needsRender) return;
    state.needsRender = false;
    state.renderer.render(state.scene, state.camera);
    // Camera position, readable from outside (debugging / tests).
    const p = state.camera.position;
    state.renderer.domElement.dataset.camera = `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`;
  });
}

function fitCamera(state: ViewerState, view: ViewName): void {
  const bounds = state.bounds;
  if (!bounds) return;
  const dir = new THREE.Vector3(...VIEW_DIRECTIONS[view]);
  // A camera exactly on the orbit pole (straight top/bottom view with Z up) cannot be tilted by
  // dragging: OrbitControls clamps the polar angle there. Nudge those views 2° towards the front.
  if (Math.abs(dir.z) > 0.999 * dir.length()) dir.y -= 0.035 * dir.length();
  dir.normalize();
  const fov = (state.camera.fov * Math.PI) / 180;
  const distance = (bounds.radius / Math.sin(fov / 2)) * 1.12;
  state.camera.position.copy(bounds.center).addScaledVector(dir, distance);
  state.camera.up.set(0, 0, 1);
  state.camera.near = Math.max(0.01, distance - bounds.radius * 4);
  state.camera.far = distance + bounds.radius * 4;
  state.camera.updateProjectionMatrix();
  state.controls.target.copy(bounds.center);
  state.controls.update();
  requestRender(state);
}

function disposeOverlays(state: ViewerState): void {
  for (const overlay of state.overlays) {
    state.overlayGroup.remove(overlay.mesh);
    state.overlayGroup.remove(overlay.lines);
    overlay.mesh.geometry.dispose();
    overlay.lines.geometry.dispose();
    overlay.fillMaterial.dispose();
    overlay.lineMaterial.dispose();
  }
  state.overlays = [];
  if (state.pulseRaf !== null) {
    window.cancelAnimationFrame(state.pulseRaf);
    state.pulseRaf = null;
  }
}

function startPulse(state: ViewerState): void {
  if (state.pulseRaf !== null) return;
  const tick = (time: number) => {
    state.pulseRaf = null;
    const pulsing = state.overlays.filter((overlay) => overlay.pulse);
    if (pulsing.length === 0) return;
    const wave = 0.5 + 0.5 * Math.sin(time / 260);
    for (const overlay of pulsing) {
      overlay.fillMaterial.opacity = overlay.baseOpacity * (0.55 + 0.45 * wave);
      overlay.lineMaterial.opacity = 0.55 + 0.45 * wave;
    }
    requestRender(state);
    state.pulseRaf = window.requestAnimationFrame(tick);
  };
  state.pulseRaf = window.requestAnimationFrame(tick);
}

/** Face under a client-space point via an id render pass, plus the exact surface point. */
function gpuPick(state: ViewerState, clientX: number, clientY: number): ViewerHit | null {
  const { renderer, mesh, geometry, camera } = state;
  if (!mesh || !geometry) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  const dpr = renderer.getPixelRatio();
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  const x = Math.floor((clientX - rect.left) * dpr);
  const y = Math.floor((rect.bottom - clientY) * dpr);
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  if (!state.pickTarget || state.pickTarget.width !== width || state.pickTarget.height !== height) {
    state.pickTarget?.dispose();
    state.pickTarget = new THREE.WebGLRenderTarget(width, height, { depthBuffer: true, stencilBuffer: false });
  }
  const previousMaterial = mesh.material;
  const previousClear = renderer.getClearColor(new THREE.Color());
  const previousAlpha = renderer.getClearAlpha();
  mesh.material = state.pickMaterial;
  state.overlayGroup.visible = false;
  state.cursorGroup.visible = false;
  renderer.setRenderTarget(state.pickTarget);
  renderer.setClearColor(0xffffff, 1);
  renderer.clear();
  renderer.render(state.scene, camera);
  const pixel = new Uint8Array(4);
  renderer.readRenderTargetPixels(state.pickTarget, x, y, 1, 1, pixel);
  renderer.setRenderTarget(null);
  renderer.setClearColor(previousClear, previousAlpha);
  mesh.material = previousMaterial;
  state.overlayGroup.visible = true;
  state.cursorGroup.visible = true;
  const id = pixel[0] + pixel[1] * 256 + pixel[2] * 65536;
  if (id === 0xffffff || id >= state.faceCount) return null;

  const positions = (geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
  const o = id * 9;
  const a = new THREE.Vector3(positions[o], positions[o + 1], positions[o + 2]);
  const b = new THREE.Vector3(positions[o + 3], positions[o + 4], positions[o + 5]);
  const c = new THREE.Vector3(positions[o + 6], positions[o + 7], positions[o + 8]);
  const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), camera);
  const point = raycaster.ray.intersectTriangle(a, b, c, false, new THREE.Vector3()) ?? a.clone().add(b).add(c).multiplyScalar(1 / 3);
  return { faceIndex: id, point: [point.x, point.y, point.z], normal: [normal.x, normal.y, normal.z] };
}

function makeCursorLine(): THREE.LineLoop {
  const segments = 64;
  const points = new Float32Array(segments * 3);
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points[i * 3] = Math.cos(angle);
    points[i * 3 + 1] = Math.sin(angle);
    points[i * 3 + 2] = 0;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(points, 3));
  const material = new THREE.LineBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.95, depthTest: false });
  material.toneMapped = false;
  const line = new THREE.LineLoop(geometry, material);
  line.renderOrder = 20;
  line.visible = false;
  return line;
}

export const MeshViewer = forwardRef<MeshViewerHandle, MeshViewerProps>(function MeshViewer(
  { positions, colours, view, fitNonce, overlays, onPick, label, emptyLabel, className, flat = false, brush = false, onBrushHover, onBrushStart, onBrushDrag, onBrushEnd },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<ViewerState | null>(null);
  const callbacksRef = useRef({ onPick, onBrushHover, onBrushStart, onBrushDrag, onBrushEnd });
  callbacksRef.current = { onPick, onBrushHover, onBrushStart, onBrushDrag, onBrushEnd };
  const flatRef = useRef(flat);
  flatRef.current = flat;
  const brushRef = useRef(brush);
  brushRef.current = brush;

  useImperativeHandle(
    ref,
    () => ({
      setFaceColours(faces, rgb) {
        const state = stateRef.current;
        if (!state?.geometry) return;
        const attribute = state.geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
        if (!attribute) return;
        const array = attribute.array as Float32Array;
        const r = srgbToLinear(rgb[0]);
        const g = srgbToLinear(rgb[1]);
        const b = srgbToLinear(rgb[2]);
        attribute.clearUpdateRanges();
        for (let i = 0; i < faces.length; i++) {
          const o = faces[i] * 9;
          if (o + 9 > array.length) continue;
          for (let k = 0; k < 3; k++) {
            array[o + k * 3] = r;
            array[o + k * 3 + 1] = g;
            array[o + k * 3 + 2] = b;
          }
          attribute.addUpdateRange(o, 9);
        }
        attribute.needsUpdate = true;
        requestRender(state);
      },
      setBrushCursor(cursor) {
        const state = stateRef.current;
        if (!state) return;
        const line = state.cursorLine;
        if (!cursor) {
          if (line.visible) {
            line.visible = false;
            requestRender(state);
          }
          return;
        }
        const normal = new THREE.Vector3(...cursor.normal);
        if (normal.lengthSq() === 0) normal.set(0, 0, 1);
        normal.normalize();
        line.position.set(cursor.point[0], cursor.point[1], cursor.point[2]).addScaledVector(normal, cursor.radius * 0.02);
        line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
        line.scale.setScalar(Math.max(1e-6, cursor.radius));
        line.visible = true;
        requestRender(state);
      },
      viewDirection() {
        const state = stateRef.current;
        if (!state) return [0, 0, -1];
        const dir = new THREE.Vector3();
        state.camera.getWorldDirection(dir);
        return [dir.x, dir.y, dir.z];
      },
      focusOn(point) {
        const state = stateRef.current;
        if (!state) return;
        const target = new THREE.Vector3(point[0], point[1], point[2]);
        const delta = target.clone().sub(state.controls.target);
        state.camera.position.add(delta);
        state.controls.target.copy(target);
        state.controls.update();
        requestRender(state);
      },
    }),
    [],
  );

  // Create the renderer once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x2b3138, 1);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(-1.2, -2.0, 2.2);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.6);
    fill.position.set(2.0, 1.5, -1.0);
    scene.add(fill);
    const overlayGroup = new THREE.Group();
    scene.add(overlayGroup);
    const cursorGroup = new THREE.Group();
    const cursorLine = makeCursorLine();
    cursorGroup.add(cursorLine);
    scene.add(cursorGroup);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 1000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;

    const state: ViewerState = {
      renderer,
      scene,
      camera,
      controls,
      mesh: null,
      geometry: null,
      faceCount: 0,
      overlayGroup,
      overlays: [],
      cursorGroup,
      cursorLine,
      pickMaterial: makePickMaterial(),
      pickTarget: null,
      needsRender: false,
      raf: null,
      pulseRaf: null,
      bounds: null,
    };
    stateRef.current = state;
    controls.addEventListener("change", () => requestRender(state));

    // Click = pick (when the pointer did not move); brush mode = paint while the left button is down.
    let down: { x: number; y: number; time: number } | null = null;
    let lastClick: { face: number | null; time: number } | null = null;
    let brushDown = false;
    let pendingMove: { x: number; y: number; drag: boolean } | null = null;
    let moveRaf: number | null = null;
    const flushMove = () => {
      moveRaf = null;
      const move = pendingMove;
      pendingMove = null;
      if (!move) return;
      const hit = gpuPick(state, move.x, move.y);
      if (move.drag) callbacksRef.current.onBrushDrag?.(hit);
      else callbacksRef.current.onBrushHover?.(hit);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (brushRef.current && event.button === 0) {
        brushDown = true;
        renderer.domElement.setPointerCapture(event.pointerId);
        callbacksRef.current.onBrushStart?.(gpuPick(state, event.clientX, event.clientY));
        return;
      }
      down = { x: event.clientX, y: event.clientY, time: performance.now() };
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!brushRef.current) return;
      pendingMove = { x: event.clientX, y: event.clientY, drag: brushDown };
      if (moveRaf === null) moveRaf = window.requestAnimationFrame(flushMove);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (brushDown && event.button === 0) {
        brushDown = false;
        pendingMove = null;
        callbacksRef.current.onBrushEnd?.();
        return;
      }
      if (!down) return;
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      const elapsed = performance.now() - down.time;
      down = null;
      if (moved > 5 || elapsed > 600 || event.button !== 0) return;
      const handler = callbacksRef.current.onPick;
      if (!handler || !state.mesh) return;
      const hit = gpuPick(state, event.clientX, event.clientY);
      const face = hit ? hit.faceIndex : null;
      const now = performance.now();
      const double = face !== null && lastClick !== null && lastClick.face === face && now - lastClick.time < 400;
      lastClick = double ? null : { face, time: now };
      handler(face, { double, toggle: event.shiftKey || event.ctrlKey || event.metaKey, source: "3d" });
    };
    const onPointerLeave = () => {
      pendingMove = null;
      if (brushRef.current) callbacksRef.current.onBrushHover?.(null);
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("contextmenu", (event) => event.preventDefault());

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      requestRender(state);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    return () => {
      observer.disconnect();
      if (moveRaf !== null) window.cancelAnimationFrame(moveRaf);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      disposeOverlays(state);
      controls.dispose();
      state.geometry?.dispose();
      (state.mesh?.material as THREE.Material | undefined)?.dispose();
      state.pickMaterial.dispose();
      state.pickTarget?.dispose();
      cursorLine.geometry.dispose();
      (cursorLine.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
      stateRef.current = null;
    };
  }, []);

  // Brush mode: the left button paints, so rotate with the right button instead.
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    state.controls.mouseButtons = brush
      ? { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
      : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    state.renderer.domElement.style.cursor = brush ? "crosshair" : "";
    if (!brush && state.cursorLine.visible) {
      state.cursorLine.visible = false;
      requestRender(state);
    }
  }, [brush]);

  // Geometry from positions.
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    if (state.mesh) {
      state.scene.remove(state.mesh);
      state.geometry?.dispose();
      (state.mesh.material as THREE.Material).dispose();
      state.mesh = null;
      state.geometry = null;
      state.faceCount = 0;
      state.bounds = null;
    }
    if (!positions || positions.length === 0) {
      requestRender(state);
      return;
    }
    const faceCount = positions.length / 9;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const colourArray = colours && colours.length === positions.length ? colours : new Float32Array(positions.length).fill(0.6);
    geometry.setAttribute("color", new THREE.BufferAttribute(colourArray, 3));
    const ids = new Float32Array(faceCount * 3);
    for (let i = 0; i < faceCount; i++) {
      ids[i * 3] = i;
      ids[i * 3 + 1] = i;
      ids[i * 3 + 2] = i;
    }
    geometry.setAttribute("faceId", new THREE.BufferAttribute(ids, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere;
    state.bounds = sphere ? { center: sphere.center.clone(), radius: Math.max(1e-3, sphere.radius) } : null;
    const material = makeMeshMaterial(flatRef.current);
    const mesh = new THREE.Mesh(geometry, material);
    state.scene.add(mesh);
    state.mesh = mesh;
    state.geometry = geometry;
    state.faceCount = faceCount;
    fitCamera(state, view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions]);

  // Flat (unlit) vs shaded material.
  useEffect(() => {
    const state = stateRef.current;
    if (!state?.mesh) return;
    const old = state.mesh.material as THREE.Material;
    state.mesh.material = makeMeshMaterial(flat);
    old.dispose();
    requestRender(state);
  }, [flat]);

  // Colour updates without rebuilding the geometry.
  useEffect(() => {
    const state = stateRef.current;
    if (!state || !state.geometry || !colours) return;
    const attribute = state.geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
    if (attribute && attribute.array.length === colours.length) {
      (attribute.array as Float32Array).set(colours);
      attribute.clearUpdateRanges();
      attribute.needsUpdate = true;
    } else {
      state.geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    }
    requestRender(state);
  }, [colours]);

  // Highlight overlays.
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    disposeOverlays(state);
    for (const overlay of overlays ?? []) {
      if (overlay.fill.length === 0) continue;
      const colour = new THREE.Color(overlay.colour);
      const fillGeometry = new THREE.BufferGeometry();
      fillGeometry.setAttribute("position", new THREE.BufferAttribute(overlay.fill, 3));
      const baseOpacity = overlay.opacity ?? 0.5;
      const fillMaterial = new THREE.MeshBasicMaterial({
        color: colour,
        transparent: true,
        opacity: baseOpacity,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        side: THREE.DoubleSide,
      });
      fillMaterial.toneMapped = false;
      const mesh = new THREE.Mesh(fillGeometry, fillMaterial);
      mesh.renderOrder = 2;
      const lineGeometry = new THREE.BufferGeometry();
      lineGeometry.setAttribute("position", new THREE.BufferAttribute(overlay.edges, 3));
      const lineMaterial = new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: 0.9, depthTest: false });
      lineMaterial.toneMapped = false;
      const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
      lines.renderOrder = 3;
      state.overlayGroup.add(mesh);
      state.overlayGroup.add(lines);
      state.overlays.push({ mesh, lines, fillMaterial, lineMaterial, baseOpacity, pulse: overlay.pulse !== false });
    }
    requestRender(state);
    if (state.overlays.some((o) => o.pulse)) startPulse(state);
  }, [overlays]);

  // View changes.
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    fitCamera(state, view);
  }, [view, fitNonce]);

  return (
    <div className={`mesh-viewer${className ? ` ${className}` : ""}${brush ? " brushing" : ""}`}>
      {label && <div className="mesh-viewer-label">{label}</div>}
      <div className="mesh-viewer-host" ref={hostRef} />
      {(!positions || positions.length === 0) && (
        <div className="mesh-viewer-empty">{emptyLabel ?? "Load a model to see it here."}</div>
      )}
    </div>
  );
});
