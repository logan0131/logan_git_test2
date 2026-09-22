import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ViewName } from "../engine/types";

export interface MeshViewerProps {
  positions: Float32Array | null;
  colours: Float32Array | null;
  view: ViewName;
  /** Bump to re-fit the camera to the current view. */
  fitNonce: number;
  label?: string;
  emptyLabel?: string;
  className?: string;
}

interface ViewerState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  mesh: THREE.Mesh | null;
  geometry: THREE.BufferGeometry | null;
  needsRender: boolean;
  raf: number | null;
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
  });
}

function fitCamera(state: ViewerState, view: ViewName): void {
  const bounds = state.bounds;
  if (!bounds) return;
  const dir = new THREE.Vector3(...VIEW_DIRECTIONS[view]).normalize();
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

export function MeshViewer({ positions, colours, view, fitNonce, label, emptyLabel, className }: MeshViewerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<ViewerState | null>(null);

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
      needsRender: true,
      raf: null,
      bounds: null,
    };
    stateRef.current = state;
    controls.addEventListener("change", () => requestRender(state));

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
      controls.dispose();
      state.geometry?.dispose();
      (state.mesh?.material as THREE.Material | undefined)?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      stateRef.current = null;
    };
  }, []);

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
      state.bounds = null;
    }
    if (!positions || positions.length === 0) {
      requestRender(state);
      return;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const colourArray = colours && colours.length === positions.length ? colours : new Float32Array(positions.length).fill(0.6);
    geometry.setAttribute("color", new THREE.BufferAttribute(colourArray, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere;
    state.bounds = sphere ? { center: sphere.center.clone(), radius: Math.max(1e-3, sphere.radius) } : null;
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      color: 0xffffff,
      roughness: 0.8,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    state.scene.add(mesh);
    state.mesh = mesh;
    state.geometry = geometry;
    fitCamera(state, view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions]);

  // Colour updates without rebuilding the geometry.
  useEffect(() => {
    const state = stateRef.current;
    if (!state || !state.geometry || !colours) return;
    const attribute = state.geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
    if (attribute && attribute.array.length === colours.length) {
      (attribute.array as Float32Array).set(colours);
      attribute.needsUpdate = true;
    } else {
      state.geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    }
    requestRender(state);
  }, [colours]);

  // View changes.
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    fitCamera(state, view);
  }, [view, fitNonce]);

  return (
    <div className={`mesh-viewer${className ? ` ${className}` : ""}`}>
      {label && <div className="mesh-viewer-label">{label}</div>}
      <div className="mesh-viewer-host" ref={hostRef} />
      {(!positions || positions.length === 0) && (
        <div className="mesh-viewer-empty">{emptyLabel ?? "모델을 불러오면 여기에 표시됩니다."}</div>
      )}
    </div>
  );
}
