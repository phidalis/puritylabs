/* ===== PDB — PURITY LABS DATABASE BRIDGE =====
   Thin wrapper around the Firebase (compat) SDK so the static storefront and
   the admin console talk to Firestore + Auth through one shared API.

   Load order on every page:
     1. firebase-app-compat.js
     2. firebase-firestore-compat.js
     3. firebase-auth-compat.js
     4. pdb.js
     5. script.js / account.js / admin.js
*/

/* Email API is served from the Render web service. This base is used by
   script.js / account.js so welcome & order emails are sent even when the
   storefront is opened from any host (custom domain, local files, etc.). */
window.EMAIL_API_BASE = 'https://puritylabs.onrender.com';

var FIREBASE_CONFIG = {
  apiKey: "AIzaSyBlxmZYat0cX0DtFCBP_6IE--uOyiE1ksU",
  authDomain: "peptides-21f83.firebaseapp.com",
  projectId: "peptides-21f83",
  storageBucket: "peptides-21f83.firebasestorage.app",
  messagingSenderId: "714995589397",
  appId: "1:714995589397:web:2b5cd2c67e5528b195c91c",
  measurementId: "G-3SRM85C4J3"
};

window.PDB = (function () {
  'use strict';

  var ready = false;
  var app = null;
  var db = null;
  var auth = null;

  /* ---------------- local cache (IndexedDB) ----------------
     Products and other rarely-changing collections are cached locally so the
     grid renders instantly on repeat visits instead of waiting on the network
     round-trip. The network still runs in the background and refreshes/overwrites
     the cache, so data stays live without the blank-grid wait.
  */
  var CACHE_DB = 'pl_cache';
  var CACHE_VERSION = 1;
  var STORE = 'kv';
  var MAX_AGE = 24 * 60 * 60 * 1000; // 24h freshness for reads; writes always overwrite

  var _idb = null;
  function idb() {
    if (_idb) return Promise.resolve(_idb);
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    return new Promise(function (resolve) {
      var req = indexedDB.open(CACHE_DB, CACHE_VERSION);
      req.onupgradeneeded = function (e) {
        var d = e.target.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      };
      req.onsuccess = function (e) { _idb = e.target.result; resolve(_idb); };
      req.onerror = function () { resolve(null); };
    });
  }

  function cacheSet(key, data) {
    idb().then(function (d) {
      if (!d) return;
      try {
        var tx = d.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ key: key, data: data, ts: Date.now() });
      } catch (e) { /* ignore */ }
    });
  }

  function cacheGet(key, maxAge) {
    return idb().then(function (d) {
      if (!d) return null;
      return new Promise(function (resolve) {
        var tx = d.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).get(key);
        req.onsuccess = function () {
          var row = req.result;
          if (!row) return resolve(null);
          if (maxAge && (Date.now() - row.ts) > maxAge) return resolve(null);
          resolve(row.data);
        };
        req.onerror = function () { resolve(null); };
      });
    });
  }

  function cacheClear() {
    return idb().then(function (d) {
      if (!d) return;
      try {
        var tx = d.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
      } catch (e) { /* ignore */ }
    });
  }

  function init() {
    if (typeof firebase === 'undefined') return;
    try {
      if (firebase.apps && firebase.apps.length) {
        app = firebase.apps[0];
      } else {
        app = firebase.initializeApp(FIREBASE_CONFIG);
      }
      db = app.firestore();
      auth = app.auth();
      // Default Firebase web persistence is already browser-local; we assert it
      // explicitly so a signed-up account stays logged in on this device.
      if (auth && auth.setPersistence && !auth.currentUser) {
        Promise.resolve(auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)).catch(function () {});
      }
      ready = true;
    } catch (e) {
      // Firebase misconfigured — every async call rejects with a clear message.
    }
  }
  init();

  function noDb() { return Promise.reject(new Error('Firebase is not available right now. Check your connection and reload.')); }

  function pick(data, id) { if (!data) return null; var d = data; d.id = id; return d; }

  /* ---------------- reads ---------------- */
  function getDoc(col, id) {
    if (!ready) return noDb();
    return db.collection(col).doc(id).get().then(function (s) { return pick(s.data ? s.data() : null, s.id); });
  }

  function getCol(col) {
    if (!ready) return noDb();
    return db.collection(col).get().then(function (snap) {
      return snap.docs.map(function (d) { return pick(d.data(), d.id); });
    });
  }

  function getQuery(query) {
    if (!ready) return noDb();
    if (!query) return Promise.resolve([]);
    return query.get().then(function (snap) {
      return snap.docs.map(function (d) { return pick(d.data(), d.id); });
    });
  }

  /* Get a collection, using the local cache if present. First `then` resolves
     with the cached copy (may be null on first visit / expired); the Promise
     resolves to the full result array once the *network* fetch completes and
     the cache has been refreshed. Consumers that render immediately from the
     cache then re-render on the network result get instant repeat loads. */
  function cacheKeyFor(col) { return 'col:' + col; }
  function cacheKeyForQuery(q) {
    try {
      return 'q:' + q.path + ':' + (q._query ? JSON.stringify(q._query) : '') + ':' + JSON.stringify(q._queryOptions || '');
    } catch (e) { return 'q:' + String(q); }
  }

  function getColCached(col, cb, maxAge) {
    if (!ready) return noDb();
    var key = cacheKeyFor(col);
    var age = (maxAge === undefined ? MAX_AGE : maxAge);
    var live = false;
    var pending = db.collection(col).get().then(function (snap) {
      var data = snap.docs.map(function (d) { return pick(d.data(), d.id); });
      live = true;
      cacheSet(key, data);
      if (cb) cb(data);
      return data;
    });
    cacheGet(key, age).then(function (cached) {
      // Only paint the cached copy if a live (network) result hasn't already
      // arrived — never let stale data overwrite a fresher response.
      if (cached && !live && cb) cb(cached);
    });
    return pending;
  }

  function getQueryCached(query, cb, maxAge) {
    if (!ready) return noDb();
    if (!query) return Promise.resolve([]);
    var key = cacheKeyForQuery(query);
    var age = (maxAge === undefined ? MAX_AGE : maxAge);
    var live = false;
    var pending = query.get().then(function (snap) {
      var data = snap.docs.map(function (d) { return pick(d.data(), d.id); });
      live = true;
      cacheSet(key, data);
      if (cb) cb(data);
      return data;
    });
    cacheGet(key, age).then(function (cached) {
      if (cached && !live && cb) cb(cached);
    });
    return pending;
  }

  /* ---------------- writes ---------------- */
  function setDoc(col, id, data, opts) {
    if (!ready) return noDb();
    return db.collection(col).doc(id).set(data, opts || { merge: true });
  }

  function addDoc(col, data) {
    if (!ready) return noDb();
    return db.collection(col).add(data).then(function (r) { return r.id; });
  }

  function updDoc(col, id, obj) {
    if (!ready) return noDb();
    return db.collection(col).doc(id).update(obj);
  }

  function delDoc(col, id) {
    if (!ready) return noDb();
    return db.collection(col).doc(id).delete();
  }

  function batch() {
    return ready ? db.batch() : null;
  }

  /* ---------------- realtime ---------------- */
  function watchQuery(query, cb) {
    if (!ready || !query) { return function () {}; }
    return query.onSnapshot(function (snap) {
      cb(snap.docs.map(function (d) { return pick(d.data(), d.id); }));
    }, function () {});
  }

  function q(col) { return ready ? db.collection(col) : null; }

  function watchCol(col, cb) {
    if (!ready) return function () {};
    return db.collection(col).onSnapshot(function (snap) {
      cb(snap.docs.map(function (d) { return pick(d.data(), d.id); }));
    }, function () {});
  }

  function watchDoc(col, id, cb) {
    if (!ready) return function () {};
    return db.collection(col).doc(id).onSnapshot(function (s) {
      cb(s.exists ? pick(s.data(), s.id) : null);
    }, function () {});
  }

  /* ---------------- auth ---------------- */
  function plainUser(u) {
    if (!u) return null;
    var name = u.displayName || (u.email || '').split('@')[0] || 'Researcher';
    if (name) name = name.charAt(0).toUpperCase() + name.slice(1);
    return { uid: u.uid, email: u.email, name: name };
  }

  function onAuth(cb) {
    if (!ready) { cb(null); return function () {}; }
    return auth.onAuthStateChanged(function (u) { cb(plainUser(u)); }, function () { cb(null); });
  }

  function signIn(email, pass) {
    if (!ready) return noDb();
    return auth.signInWithEmailAndPassword(email, pass).then(function (r) { return plainUser(r.user); });
  }

  function signUp(email, pass) {
    if (!ready) return noDb();
    return auth.createUserWithEmailAndPassword(email, pass).then(function (r) { return plainUser(r.user); });
  }

  function resetPassword(email) {
    if (!ready) return noDb();
    return auth.sendPasswordResetEmail(email);
  }

  function signOut() {
    if (!ready) return Promise.resolve();
    return auth.signOut();
  }

  function currentUser() {
    if (!ready || !auth) return null;
    return plainUser(auth.currentUser);
  }

  /* ---------------- field values ---------------- */
  function ts() { return ready ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString(); }
  function inc(v) { return ready ? firebase.firestore.FieldValue.increment(v || 1) : (v || 1); }
  function del() { return ready ? firebase.firestore.FieldValue.delete() : null; }

  /* ---------------- error codes ---------------- */
  function authMsg(err) {
    var c = err && err.code;
    var m = {
      'auth/email-already-in-use': 'That email is already registered. Try signing in.',
      'auth/invalid-email': 'Please enter a valid email address.',
      'auth/user-not-found': 'No account found with that email.',
      'auth/wrong-password': 'Incorrect password. Please try again.',
      'auth/weak-password': 'Password must be at least 6 characters.',
      'auth/too-many-requests': 'Too many attempts. Please retry in a moment.',
      'auth/invalid-login-credentials': 'Incorrect email or password.'
    };
    return m[c] || (err && err.message) || 'Something went wrong. Please try again.';
  }

  return {
    ready: ready,
    app: app,
    db: db,
    auth: auth,
    getDoc: getDoc,
    getCol: getCol,
    getQuery: getQuery,
    getColCached: getColCached,
    getQueryCached: getQueryCached,
    cacheClear: cacheClear,
    q: q,
    setDoc: setDoc,
    addDoc: addDoc,
    updDoc: updDoc,
    delDoc: delDoc,
    batch: batch,
    watchCol: watchCol,
    watchDoc: watchDoc,
    watchQuery: watchQuery,
    onAuth: onAuth,
    signIn: signIn,
    signUp: signUp,
    resetPassword: resetPassword,
    signOut: signOut,
    currentUser: currentUser,
    ts: ts,
    inc: inc,
    del: del,
    authMsg: authMsg
  };
})();