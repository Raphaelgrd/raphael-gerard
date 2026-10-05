if (window.__nfHistory) {
  if (!history.pushState) history.pushState = window.__nfHistory.push;
  if (!history.replaceState) history.replaceState = window.__nfHistory.replace;
}
