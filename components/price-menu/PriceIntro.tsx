import { Reveal } from "./Reveal";

export function PriceIntro() {
  return (
    <section className="pm-intro" aria-labelledby="intro-heading">
      <Reveal>
        <div className="pm-intro__inner">
          <p className="pm-intro__eyebrow">TREATMENT COLLECTION</p>
          <h2 id="intro-heading" className="pm-intro__brand">
            THE ENJOYE SPA
          </h2>
          <span className="pm-intro__rule" aria-hidden />
          <p className="pm-intro__quote">
            「把時間留給自己，
            <br />
            讓身體慢慢回到舒服的狀態。」
          </p>
        </div>
      </Reveal>
    </section>
  );
}
