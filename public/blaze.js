/**
 * Blaze Client -- Frontend JS glue for LiveView.
 *
 * Connects to the server via WebSocket, receives rendered HTML,
 * and sends user events (clicks, changes, form submissions) back.
 *
 * Features:
 * - Event delegation (single listener on container, not per-element)
 * - Supports bv-click, bv-change, bv-submit, bv-keydown, bv-navigate
 * - Automatic reconnection with exponential backoff
 * - Diffing: receives statics once on mount, then sparse dynamics diffs
 * - Morphdom: focus-preserving DOM patches (falls back to innerHTML)
 * - SPA-like navigation between LiveViews (history.pushState)
 * - JS Hooks: client-side lifecycle callbacks (mounted/updated/destroyed)
 * - Streams: efficient list rendering via insert/delete/upsert DOM operations
 * - File uploads: chunked binary WebSocket uploads with progress
 * - Connection status display
 */
(function () {
  "use strict";

  var container = document.getElementById("blaze-container");
  var statusEl = document.getElementById("blaze-status");
  var path = container && container.getAttribute("data-path");

  if (!container || !path) return;

  // ── Route map ──
  // Parse live routes from data attribute so we know which paths
  // can be navigated client-side vs requiring a full page load.
  var liveRoutes = {};
  try {
    liveRoutes = JSON.parse(container.getAttribute("data-live-routes") || "{}");
  } catch (e) {}

  // ── Connection state ──
  var ws = null;
  var reconnectDelay = 200; // Start at 200ms, max 5s
  var MAX_DELAY = 5000;
  var reconnectTimer = null;
  var navigating = false; // Suppress reconnect during navigation

  // ── Hooks state ──
  // Tracks mounted hook instances by element ID.
  // Each entry: { name: hookName, instance: hookInstance }
  var mountedHooks = {};

  // ── Upload state ──
  var uploadConfigs = {};  // Server-validated configs by name
  var pendingFiles = {};   // Files waiting for upload by name
  var uploading = false;   // Prevent concurrent uploads

  // ── Diffing state ──
  var statics = null;   // string[] — fixed template parts (set on mount)
  var dynamics = null;   // string[] — current dynamic values

  /**
   * Rebuild full HTML from statics and dynamics arrays.
   */
  function buildHtml() {
    if (!statics || !dynamics) return "";
    var html = statics[0] || "";
    for (var i = 0; i < dynamics.length; i++) {
      html += dynamics[i] + (statics[i + 1] || "");
    }
    return html;
  }

  // ── WebSocket connection ──

  function connect() {
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    var url = proto + "//" + location.host + "/live/websocket?path=" + encodeURIComponent(path);

    ws = new WebSocket(url);

    ws.onopen = function () {
      reconnectDelay = 200; // Reset on successful connect
      setStatus("Connected", "connected");
    };

    ws.onmessage = function (e) {
      var msg = JSON.parse(e.data);

      if (msg.type === "mount") {
        statics = msg.statics;
        dynamics = msg.dynamics;
        patch(buildHtml());
        applyStreamOps(msg);
      } else if (msg.type === "diff") {
        if (dynamics && msg.dynamics) {
          var keys = Object.keys(msg.dynamics);
          for (var i = 0; i < keys.length; i++) {
            dynamics[parseInt(keys[i], 10)] = msg.dynamics[keys[i]];
          }
          patch(buildHtml());
        }
        applyStreamOps(msg);
      } else if (msg.type === "render") {
        statics = null;
        dynamics = null;
        patch(msg.html);
        applyStreamOps(msg);
      } else if (msg.type === "upload") {
        // Server validated upload config — store it and start uploading
        handleUploadConfig(msg.config);
      } else if (msg.type === "redirect") {
        // Server-initiated navigation
        navigate(msg.path);
      }
    };

    ws.onclose = function () {
      if (navigating) return; // Don't reconnect during navigation
      setStatus("Disconnected \u2014 reconnecting...", "disconnected");
      scheduleReconnect();
    };

    ws.onerror = function () {
      ws.close();
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      connect();
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_DELAY);
    }, reconnectDelay);
  }

  function setStatus(text, className) {
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.className = "status " + className;
    }
  }

  // ── Navigation ──
  // SPA-like navigation between LiveViews without full page reload.

  function navigate(targetPath) {
    // Non-LiveView routes → full page load
    if (!liveRoutes[targetPath]) {
      window.location.href = targetPath;
      return;
    }

    // Cleanup hooks before leaving
    destroyAllHooks();

    // Close current WebSocket (suppress reconnect)
    navigating = true;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }

    // Reset diffing state
    statics = null;
    dynamics = null;
    reconnectDelay = 200;

    // Update path and URL
    path = targetPath;
    container.dataset.path = targetPath;
    container.innerHTML = "Connecting...";
    history.pushState({ path: targetPath }, "", targetPath);

    // Connect to new LiveView
    navigating = false;
    connect();
  }

  // ── DOM patching ──

  function patch(html) {
    if (typeof morphdom === "function") {
      var wrapper = document.createElement("div");
      wrapper.id = container.id;
      if (container.dataset.path) {
        wrapper.dataset.path = container.dataset.path;
      }
      if (container.dataset.liveRoutes) {
        wrapper.dataset.liveRoutes = container.dataset.liveRoutes;
      }
      wrapper.innerHTML = html;

      morphdom(container, wrapper, {
        onBeforeElUpdated: function (fromEl, toEl) {
          if (fromEl.type === "file") return false;
          // Skip stream containers — their children are managed by applyStreamOps
          if (fromEl.hasAttribute && fromEl.hasAttribute("bv-stream")) return false;
          if (fromEl === document.activeElement) {
            if (fromEl.tagName === "INPUT" || fromEl.tagName === "TEXTAREA"
                || fromEl.tagName === "SELECT") {
              toEl.value = fromEl.value;
              if (fromEl.selectionStart !== undefined) {
                toEl.selectionStart = fromEl.selectionStart;
                toEl.selectionEnd = fromEl.selectionEnd;
              }
            }
          }
          return true;
        },
      });
    } else {
      container.innerHTML = html;
    }
    processHooks();
  }

  // ── JS Hooks ──
  // Hooks are client-side lifecycle callbacks attached to elements via bv-hook.
  // Each hook object can have mounted(), updated(), destroyed() callbacks.
  // this.el = the DOM element, this.pushEvent(event, params) sends to server.

  function createHookInstance(hookDef, el) {
    var instance = Object.create(hookDef);
    instance.el = el;
    instance.pushEvent = function (event, params) {
      sendEvent(event, params);
    };
    return instance;
  }

  function processHooks() {
    var hooks = window.BlazeHooks || {};
    var seenIds = {};

    // Scan for all [bv-hook] elements
    container.querySelectorAll("[bv-hook]").forEach(function (el) {
      var hookName = el.getAttribute("bv-hook");
      var elId = el.id;
      if (!elId || !hookName) return;

      seenIds[elId] = true;
      var hookDef = hooks[hookName];
      if (!hookDef) return;

      var existing = mountedHooks[elId];
      if (existing) {
        // Update: element already mounted, refresh el reference and call updated()
        existing.instance.el = el;
        if (typeof existing.instance.updated === "function") {
          existing.instance.updated();
        }
      } else {
        // Mount: create new instance and call mounted()
        var instance = createHookInstance(hookDef, el);
        mountedHooks[elId] = { name: hookName, instance: instance };
        if (typeof instance.mounted === "function") {
          instance.mounted();
        }
      }
    });

    // Destroy: cleanup hooks whose elements were removed from DOM
    for (var id in mountedHooks) {
      if (!seenIds[id]) {
        var entry = mountedHooks[id];
        if (entry && typeof entry.instance.destroyed === "function") {
          entry.instance.destroyed();
        }
        delete mountedHooks[id];
      }
    }
  }

  function destroyAllHooks() {
    for (var id in mountedHooks) {
      var entry = mountedHooks[id];
      if (entry && typeof entry.instance.destroyed === "function") {
        entry.instance.destroyed();
      }
    }
    mountedHooks = {};
  }

  // ── Stream operations ──
  // Apply stream insert/delete/reset operations from a server message.
  // Stream containers are marked with bv-stream="name" in the DOM.

  function applyStreamOps(msg) {
    if (!msg.streams) return;

    for (var streamName in msg.streams) {
      var ops = msg.streams[streamName];
      var streamContainer = document.querySelector('[bv-stream="' + streamName + '"]');
      if (!streamContainer) continue;

      // Reset: remove all children
      if (ops.reset) {
        while (streamContainer.firstChild) {
          streamContainer.removeChild(streamContainer.firstChild);
        }
      }

      // Deletes: remove elements by DOM ID
      if (ops.deletes) {
        for (var i = 0; i < ops.deletes.length; i++) {
          var el = document.getElementById(ops.deletes[i]);
          if (el) el.parentNode.removeChild(el);
        }
      }

      // Inserts: add new elements (or update existing via morphdom)
      if (ops.inserts) {
        for (var j = 0; j < ops.inserts.length; j++) {
          var entry = ops.inserts[j];
          var temp = document.createElement("div");
          temp.innerHTML = entry.html.trim();
          var newEl = temp.firstChild;

          var existing = document.getElementById(entry.id);
          if (existing) {
            // Upsert: morphdom patch in place
            if (typeof morphdom === "function") {
              morphdom(existing, newEl, {
                onBeforeElUpdated: function (fromEl) {
                  if (fromEl.type === "file") return false;
                  return true;
                },
              });
            } else {
              existing.parentNode.replaceChild(newEl, existing);
            }
          } else if (entry.at === 0) {
            streamContainer.insertBefore(newEl, streamContainer.firstChild);
          } else {
            streamContainer.appendChild(newEl);
          }
        }
      }
    }

    processHooks();
  }

  // ── File uploads ──
  // Chunked binary WebSocket uploads with progress tracking.
  // Flow: user selects files → client sends __upload_validate__ → server validates →
  // server sends "upload" config → client sends binary chunks → client sends __upload_complete__

  /**
   * Handle file input change for bv-upload inputs.
   * Stores pending files and sends validation request to server.
   */
  function validateUpload(uploadName, fileInput) {
    var files = Array.from(fileInput.files || []);
    if (files.length === 0) return;

    pendingFiles[uploadName] = files;

    // Send file metadata to server for validation
    var entries = files.map(function (file, i) {
      return {
        ref: uploadName + "-" + i + "-" + Date.now(),
        name: file.name,
        type: file.type,
        size: file.size,
      };
    });

    sendEvent("__upload_validate__", { name: uploadName, entries: entries });
  }

  /**
   * Handle server-validated upload config.
   * Stores config and starts uploading if autoUpload is enabled.
   */
  function handleUploadConfig(config) {
    uploadConfigs[config.name] = config;

    if (config.autoUpload) {
      startUpload(config.name);
    }
  }

  /**
   * Start uploading files for a named upload.
   * Called automatically (autoUpload) or manually via triggerUpload().
   */
  function startUpload(uploadName) {
    var config = uploadConfigs[uploadName];
    var files = pendingFiles[uploadName];
    if (!config || !files || uploading) return;

    // Only upload valid entries
    var validEntries = config.entries.filter(function (e) { return e.valid; });
    if (validEntries.length === 0) return;

    uploading = true;

    // Upload files sequentially
    var idx = 0;
    function uploadNext() {
      if (idx >= validEntries.length) {
        uploading = false;
        delete pendingFiles[uploadName];
        return;
      }

      var entry = validEntries[idx];
      var file = files[idx];
      idx++;

      if (!file) {
        uploadNext();
        return;
      }

      sendFileChunks(entry.ref, file, config.chunkSize, function () {
        // Signal upload complete for this file
        sendEvent("__upload_complete__", { ref: entry.ref });
        uploadNext();
      });
    }

    uploadNext();
  }

  /**
   * Send a file as binary WebSocket frames in chunks.
   * Frame format: [2-byte ref_len][ref_string][chunk_data]
   */
  function sendFileChunks(ref, file, chunkSize, onDone) {
    var offset = 0;
    var refBytes = new TextEncoder().encode(ref);

    function sendNextChunk() {
      if (offset >= file.size) {
        if (onDone) onDone();
        return;
      }

      var end = Math.min(offset + chunkSize, file.size);
      var slice = file.slice(offset, end);
      offset = end;

      var reader = new FileReader();
      reader.onload = function () {
        var chunkData = new Uint8Array(reader.result);
        // Build binary frame: [2-byte ref_len][ref][chunk]
        var frame = new Uint8Array(2 + refBytes.length + chunkData.length);
        frame[0] = (refBytes.length >> 8) & 0xff;
        frame[1] = refBytes.length & 0xff;
        frame.set(refBytes, 2);
        frame.set(chunkData, 2 + refBytes.length);

        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(frame.buffer);
        }

        // Small delay between chunks to avoid overwhelming the server
        setTimeout(sendNextChunk, 10);
      };
      reader.readAsArrayBuffer(slice);
    }

    sendNextChunk();
  }

  /**
   * Trigger upload manually (for non-autoUpload configs).
   * Called from form submit or explicit upload button.
   */
  function triggerUpload(uploadName) {
    startUpload(uploadName);
  }

  // ── Send event to server ──

  function sendEvent(event, params) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "event", event: event, params: params || {} }));
    }
  }

  // ── Component event namespacing ──
  // Walk up the DOM from el looking for a bv-component wrapper.
  // If found, prefix the event name with "componentId:".

  function resolveEvent(eventName, el) {
    var node = el;
    while (node && node !== container) {
      var componentId = node.getAttribute("bv-component");
      if (componentId) return componentId + ":" + eventName;
      node = node.parentElement;
    }
    return eventName;
  }

  // ── Event delegation ──
  // One listener on the container handles all bv-* events.
  // This works even after innerHTML/morphdom replacement (no re-binding needed).

  // bv-click: <button bv-click="increment">+</button>
  container.addEventListener("click", function (e) {
    // bv-navigate: SPA-like navigation between LiveViews
    var navTarget = e.target.closest("[bv-navigate]");
    if (navTarget) {
      e.preventDefault();
      var targetPath = navTarget.getAttribute("bv-navigate");
      navigate(targetPath);
      return;
    }

    // bv-click: send event to server
    var target = e.target.closest("[bv-click]");
    if (target) {
      var event = resolveEvent(target.getAttribute("bv-click"), target);
      var value = target.getAttribute("bv-value");
      var params = value ? { value: value } : {};
      sendEvent(event, params);
    }
  });

  // bv-change: <input bv-change="update_name">
  container.addEventListener("change", function (e) {
    // bv-upload: file input for uploads
    var uploadTarget = e.target.closest("[bv-upload]");
    if (uploadTarget && uploadTarget.type === "file") {
      var uploadName = uploadTarget.getAttribute("bv-upload");
      validateUpload(uploadName, uploadTarget);
      return;
    }

    var target = e.target.closest("[bv-change]");
    if (target) {
      var event = resolveEvent(target.getAttribute("bv-change"), target);
      var value = target.value;
      var name = target.getAttribute("name") || "value";
      var params = {};
      params[name] = value;
      sendEvent(event, params);
    }
  });

  // bv-submit: <form bv-submit="save">
  container.addEventListener("submit", function (e) {
    var form = e.target.closest("[bv-submit]");
    if (form) {
      e.preventDefault();
      var event = resolveEvent(form.getAttribute("bv-submit"), form);
      var formData = new FormData(form);
      var params = {};
      formData.forEach(function (value, key) {
        // Skip file inputs — handled by bv-upload
        if (value instanceof File) return;
        params[key] = value;
      });

      // Trigger pending uploads before sending the form event
      var uploadInputs = form.querySelectorAll("[bv-upload]");
      for (var i = 0; i < uploadInputs.length; i++) {
        var uploadName = uploadInputs[i].getAttribute("bv-upload");
        if (uploadName && pendingFiles[uploadName]) {
          triggerUpload(uploadName);
        }
      }

      sendEvent(event, params);
    }
  });

  // bv-keydown: <input bv-keydown="search">
  container.addEventListener("keydown", function (e) {
    var target = e.target.closest("[bv-keydown]");
    if (target) {
      var event = resolveEvent(target.getAttribute("bv-keydown"), target);
      var name = target.getAttribute("name") || "value";
      var params = { key: e.key };
      params[name] = target.value;
      sendEvent(event, params);
    }
  });

  // ── Browser history ──
  // Support back/forward buttons for SPA navigation.

  history.replaceState({ path: path }, "", path);

  window.addEventListener("popstate", function (e) {
    if (e.state && e.state.path) {
      // Reconnect to the stored path without pushing new history
      navigating = true;
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
      statics = null;
      dynamics = null;
      reconnectDelay = 200;
      path = e.state.path;
      container.dataset.path = path;
      container.innerHTML = "Connecting...";
      navigating = false;
      connect();
    } else {
      window.location.reload();
    }
  });

  // ── Initialize ──
  connect();
})();
