"use client";

import { CockpitScene, useCockpitDialogue } from "@/components/three/cockpit-scene";
import { ContactCTA } from "@/components/ui/contact-cta";

/** /about — you've boarded the FABRIQUE ship. Cockpit scene in the back,
    story copy on the right panel, pilot dialogue bubbles centered at the
    top so they read large and stay visible through each 2–3 turn convo. */
export function AboutRoute() {
  const { edouardLine, asaLine } = useCockpitDialogue();
  return (
    <main>
      <div className="scene-root">
        <CockpitScene edouardLine={edouardLine} asaLine={asaLine} />
      </div>
      <div className="scene-overlay">
        {/* Chat bubbles are rendered inside the 3D scene, anchored to each
            pilot's head via drei <Html>, so they visually come from the
            speakers themselves. */}
        <div className="about-panel">
          <p className="eyebrow">FABRIQUE · About</p>
          <h1 className="about-heading">
            Two pilots. One workshop. Sites that move.
          </h1>
          <div className="about-body">
            <p>
              We&apos;re <strong>Edouard</strong> and <strong>Asa</strong> — a two-person
              studio building physics-driven interfaces, interactive 3D, and
              apps that actually feel alive. We met because we both got tired
              of the same scroll-fade-in portfolio template, and started
              putting the good parts (motion, weight, reaction) back into
              client work.
            </p>
            <p>
              Edouard drives the frontend — R3F, shaders, the stuff that
              moves on screen. Asa runs the backend — APIs, data, the stuff
              that keeps the lights on. Together we ship small, sharp
              projects and the occasional oddball like this site.
            </p>
            <p>
              This ship is <em>FABRIQUE</em>. The cockpit out there is where
              we dream up the next project. If you&apos;re looking for a team
              that won&apos;t phone it in — that&apos;s us.
            </p>
          </div>
          <ContactCTA />
        </div>
      </div>
    </main>
  );
}
