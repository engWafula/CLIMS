import { useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { AppState } from "react-native";

const REFRESH_MS = 60_000;

/** Refresh a visible screen without overlapping requests or polling in the background. */
export function useFocusedRefresh(
  refresh: (isCurrent: () => boolean) => Promise<void>,
  offline: boolean,
) {
  useFocusEffect(
    useCallback(() => {
      let active = true;
      let running = false;
      const run = () => {
        if (!active || running) return;
        running = true;
        void refresh(() => active)
          .catch((error: unknown) => console.error("Could not refresh screen", error))
          .finally(() => {
            running = false;
          });
      };
      run();
      const timer = setInterval(() => {
        if (!offline && AppState.currentState === "active") run();
      }, REFRESH_MS);
      const subscription = AppState.addEventListener("change", (state) => {
        if (!offline && state === "active") run();
      });
      return () => {
        active = false;
        clearInterval(timer);
        subscription.remove();
      };
    }, [offline, refresh]),
  );
}
