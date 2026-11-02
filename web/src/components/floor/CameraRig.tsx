import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef } from "react";
import { CAMERA_KEY, defaultCamera, MAX_DISTANCE, MAX_POLAR, MIN_DISTANCE, parseCamera, type CameraPose } from "./layout";

function readSaved(): CameraPose | null {
  try {
    return parseCamera(localStorage.getItem(CAMERA_KEY));
  } catch {
    return null;
  }
}
function save(pose: CameraPose) {
  try {
    localStorage.setItem(CAMERA_KEY, JSON.stringify(pose));
  } catch {}
}

function clearSaved() {
  try {
    localStorage.removeItem(CAMERA_KEY);
  } catch {}
}

/** Orbit and zoom with limits. The view survives a reload through localStorage; RESET VIEW restores the default. */
export function CameraRig({ resetCount, reduced }: { resetCount: number; reduced: boolean }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<any>(null);
  const custom = useRef(false); // true once the viewer has a view of their own
  const restored = useRef(false);
  const seenReset = useRef(resetCount);
  const pendingSave = useRef(false);
  const lastPose = useRef<CameraPose | null>(null);
  const stillFrames = useRef(0);

  const apply = useCallback((pose: CameraPose) => {
    // Drop leftover damping motion first. Dragging against a limit leaves a residual rotation
    // that the next update() would replay, pulling RESET VIEW straight back to that limit.
    const c = controls.current;
    if (c) {
      const damping = c.enableDamping;
      c.enableDamping = false;
      c.update();
      c.enableDamping = damping;
    }
    camera.position.set(...pose.position);
    controls.current?.target.set(...pose.target);
    camera.lookAt(...pose.target);
    controls.current?.update();
    invalidate();
  }, [camera, invalidate]);

  // The default view fits the panel, so it follows resizes until the viewer moves the camera.
  useEffect(() => {
    if (!size.width || !size.height) return;
    if (!restored.current) {
      restored.current = true;
      const saved = readSaved();
      if (saved) {
        custom.current = true;
        apply(saved);
        return;
      }
    }
    if (!custom.current) apply(defaultCamera(size.width / size.height));
  }, [apply, size.width, size.height]);

  useEffect(() => {
    if (resetCount === seenReset.current) return;
    seenReset.current = resetCount;
    custom.current = false;
    pendingSave.current = false;
    lastPose.current = null;
    stillFrames.current = 0;
    clearSaved();
    apply(defaultCamera(size.width / size.height));
  }, [resetCount, apply, size.width, size.height]);

  const onStart = useCallback(() => {
    custom.current = true;
    pendingSave.current = false;
    lastPose.current = null;
    stillFrames.current = 0;
  }, []);

  const onEnd = useCallback(() => {
    pendingSave.current = true;
    invalidate();
  }, [invalidate]);

  // Drei updates controls at priority -1. Observe the actual post-damping pose here,
  // including tiny residual motion below OrbitControls' change-event threshold.
  useFrame(() => {
    const c = controls.current;
    if (!pendingSave.current || !custom.current || !c) return;
    const pose: CameraPose = { position: [camera.position.x, camera.position.y, camera.position.z], target: [c.target.x, c.target.y, c.target.z] };
    const last = lastPose.current;
    const stable = last && pose.position.every((n, i) => Math.abs(n - last.position[i]) < 1e-6)
      && pose.target.every((n, i) => Math.abs(n - last.target[i]) < 1e-6);
    stillFrames.current = stable ? stillFrames.current + 1 : 0;
    lastPose.current = pose;
    if (stillFrames.current >= 3) {
      save(pose);
      pendingSave.current = false;
    } else invalidate();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      enableDamping={!reduced}
      minDistance={MIN_DISTANCE}
      maxDistance={MAX_DISTANCE}
      minPolarAngle={0.1}
      maxPolarAngle={MAX_POLAR}
      onStart={onStart}
      onEnd={onEnd}
    />
  );
}
