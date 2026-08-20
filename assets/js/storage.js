/**
 * Livello di persistenza.
 *
 * Oggi tutto vive in localStorage, ma l'app parla solo con l'interfaccia
 * `Store`: per passare domani a un backend (o a un file su GitHub, o a un
 * Gist privato) basta scrivere un nuovo adapter con gli stessi 4 metodi e
 * registrarlo in `createStore()`. Nessun'altra parte del codice cambia.
 *
 *   interface StorageAdapter {
 *     get(key)          -> Promise<any|null>
 *     set(key, value)   -> Promise<void>
 *     remove(key)       -> Promise<void>
 *     keys()            -> Promise<string[]>
 *   }
 */

import { APP } from './config.js';

export const localStorageAdapter = {
  name: 'local',
  async get(key) {
    try {
      const raw = localStorage.getItem(APP.storagePrefix + key);
      return raw === null ? null : JSON.parse(raw);
    } catch {
      return null;
    }
  },
  async set(key, value) {
    try {
      localStorage.setItem(APP.storagePrefix + key, JSON.stringify(value));
    } catch (err) {
      // Quota piena: buttiamo via la cache dei feed, è l'unica cosa rigenerabile.
      if (err && /quota/i.test(err.name || err.message || '')) {
        localStorage.removeItem(APP.storagePrefix + 'feedCache');
        try { localStorage.setItem(APP.storagePrefix + key, JSON.stringify(value)); } catch {}
      }
    }
  },
  async remove(key) {
    localStorage.removeItem(APP.storagePrefix + key);
  },
  async keys() {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith(APP.storagePrefix))
      .map((k) => k.slice(APP.storagePrefix.length));
  }
};

/**
 * Segnaposto per la sincronizzazione remota (v2).
 * Idee già compatibili con GitHub Pages, cioè senza server proprio:
 *  - un Gist privato + Personal Access Token inserito dall'utente;
 *  - un endpoint serverless (Cloudflare Worker / Vercel) con un token;
 *  - un file JSON nel repo aggiornato via GitHub API.
 * L'adapter deve solo rispettare la stessa interfaccia.
 */
export function createRemoteAdapter({ endpoint, token, fetchImpl = fetch } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return {
    name: 'remote',
    async get(key) {
      const res = await fetchImpl(`${endpoint}/${encodeURIComponent(key)}`, { headers });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GET ${key}: ${res.status}`);
      return res.json();
    },
    async set(key, value) {
      const res = await fetchImpl(`${endpoint}/${encodeURIComponent(key)}`, {
        method: 'PUT', headers, body: JSON.stringify(value)
      });
      if (!res.ok) throw new Error(`PUT ${key}: ${res.status}`);
    },
    async remove(key) {
      await fetchImpl(`${endpoint}/${encodeURIComponent(key)}`, { method: 'DELETE', headers });
    },
    async keys() {
      const res = await fetchImpl(endpoint, { headers });
      return res.ok ? res.json() : [];
    }
  };
}

/**
 * Store con cache in memoria e scrittura "debounced": l'interfaccia resta
 * sincrona per chi legge, asincrona per chi scrive.
 */
export function createStore(adapter = localStorageAdapter) {
  const cache = new Map();
  const pending = new Map();

  return {
    adapter,

    async load(key, fallback) {
      const value = await adapter.get(key);
      const resolved = value === null || value === undefined ? fallback : value;
      cache.set(key, resolved);
      return resolved;
    },

    get(key, fallback = null) {
      return cache.has(key) ? cache.get(key) : fallback;
    },

    /** Scrive subito in cache, su disco al massimo ogni 150 ms per chiave. */
    save(key, value) {
      cache.set(key, value);
      clearTimeout(pending.get(key));
      pending.set(key, setTimeout(() => {
        pending.delete(key);
        adapter.set(key, value);
      }, 150));
      return value;
    },

    async flush() {
      for (const [key, timer] of pending) {
        clearTimeout(timer);
        pending.delete(key);
        await adapter.set(key, cache.get(key));
      }
    },

    async clearAll() {
      for (const key of await adapter.keys()) await adapter.remove(key);
      cache.clear();
    },

    /** Esporta l'intero profilo utente: è il "salvataggio su file" di oggi. */
    async exportAll() {
      const out = {};
      for (const key of await adapter.keys()) out[key] = await adapter.get(key);
      return { app: APP.name, version: APP.version, exportedAt: new Date().toISOString(), data: out };
    },

    async importAll(payload) {
      const data = payload && payload.data ? payload.data : payload;
      if (!data || typeof data !== 'object') throw new Error('File non valido');
      for (const [key, value] of Object.entries(data)) {
        if (key === 'feedCache') continue; // la cache si rigenera da sola
        cache.set(key, value);
        await adapter.set(key, value);
      }
    }
  };
}
