import { useEffect, useState } from 'react';
import { Nav } from './components/Nav';
import { Intro, SortDivider } from './components/primitives';
import { I18nProvider, useI18n } from './i18n';
import { ScrollTrigger, bindAnchorLinks, initSmoothScroll } from './lib/scroll';
import { Faq, FinalCta, Footer } from './sections/Closing';
import { Hero } from './sections/Hero';
import { HowItWorks } from './sections/HowItWorks';
import { Pricing } from './sections/Pricing';
import { Stats } from './sections/Stats';
import { Courses } from './sections/courses/Courses';
import { Features } from './sections/features/Features';
import { Showcase } from './sections/showcase/Showcase';

/** Copy length changes with language and web fonts, so scroll triggers are re-measured after both. */
function ScrollRefresh() {
  const { lang } = useI18n();
  useEffect(() => {
    const id = window.setTimeout(() => ScrollTrigger.refresh(), 350);
    document.fonts.ready.then(() => ScrollTrigger.refresh());
    return () => clearTimeout(id);
  }, [lang]);
  return null;
}

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stopScroll = initSmoothScroll();
    const unbind = bindAnchorLinks();
    return () => {
      stopScroll();
      unbind();
    };
  }, []);

  return (
    <I18nProvider>
      <ScrollRefresh />
      <Intro onDone={() => setReady(true)} />
      <Nav />
      <main>
        <Hero ready={ready} />
        <SortDivider from="paper" to="ink" caption="sorted(page)" />
        <Showcase />
        <Stats />
        <SortDivider from="ink" to="paper" flip />
        <Features />
        <Courses />
        <HowItWorks />
        <Pricing />
        <Faq />
        <SortDivider from="paper" to="ink" />
        <FinalCta />
      </main>
      <Footer />
    </I18nProvider>
  );
}
