"use client";

type AlertListener = (payloadText: string) => void;

const listeners = new Set<AlertListener>();
let source: EventSource | null = null;
let reconnectTimer: number | null = null;
let closeTimer: number | null = null;

function clearTimer(timer: number | null) {
  if (timer !== null) {
    window.clearTimeout(timer);
  }
}

function scheduleReconnect() {
  if (reconnectTimer !== null || listeners.size === 0) {
    return;
  }
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    ensureConnected();
  }, 3000);
}

function cleanupSource() {
  if (source) {
    source.close();
    source = null;
  }
}

function ensureConnected() {
  if (typeof window === "undefined" || !("EventSource" in window) || source || listeners.size === 0) {
    return;
  }
  clearTimer(closeTimer);
  closeTimer = null;
  source = new EventSource("/api/alert-notifications/stream");
  source.addEventListener("alert", (event) => {
    for (const listener of listeners) {
      listener(event.data);
    }
  });
  source.onerror = () => {
    cleanupSource();
    scheduleReconnect();
  };
}

function scheduleCloseWhenIdle() {
  if (listeners.size > 0) {
    return;
  }
  clearTimer(closeTimer);
  closeTimer = window.setTimeout(() => {
    closeTimer = null;
    if (listeners.size === 0) {
      cleanupSource();
    }
  }, 1000);
}

export function subscribeToAlertNotificationStream(listener: AlertListener): () => void {
  listeners.add(listener);
  clearTimer(closeTimer);
  closeTimer = null;
  ensureConnected();

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearTimer(reconnectTimer);
      reconnectTimer = null;
      scheduleCloseWhenIdle();
    }
  };
}
