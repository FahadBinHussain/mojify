// Mojify Discord Send Interceptor
// Injected via chrome.scripting.executeScript with world: MAIN
// Patches both fetch AND XHR to intercept message sends

if (!window.__mojifyFetchPatched) {
  window.__mojifyFetchPatched = true;

  function getPending() {
    var el = document.getElementById('mojify-pending-content');
    if (!el || !el.textContent) return '';
    var text = el.textContent;
    el.textContent = '';
    return text;
  }

  function isMessageSend(url, method) {
    return method === 'POST' && /\/api\/v\d+\/channels\/[^/]+\/messages/.test(url);
  }

  function appendToBody(body, pending) {
    if (!body || !pending) return body;
    if (body instanceof FormData) {
      var c = body.get('content') || '';
      body.set('content', c + ' ' + pending);
      console.log('[Mojify] FormData content +=', pending);
      return body;
    } else if (typeof body === 'string') {
      try {
        var p = JSON.parse(body);
        if (p.content !== undefined) {
          p.content = (p.content || '') + ' ' + pending;
          body = JSON.stringify(p);
          console.log('[Mojify] JSON content +=', pending);
        }
      } catch (e) {}
    }
    return body;
  }

  // Patch fetch
  var realFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var method = ((init && init.method) || 'GET').toUpperCase();
      if (isMessageSend(url, method)) {
        var pending = getPending();
        if (pending && init) {
          init.body = appendToBody(init.body, pending);
        }
      }
    } catch (e) {}
    return realFetch.apply(this, arguments);
  };

  // Patch XHR
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__mojifyUrl = url || '';
    this.__mojifyMethod = (method || 'GET').toUpperCase();
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    try {
      if (isMessageSend(this.__mojifyUrl, this.__mojifyMethod)) {
        var pending = getPending();
        if (pending) {
          body = appendToBody(body, pending);
        }
      }
    } catch (e) {}
    return origSend.call(this, body);
  };

  console.log('[Mojify] fetch + XHR patched');
}
