(function (global) {
  const STORAGE_KEY = 'wiz_bot_service_url';
  const DEFAULT_URL = 'http://127.0.0.1:8001';

  function resolveServiceUrl() {
    if (global.__BOT_SERVICE_URL__) return global.__BOT_SERVICE_URL__;
    if (global.BOT_SERVICE_URL) return global.BOT_SERVICE_URL;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return stored;
    } catch (_) { /* ignore */ }
    return DEFAULT_URL;
  }

  function setBotServiceUrl(url) {
    try {
      localStorage.setItem(STORAGE_KEY, url);
    } catch (_) { /* ignore */ }
    global.__BOT_SERVICE_URL__ = url;
  }

  global.BotConfig = {
    get serviceUrl() {
      return resolveServiceUrl();
    },
    setBotServiceUrl,
    resolveServiceUrl
  };
})(typeof window !== 'undefined' ? window : global);
