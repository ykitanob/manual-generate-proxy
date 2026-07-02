(function () {
  var PO = window.__GUIDE_PROXY_ORIGIN__;
  var TU = window.__GUIDE_PROXY_TARGET_URL__;
  if (!PO || !TU) return;

  function proxify(url) {
    if (!url) return url;
    var s = String(url);
    if (/^(data:|blob:|javascript:|#)/i.test(s)) return s;
    try {
      // 絶対 http(s) はそのまま、相対/ルート相対(/ontology/... 等)は
      // ターゲットサイトを基準に解決してプロキシ経由にする。
      var abs = /^https?:\/\//i.test(s) ? s : new URL(s, TU).href;
      if (!/^https?:/i.test(abs)) return s;
      // すでにプロキシ自身のURL(API/static 等)はそのまま
      if (abs.indexOf(PO) === 0) return url;
      return PO + '/proxy?url=' + encodeURIComponent(abs);
    } catch (e) {
      return s;
    }
  }

  if (typeof window.fetch === 'function') {
    var _fetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var url = (input && typeof input === 'object') ? input.url : String(input);
      var p = proxify(url);
      if (p !== url) {
        try {
          input = (input && typeof input === 'object') ? new Request(p, input) : p;
        } catch (e) {
          input = p;
        }
      }
      return _fetch(input, init);
    };
  }

  var _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, url) {
    var args = [].slice.call(arguments);
    args[1] = proxify(String(url || ''));
    return _open.apply(this, args);
  };
}());
