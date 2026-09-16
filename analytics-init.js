/*
 * LaunchFury Analytics — client-only initialization for the shipped web runtime.
 *
 * Hashmark Heroes is a no-build static site (plain HTML/JS served from the repo
 * root, GitHub Pages). The `@launchfury/analytics` browser build is therefore
 * vendored at vendor/launchfury-analytics.js (the package dist; the declared
 * dependency version lives in package.json) and loaded here with a dynamic
 * import — no bundler, no import map, no external origin.
 *
 * The browser WRITE key is a public release value and is NEVER committed. The
 * release supplies it at deploy time as either:
 *   - <meta name="lf-analytics-write-key" content="...">, or
 *   - window.LF_ANALYTICS_WRITE_KEY = "..."  (env var LF_ANALYTICS_WRITE_KEY)
 * together with the canonical ingest host https://launchfury.com. When no key
 * is supplied the integration stays inert: no fabricated key, no network calls.
 *
 * This file is a plain script (not an ES module) so it runs unchanged in the
 * no-build runtime and can be unit-checked under Node (see tools/_analytics_probe.js).
 */
(function () {
  "use strict";

  var LAUNCHFURY_HOST = "https://launchfury.com"; // canonical ingest origin
  var WRITE_KEY_ENV = "LF_ANALYTICS_WRITE_KEY";
  var SDK_URL = "./vendor/launchfury-analytics.js";
  var MAX_PENDING = 100;

  var state = {
    sdk: null,
    ready: false,
    initPromise: null,
    pending: [],
  };

  // Resolve the public browser write key from the deploy-injected meta tag or
  // the runtime global. Never a literal in source.
  function resolveWriteKey() {
    try {
      if (typeof document !== "undefined" && document.querySelector) {
        var meta = document.querySelector('meta[name="lf-analytics-write-key"]');
        var content = meta && meta.getAttribute && meta.getAttribute("content");
        if (content) return String(content).trim();
      }
    } catch (_e) {}
    try {
      if (typeof window !== "undefined" && window.LF_ANALYTICS_WRITE_KEY) {
        return String(window.LF_ANALYTICS_WRITE_KEY).trim();
      }
    } catch (_e2) {}
    return "";
  }

  function surfaceName() {
    try {
      if (typeof document !== "undefined" && document.documentElement &&
          document.documentElement.dataset && document.documentElement.dataset.surface) {
        return document.documentElement.dataset.surface;
      }
    } catch (_e) {}
    return "web";
  }

  // Queue events fired before the async SDK import settles, then replay them.
  function capture(event, props) {
    if (state.ready && state.sdk) {
      try { state.sdk.capture(event, props || {}); } catch (_e) {}
      return;
    }
    if (state.pending.length >= MAX_PENDING) state.pending.shift();
    state.pending.push([event, props || {}]);
  }

  function flushPending() {
    var queued = state.pending;
    state.pending = [];
    for (var i = 0; i < queued.length; i++) {
      try { state.sdk.capture(queued[i][0], queued[i][1]); } catch (_e) {}
    }
  }

  function exposeGlobal() {
    if (typeof window === "undefined") return;
    window.HHAnalytics = {
      capture: function (event, props) { capture(event, props); },
      reset: function () { try { state.sdk.reset(); } catch (_e) {} },
      optIn: function () { try { state.sdk.optIn(); } catch (_e) {} },
      optOut: function () { try { state.sdk.optOut(); } catch (_e) {} },
      hasOptedOut: function () {
        try { return state.sdk ? state.sdk.hasOptedOut() : false; } catch (_e) { return false; }
      },
      ready: true,
    };
  }

  // Initialize exactly once with the canonical host + supplied browser key.
  // `options.sdkUrl` is a configuration seam (used by the Node probe); it
  // defaults to the vendored package build.
  function initLaunchFuryAnalytics(options) {
    options = options || {};
    if (state.ready) return Promise.resolve(state.sdk);
    if (state.initPromise) return state.initPromise;

    var writeKey = options.writeKey || resolveWriteKey();
    if (!writeKey) return Promise.resolve(null);

    state.initPromise = import(options.sdkUrl || SDK_URL).then(function (mod) {
      var sdk = mod.analytics || mod.default || mod;
      var config = {
        writeKey: writeKey,
        host: options.host || LAUNCHFURY_HOST,
        autocapturePageviews: true,
      };
      for (var k in options) {
        if (k !== "writeKey" && k !== "host" && k !== "sdkUrl") config[k] = options[k];
      }
      sdk.init(config);
      state.sdk = sdk;
      state.ready = true;
      exposeGlobal();
      flushPending();
      return sdk;
    }).catch(function (err) {
      // Analytics is best-effort: a failed load/init must never break the game.
      try { console.warn("[analytics] LaunchFury Analytics unavailable:", err); } catch (_e) {}
      state.initPromise = null;
      return null;
    });
    return state.initPromise;
  }

  // Auto-entry point for the shipped surfaces: init, expose the event API,
  // and record the surface load. Resolves to the SDK, or null when inert.
  function bootLaunchFuryAnalytics(options) {
    return initLaunchFuryAnalytics(options).then(function (sdk) {
      if (!sdk) return null;
      sdk.capture("app_loaded", { surface: surfaceName() });
      return sdk;
    });
  }

  // Pre-ready global so classic game scripts can capture immediately; events
  // are queued until the SDK is live.
  if (typeof window !== "undefined") {
    window.HHAnalytics = {
      capture: capture,
      reset: function () { if (state.sdk) try { state.sdk.reset(); } catch (_e) {} },
      optIn: function () { if (state.sdk) try { state.sdk.optIn(); } catch (_e) {} },
      optOut: function () { if (state.sdk) try { state.sdk.optOut(); } catch (_e) {} },
      hasOptedOut: function () {
        try { return state.sdk ? state.sdk.hasOptedOut() : false; } catch (_e) { return false; }
      },
      ready: false,
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      LAUNCHFURY_HOST: LAUNCHFURY_HOST,
      WRITE_KEY_ENV: WRITE_KEY_ENV,
      SDK_URL: SDK_URL,
      resolveWriteKey: resolveWriteKey,
      initLaunchFuryAnalytics: initLaunchFuryAnalytics,
      bootLaunchFuryAnalytics: bootLaunchFuryAnalytics,
      capture: capture,
      _state: state,
    };
  }

  // Auto-boot on the shipped pages. Node test harnesses import this module
  // directly and drive it explicitly, so this branch is skipped there.
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { bootLaunchFuryAnalytics(); }, { once: true });
    } else {
      bootLaunchFuryAnalytics();
    }
  }
})();
