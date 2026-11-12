import { useEffect, useState } from 'react';
import { Nav } from './components/Nav';
import { Intro, SortDivider } from './components/primitives';
import { I18nProvider } from './i18n';
import { bindAnchorLinks, initSmoothScroll } from './lib/scroll';
import { Hero } from './sections/Hero';

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
      <Intro onDone={() => setReady(true)} />
      <Nav />
      <main>
        <Hero ready={ready} />
        <SortDivider from="paper" to="ink" caption="sorted(page)" />
        <section className="section" data-theme="ink" data-section id="showcase" style={{ minHeight: '120vh' }} />
      </main>
    </I18nProvider>
  );
}
