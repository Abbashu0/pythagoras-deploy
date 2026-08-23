import { getQuestionBankSubjectByView, getSubjectByView, screens } from "./data.js";

export function pushRoute(view) {
  const hash = `#${view}`;
  if (window.location.hash !== hash) window.history.pushState({ view }, "", hash);
}

export function viewFromHash() {
  const view = window.location.hash.replace("#", "");
  return screens[view] || getSubjectByView(view) || getQuestionBankSubjectByView(view) ? view : "home";
}
