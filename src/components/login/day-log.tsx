"use client";

// The day log (spec §4.6): the clock, the area and task, pause/play, and a timeline from 08:00 to 18:00 with a
// button per scene. The only interactive part of the room, so it is a labelled section after the card's <main>.
import { cn } from "@/lib/cn";
import { SCENES, dayPct, fmtClock } from "./scenes";
import type { RoomLoop } from "./use-room-loop";

export function DayLog({ loop }: { loop: RoomLoop }) {
  const sc = SCENES[loop.index];
  return (
    <section className="lw-daylog" aria-label="Cris's day">
      <div className="lw-dl-top">
        <span className="lw-clock">{fmtClock(loop.minute)}</span>
        <div className="lw-what">
          <span className="lw-area">{sc.area}</span>
          <span className="lw-task">{sc.task}</span>
        </div>
        <button
          type="button"
          className="lw-iconbtn"
          aria-pressed={!loop.playing}
          aria-label={loop.playing ? "Pause the scene" : "Play the scene"}
          onClick={loop.togglePlay}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            {loop.playing ? (
              <>
                <rect x="3" y="2" width="3" height="10" rx="1" fill="currentColor" />
                <rect x="8" y="2" width="3" height="10" rx="1" fill="currentColor" />
              </>
            ) : (
              <path d="M4 2.5v9a.6.6 0 0 0 .9.5l7.2-4.5a.6.6 0 0 0 0-1L4.9 2a.6.6 0 0 0-.9.5z" fill="currentColor" />
            )}
          </svg>
        </button>
      </div>
      <div className="lw-ruler">
        <div className="lw-track">
          <div
            className="lw-fill"
            style={{ width: `${dayPct(sc.minute)}%`, transitionDuration: `${loop.travel}s` }}
          />
        </div>
        {SCENES.map((s, k) => (
          <button
            key={s.id}
            type="button"
            className={cn("lw-tickb", s.minute < sc.minute && "lw-tick-past")}
            style={{ left: `${dayPct(s.minute)}%` }}
            aria-label={`${fmtClock(s.minute)} ${s.area}: ${s.task}`}
            aria-pressed={k === loop.index}
            onClick={() => loop.goTo(k)}
          >
            <span />
          </button>
        ))}
      </div>
      <div className="lw-rlabels" aria-hidden="true">
        <span>08:00</span>
        <span>13:00</span>
        <span>18:00</span>
      </div>
    </section>
  );
}
