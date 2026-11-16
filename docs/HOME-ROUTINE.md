# Home Routine

This ESP32 extension is separate from the stove’s native weekly schedule. Set daytime Comfort hours/temperature, a frost-only night break or lower night target, and frost temperature. The module stores the plan locally and runs it with the phone closed. Calendar: Europe/Ljubljana including daylight saving changes.

The main screen retains Comfort, Manual and Schedule. Manual power can last until the next routine transition. Native Schedule requires confirmed disabling of Home Routine and does not itself turn on an off stove.

**Manual off** persistently pauses automatic starts. Saving settings, reopening or rebooting does not clear it. Explicitly enable heating to resume. Automatic night shutdown is a separate state, allowing the morning start.

**Away** requires a confirmed normal shutdown before saving. Set a return date or leave it unknown. On that date at the daytime start, a supported module rechecks the plan online and requests the normal Comfort transition. The evening reminder is optional: extending the date replaces the trigger, and removing it leaves heating paused. A later manual off/resume command cancels the pending return.

Invalid clock, disabled plan, stale date, faults, missing room sensor, wood burning and active native frost prevent a pellet start. An uncertain start is not blindly retried. A previously armed return may recover during the same daytime window after a brief outage. A whole missed day, or a newly received date already past its morning boundary, does not cause a surprise late start.

A matching physical control echo confirms the transition. An approved connected client reconciles presence transactionally without another heating command, preserving a concurrent new date. Control confirmation remains separate from flame confirmation.

The policy is tested in simulation for persistence, postponement, manual cancellation, faults and clock changes. A real future return boundary has not yet been observed in this community release.
