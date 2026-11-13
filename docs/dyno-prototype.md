# Dyno prototype — 13 November 2026

Open the local `index.html` with the newly built Dyno running. Use this local
copy for the bench connection; the native simulator runs separately on the PC.

In Models → Dyno → Settings:

1. **Connect** opens `ws://127.0.0.1:8100`; it sends no machine commands.
2. **Init** sends only `G91` then `M114`, waiting for responses. An adapter
   snapshot associates the reported X coordinate with the current pulse
   displacement. No queue drain is forced; M114 remains a commanded baseline.
3. **Send Test** sends `G0 X1 F6000` (feed rate is editable). Each click adds
   another 1 mm to X. Only one test may be outstanding.

No local Start is required. Local Start/Stop/Clear and historical inspection
send no Dyno commands. The Dyno capture survives local Clear. Disconnect
invalidates initialization and marks an outstanding test incomplete; it does
not stop Marlin. Reconnect or manual fiddling calls for explicit Init again.
If a test never reaches its target or returns OK, it remains outstanding;
disconnect/reconnect permits a fresh Init. No automatic retry or timeout
alters the experiment.

The panel shows send-to-OK, send-to-first-X-pulse and send-to-target-X receipt
latencies, in µs. These include transport and browser delivery. Native Dyno
simulation timestamps separately give pulse span, intervals and
submit-to-first/target timings. Display units do not imply microsecond browser
clock accuracy. All native event and local receipt timestamps remain recorded.
Timing readouts use groups-of-three thousands separators in both µs and ns.

Only this module's plotted/logged coordinates map Y to zero. Real Dyno XYZ,
Marlin coordinates and the local models are untouched. Original wire records
are retained alongside `loggedX` / `loggedY` pulse coordinates. Pulse-based X
uses the Init baseline plus observed step displacement, avoiding the simulator
visualiser's arbitrary mechanical offset. Exact raw positions are retained;
the existing canvas readout rounds to 0.1 mm. Target matching uses 0.00001 mm
tolerance to accommodate the simulator callback's float representation.

The canvas, CAM-era selection and shared scrubber accept the third model.
Recording time for Dyno is native monotonic elapsed time relative to the
snapshot, aligned at its local receipt. The shared timeline extends to captured
Dyno time without advancing the local clock. Stopped local models are not
extrapolated into that extended range. Historical inspection freezes the view,
not the Dyno engine or its recording. Amber pulse marks appear in the event
lane. No Dyno velocity estimate is invented; its velocity curve is zero for
this first prototype.

Timeline controls: middle-button drag pans; right-button drag highlights a time
window and reports Start, End and Width in grouped µs below the chart. Either
drag direction selects the same normalized interval. Measurement leaves the
inspection cursor and recording state alone. Wheel zoom and left-click/drag
inspection retain their existing behaviour.

Developer inspection: `MoveSim.app.models[2]` exposes `records`, `tests`,
`history`, and `points`. Histories remain in memory until reload; there is no
export UI yet. Reinitializing during a run does not clear previous evidence.

Validation: 76 existing unit tests and three Dyno protocol/history tests;
headless browser regression and Dyno-panel checks; actual native-Dyno
WebSocket single-move smoke test. The native run produced 80 X pulses for 1 mm.
`node tests/dyno-live-check.cjs` starts its own Dyno, sends the agreed Init and
one test, writes evidence under ignored `tests/artifacts/`, then terminates
only its own process. It refuses to run if port 8100 is already occupied.

Periodic joystick sending, local-clock integration, remote Dyno Pause/Resume,
and a dedicated pulse waveform display remain later work.

## Open timing exploration

The prototype establishes communication and measurement; exploration is still
required. The present timeline plots native **host wall-clock** pulse capture
times, aligned at the Init snapshot. The panel's native pulse-span number uses
**simulation time**. Local receipt timestamps are retained separately.

In the saved single-move run, the pulse train spans 42,432.84 µs in simulation
time, 212,018 µs in native host time and 212,466.8 µs in browser receipt time.
The roughly fivefold stretch is already present at capture inside Dyno. The
448.8 µs difference between host and receipt spans is an interval comparison,
not a measurement of individual one-way transport delay. Simulator execution
rate and pulse timing must therefore be distinguished before interpreting
visible jitter. The execution-rate cause has not been isolated.

There is a separate 82,999.94 simulated µs from serial insertion to first X
pulse. Waiting for another command/lookahead is a hypothesis to investigate;
`shaped_immediate()` is a possible direction, not a demonstrated fix. No second
command, queue-draining command or pacing change has been added to conceal it.

Pending design: choose how simulation-time pulse spacing and wall-time
send/receive events should be displayed together, possibly with explicit clock
selection. No option has been selected or implemented. A test-send marker in
the existing timeline message lane has also been discussed; the timestamp is
recorded, but the marker is not implemented. The existing log panel is useful
and should be preserved while these questions are explored.
