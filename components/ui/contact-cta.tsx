import Link from "next/link";

/** Small pill-shaped CTA that links to /contact. Shown under every page's
    hero-copy block. */
export function ContactCTA() {
  return (
    <Link href="/contact" className="hero-cta">
      <span>Contact us</span>
    </Link>
  );
}
