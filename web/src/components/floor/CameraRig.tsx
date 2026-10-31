import { OrbitControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
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

  const apply = useCallback((pose: CameraPose) => {
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
    clearSaved();
    apply(defaultCamera(size.width / size.height));
  }, [resetCount, apply, size.width, size.height]);

  const onEnd = useCallback(() => {
    const c = controls.current;
    if (!c) return;
    custom.current = true;
    save({ position: [camera.position.x, camera.position.y, camera.position.z], target: [c.target.x, c.target.y, c.target.z] });
  }, [camera]);

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
      onEnd={onEnd}
    />
  );
}
