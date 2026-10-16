"use client";

import { createContext, useContext, useEffect, useMemo, useRef } from "react";

/**
 * Phase 37 (spec §3.3): leaving with unsaved policy edits asks first. Each editor on the page registers whether
 * it is dirty; the group list asks before following a link. A ref, not state: nothing re-renders on a keystroke.
 */
interface DirtyApi {
  set: (key: string, dirty: boolean) => void;
  any: () => boolean;
}

const NONE: DirtyApi = { set: () => {}, any: () => false };
const DirtyContext = createContext<DirtyApi>(NONE);

export function PolicyDirtyProvider({ children }: { children: React.ReactNode }) {
  const dirty = useRef(new Set<string>());
  const api = useMemo<DirtyApi>(() => ({
    set: (key, isDirty) => {
      if (isDirty) dirty.current.add(key);
      else dirty.current.delete(key);
    },
    any: () => dirty.current.size > 0,
  }), []);
  return <DirtyContext.Provider value={api}>{children}</DirtyContext.Provider>;
}

export function usePolicyDirty(): DirtyApi {
  return useContext(DirtyContext);
}

export const LEAVE_UNSAVED = "Leave without saving?";

/** One editor's dirtiness: told to the page's list, and to the browser (beforeunload) while it lasts. */
export function useDirtyFlag(key: string, dirty: boolean) {
  const api = usePolicyDirty();
  useEffect(() => {
    api.set(key, dirty);
    return () => api.set(key, false);
  }, [api, key, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}
