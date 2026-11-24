import { CaptainAvatar } from "./CaptainAvatar";
import { expect, it } from "vite-plus/test";
import { render } from "../../../test/render";

it("runs the working morph and orbit continuously", async () => {
  await using screen = await render(
    <CaptainAvatar avatar={{ preset: "drop", color: "purple" }} state="working" />,
  );
  const avatar = screen.container.querySelector("[data-captain-avatar]");

  expect(avatar?.getAttribute("data-captain-state")).toBe("working");
  expect(avatar?.querySelector("animate[attributeName='d']")?.getAttribute("repeatCount")).toBe(
    "indefinite",
  );
  expect(avatar?.querySelectorAll("[data-captain-avatar-orbit]")).toHaveLength(2);
});
