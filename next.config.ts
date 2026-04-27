import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // React Strict Mode double-mounts every component in dev. That fights with
  // @react-three/rapier (bodies mount → unmount → re-mount faster than the
  // physics world settles), which produces the "Maximum update depth
  // exceeded" loop + black-frame flicker on the hero. Turn it off in dev;
  // production still gets the safety checks via React's own build pipeline.
  reactStrictMode: false,

  // ── Parents-preview lockdown ─────────────────────────────────────────
  // Only /title is reachable in this deployment. Every other page route
  // (/, /about, /coal, /contact, /lab, /projects) issues a 301 to /title
  // so visitors can't stumble into the older HeroScene / cockpit /
  // contact-form versions. /api/* and Next.js internals (_next/*,
  // /favicon.ico, etc.) are left alone so the title page can still load
  // its assets.
  async redirects() {
    const targets = ["/", "/about", "/coal", "/contact", "/lab", "/projects"];
    return targets.map((source) => ({
      source,
      destination: "/title",
      permanent: true,
    }));
  },
};

export default nextConfig;
