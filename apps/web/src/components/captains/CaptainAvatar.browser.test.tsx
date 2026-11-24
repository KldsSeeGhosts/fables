import { CaptainAvatar } from "./CaptainAvatar";
import { expect, it } from "vite-plus/test";
import { render } from "../../../test/render";

it("renders a geometric Duet emblem without continuous animation", async () => {
  await using screen = await render(
    <CaptainAvatar avatar={{ preset: "drop", color: "purple" }} state="working" />,
  );
  const avatar = screen.container.querySelector("[data-captain-avatar]");

  expect(avatar?.getAttribute("data-captain-state")).toBe("working");
  expect(avatar?.getAttribute("data-duet-palette")).toBe("plum");
  expect(avatar?.querySelector("[data-captain-emblem]")?.getAttribute("data-captain-emblem")).toBe(
    "heart-wave",
  );
  expect(avatar?.querySelector("animate")).toBeNull();
  expect(avatar?.querySelector("[data-captain-avatar-orbit]")).toBeNull();
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

it("renders the hero size as a bare 28px emblem without a tile", async () => {
  await using screen = await render(
    <CaptainAvatar avatar={{ preset: "triangle", color: "blue" }} size="hero" />,
  );
  const avatar = screen.container.querySelector<HTMLElement>("[data-captain-avatar]");

  expect(avatar?.classList.contains("size-7")).toBe(true);
  expect(avatar?.querySelector("svg")?.classList.contains("size-7")).toBe(true);
  expect(avatar?.className).not.toContain("rounded");
  expect(avatar?.style.backgroundColor).toBe("");
});
