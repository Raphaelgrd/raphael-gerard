// Chargé avant Office.js.
// 1. Office.js efface history.pushState/replaceState : on les sauvegarde (restaurés dans history-restore.js).
window.__nfHistory = { push: history.pushState, replace: history.replaceState };
// 2. Journal de diagnostic affiché dans le volet si Outlook ne répond pas.
window.__nfDiag = [];
(function () {
  var log = function (m) {
    if (/logo\.png/.test(m)) return; // logo facultatif
    if (window.__nfDiag.length < 20) window.__nfDiag.push(String(m).slice(0, 300));
  };
  window.addEventListener('securitypolicyviolation', function (e) {
    log('CSP ' + e.violatedDirective + ' ' + e.blockedURI);
  });
  window.addEventListener('error', function (e) {
    log('Erreur ' + (e.message || (e.target && (e.target.src || e.target.href)) || 'inconnue'));
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    log('Promesse ' + (e.reason && e.reason.message ? e.reason.message : e.reason));
  });
})();
