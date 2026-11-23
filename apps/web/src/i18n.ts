export type Lang = 'en' | 'hi';

const strings = {
  tagline: { en: 'Hindi-first video editor', hi: 'हिन्दी-प्रथम वीडियो एडिटर' },
  open: { en: 'Open project', hi: 'प्रोजेक्ट खोलें' },
  empty: { en: 'Open a .klipzo project file to check it loads.', hi: 'जाँचने के लिए .klipzo प्रोजेक्ट फ़ाइल खोलें।' },
  loaded: { en: 'Project loaded', hi: 'प्रोजेक्ट खुल गया' },
  invalid: { en: "This file can't be opened", hi: 'यह फ़ाइल नहीं खुल सकती' },
  notJson: { en: 'The file is not valid JSON.', hi: 'फ़ाइल सही JSON नहीं है।' },
  sequences: { en: 'Sequences', hi: 'सीक्वेंस' },
  assets: { en: 'Media files', hi: 'मीडिया फ़ाइलें' },
  captions: { en: 'Subtitle tracks', hi: 'सबटाइटल ट्रैक' },
  theme: { en: 'Theme', hi: 'थीम' },
  light: { en: 'Light', hi: 'लाइट' },
  dark: { en: 'Dark', hi: 'डार्क' },
  system: { en: 'System', hi: 'सिस्टम' },
  language: { en: 'Language', hi: 'भाषा' },
} satisfies Record<string, Record<Lang, string>>;

export type Key = keyof typeof strings;
export const t = (lang: Lang, key: Key): string => strings[key][lang];
