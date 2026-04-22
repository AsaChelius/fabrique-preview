"use client";

/**
 * Next.js `template.tsx` — mounts fresh on every route change, giving us
 * a natural hook for a transition animation. We fade + scale the incoming
 * page content, and the persistent body-level starfield (set in globals.css
 * `.site-backdrop`) means there's never a plain-black gap while the new
 * route's Canvas boots.
 */

import { motion } from "framer-motion";
import { usePathname } from "next/navigation";

export default function Template({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, scale: 0.985, filter: "blur(6px)" }}
      animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
      transition={{
        duration: 0.55,
        ease: [0.2, 0.8, 0.2, 1],
      }}
      style={{ minHeight: "100svh" }}
    >
      {children}
    </motion.div>
  );
}
