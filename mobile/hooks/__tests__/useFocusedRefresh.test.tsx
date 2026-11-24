import React from "react";
import { AppState, type AppStateStatus } from "react-native";
import renderer, { act } from "react-test-renderer";

import { useFocusedRefresh } from "../useFocusedRefresh";

jest.mock("expo-router", () => ({
  useFocusEffect: (effect: React.EffectCallback) =>
    jest.requireActual<typeof import("react")>("react").useEffect(effect, [effect]),
}));

function Screen({
  refresh,
  offline = false,
}: {
  refresh: (isCurrent: () => boolean) => Promise<void>;
  offline?: boolean;
}) {
  useFocusedRefresh(refresh, offline);
  return null;
}

test("refreshes only while visible and online, without overlapping requests", async () => {
  jest.useFakeTimers();
  const originalState = AppState.currentState;
  AppState.currentState = "active";
  let onChange: ((state: AppStateStatus) => void) | undefined;
  const remove = jest.fn();
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    onChange = listener;
    return { remove };
  });
  let resolve!: () => void;
  const refresh = jest.fn(
    (_isCurrent: () => boolean) =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<Screen refresh={refresh} />);
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.advanceTimersByTime(60_000);
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolve();
  });
  AppState.currentState = "background";
  await act(async () => {
    jest.advanceTimersByTime(60_000);
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  AppState.currentState = "active";
  await act(async () => {
    onChange?.("active");
  });
  expect(refresh).toHaveBeenCalledTimes(2);
  const isCurrent = refresh.mock.calls[1]?.[0] as (() => boolean) | undefined;
  await act(async () => {
    tree.unmount();
  });
  expect(isCurrent?.()).toBe(false);
  expect(remove).toHaveBeenCalled();
  await act(async () => {
    resolve();
  });
  AppState.currentState = originalState;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test("does not poll while offline", async () => {
  jest.useFakeTimers();
  const originalState = AppState.currentState;
  AppState.currentState = "active";
  const refresh = jest.fn(async (_isCurrent: () => boolean) => {});
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<Screen refresh={refresh} offline />);
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.advanceTimersByTime(120_000);
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => {
    tree.unmount();
  });
  AppState.currentState = originalState;
  jest.useRealTimers();
});
