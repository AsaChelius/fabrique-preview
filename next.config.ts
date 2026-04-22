import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // React Strict Mode double-mounts every component in dev. That fights with
  // @react-three/rapier (bodies mount → unmount → re-mount faster than the
  // physics world settles), which produces the "Maximum update depth
  // exceeded" loop + black-frame flicker on the hero. Turn it off in dev;
  // production still gets the safety checks via React's own build pipeline.
  reactStrictMode: false,
};

export default nextConfig;
