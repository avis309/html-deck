// The editor's UI language and the lookups bound to it (the strings live in i18n.mjs).
import { layerName, storedLang, translate } from '../i18n.mjs';

let lang = storedLang();
export const curLang = () => lang;
// Set by applyLanguage (ui/language.mjs), which also re-renders the UI.
export function setLang(l) { lang = l; }
export function getLayerName(tag) { return layerName(lang, tag); }
export function t(key, fallback = '') { return translate(lang, key, fallback); }
