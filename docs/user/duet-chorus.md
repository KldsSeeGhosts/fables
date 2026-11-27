# Chorus

Chorus is the fleet-wide coordinator for your linked machines. Ask it what's happening across your Duets or ask it to route work to the Duet that owns a project. It can start a Solo for a one-off in a project no Duet covers. If that project comes up again, Chorus suggests giving it to a Duet. Keep ongoing project state in the Duet that owns the work.

## Choose the Chorus home

One machine owns Chorus. In **Settings → Labs**, select the machine you want to host it and turn on **Chorus home**. Pick an always-on machine that you keep up to date. Fables creates Chorus there automatically and uses the same conversation after restarts. The row shows that setup is in progress while it waits for a model.

The pinned Chorus row appears above your Duets in web, desktop, and mobile apps. The app can connect to the home or to an updated machine that has a link to the home. Opening from another machine uses the linked thread relay to read the conversation. Connect to the home to send Chorus a message.

If a known home machine is offline or needs a server update, the pinned row says so. If the connected machine doesn't know a home, the row asks you to choose one in Settings. If two machines claim the role, Settings shows a warning. Turn **Chorus home** off on all but one machine. Use **Refresh** next to the home setting to recheck linked machines after a home change, outage, or update.

Turning **Chorus home** off archives that machine's Chorus and keeps its history. The pinned row follows the remaining home or asks you to choose one. The home adopts its existing active Chorus, or restores its most recently archived Chorus if it has one. Other machines archive their old local Choruses.

## Linked machines and trust

Link only your own machines. Linking a machine grants it full operator trust. The link's access level determines what it can do. Routing work to an existing Duet on another machine requires a full-access link.

A linked machine can miss a fleet read while it is offline or running an older version. In that case, Chorus answers and recaps can be incomplete. The Chorus recap lists machines that did not respond. When you enable scheduled recaps, the suggested time for Chorus is 15 minutes after the suggested time for other Duets.

A confirmed route can show an unknown status while its machine is offline. Routed work finishing does not wake Chorus. It gets route updates on your next user turn. Its own Solos can wake it when they finish.
