import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { DuetOrbMark, DuetStatusOrb } from "./DuetStatusOrb";

function pixels(value: string): number {
  return Number.parseFloat(value);
}

it("draws the idle orb at the specified geometry without continuous animation", async () => {
  await using screen = await render(<DuetOrbMark size={40} state="idle" />);
  const disc = screen.container.querySelector("[data-duet-orb-disc]");
  const body = screen.container.querySelector("[data-duet-orb-body]");
  const wave = screen.container.querySelector("[data-duet-orb-wave]");
  expect(disc).not.toBeNull();
  expect(body).not.toBeNull();
  expect(wave).not.toBeNull();

  const discStyle = getComputedStyle(disc as Element);
  const bodyStyle = getComputedStyle(body as Element);
  const waveStyle = getComputedStyle(wave as Element);
  expect(pixels(discStyle.width)).toBe(40);
  expect(pixels(bodyStyle.width)).toBeCloseTo(17);
  expect(pixels(bodyStyle.left)).toBeCloseTo(12.5);
  expect(pixels(bodyStyle.top)).toBeCloseTo(13);
  expect(waveStyle.animationName).toBe("none");
  expect(bodyStyle.animationName).toBe("none");
  expect(waveStyle.willChange).toBe("auto");
});

it("animates only the wave and body while working", async () => {
  await using screen = await render(<DuetOrbMark size={40} state="working" />);
  const body = screen.container.querySelector("[data-duet-orb-body]");
  const wave = screen.container.querySelector("[data-duet-orb-wave]");
  expect(body).not.toBeNull();
  expect(wave).not.toBeNull();

  expect(getComputedStyle(wave as Element).animationName).toBe("duet-orb-roll");
  expect(getComputedStyle(body as Element).animationName).toBe("duet-orb-breathe");
  expect(getComputedStyle(wave as Element).willChange).toBe("transform");
  expect(getComputedStyle(body as Element).willChange).toBe("transform");
});

it("opens its status popover from the orb button", async () => {
  const threadRef = scopeThreadRef(EnvironmentId.make("environment"), ThreadId.make("thread"));
  await using screen = await render(<DuetStatusOrb threadRef={threadRef} />);
  await screen.getByRole("button", { name: "Status: Idle" }).click();

  await expect.element(page.getByRole("dialog")).toBeVisible();
  await expect.element(page.getByRole("dialog").getByText("Idle", { exact: true })).toBeVisible();
  await expect
    .element(page.getByRole("dialog").getByText("environment", { exact: true }))
    .toBeVisible();
  await expect
    .element(page.getByRole("dialog").getByText("Unknown", { exact: true }))
    .toBeVisible();
});
