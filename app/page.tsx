import { HeroScene } from "@/components/three/hero-scene";
import { ContactCTA } from "@/components/ui/contact-cta";

export default function Home() {
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
