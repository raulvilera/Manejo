/**
 * Debug Collector (agent-friendly)
 *
 * Captures:
 * 1) Console logs
 * 2) Network requests (fetch + XHR)
 * 3) User interactions (semantic uiEvents: click/type/submit/nav/scroll/etc.)
 *
 * Data is periodically sent to /__debug__/logs
 * Note: uiEvents are mirrored to sessionEvents for sessionReplay.log
 */
(function () {
  "use strict";

  // Prevent double initialization
  if (window.__DEBUG_COLLECTOR__) return;

  // ==========================================================================
  // Configuration
  // ==========================================================================
  const CONFIG = {
    reportEndpoint: "/__debug__/logs",
    bufferSize: {
      console: 500,
      network: 200,
      // semantic, agent-friendly UI events
      ui: 500,
    },
    reportInterval: 2000,
    sensitiveFields: [
      "password",
      "token",
      "secret",
      "key",
      "authorization",
      "cookie",
      "session",
    ],
    maxBodyLength: 10240,
    // UI event logging privacy policy:
    // - inputs matching sensitiveFields or type=password are masked by default
    // - non-sensitive inputs log up to 200 chars
    uiInputMaxLen: 200,
    uiTextMaxLen: 80,
    // Scroll throttling: minimum ms between scroll events
    scrollThrottleMs: 500,
  };

  // ==========================================================================
  // Storage
  // ==========================================================================
  const store = {
    consoleLogs: [],
    networkRequests: [],
    uiEvents: [],
    lastReportTime: Date.now(),
    lastScrollTime: 0,
  };

  // ==========================================================================
  // Utility Functions
  // ==========================================================================

  function sanitizeValue(value, depth) {
    if (depth === void 0) depth = 0;
    if (depth > 5) return "[Max Depth]";
    if (value === null) return null;
    if (value === undefined) return undefined;

    if (typeof value === "string") {
      return value.length > 1000 ? value.slice(0, 1000) + "...[truncated]" : value;
    }

    if (typeof value !== "object") return value;

    if (Array.isArray(value)) {
      return value.slice(0, 100).map(function (v) {
        return sanitizeValue(v, depth + 1);
      });
    }

    var sanitized = {};
    for (var k in value) {
      if (Object.prototype.hasOwnProperty.call(value, k)) {
        var isSensitive = CONFIG.sensitiveFields.some(function (f) {
          return k.toLowerCase().indexOf(f) !== -1;
        });
        if (isSensitive) {
          sanitized[k] = "[REDACTED]";
        } else {
          sanitized[k] = sanitizeValue(value[k], depth + 1);
        }
      }
    }
    return sanitized;
  }

  function formatArg(arg) {
    try {
      if (arg instanceof Error) {
        return { type: "Error", message: arg.message, stack: arg.stack };
      }
      if (typeof arg === "object") return sanitizeValue(arg);
      return String(arg);
    } catch (e) {
      return "[Unserializable]";
    }
  }

  function formatArgs(args) {
    var result = [];
    for (var i = 0; i < args.length; i++) result.push(formatArg(args[i]));
    return result;
  }

  function pruneBuffer(buffer, maxSize) {
    if (buffer.length > maxSize) buffer.splice(0, buffer.length - maxSize);
  }

  function tryParseJson(str) {
    if (typeof str !== "string") return str;
    try {
      return JSON.parse(str);
    } catch (e) {
      return str;
    }
  }

  // ==========================================================================
  // Semantic UI Event Logging (agent-friendly)
  // ==========================================================================

  function shouldIgnoreTarget(target) {
    try {
      if (!target || !(target instanceof Element)) return false;
      return !!target.closest(".debug-no-record");
    } catch (e) {
      return false;
    }
  }

  function compactText(s, maxLen) {
    try {
      var t = (s || "").trim().replace(/\s+/g, " ");
      if (!t) return "";
      return t.length > maxLen ? t.slice(0, maxLen) + "…" : t;
    } catch (e) {
      return "";
    }
  }

  function elText(el) {
    try {
      var t = el.innerText || el.textContent || "";
      return compactText(t, CONFIG.uiTextMaxLen);
    } catch (e) {
      return "";
    }
  }

  function describeElement(el) {
    if (!el || !(el instanceof Element)) return null;

    var getAttr = function (name) {
      return el.getAttribute(name);
    };

    var tag = el.tagName ? el.tagName.toLowerCase() : null;
    var id = el.id || null;
    var name = getAttr("name") || null;
    var role = getAttr("role") || null;
    var ariaLabel = getAttr("aria-label") || null;

    var dataLoc = getAttr("data-loc") || null;
    var testId =
      getAttr("data-testid") ||
      getAttr("data-test-id") ||
      getAttr("data-test") ||
      null;

    var type = tag === "input" ? (getAttr("type") || "text") : null;
    var href = tag === "a" ? getAttr("href") || null : null;

    // a small, stable hint for agents (avoid building full CSS paths)
    var selectorHint = null;
    if (testId) selectorHint = '[data-testid="' + testId + '"]';
    else if (dataLoc) selectorHint = '[data-loc="' + dataLoc + '"]';
    else if (id) selectorHint = "#" + id;
    else selectorHint = tag || "unknown";

    return {
      tag: tag,
      id: id,
      name: name,
      type: type,
      role: role,
      ariaLabel: ariaLabel,
      testId: testId,
      dataLoc: dataLoc,
      href: href,
      text: elText(el),
      selectorHint: selectorHint,
    };
  }

  function isSensitiveField(el) {
    if (!el || !(el instanceof Element)) return false;
    var tag = el.tagName ? el.tagName.toLowerCase() : "";
    if (tag !== "input" && tag !== "textarea") return false;

    var type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "password") return true;

    var name = (el.getAttribute("name") || "").toLowerCase();
    var id = (el.id || "").toLowerCase();

    return CONFIG.sensitiveFields.some(function (f) {
      return name.indexOf(f) !== -1 || id.indexOf(f) !== -1;
    });
  }

  function getInputValueSafe(el) {
    if (!el || !(el instanceof Element)) return null;
    var tag = el.tagName ? el.tagName.toLowerCase() : "";
    if (tag !== "input" && tag !== "textarea" && tag !== "select") return null;

    var v = "";
    try {
      v = el.value != null ? String(el.value) : "";
    } catch (e) {
      v = "";
    }

    if (isSensitiveField(el)) return { masked: true, length: v.length };

    if (v.length > CONFIG.uiInputMaxLen) v = v.slice(0, CONFIG.uiInputMaxLen) + "…";
    return v;
  }

  function logUiEvent(kind, payload) {
    var entry = {
      timestamp: Date.now(),
      kind: kind,
      url: location.href,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      payload: sanitizeValue(payload),
    };
    store.uiEvents.push(entry);
    pruneBuffer(store.uiEvents, CONFIG.bufferSize.ui);
  }

  function installUiEventListeners() {
    // Clicks
    document.addEventListener(
      "click",
      function (e) {
        var t = e.target;
        if (shouldIgnoreTarget(t)) return;
        logUiEvent("click", {
          target: describeElement(t),
          x: e.clientX,
          y: e.clientY,
        });
      },
      true
    );

    // Form submissions
    document.addEventListener(
      "submit",
      function (e) {
        var t = e.target;
        if (shouldIgnoreTarget(t)) return;
        logUiEvent("submit", { target: describeElement(t) });
      },
      true
    );

    // Input/textarea changes
    document.addEventListener(
      "input",
      function (e) {
        var t = e.target;
        if (shouldIgnoreTarget(t)) return;
        logUiEvent("input", {
          target: describeElement(t),
          value: getInputValueSafe(t),
        });
      },
      true
    );

    // Change events (for selects, checkboxes, radios)
    document.addEventListener(
      "change",
      function (e) {
        var t = e.target;
        if (shouldIgnoreTarget(t)) return;
        logUiEvent("change", {
          target: describeElement(t),
          value: getInputValueSafe(t),
        });
      },
      true
    );

    // Navigation
    if (window.history && window.history.pushState) {
      var originalPushState = window.history.pushState;
      window.history.pushState = function () {
        var result = originalPushState.apply(window.history, arguments);
        logUiEvent("navigation", {
          url: location.href,
        });
        return result;
      };
    }

    // Scroll events (throttled)
    document.addEventListener(
      "scroll",
      function () {
        var now = Date.now();
        if (now - store.lastScrollTime > CONFIG.scrollThrottleMs) {
          store.lastScrollTime = now;
          logUiEvent("scroll", {
            scrollX: window.scrollX,
            scrollY: window.scrollY,
            viewportHeight: window.innerHeight,
          });
        }
      },
      true
    );
  }

  // ==========================================================================
  // Console Interception
  // ==========================================================================

  var originalFetch = window.fetch;
  var originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
    info: console.info,
  };

  ["log", "warn", "error", "debug", "info"].forEach(function (level) {
    console[level] = function () {
      var args = Array.from(arguments);
      originalConsole[level].apply(console, args);

      var entry = {
        timestamp: Date.now(),
        level: level,
        message: formatArgs(args),
      };

      store.consoleLogs.push(entry);
      pruneBuffer(store.consoleLogs, CONFIG.bufferSize.console);
    };
  });

  // ==========================================================================
  // Fetch Interception
  // ==========================================================================

  window.fetch = function () {
    var url = arguments[0];
    var options = arguments[1] || {};
    var method = (options.method || "GET").toUpperCase();
    var startTime = Date.now();

    var entry = {
      timestamp: startTime,
      type: "fetch",
      method: method,
      url: url,
      request: { body: null },
      response: null,
      duration: 0,
      error: null,
    };

    // Try to capture request body
    if (options.body) {
      entry.request.body = sanitizeValue(tryParseJson(options.body));
    }

    return originalFetch
      .apply(this, arguments)
      .then(function (response) {
        entry.duration = Date.now() - startTime;
        entry.response = {
          status: response.status,
          statusText: response.statusText,
          body: null,
        };

        if (entry.response && entry.response.status >= 400) {
          logUiEvent("network_error", {
            kind: "fetch",
            method: entry.method,
            url: entry.url,
            status: entry.response.status,
            statusText: entry.response.statusText,
          });
        }

        // Clone response to read body
        var clonedResponse = response.clone();
        var contentType = (clonedResponse.headers.get("content-type") || "").toLowerCase();

        // Skip body capture for streaming responses
        var isStreaming = contentType.indexOf("text/event-stream") !== -1 ||
                          contentType.indexOf("application/stream") !== -1 ||
                          contentType.indexOf("application/x-ndjson") !== -1;

        // Skip body capture for binary content types
        var isBinary = contentType.indexOf("image/") !== -1 ||
                       contentType.indexOf("video/") !== -1 ||
                       contentType.indexOf("audio/") !== -1 ||
                       contentType.indexOf("application/octet-stream") !== -1 ||
                       contentType.indexOf("application/pdf") !== -1 ||
                       contentType.indexOf("application/zip") !== -1;

        if (isStreaming) {
          entry.response.body = "[Streaming response - not captured]";
          store.networkRequests.push(entry);
          pruneBuffer(store.networkRequests, CONFIG.bufferSize.network);
        } else if (isBinary) {
          entry.response.body = "[Binary content: " + contentType + "]";
          store.networkRequests.push(entry);
          pruneBuffer(store.networkRequests, CONFIG.bufferSize.network);
        } else {
          clonedResponse
            .text()
            .then(function (text) {
              if (text.length > CONFIG.maxBodyLength) {
                entry.response.body = text.slice(0, CONFIG.maxBodyLength) + "...[truncated]";
              } else {
                entry.response.body = sanitizeValue(tryParseJson(text));
              }
            })
            .catch(function () {
              entry.response.body = "[Unable to read body]";
            })
            .finally(function () {
              store.networkRequests.push(entry);
              pruneBuffer(store.networkRequests, CONFIG.bufferSize.network);
            });
        }

        // Return response immediately, don't wait for body reading
        return response;
      })
      .catch(function (error) {
        entry.duration = Date.now() - startTime;
        entry.error = { message: error.message, stack: error.stack };

        store.networkRequests.push(entry);
        pruneBuffer(store.networkRequests, CONFIG.bufferSize.network);

        logUiEvent("network_error", {
          kind: "fetch",
          method: entry.method,
          url: entry.url,
          message: error.message,
        });

        throw error;
      });
  };

  // ==========================================================================
  // XHR Interception
  // ==========================================================================

  var originalXHROpen = XMLHttpRequest.prototype.open;
  var originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._debugData = {
      method: (method || "GET").toUpperCase(),
      url: url,
      startTime: null,
    };
    return originalXHROpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    var xhr = this;

    if (
      xhr._debugData &&
      xhr._debugData.url &&
      xhr._debugData.url.indexOf("/__debug__/") !== 0
    ) {
      xhr._debugData.startTime = Date.now();
      xhr._debugData.requestBody = body ? sanitizeValue(tryParseJson(body)) : null;

      xhr.addEventListener("load", function () {
        var contentType = (xhr.getResponseHeader("content-type") || "").toLowerCase();
        var responseBody = null;

        // Skip body capture for streaming responses
        var isStreaming = contentType.indexOf("text/event-stream") !== -1 ||
                          contentType.indexOf("application/stream") !== -1 ||
                          contentType.indexOf("application/x-ndjson") !== -1;

        // Skip body capture for binary content types
        var isBinary = contentType.indexOf("image/") !== -1 ||
                       contentType.indexOf("video/") !== -1 ||
                       contentType.indexOf("audio/") !== -1 ||
                       contentType.indexOf("application/octet-stream") !== -1 ||
                       contentType.indexOf("application/pdf") !== -1 ||
                       contentType.indexOf("application/zip") !== -1;

        if (isStreaming) {
          responseBody = "[Streaming response - not captured]";
        } else if (isBinary) {
          responseBody = "[Binary content: " + contentType + "]";
        } else {
          // Safe to read responseText for text responses
          try {
            var text = xhr.responseText || "";
            if (text.length > CONFIG.maxBodyLength) {
              responseBody = text.slice(0, CONFIG.maxBodyLength) + "...[truncated]";
            } else {
              responseBody = sanitizeValue(tryParseJson(text));
            }
          } catch (e) {
            // responseText may throw for non-text responses
            responseBody = "[Unable to read response: " + e.message + "]";
          }
        }

        var entry = {
          timestamp: xhr._debugData.startTime,
          type: "xhr",
          method: xhr._debugData.method,
          url: xhr._debugData.url,
          request: { body: xhr._debugData.requestBody },
          response: {
            status: xhr.status,
            statusText: xhr.statusText,
            body: responseBody,
          },
          duration: Date.now() - xhr._debugData.startTime,
          error: null,
        };

        store.networkRequests.push(entry);
        pruneBuffer(store.networkRequests, CONFIG.bufferSize.network);

        if (entry.response && entry.response.status >= 400) {
          logUiEvent("network_error", {
            kind: "xhr",
            method: entry.method,
            url: entry.url,
            status: entry.response.status,
            statusText: entry.response.statusText,
          });
        }
      });

      xhr.addEventListener("error", function () {
        var entry = {
          timestamp: xhr._debugData.startTime,
          type: "xhr",
          method: xhr._debugData.method,
          url: xhr._debugData.url,
          request: { body: xhr._debugData.requestBody },
          response: null,
          duration: Date.now() - xhr._debugData.startTime,
          error: { message: "Network error" },
        };

        store.networkRequests.push(entry);
        pruneBuffer(store.networkRequests, CONFIG.bufferSize.network);

        logUiEvent("network_error", {
          kind: "xhr",
          method: entry.method,
          url: entry.url,
          message: "Network error",
        });
      });
    }

    return originalXHRSend.apply(this, arguments);
  };

  // ==========================================================================
  // Data Reporting
  // ==========================================================================

  function reportLogs() {
    var consoleLogs = store.consoleLogs.splice(0);
    var networkRequests = store.networkRequests.splice(0);
    var uiEvents = store.uiEvents.splice(0);

    // Skip if no new data
    if (
      consoleLogs.length === 0 &&
      networkRequests.length === 0 &&
      uiEvents.length === 0
    ) {
      return Promise.resolve();
    }

    var payload = {
      timestamp: Date.now(),
      consoleLogs: consoleLogs,
      networkRequests: networkRequests,
      // Mirror uiEvents to sessionEvents for sessionReplay.log
      sessionEvents: uiEvents,
      // agent-friendly semantic events
      uiEvents: uiEvents,
    };

    return originalFetch(CONFIG.reportEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(function () {
      // Put data back on failure (but respect limits)
      store.consoleLogs = consoleLogs.concat(store.consoleLogs);
      store.networkRequests = networkRequests.concat(store.networkRequests);
      store.uiEvents = uiEvents.concat(store.uiEvents);

      pruneBuffer(store.consoleLogs, CONFIG.bufferSize.console);
      pruneBuffer(store.networkRequests, CONFIG.bufferSize.network);
      pruneBuffer(store.uiEvents, CONFIG.bufferSize.ui);
    });
  }

  // Periodic reporting
  setInterval(reportLogs, CONFIG.reportInterval);

  // Report on page unload
  window.addEventListener("beforeunload", function () {
    var consoleLogs = store.consoleLogs;
    var networkRequests = store.networkRequests;
    var uiEvents = store.uiEvents;

    if (
      consoleLogs.length === 0 &&
      networkRequests.length === 0 &&
      uiEvents.length === 0
    ) {
      return;
    }

    var payload = {
      timestamp: Date.now(),
      consoleLogs: consoleLogs,
      networkRequests: networkRequests,
      // Mirror uiEvents to sessionEvents for sessionReplay.log
      sessionEvents: uiEvents,
      uiEvents: uiEvents,
    };

    if (navigator.sendBeacon) {
      var payloadStr = JSON.stringify(payload);
      // sendBeacon has ~64KB limit, truncate if too large
      var MAX_BEACON_SIZE = 60000; // Leave some margin
      if (payloadStr.length > MAX_BEACON_SIZE) {
        // Prioritize: keep recent events, drop older logs
        var truncatedPayload = {
          timestamp: Date.now(),
          consoleLogs: consoleLogs.slice(-50),
          networkRequests: networkRequests.slice(-20),
          sessionEvents: uiEvents.slice(-100),
          uiEvents: uiEvents.slice(-100),
          _truncated: true,
        };
        payloadStr = JSON.stringify(truncatedPayload);
      }
      navigator.sendBeacon(CONFIG.reportEndpoint, payloadStr);
    }
  });

  // ==========================================================================
  // Initialization
  // ==========================================================================

  // Install semantic UI listeners ASAP
  try {
    installUiEventListeners();
  } catch (e) {
    console.warn("[Debug] Failed to install UI listeners:", e);
  }

  // Mark as initialized
  window.__DEBUG_COLLECTOR__ = {
    version: "2.0-core",
    store: store,
    forceReport: reportLogs,
  };

  console.debug("[Debug] Debug collector initialized (UI events only)");
})();
