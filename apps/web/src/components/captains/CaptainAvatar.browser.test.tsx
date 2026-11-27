import { CaptainAvatar } from "./CaptainAvatar";
import { expect, it } from "vite-plus/test";
import { render } from "../../../test/render";

it("draws the emblem's creature in its palette with the line on its own layer", async () => {
  await using screen = await render(
    <CaptainAvatar avatar={{ preset: "drop", color: "purple" }} state="working" />,
  );
  const avatar = screen.container.querySelector("[data-captain-avatar]");

  expect(avatar?.getAttribute("data-captain-state")).toBe("working");
  expect(avatar?.getAttribute("data-duet-palette")).toBe("plum");
  expect(
    avatar?.querySelector("[data-captain-creature]")?.getAttribute("data-captain-creature"),
  ).toBe("heart-wave");
  expect(avatar?.querySelector("[data-captain-creature-body] path")?.getAttribute("fill")).toBe(
    "#7e4fae",
  );
  const line = avatar?.querySelector("[data-captain-creature-line-window]");
  expect(line?.tagName).toBe("SPAN");
  expect(line?.querySelector("[data-captain-creature-line]")).not.toBeNull();
  expect(avatar?.querySelector("[data-captain-mascot-eyes]")).toBeNull();
  expect(avatar?.querySelector("animate")).toBeNull();
});

it("moves only by transform, and not at all under reduced motion", async () => {
  await using screen = await render(
    <CaptainAvatar avatar={{ preset: "circle", color: "blue" }} state="working" />,
  );
  const line = screen.container.querySelector<SVGElement>("[data-captain-creature-line]")!;
  const body = screen.container.querySelector<HTMLElement>("[data-captain-creature-body]")!;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  expect(getComputedStyle(line).animationName).toBe(reduced ? "none" : "captain-creature-roll");
  expect(getComputedStyle(body).animationName).toBe(reduced ? "none" : "captain-creature-breathe");
  if (!reduced) {
    expect(getComputedStyle(line).animationDuration).toBe("1.8s");
    expect(getComputedStyle(body).animationDuration).toBe("2.4s");
  }
  const keyframes = [...document.styleSheets]
    .flatMap((sheet) => [...sheet.cssRules])
    .filter(
      (rule): rule is CSSKeyframesRule =>
        rule instanceof CSSKeyframesRule &&
        (rule.name.startsWith("captain-creature-") || rule.name.startsWith("captain-avatar-")),
    );
  expect(keyframes.length).toBeGreaterThan(0);
  for (const rule of keyframes) {
    for (const frame of rule.cssRules) {
      const style = (frame as CSSKeyframeRule).style;
      for (const property of style) expect(["transform", "opacity"]).toContain(property);
    }
  }
});

it.each([
  ["reading", "working", "[data-captain-creature-line]", "captain-creature-scan", "2.2s"],
  ["editing", "working", "[data-captain-creature-line]", "captain-creature-scribble", "1.1s"],
  ["writing", "working", "[data-captain-creature-line]", "captain-creature-scribble", "1.4s"],
  ["command", "working", "[data-captain-creature-body]", "captain-creature-command-bounce", "1.1s"],
  ["searching", "working", "[data-captain-creature-body]", "captain-creature-look", "2.4s"],
  ["browsing", "working", "[data-captain-creature-body]", "captain-creature-sway", "3.2s"],
  ["thinking", "working", "[data-captain-creature-body]", "captain-creature-breathe", "3.2s"],
  ["delegating", "working", "[data-captain-creature-body]", "captain-creature-handoff", "1.8s"],
  ["waiting", "waiting", "[data-captain-creature]", "captain-creature-attention", "1.6s"],
] as const)("gives %s its own motion", async (activity, state, selector, name, duration) => {
  await using screen = await render(
    <CaptainAvatar
      avatar={{ preset: "circle", color: "blue" }}
      state={state}
      activity={activity}
    />,
  );
  const layer = screen.container.querySelector<HTMLElement>(selector)!;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  expect(getComputedStyle(layer).animationName).toBe(reduced ? "none" : name);
  if (!reduced) expect(getComputedStyle(layer).animationDuration).toBe(duration);
});

it("asks for attention once instead of looping while waiting", async () => {
  await using screen = await render(
    <CaptainAvatar avatar={{ preset: "circle", color: "blue" }} state="waiting" />,
  );
  const creature = screen.container.querySelector<HTMLElement>("[data-captain-creature]")!;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  expect(getComputedStyle(creature).animationName).toBe("captain-creature-attention");
  expect(getComputedStyle(creature).animationIterationCount).toBe("1");
});

it("draws the light line inside black chrome on a light page", async () => {
  await using screen = await render(
    <div className="black-chrome">
      <CaptainAvatar avatar={{ preset: "circle", color: "blue" }} />
      <div data-chrome-scope="">
        <CaptainAvatar avatar={{ preset: "circle", color: "blue" }} />
      </div>
    </div>,
  );
  const [lightLine, darkLine] = screen.container.querySelectorAll<SVGPathElement>(
    "[data-captain-creature-line] path",
  );
  expect(getComputedStyle(lightLine!).stroke).toBe("rgb(20, 20, 19)");
  expect(getComputedStyle(darkLine!).stroke).toBe("rgb(236, 236, 236)");
});

it("plays one completion hop only while celebrate is set", async () => {
  await using screen = await render(
    <CaptainAvatar avatar={{ preset: "circle", color: "blue" }} state="idle" celebrate />,
  );
  const creature = screen.container.querySelector<HTMLElement>("[data-captain-creature]")!;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  expect(getComputedStyle(creature).animationName).toBe(
    reduced ? "none" : "captain-creature-celebrate",
  );
});

it("stays still while idle", async () => {
  await using screen = await render(
    <CaptainAvatar avatar={{ preset: "circle", color: "blue" }} state="idle" />,
  );
  const line = screen.container.querySelector<SVGElement>("[data-captain-creature-line]")!;
  const body = screen.container.querySelector<HTMLElement>("[data-captain-creature-body]")!;

  expect(getComputedStyle(line).animationName).toBe("none");
  expect(getComputedStyle(body).animationName).toBe("none");
  expect(getComputedStyle(body).willChange).toBe("auto");
});

it("uses the one-shot mount animation only when requested", async () => {
  await using screen = await render(
    <CaptainAvatar avatar={{ preset: "triangle", color: "blue" }} animateOnMount />,
  );
  const avatar = screen.container.querySelector("[data-captain-avatar]");

  expect(avatar?.getAttribute("data-captain-animate-on-mount")).toBe("true");
  expect(
    avatar?.querySelector("[data-captain-creature]")?.getAttribute("data-captain-creature"),
  ).toBe("prism");
});

it("sits the header orb on the Duet disc and draws sidebar rows bare", async () => {
  await using screen = await render(
    <>
      <CaptainAvatar avatar={{ preset: "triangle", color: "blue" }} size="orb" />
      <CaptainAvatar avatar={{ preset: "triangle", color: "blue" }} size="channel" />
    </>,
  );
  const [orb, channel] = screen.container.querySelectorAll<HTMLElement>("[data-captain-avatar]");

  expect(orb?.hasAttribute("data-captain-disc")).toBe(true);
  expect(orb?.querySelector("[data-captain-creature-stage]")).not.toBeNull();
  expect(getComputedStyle(orb!).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(channel?.hasAttribute("data-captain-disc")).toBe(false);
  expect(getComputedStyle(channel!).backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(getComputedStyle(channel!).boxShadow).toBe("none");
});
