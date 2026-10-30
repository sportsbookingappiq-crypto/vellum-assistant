/**
 * Whether the phone can reach the network right now: the browser's own
 * online flag on the web, and the Network plugin's status in the native
 * shells (through `useNetworkStatus`).
 */

import { useEffect, useState } from "react";

import { useNetworkStatus } from "@/hooks/use-network-status";

export function useAnuOnline(): boolean {
  const native = useNetworkStatus();
  const [browser, setBrowser] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const update = () => setBrowser(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return native && browser;
}
