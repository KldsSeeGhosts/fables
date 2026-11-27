# Chorus

A Chorus is a Duet for all your linked machines. Ask it what's happening across your Duets or ask it to route work to the Duet that owns a project. It can start a Solo for a one-off in a project no Duet covers. If that project comes up again, Chorus suggests giving it to a Duet. Keep ongoing project state in the Duet that owns the work.

## Create, archive, or restore a Chorus

On web or desktop, open **Duets**, choose **New Duet**, and select **Chorus**. On mobile, choose **New Chorus** above your Duets. Choose an up-to-date machine to host it. The active Chorus appears above the other Duets when your app is connected to its host.

On web or desktop, use **Archive** or **Restore** in the Chorus row's menu. On mobile, open **Brief** in the Chorus conversation to archive it. Tap the archived Chorus row to open its Brief and restore it. Archiving removes the pinned row. Restoring pins it again.

A fleet is meant to have one active Chorus. Fables checks the machines that respond when you create or restore one. Simultaneous creates, or a restore while another machine is offline, can leave two active Choruses. If you see the duplicate warning, archive all but the one you want to keep.

## Linked machines and trust

Link only your own machines. Linking a machine grants it full operator trust. The link's access level determines what it can do. Routing work to an existing Duet on another machine requires a full-access link.

A linked machine can miss a fleet read while it is offline or running an older version. In that case, Chorus answers and recaps can be incomplete. The Chorus recap lists machines that did not respond. When you enable scheduled recaps, the suggested time for Chorus is 15 minutes after the suggested time for other Duets.

A confirmed route can show an unknown status while its machine is offline. Routed work finishing does not wake Chorus. It gets route updates on your next user turn. Its own Solos can wake it when they finish.
