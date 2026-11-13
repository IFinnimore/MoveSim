# MoveSim

A local motion workbench written in plain JavaScript, HTML and CSS. Dark mode is the only theme. No packages, build step or account are required. Scripts and image assets are bundled; simulations and notebooks stay in your browser.

**[Run MoveSim](https://ifinnimore.github.io/MoveSim/)** · [Source on GitHub](https://github.com/IFinnimore/MoveSim)

## Open it

Open `index.html` in a browser. The clock starts stopped at zero, with Send disabled. Local use needs no internet connection.

The local source also includes an experimental **Dyno** module: open its Settings
and choose **Connect → Init → Send Test** with native Dyno running. It operates
independently of the local clock and Send controls. See the [Dyno prototype
notes](docs/dyno-prototype.md) for commands, timings and recording semantics.

For a browser that needs localhost for gamepad access, run this from the MoveSim folder:

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

Then open **http://127.0.0.1:8765**. Stop that local server with Ctrl+C. It serves static files only; the application still runs entirely in the browser.

## Controls

**Local model motion is sent only while the clock is running and Send is enabled.** Choose **Start**, then enable **Send** on screen or hold its mapped controller button (default **R2**). The Dyno prototype uses its own explicit buttons.

Set up your gamepad with axes, directions, dead zone and button assignments that are convenient for you. The defaults below are starting points.

### Clock, Send and Clear

The screen **Send / Don't send** toggle latches the model run signal. Holding the mapped deadman also activates run; either source enables both models. Releasing the deadman leaves a screen latch on if it was enabled. Both controls act independently of the clock. Button actions use the selected controller even while simulated joysticks supply X/Y input.

**Don't send signals model stop.** G91 finishes its current block unchanged, then creates acceleration-limited blocks targeting zero until both axes stop. Input continues to update its latest-message cache. Just Draw stops immediately, cancels its pending deliveries, and waits for Send before sending more messages. The clock button freezes all simulation time immediately for inspection.

- **Stop the clock / Start** freezes simulation time and continues it without catch-up. Start is bright green whenever paused. Zoom, pan, visibility, log inspection, and the timeline scrubber still work. Hiding the browser tab also stops the clock.

- **Clear & home** resets the clock to zero, every model to (200.0, 200.0) mm with zero velocity, input to neutral, sending to disabled, histories, messages, and gate hits. It fits both views and preserves the running/stopped choice, model settings and input/button preferences. A gamepad stick held through Clear must change its reported state before it drives again; a held deadman must be released and pressed again.

- **60-second inactivity pause:** the clock pauses automatically after a minute without operator input and shows **IDLE**. A held direction remains active, even against a wall. Pointer movement, typing, notebook edits, and view navigation renew the timeout; periodic model messages do not. Start and Clear start a fresh inactivity interval. Input after an idle pause does not restart the clock automatically; choose Start.

- **Free play:** rotation while the clock is stopped or **Don't send** is active moves only the display. It adds no motion request for later. A new permitted interval also discards unsampled old wheel requests and partial pulses, preventing old travel or an old sampled wheel velocity from restarting on Start/Send. Angular fractions within a permitted interval are retained between movements.

### Gamepad setup

- Choose Gamepad to use a connected controller; focus the page and press a controller button to make it detectable. Both controller sticks send proportional X/Y. A standard-mapped controller's D-pad sends full +/-1.0 directions. They write the same shared input stream: the latest changed control wins, and releasing one can overwrite another held direction. This collision behaviour is intentional for now.

- **Gamepad settings** is collapsed by default. It contains controller selection, separate left/right axis mappings and inversions, the neutral/dead-zone value, and controller details. Initial mappings are left axes 0/1 and right axes 2/3, with Y inverted on both so up is positive. The dead zone also applies to simulated sticks.

- Source selection and all gamepad preferences save immediately when changed, with no Save button. They restore from local browser storage on load; the clock still waits for Start. The remembered controller is matched by its reported identity, with an index preference for identical devices. If it is disconnected, MoveSim waits for it instead of silently choosing another controller. Clear preserves these preferences. When storage is unavailable, an inline notice explains that changes are kept only in the current tab.

### Joysticks

- Drag either simulated proportional joystick; release to return to neutral. Each stick has a single 12 px X/Y/direction readout above it. Arrow keys or WASD drive the left stick.

### Finger wheels and axis ownership

- **Finger wheels:** while the clock is stopped, fixed **L3 / R3** or the caption buttons toggle each control independently. Each scalloped wheel uses the existing 130 px footprint, with an amber zero divider. Stick movement outside radial magnitude **0.75** rotates it by angular delta; neutral holds orientation and releases the reference so re-entry does not jump. Rotation crosses the +/-180 degree seam smoothly. Dragging the virtual control works too. Mode changes are ignored while the clock runs, and a held click never toggles repeatedly or takes effect later on pause. Modes and angles are session-only; Clear homes wheel angles while preserving modes.

- **Wheel distance / revolution** is one shared selector: **100 mm (default), 50 mm, 10 mm, 254 mm, 25.4 mm**, in that order. It autosaves with input preferences. There are **100 logical pulses per revolution**, each 3.6 degrees (two physical pulses of a 200-pulse encoder). Clockwise adds distance (X right, Y up); counterclockwise subtracts. At 10 mm/rev one pulse is 0.1 mm; at 25.4 mm/rev it is 0.254 mm. Internal distance accounting keeps fractional dmm precise; public coordinates remain integer dmm. A scale change applies to future pulses and does not rescale already accepted distance.

- **Axis ownership:** left wheel owns X; right wheel owns Y. A wheel-mode stick supplies only wheel pulses. Joysticks can drive only axes not owned by a wheel. The D-pad is an exception and can always drive both axes, including diagonals. In mixed mode the remaining joystick axis still uses the selected speed and Proportional setting. With both wheels enabled, joystick XY is suppressed while the D-pad remains available. D-pad motion retains its current movement-while-held behaviour at selected Input speed, subject to each model's timing and acceleration. On a wheel-owned axis its velocity adds to that sample's wheel velocity, preserving wheel pulses received in the same window. Holding the Fine bump modifier (default L1), or enabling the on-screen D-pad toggle, switches to the fine behaviour below.

### D-pad fine bumps

- **Fine D-pad bumps:** hold **L1** (configurable as Fine bump while held), or enable **D-pad: 0.1 mm** on screen. Each fresh direction press requests **0.1 mm** on that axis, including diagonals. Holding the direction does not repeat; release and press again for another bump. A held modifier and the screen latch combine like Send; releasing L1 leaves a screen latch on if it was enabled. Releasing the modifier restores normal movement while held. Entering fine mode with a direction already held does not create a bump. Bumps are independent of wheel scale, Input speed and Proportional, and work with or without wheel modes. Each model samples its own accepted bump totals and executes them under its existing timing/acceleration rules; G91 does not compensate tracking errors. Fine presses while paused or Don't send are discarded. Clear resets accepted counts and the screen latch, retains the physical held modifier, and requires a fresh D-pad press before another bump. The mode is not restored on page load.

### Button assignments

**Button settings** is collapsed by default. Opening it scrolls its bottom controls into view. Select an action, then press controller buttons to assign. Every fresh press replaces the selected action's assignment and autosaves immediately. Assignment remains active until the panel is collapsed or **Choose an action...** is chosen. Assignment presses do not run their actions or drive the D-pad; a button reassigned to another action leaves its previous action unassigned. Fixed L3/R3 remain reserved for wheel display modes.

Each action in the combo shows its current assignment, for example **Clock toggle — R1 [5]**, and updates immediately after remapping. The edited action remains selected and capture continues, so another button press replaces it without reselecting. Exit assignment before using the mapped actions normally. Actions without a button show **Unassigned**.

| Action | Default button |
| --- | --- |
| Start / stop the clock | R1, index 5; one toggle per press |
| Clear & home | Start/Menu, index 9; one reset per press |
| Send while held | R2, index 7 |
| Fine bump while held | L1, index 4 |
| Speed 1 | A, index 0; 1 mm/s |
| Speed 2 | B, index 1; 10 mm/s |
| Speed 3 | X, index 2; 50 mm/s |
| Speed 4 | Y, index 3; 100 mm/s |

These defaults use standard browser gamepad numbering. An older saved assignment already using L1 is preserved; Fine bump starts unassigned in that case and can be mapped in this panel.

Mappings, four speeds and selected speed autosave in one shared browser record for all controllers. Sending is never restored on page load. The first observed Clock or Send press takes effect even if it is the press that makes the browser reveal the controller after refresh. Clock toggles once per press; Send remains active only while the deadman is held or the screen latch is enabled. Fixed L3/R3 clicks also respond on first detection; other button actions use their initial detected state as a baseline. L3/R3 cannot be assigned to other actions. If an older saved configuration assigned them elsewhere, that action becomes visibly unassigned and can be remapped. Configuration and speed selection remain available with the clock stopped.

### Joystick speed

The Input heading's speed combo selects the same four slots. Their values are editable in Button settings, from 0.1 to 1000 mm/s in 0.1 mm/s increments. Initial selection is 50 mm/s. Just Draw uses the new speed in future messages; G91 uses it at the next block boundary. Existing messages and blocks retain their payloads and profiles. Speed belongs to the shared input; older preset speed fields are ignored while notes and timing parameters remain available.

## Views and timeline

On desktop the 620 px control column spans the full height at the left. The motion canvas and timeline share the remaining width on the right. Narrow windows stack these areas vertically.

### Models canvas

- In the **Models** canvas view, scroll to zoom at the pointer; drag to pan. **Full area** restores the 400 × 400 mm view. Grid and gates are display toggles.

### CAM-era views

The Motion canvas title-bar selector starts at **Models**, the existing comparison view. It also lists **CAM-era: Just Draw**, **CAM-era: G91 Incremental**, and automatically includes other models added to the application.

CAM-era follows the selected model at the displayed simulation time. Its dot and crosshair remain centred while the board, grid, paths, gates and other model cursors move beneath them. Following works even if that model's trace visibility is off. Timeline inspection follows historical position; returning to Latest follows the current run again. Choosing a view does not change model input, timing or recorded motion.

The initial/reset field is a square **100 by 100 mm** aperture inside the existing canvas. Dark margins preserve equal physical scale on rectangular screens. The local **assets/pcb1-scaled.png** image occupies **100.1 by 62.1 mm**, centred at machine home **X200.0 Y200.0 mm**. Rendering order is background/grid, PCB, existing gates and model paths/cursors, then the crosshair and DRO. The reticle has a centre dot and three CSS pixels of clear space before each arm. Its colour identifies the followed model. Existing tracing stays enabled; a Mark action and tracing controls remain future work.

The upper-left overlay reads **CAM-era view**, followed by separate X and Y coordinate lines. These use the clock's font size, including its narrow-screen size. Coordinates are in mm and match the displayed inspection time.

Scroll and +/- still zoom, centred on the followed point. **Pan is locked.** The reset button reads **100 x 100 mm** in CAM-era. Each model's camera remembers its zoom; switching back to Models restores that view's saved zoom and pan. Clear retains the selected view, homes the models and resets all saved views, including each camera's 100 mm field. View selection and camera zoom are session-only. The PCB image stays local and is included in the source ZIP.

### Timeline and messages

- Click the velocity plot or drag its scrubber to stop and inspect the recording. **Latest** returns to the most recent state while remaining stopped. **Start** continues from the end of the run, not from the historical inspection time.

- On the timeline, scroll to zoom at the pointer; middle-button drag to pan in time. Right-button drag marks a window and reports Start, End and Width in µs with thousands separators. **Fit to sim** restores an automatically fitted time range. Each model uses its own colour, with solid X and dashed Y velocity. Ramps are drawn with their recorded slope. Amber ticks mark shared input changes; blue ticks mark model messages. Click the blue marker lane to select a message and open its log entry.

## Model settings

Each model title row shows its own right-aligned position as `X200.0 Y200.0` in mm, following the displayed inspection time when scrubbing history. Readouts remain visible when a trace is hidden. The canvas legend identifies both model colours.

- **Just Draw** is green and changes velocity instantly. Its Proportional switch defaults off: each active axis uses full selected speed. With Proportional on, each axis uses its signed input proportion times selected speed. It requires Send, stops immediately when run turns off, and cancels any commands still in flight. Hiding a trace only affects rendering; Send controls whether it moves.

- **G91 Incremental** is blue. Proportional defaults on and Move duration defaults to 100 ms. It creates fixed-duration acceleration-limited blocks using the latest input at each boundary, carrying actual ending velocity into the next block.

- Unchecking a model hides its trace and markers. Its input processing and recordings continue. Checking it again reveals the existing run, including historical inspection.

- Each model starts as a compact title row. Its **Settings** button shows or hides the parameter notebook, notes, timing fields, Apply control and recorded-point details. Hiding the area preserves its values and has no effect on recording or rendering. Each title-row button controls its own model independently.

- **Max acceleration (mm/s²)** stays visible in the Models heading and belongs to the machine, separately from model presets. Its editable starting value is 2,000 mm/s², matching the local Artisan Marlin configuration's X/Y maximum defaults. Valid edits update shared machine settings immediately and autosave locally. G91 captures this limit when creating each block, so a live edit affects subsequent blocks. Clear preserves the value. Just Draw remains the instant-response baseline.

- Model timing edits take effect with **Apply settings & start**. This starts or continues the clock at the current position and preserves the trail, histories, messages, zoom and pan. It does not save a preset. The button turns amber when displayed values differ from the running model. When they match, it is disabled and reads **Settings applied**. Reverting an edit also returns it to this clean state; editing a preset name or note does not require Apply. Use **Clear & home** for an explicit reset. Speed is selected independently in the Input heading and takes effect in future messages immediately.

## Parameter notebook

Choose **Settings** on either model's title row, then open its **Parameter notebook** to keep named parameter sets and short engineering notes. Each model has a separate notebook, including its Proportional setting.

- Enter a name and an optional note, then **Save** to capture the parameters currently displayed in the controls. Saving an existing name updates that set, including its note. Names ignore letter case and surrounding spaces.
- The saved-set list is alphabetical. Selecting a set immediately loads its parameters and note into the controls. It does not change the running model, clear the clock, or erase the current recording. Use the amber **Apply settings & start** button to use those values and continue the experiment. If those values are already active, the button stays clean.
- Edit the name and choose **Rename** to change the selected set's name while preserving its saved parameters and note. Use Save to store any further edits to the note or parameters. A name already used by another set is rejected.
- **Delete** removes the selected set and loads the next set in the list. Deleting the last one creates **Defaults** with the model's factory parameters and an empty note, and fills the controls with those defaults. Apply settings & start uses them when those values differ from the active settings.

Notes allow multiple lines, up to 2,000 characters; names allow up to 80. Clear preserves both saved sets and the note editor. Sets and notes persist locally in browser storage, separately for each model. Return using the same browser and page address to use the same notebook. Browser-stored sets are not included when sharing the source folder. If the browser cannot store changes, the notebook explicitly reports that changes are kept in this tab only.

## Model timing reference

Just Draw starts with Proportional off, 20 ms input sampling, 20 ms messages, and 0 ms delivery delay. At equal timestamps the order is sample, send, receive. It sends periodic updates, including neutral updates, only while Send is enabled. Input sampling continues while stopped. Run-off is processed at its input timestamp even between polling events, sets velocity to zero, and marks in-flight messages cancelled in the log. When Send returns, the normal sampling and message schedules resume. On joystick axes, Proportional off uses the sign; on uses the full signed proportion. D-pad directions already have magnitude 1.0.

For wheel axes, each model keeps its own cursor into cumulative accepted distance. At an input sampling boundary, **requested velocity = new distance since that model's previous sample / elapsed sample time**. Input speed and Proportional have no effect on wheel axes. Just Draw samples at its Input sample interval, then sends that velocity on its existing message schedule; sample/message/delivery timing remains part of the experiment. G91 samples once at each move-duration boundary and uses the new delta for its next fixed block. All models see the same input independently, including hidden models.

**G91 deliberately has no distance catch-up.** Its acceleration-limited velocity profile may execute less or more than the requested sampled distance. The next block uses only newly arrived pulses, without adding a previous shortfall. No pulses means a zero target velocity, approached under the same acceleration limit. Requested and executed deltas are recorded separately so model error remains visible. Releasing Send retains the existing rule: finish the active block unchanged, then ramp to zero.

Applying Just Draw settings finishes the previous schedule up to current time and begins new sampling/sending cycles from there. In-flight messages retain their payloads and delivery times; a shorter new delay can let a newer message arrive first. Applying G91 settings preserves the active block and uses the new settings for the next block. An inactive G91 model restarts its boundary schedule from the application time. Each model's `settingsHistory` records `{ timeMs, parameters }`; Clear begins a fresh history using current values.

G91 starts with Proportional on and a 100 ms move duration. Boundaries initially occur at 100, 200, 300… ms from Clear. While run is off and both axes are stationary, boundaries pass without creating blocks. At an active boundary it reads the latest timestamped shared input, converts joystick proportions and selected speed, or sampled wheel distance/time, into per-axis target velocities, and creates an immutable fixed-duration block. Each axis ramps at the global acceleration limit toward its target, holds the target if reached early, and otherwise carries the velocity reached into the next block. Distance is the integral of that profile, not requested speed times duration. A short block does not imply a stop at its boundary.

When run turns off during a block, that block finishes unchanged. Subsequent blocks target zero, possibly spanning several windows if acceleration is low. Motion stops as soon as zero velocity is reached; the rest of that fixed window holds zero. If run returns, the latest target is considered at the next boundary. Input, proportional-setting or machine-limit changes do not rewrite a created block. A wall stops only that axis for the rest of its current block; the other axis continues, and the next block starts from the actual wall-limited state.

G91 records its generated incremental blocks as model log messages, with integrated integer deltas, target velocities, duration and a stopping flag. `model.blocks` retains frozen plans, including exact phase state and display knots. The label G91 Incremental denotes this specified local fixed-duration policy.

There is one master elapsed-time clock in milliseconds from Clear. The browser's monotonic wall clock drives it while running. A screen frame is an opportunity to process all due events and draw, not one model time step. Models retain their own scheduled events and never run on their own `setInterval` timers. This makes results independent of how frames are divided, for a given captured input history. Real keyboard, pointer, and gamepad input remains subject to browser event and polling latency; this is not a hardware timing emulator.

Just Draw messages record model, sample/send/delivery/receive times, integer X/Y deltas, selected speed and target velocities. Its deltas describe one message interval at that velocity; it follows velocity until the next delivery. G91 deltas describe its integrated ramp profile. Both retain precise position internally and round public coordinates/deltas for inspection, so rounding short increments does not cause cumulative motion loss. These are local simulator records, not a GCodeI wire format.

## Units and histories

- `dmm` means 0.1 mm. The canvas ranges from 0 to 4000 dmm on each axis, with positive Y upward.
- Public `model.points` entries are `{ timeMs, positionXdmm, positionYdmm }`. Coordinates are integers. Arrival timestamps are millisecond-scale numbers; an exact boundary hit can occur at a fractional millisecond.
- Velocities use `velocityXdmmPerSecond` / `velocityYdmmPerSecond`. The UI converts them to mm/s. `model.velocityHistory` records actual motion velocity changes, including an individual axis stopping at a wall.
- `model.history` retains precise position, velocity and acceleration for drawing and playback. Integration and historical lookup use constant-acceleration kinematics between knots. Displayed coordinates and the public point array are rounded to integer dmm.
- All models share `input.history`, containing timestamped proportional X/Y, `sendEnabled` (the model run signal) and `speeddmmPerSecond`. Each model decides whether to use magnitude or sign. Run and speed changes produce input markers even if X/Y remain unchanged.
- All histories and messages remain in memory until Clear or page closure. The log displays the latest 160 rows to keep its DOM small; older entries can still be selected from their timeline markers. There is no export format yet.

Six initial 10 × 10 mm gate positions exercise the display. A gate is red if any **visible model's path up to the displayed time** touches or crosses its square, otherwise green. Whole line segments are tested, not just endpoints. G91 supplies frame-independent curve knots with at most 0.005 mm chord deviation for drawing and gate checks. Gates do not block movement. Their arrangement and further game rules remain open for later discussion.

## Share with GitHub Pages

GitHub Pages can host MoveSim directly as a static website. A public repository works with GitHub Free; no application server or build step is needed. See the [GitHub Pages documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

1. Put the contents of this folder at the root of [IFinnimore/MoveSim](https://github.com/IFinnimore/MoveSim), including `index.html`, `styles.css`, `js/`, `assets/` and `.nojekyll`.
2. In that repository, open **Settings > Pages**, choose **Deploy from a branch**, select **main** and **/(root)**, then save. See [publishing-source instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
3. The project address is **https://ifinnimore.github.io/MoveSim/**. GitHub Pages shows the live link once publishing completes.

The included `.nojekyll` file keeps publishing as plain static files. Git ignores `notes-for-new-me.md` and generated test screenshots. Named parameter sets, notes and controller preferences remain in each visitor's browser; they are not shared through the hosted site or source ZIP.

## Files and adding a model

`index.html` is the load-order manifest. `styles.css` owns the theme and layout. Each major subsystem has its own file:

| File | Responsibility |
| --- | --- |
| `js/common.js` | Units, time lookup, geometry, canvas density |
| `js/clock.js` | Master time, stop, resume, clear, and operator inactivity timing |
| `js/input.js` | Shared input history, joystick, keyboard, gamepad and display-mode controls |
| `js/finger-wheel.js` | Independent angular wheel state, radial neutral band and SVG display |
| `js/wheel-input.js` | Shared scale choices, logical pulses, precise distance accounting, free-play gates and independent model sampling |
| `js/input-settings.js` | Immediate persistence and validation of source and gamepad preferences |
| `js/button-controls.js` | Shared button assignments, speed slots, learning, clock actions, and model run/stop signal |
| `js/machine-settings.js` | Shared machine limits, unit validation and independent browser persistence |
| `js/messages.js` | Complete in-memory message log |
| `js/presets.js` | Shared named parameter sets, notes, browser storage, and notebook controls |
| `js/model-base.js` | Motion state, boundary helpers, recording, historical lookup |
| `js/model-just-draw.js` | Baseline model and example scheduling policy |
| `js/model-g91-incremental.js` | Immutable fixed-duration ramp blocks, integrated deltas and run/stop behaviour |
| `js/motion-canvas.js` | Paths, cursor, grid, gates, per-view navigation and camera tracking |
| `js/camera-view.js` | Calibrated PCB placement, square camera field and fixed-pixel crosshair |
| `js/velocity-chart.js` | Velocity display, event markers, timeline navigation |
| `js/ui.js` | Creates models, binds controls, drives frames |

Use plain functions and objects. Comments should explain intent in simple English. For another model, start from `model-just-draw.js`, give its factory and model a unique name/id, load its script after `model-base.js`, and add its instance to the `models` array in `ui.js` with the **same input and messages services** and **same `machineSettings.values` object**. Provide its controls and visibility checkbox there. Each model provides `clear()`, `applySettings(parameters, timeMs)`, `advanceTo(timeMs)`, `stateAt(timeMs)`, `points`, `history`, `velocityHistory`, and `settingsHistory`. The drawing code already iterates over that array and uses each model's `colour` and `visible` flag. Blue (`MoveSim.colours.blue`) is available for a comparison model.

Machine acceleration is stored as integer `maxAccelerationdmmPerSecondSquared`, with 10 internal units per mm/s². Model settings toggles use a `data-model-settings` button carrying the model name, `aria-controls` naming its hidden settings body, and `aria-expanded` for visible state. The shared UI binding toggles that body without replacing or resetting its controls.

The base motion helper integrates piecewise constant acceleration and evaluates historical position/velocity analytically. Just Draw uses zero acceleration and its existing wall-event helpers. G91 plans exact target-reaching, reversal and wall phases before creating a block, then records those events and extra curve knots. The velocity chart uses recorded acceleration for slopes; it does not invent motion from frame timing.

For presets, each model declares a `parameterSchema` with factory values, labels, numeric ranges/integer requirements, or `type: "boolean"` for switches. Create its store with `MoveSim.createPresetStore({ modelId, parameterSchema })` and bind its notebook elements with `MoveSim.bindPresetControls(...)`, supplying functions that read and write its parameter form. The service stores only declared parameters. A model's unique `modelId` keeps its notebook separate from other models.

## Checks

With Node.js installed, run:

```powershell
node --test tests/model.test.cjs tests/g91.test.cjs tests/finger-wheel.test.cjs tests/wheel-input.test.cjs tests/wheel-models.test.cjs tests/camera-view.test.cjs tests/presets.test.cjs tests/input-settings.test.cjs tests/button-settings.test.cjs tests/machine-settings.test.cjs
```

The 76 tests cover calibrated CAM-era geometry, PCB placement and reticle gap, exact fine bumps with and without wheels, fine free-play gates and modifier upgrades, D-pad motion/release on wheel axes and combined wheel/D-pad samples, wheel scales, pulse fractions, independent sample windows, free-play transitions, fractional travel, deliberate G91 distance loss without catch-up, angular finger wheels, neutral re-entry, multiple turns, reserved stick clicks, clocks, proportional Just Draw, external speed, fixed G91 duration and integrated ramp distance, carried velocity, immutable blocks, reversals, stop ramps across windows, live settings, walls, frame-cadence independence, presets, input preferences, button mappings and shared machine settings. Browser checks use the installed Chrome/Edge executable and Node's built-in WebSocket without npm packages:

```powershell
node tests/browser-check.cjs
```

To check the hosted version instead of local files:

```powershell
$env:MOVESIM_URL = 'https://ifinnimore.github.io/MoveSim/'
node tests/browser-check.cjs
```

The browser check uses a disposable profile, opens the actual local `index.html`, exercises both virtual sticks, both gamepad sticks, D-pad collisions and the existing UI, verifies preference/preset/notes persistence and remembered-controller reconnect, and saves screenshots to `tests/artifacts/movesim.png`, `tests/artifacts/finger-wheels.png` and `tests/artifacts/wheel-motion.png` and `tests/artifacts/camera-view.png`. It verifies virtual wheel dragging, both fixed stick clicks, independent modes, the running-clock lock, neutral behaviour, per-axis ownership and identical layout before/after mode switching. Live checks also verify D-pad diagonals and release in both models with both wheels active, the held fine modifier, one exact 0.1 mm request per fresh press without repeat, the screen toggle, free-play gates, modifier remapping/persistence and repeated assignment without reselecting. Live wheel checks verify 100 mm from one revolution, independent Y travel, visible acceleration error without catch-up, scale persistence, fractional 25.4 mm/rev travel, and no queued motion after free play. It also checks action learning, clock press edges, deadman and screen latch behaviour, four speed buttons, edited speed persistence, and Send disabled after reload. Physical gamepad input was confirmed during hands-on testing of the earlier single-stick version; dual-stick and button mapping changes are covered with an emulated controller.

CAM-era browser checks verify direct-file PCB loading, live wheel tracking, historical DRO, hidden-model following, matching clock fonts, square physical scale, ignored pan, centre-locked zoom, per-model camera zoom, restored Models navigation, Clear/reset, narrow layout and unchanged simulation records when switching views.
