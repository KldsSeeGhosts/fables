import { CaptainAvatar } from "./CaptainAvatar";
import { expect, it } from "vite-plus/test";
import { render } from "../../../test/render";

it("draws the emblem's mascot in its palette with eyes on their own layer", async () => {
  await using screen = await render(
    <CaptainAvatar avatar={{ preset: "drop", color: "purple" }} state="working" />,
  );
  const avatar = screen.container.querySelector("[data-captain-avatar]");

  expect(avatar?.getAttribute("data-captain-state")).toBe("working");
  expect(avatar?.getAttribute("data-duet-palette")).toBe("plum");
  expect(avatar?.querySelector("[data-captain-emblem]")?.getAttribute("data-captain-emblem")).toBe(
    "heart-wave",
  );
  const eyes = avatar?.querySelector("[data-captain-mascot-eyes]");
  expect(eyes?.tagName).toBe("SPAN");
  expect(eyes?.querySelectorAll("rect")).toHaveLength(2);
  expect(avatar?.querySelector("animate")).toBeNull();
});

it("moves only by transform, and not at all under reduced motion", async () => {
  await using screen = await render(
    <CaptainAvatar avatar={{ preset: "circle", color: "blue" }} state="working" />,
  );
  const body = screen.container.querySelector<HTMLElement>("[data-captain-mascot-body]")!;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  expect(getComputedStyle(body).animationName).toBe(reduced ? "none" : "captain-mascot-work");
  const keyframes = [...document.styleSheets]
    .flatMap((sheet) => [...sheet.cssRules])
    .filter(
      (rule): rule is CSSKeyframesRule =>
        rule instanceof CSSKeyframesRule && rule.name.startsWith("captain-mascot-"),
    );
  expect(keyframes.length).toBeGreaterThan(0);
  for (const rule of keyframes) {
    for (const frame of rule.cssRules) {
      const style = (frame as CSSKeyframeRule).style;
      for (const property of style) expect(["transform", "opacity"]).toContain(property);
    }
  }
});

it("uses the one-shot mount animation only when requested", async () => {
  await using screen = await render(
    <CaptainAvatar avatar={{ preset: "triangle", color: "blue" }} animateOnMount />,
  );
  const avatar = screen.container.querySelector("[data-captain-avatar]");

  expect(avatar?.getAttribute("data-captain-animate-on-mount")).toBe("true");
  expect(avatar?.querySelector("[data-captain-emblem]")?.getAttribute("data-captain-emblem")).toBe(
    "prism",
  );
});

it("renders the hero size as a bare 28px mascot without a tile", async () => {
  await using screen = await render(
    <CaptainAvatar avatar={{ preset: "triangle", color: "blue" }} size="hero" />,
  );
  const avatar = screen.container.querySelector<HTMLElement>("[data-captain-avatar]");

  expect(avatar?.classList.contains("size-7")).toBe(true);
  expect(avatar?.querySelector("[data-captain-mascot-body]")?.classList.contains("size-7")).toBe(
    true,
  );
  expect(avatar?.className).not.toContain("rounded");
  expect(avatar?.style.backgroundColor).toBe("");
});

it("rings only a tile that needs attention", async () => {
  await using screen = await render(
    <>
      <CaptainAvatar avatar={{ preset: "drop", color: "purple" }} size="channel" attention />
      <CaptainAvatar avatar={{ preset: "drop", color: "purple" }} attention />
    </>,
  );
  const [tile, row] = screen.container.querySelectorAll("[data-captain-avatar]");

  expect(tile?.querySelector("[data-captain-avatar-ring]")).not.toBeNull();
  expect(tile?.hasAttribute("data-captain-tile")).toBe(true);
  expect(tile?.classList.contains("size-6")).toBe(true);
  expect(row?.querySelector("[data-captain-avatar-ring]")).toBeNull();
});
