/**
 * event-tracker.js — lightweight analytics event tracker for the student app.
 *
 * Features:
 *   - Tracks events: app_open, banner_impression, banner_click, etc.
 *   - Batches events and sends them every 30s (or on page unload)
 *   - Generates anonymous userId (stored in localStorage)
 *   - Generates per-session sessionId
 *   - No dependencies — vanilla JS, works in ES modules
 *
 * Usage:
 *   import { trackEvent } from "./event-tracker.js?v=20260715b";
 *   trackEvent("app_open");
 *   trackEvent("banner_click", { entityId: "banner-123" });
 */

const BATCH_INTERVAL_MS = 30000; // 30 seconds
const MAX_BATCH_SIZE = 50;
const API_URL = "/api/events";

// Generate or retrieve anonymous user ID
function getUserId() {
  try {
    let id = localStorage.getItem("pythagoras-user-id");
    if (!id) {
      id = "u-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
      localStorage.setItem("pythagoras-user-id", id);
    }
    return id;
  } catch {
    return null;
  }
}

// Generate per-session ID
function getSessionId() {
  try {
    let id = sessionStorage.getItem("pythagoras-session-id");
    if (!id) {
      id = "s-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem("pythagoras-session-id", id);
    }
    return id;
  } catch {
    return null;
  }
}

const USER_ID = getUserId();
const SESSION_ID = getSessionId();
const PLATFORM = "web";
const VERSION = "2.0";

// Event queue
let eventQueue = [];
let flushTimer = null;

/**
 * Track an analytics event.
 * @param {string} type — Event type (e.g. "app_open", "banner_click")
 * @param {object} data — Optional metadata (entityId, metadata, etc.)
 */
export function trackEvent(type, data) {
  const event = {
    type: type,
    userId: USER_ID,
    sessionId: SESSION_ID,
    entityId: data?.entityId || null,
    platform: PLATFORM,
    version: VERSION,
    device: navigator.userAgent.slice(0, 500),
    metadata: data?.metadata ? JSON.stringify(data.metadata) : null,
  };

  eventQueue.push(event);

  // Flush immediately if batch is full
  if (eventQueue.length >= MAX_BATCH_SIZE) {
    flushEvents();
  }
}

/**
 * Send all queued events to the server.
 */
async function flushEvents() {
  if (eventQueue.length === 0) return;

  const batch = eventQueue.slice();
  eventQueue = [];

  try {
    // Use sendBeacon if available (works on page unload)
    if (navigator.sendBeacon) {
      const blob = new Blob(
        [JSON.stringify({ events: batch })],
        { type: "application/json" }
      );
      const success = navigator.sendBeacon(API_URL, blob);
      if (success) return;
    }

    // Fallback to fetch
    await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: batch }),
      keepalive: true,
    });
  } catch (e) {
    // Re-queue events on failure (limit to 100 to prevent memory leak)
    eventQueue = batch.concat(eventQueue).slice(0, 100);
    console.warn("[event-tracker] flush failed:", e);
  }
}

/**
 * Start the auto-flush timer.
 */
function startAutoFlush() {
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = setInterval(flushEvents, BATCH_INTERVAL_MS);
}

/**
 * Stop the auto-flush timer and flush remaining events.
 */
function stopAutoFlush() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  flushEvents();
}

// Start auto-flush on load
startAutoFlush();

// Flush on page unload
window.addEventListener("beforeunload", stopAutoFlush);
window.addEventListener("pagehide", stopAutoFlush);

// Track app_open automatically
trackEvent("app_open");
