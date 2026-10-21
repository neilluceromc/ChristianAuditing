"use client";

// Cris's day on the login page (spec §4.3; Task 10's blob stage): she arrives at a scene's station, plays its moods,
// says its line, works there for DWELL_MS, sends her prop home, then flies to the next station. Stopped (focus mode,
// Pause, reduced motion, signing in) she stays where she is, showing the current scene complete with its line.
import { useEffect, useRef, useState } from "react";
import type { CrisMood } from "@/lib/cris-mood";
import { DWELL_MS, SCENES, travelSeconds } from "./scenes";

export type DayState = {
  index: number;
  /** Her line for the scene is showing. */
  said: boolean;
  mood: CrisMood;
  /** At the station (not travelling). */
  arrived: boolean;
  /** Done with the scene: the prop flies home and the line hides. */
  leaving: boolean;
  /** The day log swaps to the next scene. */
  fading: boolean;
  /** This leg's travel time in seconds (0 when not travelling). */
  travel: number;
};

/** The time the prop takes to fly home before she leaves a station. */
const PROP_HOME_MS = 1300;
/** The day log's fade between scenes. */
const SWAP_MS = 350;

const lastMood = (i: number) => SCENES[i]!.moods[SCENES[i]!.moods.length - 1]![0];

export function useDayLoop(running: boolean): DayState {
  const [day, setDay] = useState<DayState>({
    index: 0,
    said: false,
    mood: SCENES[0]!.moods[0]![0],
    arrived: true,
    leaving: false,
    fading: false,
    travel: 0,
  });
  const indexRef = useRef(0);
  useEffect(() => {
    indexRef.current = day.index;
  });

  useEffect(() => {
    if (!running) {
      // Stopped: the current scene, complete.
      setDay((d) => ({ ...d, said: true, mood: lastMood(d.index), arrived: true, leaving: false, fading: false, travel: 0 }));
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));

    const arrive = (i: number) => {
      const sc = SCENES[i]!;
      setDay({ index: i, said: false, mood: sc.moods[0]![0], arrived: true, leaving: false, fading: false, travel: 0 });
      for (const [m, at] of sc.moods) if (at > 0) later(at, () => setDay((d) => ({ ...d, mood: m })));
      later(sc.sayAt, () => setDay((d) => ({ ...d, said: true })));
      later(DWELL_MS, () => {
        setDay((d) => ({ ...d, leaving: true }));
        later(sc.prop ? PROP_HOME_MS : 0, () => {
          setDay((d) => ({ ...d, fading: true }));
          later(SWAP_MS, () => {
            const n = (i + 1) % SCENES.length;
            const tv = travelSeconds(sc.station, SCENES[n]!.station);
            setDay({ index: n, said: false, mood: "idle", arrived: false, leaving: false, fading: false, travel: tv });
            later(tv * 1000, () => arrive(n));
          });
        });
      });
    };
    arrive(indexRef.current);
    return () => timers.forEach(clearTimeout);
  }, [running]);

  return day;
}
