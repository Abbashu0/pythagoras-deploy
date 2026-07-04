import { getBiologyQuestionDetailFromView, getQuestionBankSubjectByView, getSubjectByView, screens } from "./data.js";

export function pushRoute(view) {
  const hash = `#${view}`;
  try {
    if (window.location.hash !== hash) {
      window.history.pushState({ view }, "", hash);
    }
  } catch {
    // sandbox may block
  }
}

export function viewFromHash() {
  const hash = window.location.hash.replace("#", "");
  return screens[hash] || getSubjectByView(hash) || getQuestionBankSubjectByView(hash) || getBiologyQuestionDetailFromView(hash) !== null
    ? hash
    : "tools";
}
