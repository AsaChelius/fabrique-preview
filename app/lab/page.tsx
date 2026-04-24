import { LabRoute } from "@/components/three/lab/lab-route";

export const metadata = {
  title: "FABRIQUE — /lab",
  description:
    "Prototype: liquid-around-letters physics hero. Drag the FABRIQUE glyphs; the water reacts.",
};

export default function Lab() {
  return <LabRoute />;
}
