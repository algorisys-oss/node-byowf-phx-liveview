/**
 * Blaze Reload -- Dev-only automatic page reload.
 *
 * Connects to /live/reload WebSocket. When the server restarts
 * (e.g., tsx --watch), the connection drops. The client polls
 * with HEAD / until the server is back, then reloads the page.
 *
 * Not included in production (dev: false).
 */
(function () {
  "use strict";

  var POLL_INTERVAL = 300;

  function connect() {
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    var ws = new WebSocket(proto + "//" + location.host + "/live/reload");

    ws.onopen = function () {
      console.log("[blaze-reload] connected");
    };

    ws.onclose = function () {
      console.log("[blaze-reload] server disconnected, waiting...");
      pollUntilReady();
    };

    ws.onerror = function () {};
  }

  function pollUntilReady() {
    var timer = setInterval(function () {
      fetch("/", { method: "HEAD" })
        .then(function () {
          clearInterval(timer);
          console.log("[blaze-reload] server is back, reloading...");
          location.reload();
        })
        .catch(function () {});
    }, POLL_INTERVAL);
  }

  connect();
})();
