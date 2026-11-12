import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en, type Dict } from './en';
import { ru } from './ru';
import { az } from './az';

const DICTS = { az, ru, en } satisfies Record<string, Dict>;
export type Lang = keyof typeof DICTS;
export const LANGS: Lang[] = ['az', 'ru', 'en'];
const STORAGE_KEY = 'algosolver:lang';

type Ctx = { lang: Lang; t: Dict; setLang: (l: Lang) => void };
const I18nContext = createContext<Ctx>({ lang: 'en', t: en, setLang: () => {} });

function initialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored in DICTS) return stored as Lang;
  } catch {
    /* storage unavailable */
  }
  const nav = navigator.language.slice(0, 2).toLowerCase();
  return nav in DICTS ? (nav as Lang) : 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = DICTS[lang].meta.title;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable */
    }
    // Dip the page out, swap the copy, bring it back.
    const root = document.documentElement;
    root.classList.add('lang-out');
    window.setTimeout(() => {
      setLangState(next);
      requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('lang-out')));
    }, 200);
  }, []);

  const value = useMemo(() => ({ lang, t: DICTS[lang], setLang }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);

export const fmt = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));

/** Thousands grouping: comma for English, thin space for AZ / RU. */
export function formatInt(n: number, lang: Lang) {
  const s = Math.round(n).toString();
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'en' ? ',' : '\u202f');
}

export const formatPrice = (n: number, lang: Lang) => {
  const s = n.toFixed(2);
  return lang === 'en' ? s : s.replace('.', ',');
};
