/**
 * ImageDB (vanilla JS version) — IndexedDB image storage with synchronous read cache.
 *
 * Mirror of the TypeScript version in src/lib/admin/image-db.ts.
 * Same DB_NAME / STORE_NAME / DB_VERSION so admin and student app share
 * the same IndexedDB database.
 *
 * Exposed as `window.ImageDB` for simple global access from the
 * vanilla-JS student app.
 *
 * Error handling: all methods catch and log to console; they never throw.
 * The student app ignores failures and falls back to gradients.
 */

(function () {
  var DB_NAME = "pythagoras-images";
  var STORE_NAME = "images";
  var DB_VERSION = 2;

  var cache = new Map();
  var preloaded = false;
  var dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (typeof indexedDB === "undefined") {
        console.error("[ImageDB] IndexedDB unavailable");
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      try {
        var req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
          if (!db.objectStoreNames.contains("meta")) {
            db.createObjectStore("meta");
          }
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () {
          console.error("[ImageDB] open failed:", req.error);
          reject(req.error || new Error("IndexedDB open failed"));
        };
        req.onblocked = function () {
          console.warn("[ImageDB] open blocked by another tab");
          reject(new Error("IndexedDB open blocked"));
        };
      } catch (e) {
        console.error("[ImageDB] open threw:", e);
        reject(e);
      }
    });
    return dbPromise;
  }

  function reqToPromise(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function txToPromise(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error("aborted")); };
    });
  }

  function dataUrlBytes(dataUrl) {
    try {
      var base64 = (dataUrl.split(",")[1]) || "";
      var paddingMatch = base64.match(/=+$/);
      var padding = paddingMatch ? paddingMatch[0].length : 0;
      return Math.floor((base64.length * 3) / 4) - padding;
    } catch (e) {
      return dataUrl.length;
    }
  }

  async function preloadAllImages() {
    if (preloaded) return;
    preloaded = true;
    try {
      var db = await openDB();
      var tx = db.transaction(STORE_NAME, "readonly");
      var store = tx.objectStore(STORE_NAME);

      var results = await Promise.all([
        reqToPromise(store.getAllKeys()),
        reqToPromise(store.getAll())
      ]);
      var keys = results[0];
      var values = results[1];

      for (var i = 0; i < keys.length; i++) {
        var key = String(keys[i]);
        var val = values[i];
        if (typeof val === "string" && val.length > 0) {
          cache.set(key, val);
        } else {
          console.warn("[ImageDB] Skipping corrupt entry during preload:", key);
        }
      }
    } catch (e) {
      console.error("[ImageDB] preloadAllImages failed:", e);
    }
  }

  function getImageSync(key) {
    return cache.get(key) || "";
  }

  async function getImage(key) {
    var cached = cache.get(key);
    if (cached) return cached;
    try {
      var db = await openDB();
      var tx = db.transaction(STORE_NAME, "readonly");
      var req = tx.objectStore(STORE_NAME).get(key);
      var result = await reqToPromise(req);
      if (typeof result === "string") {
        cache.set(key, result);
        return result;
      }
      return "";
    } catch (e) {
      console.error("[ImageDB] getImage failed:", key, e);
      return "";
    }
  }

  function hasImage(key) {
    return cache.has(key) && !!cache.get(key);
  }

  async function setImage(key, dataUrl) {
    if (!key || !dataUrl) {
      console.warn("[ImageDB] setImage called with empty key/dataUrl");
      return;
    }
    var previousValue = cache.get(key);
    cache.set(key, dataUrl);

    try {
      var db = await openDB();
      var tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(dataUrl, key);

      var metaTx = db.transaction("meta", "readwrite");
      metaTx.objectStore("meta").put(new Date().toISOString(), "lastWrite:" + key);

      await Promise.all([
        txToPromise(tx),
        txToPromise(metaTx)
      ]);
    } catch (e) {
      var isQuota =
        e && e.name &&
        (e.name === "QuotaExceededError" ||
          e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
          e.code === 22 || e.code === 1014);

      if (isQuota) {
        if (previousValue !== undefined) {
          cache.set(key, previousValue);
        } else {
          cache.delete(key);
        }
        console.error("[ImageDB] QUOTA EXCEEDED while saving:", key);
      } else {
        console.error("[ImageDB] setImage failed:", key, e);
      }
    }
  }

  async function deleteImage(key) {
    cache.delete(key);
    try {
      var db = await openDB();
      var tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(key);

      var metaTx = db.transaction("meta", "readwrite");
      metaTx.objectStore("meta").delete("lastWrite:" + key);

      await Promise.all([
        txToPromise(tx),
        txToPromise(metaTx)
      ]);
    } catch (e) {
      console.error("[ImageDB] deleteImage failed:", key, e);
    }
  }

  async function getStats() {
    if (!preloaded) await preloadAllImages();
    var count = 0;
    var totalBytes = 0;
    var largestKey = null;
    var largestBytes = 0;

    cache.forEach(function (dataUrl, key) {
      if (!dataUrl) return;
      count++;
      var bytes = dataUrlBytes(dataUrl);
      totalBytes += bytes;
      if (bytes > largestBytes) {
        largestBytes = bytes;
        largestKey = key;
      }
    });

    var lastAddedKey = null;
    var lastAddedAt = null;
    try {
      var db = await openDB();
      if (db.objectStoreNames.contains("meta")) {
        var tx = db.transaction("meta", "readonly");
        var store = tx.objectStore("meta");
        var results = await Promise.all([
          reqToPromise(store.getAllKeys()),
          reqToPromise(store.getAll())
        ]);
        var keys = results[0];
        var values = results[1];
        var bestTime = 0;
        for (var i = 0; i < keys.length; i++) {
          var k = String(keys[i]);
          if (k.indexOf("lastWrite:") !== 0) continue;
          var v = values[i];
          if (typeof v !== "string") continue;
          var t = Date.parse(v);
          if (Number.isFinite(t) && t > bestTime) {
            bestTime = t;
            lastAddedAt = v;
            lastAddedKey = k.slice("lastWrite:".length);
          }
        }
      }
    } catch (e) {
      /* noop */
    }

    return {
      count: count,
      totalBytes: totalBytes,
      largestKey: largestKey,
      largestBytes: largestBytes,
      lastAddedKey: lastAddedKey,
      lastAddedAt: lastAddedAt
    };
  }

  function getAllKeys() {
    var out = [];
    cache.forEach(function (val, key) {
      if (val) out.push(key);
    });
    return out;
  }

  async function cleanupOrphans(referencedKeys) {
    if (!preloaded) await preloadAllImages();
    var deleted = 0;
    var keys = Array.from(cache.keys());
    for (var i = 0; i < keys.length; i++) {
      if (!referencedKeys.has(keys[i])) {
        await deleteImage(keys[i]);
        deleted++;
      }
    }
    return deleted;
  }

  async function clearAllImages() {
    if (!preloaded) await preloadAllImages();
    var allKeys = Array.from(cache.keys());
    for (var i = 0; i < allKeys.length; i++) {
      await deleteImage(allKeys[i]);
    }
    return allKeys.length;
  }

  async function exportAllImages() {
    if (!preloaded) await preloadAllImages();
    var images = [];
    var totalBytes = 0;
    cache.forEach(function (dataUrl, key) {
      if (!dataUrl) return;
      var bytes = dataUrlBytes(dataUrl);
      totalBytes += bytes;
      images.push({ key: key, dataUrl: dataUrl, bytes: bytes });
    });
    images.sort(function (a, b) { return a.key.localeCompare(b.key); });
    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      count: images.length,
      totalBytes: totalBytes,
      images: images
    };
  }

  async function importAllImages(bundle) {
    if (!bundle || typeof bundle !== "object" || !Array.isArray(bundle.images)) {
      console.error("[ImageDB] Invalid import bundle");
      return { imported: 0, failed: 0 };
    }
    var imported = 0;
    var failed = 0;
    var CHUNK = 5;
    for (var i = 0; i < bundle.images.length; i += CHUNK) {
      var chunk = bundle.images.slice(i, i + CHUNK);
      await Promise.all(chunk.map(function (entry) {
        if (!entry || typeof entry.key !== "string" || typeof entry.dataUrl !== "string") {
          console.warn("[ImageDB] Skipping malformed import entry:", entry && entry.key);
          failed++;
          return Promise.resolve();
        }
        return setImage(entry.key, entry.dataUrl).then(function () {
          imported++;
        }).catch(function () {
          failed++;
        });
      }));
    }
    return { imported: imported, failed: failed };
  }

  window.ImageDB = {
    preloadAllImages: preloadAllImages,
    getImageSync: getImageSync,
    getImage: getImage,
    hasImage: hasImage,
    setImage: setImage,
    deleteImage: deleteImage,
    getStats: getStats,
    getAllKeys: getAllKeys,
    cleanupOrphans: cleanupOrphans,
    clearAllImages: clearAllImages,
    exportAllImages: exportAllImages,
    importAllImages: importAllImages
  };
})();
