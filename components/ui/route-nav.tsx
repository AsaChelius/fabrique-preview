"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { unlockAudio, startAmbient } from "@/lib/sound";

const ROUTES = [
  { href: "/", label: "Studio" },
  { href: "/coal", label: "Work" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
] as const;

export function RouteNav() {
  const pathname = usePathname();
  const router = useRouter();

  // Unlock audio on the very first interaction anywhere on the page.
  // Also kick off the ambient drone once audio is unlocked.
  useEffect(() => {
    const unlock = () => {
      unlockAudio();
      // Small delay to let the context resume before we start oscillators.
      window.setTimeout(() => startAmbient(), 50);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  return (
    <nav className="route-nav" aria-label="Primary">
      {ROUTES.map((r) => (
        <Link
          key={r.href}
          href={r.href}
          className={pathname === r.href ? "active" : ""}
          onClick={(e) => {
            // Special case: Studio → Work is a zoom-into-the-black-hole
            // cinematic. Intercept, fire vortex-zoom so the hero camera
            // dives into the singularity + VortexFadeOverlay fades black,
            // then navigate exactly when the overlay hits full black
            // (~1.3s into the 2.4s animation) so /coal mounts unseen and
            // its own template fade-in lets it spawn smoothly as the
            // overlay fades back out.
            if (pathname === "/" && r.href === "/coal") {
              e.preventDefault();
              window.dispatchEvent(new CustomEvent("vortex-zoom"));
              window.setTimeout(() => router.push("/coal"), 1350);
            }
          }}
        >
          {r.label}
        </Link>
      ))}
    </nav>
  );
}
