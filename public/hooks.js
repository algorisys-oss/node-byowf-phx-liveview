/**
 * Blaze Hooks -- Client-side lifecycle behaviors for LiveView elements.
 *
 * Each hook is an object with optional lifecycle callbacks:
 *   mounted()   — called when the element first appears in the DOM
 *   updated()   — called after a re-render updates the element
 *   destroyed() — called when the element is removed from the DOM
 *
 * Inside callbacks, `this.el` is the DOM element and
 * `this.pushEvent(event, params)` sends events to the server.
 *
 * Register hooks by assigning to window.BlazeHooks before blaze.js loads.
 */
window.BlazeHooks = {

  /**
   * CopyToClipboard -- Copy data-text to the clipboard on click.
   * Sends "clipboard_result" event back to the server with success status.
   */
  CopyToClipboard: {
    mounted: function () {
      var self = this;
      this._handler = function () {
        var text = self.el.getAttribute("data-text") || "";
        if (navigator.clipboard) {
          navigator.clipboard.writeText(text).then(
            function () {
              self.pushEvent("clipboard_result", { success: "true", text: text });
            },
            function () {
              self.pushEvent("clipboard_result", { success: "false" });
            }
          );
        } else {
          self.pushEvent("clipboard_result", { success: "false" });
        }
      };
      this.el.addEventListener("click", this._handler);
    },
    destroyed: function () {
      if (this._handler) {
        this.el.removeEventListener("click", this._handler);
      }
    }
  },

  /**
   * LocalTime -- Display a live-updating local clock.
   * Updates every second client-side. "Send Time" button pushes
   * the current time to the server via pushEvent.
   */
  LocalTime: {
    mounted: function () {
      var self = this;
      var display = this.el.querySelector("[data-role='display']");
      var btn = this.el.querySelector("[data-role='send']");

      function updateTime() {
        if (display) {
          display.textContent = new Date().toLocaleTimeString();
        }
      }

      updateTime();
      this._interval = setInterval(updateTime, 1000);

      if (btn) {
        this._btnHandler = function () {
          self.pushEvent("local_time", { time: new Date().toLocaleTimeString() });
        };
        btn.addEventListener("click", this._btnHandler);
      }
    },
    updated: function () {
      var display = this.el.querySelector("[data-role='display']");
      if (display) {
        display.textContent = new Date().toLocaleTimeString();
      }
    },
    destroyed: function () {
      if (this._interval) clearInterval(this._interval);
      if (this._btnHandler) {
        var btn = this.el.querySelector("[data-role='send']");
        if (btn) btn.removeEventListener("click", this._btnHandler);
      }
    }
  }
};
