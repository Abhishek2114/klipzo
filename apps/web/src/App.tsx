import { type LoadResult, loadProject } from '@klipzo/schema';
import { type ChangeEvent, useEffect, useState } from 'react';
import { type Lang, t } from './i18n';

type Theme = 'system' | 'light' | 'dark';

// shortcut: preferences use localStorage; move into the IndexedDB settings store when autosave lands (Deliverable 3)
const saved = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const save = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode or blocked storage: the preference just isn't remembered
  }
};

export function App() {
  const [lang, setLang] = useState<Lang>(saved('lang') === 'hi' ? 'hi' : 'en');
  const [theme, setTheme] = useState<Theme>((saved('theme') as Theme | null) ?? 'system');
  const [result, setResult] = useState<LoadResult | null>(null);

  useEffect(() => {
    document.documentElement.lang = lang;
    save('lang', lang);
  }, [lang]);
  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    save('theme', theme);
  }, [theme]);

  async function open(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch {
      setResult({ ok: false, errors: [t(lang, 'notJson')] });
      return;
    }
    setResult(loadProject(json));
  }

  return (
    <>
      <header>
        <h1>Klipzo</h1>
        <p className="muted">{t(lang, 'tagline')}</p>
        <div className="spacer" />
        <label>
          {t(lang, 'language')}{' '}
          <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            <option value="en">English</option>
            <option value="hi">हिन्दी</option>
          </select>
        </label>
        <label>
          {t(lang, 'theme')}{' '}
          <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
            <option value="system">{t(lang, 'system')}</option>
            <option value="light">{t(lang, 'light')}</option>
            <option value="dark">{t(lang, 'dark')}</option>
          </select>
        </label>
      </header>
      <main>
        <label className="button">
          {t(lang, 'open')}
          <input type="file" accept=".klipzo,.json,application/json" onChange={open} className="visually-hidden" />
        </label>
        <section aria-live="polite">
          {!result && <p className="muted">{t(lang, 'empty')}</p>}
          {result?.ok && (
            <div className="card">
              <h2>{t(lang, 'loaded')}</h2>
              <p className="project-name">{result.project.name}</p>
              <dl>
                <dt>{t(lang, 'sequences')}</dt>
                <dd>{result.project.sequences.length}</dd>
                <dt>{t(lang, 'assets')}</dt>
                <dd>{Object.keys(result.project.assets).length}</dd>
                <dt>{t(lang, 'captions')}</dt>
                <dd>{result.project.captionTracks.length}</dd>
              </dl>
            </div>
          )}
          {result && !result.ok && (
            <div className="card error" role="alert">
              <h2>{t(lang, 'invalid')}</h2>
              <ul>
                {result.errors.slice(0, 10).map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
