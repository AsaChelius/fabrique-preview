import { HeroScene } from "@/components/three/hero-scene";
import { ContactCTA } from "@/components/ui/contact-cta";

/** /old — the original FABRIQUE physics-letter hero scene, kept around
 *  so the parents-preview deployment can still link back to "the version
 *  we started from" via the 'Old' button on the /title page. The site
 *  root and other legacy routes still redirect to /title. */
export default function OldHome() {
  return (
    <main>
      <div className="scene-root">
        <HeroScene />
      </div>
      <div className="scene-overlay">
        <div className="hero-copy">
          <p className="eyebrow">FABRIQUE · Studio</p>
          <h1>We build sites that move, hit back, and remember you.</h1>
          <p>
            Physics-driven interfaces, interactive 3D, apps that feel alive.
            Poke the letters. Throw them around.
          </p>
          <ContactCTA />
        </div>
        <div className="hero-hint">
          <span>
            drag <span className="key">letters</span>
          </span>
          <span>
            flick <span className="key">cursor</span>
          </span>
        </div>
      </div>
    </main>
  );
}
