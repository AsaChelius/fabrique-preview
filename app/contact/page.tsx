import { ContactScene } from "@/components/three/contact-scene";

export const metadata = {
  title: "FABRIQUE — Contact",
  description: "Get in touch with FABRIQUE.",
};

export default function ContactPage() {
  return (
    <main>
      {/* Full-viewport 3D contact scene. Click the CRT to open the form. */}
      <div className="contact-fullscene">
        <ContactScene />
      </div>
    </main>
  );
}
