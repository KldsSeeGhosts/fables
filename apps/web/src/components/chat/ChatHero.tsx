import type { ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { useDuetShell } from "../../hooks/useDuetShell";
import { CaptainAvatar } from "../captains/CaptainAvatar";
import { useCaptain } from "../captains/useCaptain";
import { Button } from "../ui/button";
import { Text } from "../ui/text";

/** "Good morning", "Good afternoon" or "Good evening" for the user's local time. */
export function useTimeOfDayGreeting() {
  const gt = useGT();
  const hour = new Date(`${useNowMinute()}Z`).getHours();
  return hour < 12 ? gt("Good morning") : hour < 18 ? gt("Good afternoon") : gt("Good evening");
}

/** The terracotta spark above an empty conversation. Static, so it never repaints. */
export function ChatHeroMark() {
  return (
    <svg
      aria-hidden="true"
      data-chat-hero-mark=""
      viewBox="0 0 32 32"
      className="size-9 shrink-0 text-primary"
      fill="currentColor"
    >
      {Array.from({ length: 12 }, (_, index) => (
        <rect
          key={index}
          x="15"
          y="2.5"
          width="2"
          height={index % 2 === 0 ? 11 : 8}
          rx="1"
          transform={`rotate(${index * 30} 16 16)`}
        />
      ))}
    </svg>
  );
}

interface ChatHeroStarter {
  readonly label: string;
  readonly prompt: string;
}

/** Starter prompts for an empty conversation; a Captain gets its own set. */
function useChatHeroStarters(captain: boolean): ReadonlyArray<ChatHeroStarter> {
  const gt = useGT();
  return captain
    ? [
        { label: gt("Prepare morning brief"), prompt: gt("Prepare my morning brief.") },
        {
          label: gt("Summarize in-flight tasks"),
          prompt: gt("Summarize the tasks you have in flight and what each one is waiting on."),
        },
        {
          label: gt("Check open PRs"),
          prompt: gt("Check my open pull requests and tell me which ones need my attention."),
        },
      ]
    : [
        {
          label: gt("Review uncommitted changes"),
          prompt: gt("Review my uncommitted changes and point out anything risky."),
        },
        {
          label: gt("Explain this codebase"),
          prompt: gt("Explain how this codebase is organized and where its main entry points are."),
        },
        {
          label: gt("Run checks & fix errors"),
          prompt: gt("Run the project's checks and fix any errors you find."),
        },
      ];
}

/** The greeting over an empty conversation: a Captain's name and role, or the time of day. */
export function ChatHeroGreeting({
  threadRef,
  projectTitle,
}: {
  threadRef: ScopedThreadRef | null;
  projectTitle: string | null;
}) {
  const gt = useGT();
  const greeting = useTimeOfDayGreeting();
  const captain = useCaptain(threadRef);
  const duet = useDuetShell();
  return (
    // Duet pulls the 24px lane padding in so the title sits 12px above the composer.
    <div
      data-chat-hero=""
      className="flex flex-col items-center gap-3 duet:-mb-3 duet:gap-1 text-center"
    >
      {duet ? (
        captain ? (
          <div className="mb-2">
            <CaptainAvatar avatar={captain.avatar} size="hero" state="idle" />
          </div>
        ) : null
      ) : captain ? (
        <CaptainAvatar avatar={captain.avatar} size="profile" state="idle" />
      ) : (
        <ChatHeroMark />
      )}
      <Text variant={duet ? "display" : "display-lg"} render={<h1 className="text-balance" />}>
        {captain ? captain.name : greeting}
      </Text>
      {captain?.role ? (
        <Text variant="body" tone="muted" render={<p className="max-w-md text-balance" />}>
          {captain.role}
        </Text>
      ) : projectTitle ? (
        <Text variant="body" tone="muted" render={<p className="text-balance" />}>
          {gt("What should we build in {project}?", { project: projectTitle })}
        </Text>
      ) : null}
    </div>
  );
}

/** Pills under the hero composer; a pick fills the composer with its prompt. */
export function ChatHeroStarters({
  captain,
  onPick,
}: {
  captain: boolean;
  onPick: (prompt: string) => void;
}) {
  const gt = useGT();
  const duet = useDuetShell();
  const starters = useChatHeroStarters(captain);
  return (
    <div
      role="group"
      aria-label={gt("Suggested prompts")}
      data-chat-hero-starters=""
      className="flex flex-wrap items-center justify-center gap-2"
    >
      {starters.map((starter) => (
        <Button
          key={starter.label}
          variant={duet ? "quiet-pill" : "pill"}
          {...(duet ? {} : { size: "sm-pill" })}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => onPick(starter.prompt)}
        >
          {starter.label}
        </Button>
      ))}
    </div>
  );
}
