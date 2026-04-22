import { ContactForm } from "@/components/ui/contact-form";

export const metadata = {
  title: "FABRIQUE — Contact",
  description: "Get in touch with FABRIQUE.",
};

export default function ContactPage() {
  return (
    <main>
      <div className="scene-root" style={{ pointerEvents: "none" }}>
        {/* Contact route keeps the dark scene backdrop but swaps 3D for
            a quiet gradient so the form has breathing room. */}
      </div>
      <div className="scene-overlay">
        <div className="hero-copy" style={{ position: "relative", padding: "12vh 2vw 4vh" }}>
          <p className="eyebrow">FABRIQUE · Contact</p>
          <h1>Tell us what you&apos;re building.</h1>
          <p>We read everything. Short notes are fine.</p>
          <div style={{ marginTop: "2rem", maxWidth: "44ch" }}>
            <ContactForm />
          </div>
        </div>
      </div>
    </main>
  );
}
