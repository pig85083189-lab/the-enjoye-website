import Image from "next/image";
import { Reveal } from "./Reveal";

type EditorialBreakProps = {
  image: string;
  eyebrow?: string;
  quote: string;
};

export function EditorialBreak({
  image,
  eyebrow = "Your beauty journey",
  quote,
}: EditorialBreakProps) {
  return (
    <Reveal>
      <section className="pm-break" aria-hidden={false}>
        <div className="pm-break__media">
          <Image
            src={image}
            alt=""
            fill
            sizes="100vw"
            className="pm-break__image"
          />
          <div className="pm-break__veil" />
          <div className="pm-break__copy">
            <p className="pm-eyebrow pm-eyebrow--light">{eyebrow}</p>
            <p className="pm-break__quote">{quote}</p>
          </div>
        </div>
      </section>
    </Reveal>
  );
}
