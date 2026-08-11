"use client";

import { useEffect } from "react";

export function PwaRegistration() {
  useEffect(() => {
    if ("serviceWorker" in navigator && window.location.protocol === "https:") {
      navigator.serviceWorker.register("./sw.js").catch(() => undefined);
    }
    navigator.storage?.persist?.().catch(() => undefined);
  }, []);
  return null;
}
