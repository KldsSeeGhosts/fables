# Chorus

A Chorus is one fleet-wide Duet. It can read every Duet on this machine and on linked machines, answer questions across them, and route project work to the Duet that owns that project. It does not keep project state itself.

Create one from **Duets → New Duet → Chorus** on web or desktop, or from **New Chorus** above the Duets on mobile. Chorus always has no workspace scope, is coordinator-only, and uses the react report policy, so those controls are not shown. Its recap is scheduled after the other Duets' recaps and is written to its own `DIGEST.md`.

Only one active Chorus can exist in a fleet. Creating or restoring one checks every linked machine that answers. Simultaneous creates, or restoring while a machine is offline, can leave two active Choruses; archive all but one.

## Linked machines and trust

Link only machines you operate yourself. A linked machine is a full trusted operator: its operator can act as your Chorus there, read what the link exposes, and send work within the link's access. Routing to an existing remote Duet needs a full-access link.

A machine that is offline or runs an older server cannot answer fleet reads, so Chorus results and recaps are incomplete. Recaps label machines that did not respond. A confirmed remote route can also show unknown status while that machine is offline. Routed results do not wake Chorus; they appear as context on your next turn.

## What Chorus does not do

Chorus does not edit another Duet's documents, memory, profile, scope, or archive state. It does not steer or interrupt another Duet's threads. It starts a Solo only for work in a project no active Duet covers. Anything ongoing belongs in a Duet.
