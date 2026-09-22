import { Newsletter } from "./newsletter";

const features = [
  {
    title: "Curated experiences",
    body: "Hand-picked escapes, tastings, and workshops designed to help you slow down and savor the moment.",
    icon: "✳",
  },
  {
    title: "Thoughtful products",
    body: "Everyday objects made with honest materials and a lot of heart — built to be used, loved, and passed on.",
    icon: "◈",
  },
  {
    title: "A warm community",
    body: "Join a circle of people who believe joy is worth planning for. Meet, share, and enjoye together.",
    icon: "❤",
  },
];

const stats = [
  { value: "12k+", label: "Moments shared" },
  { value: "40+", label: "Cities" },
  { value: "4.9★", label: "Member rating" },
];

export default function Home() {
  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <a href="#top" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-accent text-white">E</span>
            Enjoye
          </a>
          <div className="hidden items-center gap-8 text-sm text-muted sm:flex">
            <a className="transition-colors hover:text-foreground" href="#features">Experiences</a>
            <a className="transition-colors hover:text-foreground" href="#stats">Community</a>
            <a className="transition-colors hover:text-foreground" href="#join">Join</a>
          </div>
          <a
            href="#join"
            className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-white shadow-sm transition-transform hover:-translate-y-0.5"
          >
            Get started
          </a>
        </nav>
      </header>

      <main id="top" className="mx-auto w-full max-w-6xl flex-1 px-6">
        <section className="grid items-center gap-12 py-20 sm:py-28 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="animate-float-up">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-xs font-medium uppercase tracking-wider text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              Savor every moment
            </span>
            <h1 className="mt-6 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-6xl">
              Little joys,
              <span className="block bg-gradient-to-r from-accent to-accent-soft bg-clip-text text-transparent">
                beautifully arranged.
              </span>
            </h1>
            <p className="mt-6 max-w-lg text-lg text-muted">
              Enjoye is a modern lifestyle brand crafting curated experiences,
              thoughtful products, and moments worth remembering — for people who
              like to live a little more deliberately.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <a
                href="#join"
                className="rounded-full bg-accent px-7 py-3 text-sm font-medium text-white shadow-lg shadow-accent/20 transition-transform hover:-translate-y-0.5"
              >
                Start enjoying
              </a>
              <a
                href="#features"
                className="rounded-full border border-border bg-card px-7 py-3 text-sm font-medium transition-colors hover:border-accent"
              >
                Explore experiences
              </a>
            </div>
          </div>

          <div className="animate-float-up rounded-3xl border border-border bg-gradient-to-br from-accent/10 via-card to-accent-soft/10 p-2 shadow-xl">
            <div className="rounded-[1.35rem] bg-card p-8">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-muted">This weekend</p>
                <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">3 spots left</span>
              </div>
              <h2 className="mt-4 text-2xl font-semibold">Sunset pottery & pour</h2>
              <p className="mt-2 text-sm text-muted">
                Shape a mug, share a glass, and watch the light go gold. Small
                group, big evening.
              </p>
              <div className="mt-6 grid grid-cols-3 gap-3 text-center">
                {stats.map((s) => (
                  <div key={s.label} className="rounded-xl bg-background p-3">
                    <p className="text-lg font-semibold text-accent">{s.value}</p>
                    <p className="text-[11px] text-muted">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="border-t border-border py-20">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Everything you need to enjoye more
            </h2>
            <p className="mt-4 text-muted">
              We handle the details so you can be fully present. Here is what
              being part of Enjoye feels like.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="group rounded-2xl border border-border bg-card p-7 transition-shadow hover:shadow-lg"
              >
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-accent/10 text-lg text-accent transition-colors group-hover:bg-accent group-hover:text-white">
                  {f.icon}
                </div>
                <h3 className="mt-5 text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="stats" className="border-t border-border py-20">
          <div className="grid gap-8 rounded-3xl bg-gradient-to-br from-accent to-accent-soft p-10 text-white sm:grid-cols-3 sm:p-14">
            {stats.map((s) => (
              <div key={s.label}>
                <p className="text-4xl font-semibold sm:text-5xl">{s.value}</p>
                <p className="mt-1 text-sm text-white/80">{s.label}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="join" className="border-t border-border py-20">
          <div className="mx-auto max-w-xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Join the Enjoye list
            </h2>
            <p className="mt-4 text-muted">
              Be first to hear about new experiences and limited drops. No spam —
              just good things, now and then.
            </p>
            <div className="mt-8">
              <Newsletter />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-muted sm:flex-row">
          <p className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-accent text-xs text-white">E</span>
            © {new Date().getFullYear()} Enjoye. Savor every moment.
          </p>
          <div className="flex gap-6">
            <a className="transition-colors hover:text-foreground" href="#features">Experiences</a>
            <a className="transition-colors hover:text-foreground" href="#join">Join</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
