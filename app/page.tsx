export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center">
      <section className="flex flex-col items-center gap-6">
        <p className="font-mono text-xs tracking-[0.3em] text-white/40 uppercase">
          hero placeholder
        </p>
        <h1 className="text-5xl font-semibold tracking-tight">fabrique</h1>
        <p className="max-w-md text-center text-sm leading-6 text-white/60">
          Physics hero (Matter.js + GSAP) drops in here: ball falls, letters
          assemble on the third bounce, ball becomes the orb that powers the
          rest of the site.
        </p>
      </section>
    </main>
  );
}
