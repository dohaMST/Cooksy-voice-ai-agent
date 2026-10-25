import * as React from "react";

/**
 * Landing page scroll state.
 *
 * Three signals in one hook: which section the reader is inside, whether the
 * page has left the top (the header densifies), and whether they are deep
 * enough to want a way back up.
 *
 * The section spy is an IntersectionObserver, because that is what observers are
 * good at. The two thresholds are a single passive scroll listener throttled to
 * one frame — cheaper than three observers plus sentinel elements, and it stays
 * correct through resizes because the threshold is recomputed on every frame it
 * runs on.
 */
export function useLandingScroll(sectionIds: readonly string[]) {
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [scrolled, setScrolled] = React.useState(false);
  const [showTop, setShowTop] = React.useState(false);

  React.useEffect(() => {
    const sections = sectionIds
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);

    if (sections.length === 0) return;

    const headerOffset = 72;
    const visibleShare = 0.55;

    /* Which section is current is decided from live rects on every boundary
       crossing, not from the observer's own targets: at a section seam both
       sections sit inside the strip, and the later one in document order is the
       one the reader has entered. Between sections, and past the last one,
       nothing is current — which is honest. */
    const measure = () => {
      const stripTop = headerOffset;
      const stripBottom = window.innerHeight * (1 - visibleShare);
      let current: string | null = null;

      for (const section of sections) {
        const { top, bottom } = section.getBoundingClientRect();

        if (top <= stripBottom && bottom > stripTop) {
          current = section.id;
        }
      }

      setActiveId(current);
    };

    const observer = new IntersectionObserver(measure, {
      rootMargin: `-${headerOffset}px 0px -${visibleShare * 100}% 0px`,
      threshold: 0,
    });

    for (const section of sections) observer.observe(section);
    measure();

    return () => observer.disconnect();
  }, [sectionIds]);

  React.useEffect(() => {
    let frame = 0;

    const measure = () => {
      frame = 0;
      const y = window.scrollY;
      setScrolled(y > 24);
      setShowTop(y > window.innerHeight * 1.25);
    };

    const onScroll = () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return { activeId, scrolled, showTop };
}
