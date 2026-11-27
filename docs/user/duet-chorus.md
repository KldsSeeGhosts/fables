# Chorus

Chorus is the fleet-wide coordinator for your linked machines. Ask it what's happening across your Duets or ask it to route work to the Duet that owns a project. It can start a Solo for a one-off in a project no Duet covers. If that project comes up again, Chorus suggests giving it to a Duet. Keep ongoing project state in the Duet that owns the work.

## Choose the Chorus home

One machine owns Chorus. Turn on **Chorus home** in **Settings → Labs** on that machine. Pick an always-on machine that you keep up to date. Fables creates Chorus there automatically and uses the same row again after restarts. You never create Chorus by hand.

The pinned Chorus row appears above your Duets in web, desktop, and mobile apps connected to any machine new enough to understand the fleet row. It has no machine label. Opening it from another machine reads it through the existing linked thread relay.

If the home machine is offline, the pinned row says so. If it runs an older server that does not understand the fleet row, the row says the home machine needs an update. If no machine is a home, the row asks you to choose one in Settings. If two machines claim the role, Settings shows a warning. Turn **Chorus home** off on all but one machine.

Turning **Chorus home** off archives that machine's Chorus row. There is no separate archive or restore control for Chorus. If a machine already has an older manually created Chorus, turning the setting on there keeps that row when it is active; otherwise the machine creates or restores its fleet row automatically. Machines without the home role archive their local Chorus rows so the fleet keeps one visible owner.

## Linked machines and trust

Link only your own machines. Linking a machine grants it full operator trust. The link's access level determines what it can do. Routing work to an existing Duet on another machine requires a full-access link.

A linked machine can miss a fleet read while it is offline or running an older version. In that case, Chorus answers and recaps can be incomplete. The Chorus recap lists machines that did not respond. When you enable scheduled recaps, the suggested time for Chorus is 15 minutes after the suggested time for other Duets.

A confirmed route can show an unknown status while its machine is offline. Routed work finishing does not wake Chorus. It gets route updates on your next user turn. Its own Solos can wake it when they finish.
