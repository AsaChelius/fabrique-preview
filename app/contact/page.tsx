import { ContactForm } from "@/components/ui/contact-form";
import { PhoneScene } from "@/components/three/phone-scene";

export const metadata = {
  title: "FABRIQUE — Contact",
  description: "Get in touch with FABRIQUE.",
};

export default function ContactPage() {
  return (
    <main>
      {/* Left: form. Right: 3D phone scene. The phone is interactive — try
          picking it up and dialing the number on the post-it. */}
      <div className="contact-split">
        <div className="contact-form-side">
          <p className="eyebrow">FABRIQUE · Contact</p>
          <h1 className="contact-heading">Tell us what you&apos;re building.</h1>
          <p className="contact-body">
            We read everything. Short notes are fine. Or pick up the phone.
          </p>
          <div style={{ marginTop: "1.75rem", maxWidth: "42ch" }}>
            <ContactForm />
          </div>
        </div>
        <div className="contact-phone-side">
          <PhoneScene />
        </div>
      </div>
    </main>
  );
}
