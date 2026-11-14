# GCode vs GCodeI

Strategy for HID control of CNC physics limited motion for motion drivers (MD) like Marlin and Klipper

## GCode: Connect the dots

Fundamentally GCode is a list of 3D coordinates and desired motion velocity (feed) to move the tool between them along that vector. Basically, a connect the dots game where the pen has a desired speed.

MD are optimized for this pattern. They look at the list and for each segment calculate how they can ramp up to get to the desired speed, cruise for some distance, and then if necessary ramp down to a feed to make the turn at the next point without having problems with the stepper motors. Due to the nature of 3D Printing, the primary focus of the MD in question, the goal is to be able to move as fast as possible without having position errors.

To accomplish this, the math needs at least 3 facts:

- Where to start the calculation from: Location and current feed motion
- Where to go to next: 2nd location
- Where to go after that: 3rd location

If there are no more points, the motion stops at the last point.

In MD this is accomplished by the following:

- Queue the locations into “planner blocks”
- When there are at least 3 points, the first segment of motion can be “shaped”. Shape has 3 aspects:
  - Time to Ramp Up from the prior segments ending feed
  - Time to Cruise
  - Time to Ramp Down to make the turn

Those shaped times then are used by a separate process, breaking down the motion into each axis separately to generate pulses to drive per axis stepper motors by using functions to calculate time to next pulse, keeping all motion coordinated to ensure as straight a line as possible between the two points. There are also motion safety checks, conforming motion to machine movement limits such as soft stops, hard stops, and emergency stop commands.

Limitation: Once a planner block is the current block for the pulses generator to work on it is not able to be changed without summoning all sorts of concurrency timing demons.

## GCodeI &lt;Immediate&gt;: Human intent across time

Human commanded motion (HID) is a different set of data. Rather than having a list of dots to connect, HID motion is a time sampled current direction and speed based upon some control input. The goal of HID motion is not to move as fast as possible through a list of points but rather move in a way where the person feels directly in control of the motion.

MD are not optimized for this pattern. The HID data pattern is time and velocity based rather than coordinate based. It is also about precision of control rather than how fast can it go, with the stepper pulse interval at low speeds encroaching into human perception timing. For the extreme example, moving 0.1 mm/sec is a pulse every 125ms.

### HID By GCode Timing

As the time for a movement command for any given distance is not very deterministic nor is the command processing lag, or at least not readily accurate to the microsecond level, there are effectively two timing scenarios for GCode commanded motion:

- Movement time takes longer than the HID update interval
- Movement time is shorter than the HID update interval

Figure 1 details these scenarios in a simple 1D form, with Planner blocks in blue, speed ramp shapes as green lines, and intervals for:

- Time HID: HID command send interval, two commands.
- P Lag: Time from command received from HID until a block is shaped
- Pulses: Time to make the movement
- Stop: Time while machine is not moving

The commands send two different feed rates, reflected in the higher pulses shape after the 2nd command.

This is using all the existing Marlin code, with the HID sending incremental or absolute motion G0 commands with a distance calculated relative to the last command at the selected speed.

<img src="../assets/batch_GCode%20Timing.png" alt="Figure 1: HID by GCode timing scenarios" style="max-width: 800px; width: 100%; height: auto;">

The obvious danger here is for Scenario A there is a cumulative lag error building up, and for Scenario B there is a jerky start and stop motion experience, which even if below perception may cause machine shuddering.

### HID By GCodeI &lt;Immediate&gt; Timing

GCodeI changes the model, downstream of GCode commands.

Fundamentally this is a change of the overall math model:  GCode is summing vectors head of prior to tail of next.   GCodeI is integrating vectors at the time the next is ready to the prior vector at that point in time.  This discardes the unexecuted remainder of the prior vector, creating a new direction.     

First this is an interpreter mode switch. Turning on GCodeI mode can only occur when the machine is not in motion, no GCode file running or for a universal solution the GCode buffer is paused, and GCodeI motion commands are processed via the “emergency” bypass.

The GCodeI commands are still standard G0/G1 motion commands with XYZEAB coordinates and F and S parameters, but rather than trying to send a distance that is similar in size to the Time HID interval, it intentionally is a motion that distances for > 2x the Time HID interval.

This command must go through all normal G# processing including the limiting of coordinates based on soft boundaries.

The diagram has the same symbols as the last one, with the change that the planner queued blocks are separate from the planned shape register. There is also drawn a dotted line in the planner block area showing the hypothetical motion shape that has not yet been realized as planner blocks.

<img src="../assets/batch_GCodeI%20Timing.png" alt="HID by GCodeI immediate timing" style="max-width: 800px; width: 100%; height: auto;">

The result of this processing creates a planner block, fully shaped, but NOT in the planner queue but rather as a register (buffered for thread safety only). From that shaped block, new small interval planner blocks are created and queued with shaping inherited from a slice of the planned shape register. In Marlin this is a alternative path to the shaped_loop() function named shape_immediate(). Shape_immediate() has the goal to always have the planner queue contain 3 blocks: The one the pulse generator is working with, the one the pulse generator will switch to, and the one shape_immediate() may be constructing, so time separated to avoid concurrency problems.

When the register block is shaped, it is done so relative to the end of the most recent planner block in the queue, overwriting the prior planned shape and picking up with the next block to be added. This makes the motion commands almost immediately interruptible, all without touching any of the code downstream in the pulse generation section.

This also has a built in safety mechanism. If no command is received in time, the Planned shape register always has a ramp to 0 at the end, stopping all motion.
