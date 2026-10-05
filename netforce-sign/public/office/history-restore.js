// Chargé après Office.js.
if (window.__nfHistory) {
  if (!history.pushState) history.pushState = window.__nfHistory.push;
  if (!history.replaceState) history.replaceState = window.__nfHistory.replace;
}
// Certaines versions d'Outlook n'achèvent l'initialisation que si Office.initialize est défini.
if (window.Office && !window.Office.initialize) window.Office.initialize = function () {};
