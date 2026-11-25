import "~/index.css";

import { expect, it, vi } from "vite-plus/test";

import { observeComposerPromptLayout } from "./observeComposerPromptLayout";

// The prompt and the + / mic / send group share one grid cell, as in ChatComposer.
function mountComposerBody(text: string) {
  const body = document.createElement("div");
  body.className = "composer-prompt-body";
  body.style.cssText = "display: grid; width: 360px; font: 14px/20px sans-serif";
  const field = document.createElement("div");
  field.dataset.composerEmpty = "false";
  field.style.gridArea = "prompt";
  const editor = document.createElement("div");
  editor.className = "composer-text";
  editor.dataset.testid = "composer-editor";
  const paragraph = document.createElement("p");
  paragraph.style.margin = "0";
  paragraph.textContent = text;
  editor.append(paragraph);
  field.append(editor);
  const actions = document.createElement("div");
  actions.dataset.chatComposerActions = "right";
  actions.style.cssText =
    "grid-area: prompt; justify-self: end; align-self: start; width: 96px; height: 32px";
  body.append(field, actions);
  document.body.append(body);
  const stop = observeComposerPromptLayout(body, (multiline) => {
    actions.style.alignSelf = multiline ? "end" : "start";
  });
  return {
    body,
    paragraph,
    actions,
    [Symbol.dispose]() {
      stop();
      body.remove();
    },
  };
}

function textOverlapsActions(paragraph: HTMLElement, actions: HTMLElement): boolean {
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  const box = actions.getBoundingClientRect();
  return Array.from(range.getClientRects()).some(
    (line) =>
      line.right > box.left + 0.5 &&
      line.left < box.right - 0.5 &&
      line.bottom > box.top + 0.5 &&
      line.top < box.bottom - 0.5,
  );
}

it("wraps one line of prompt text before the attach, mic and send buttons", async () => {
  using composer = mountComposerBody("word ".repeat(12));
  await vi.waitFor(() =>
    expect(composer.body.style.getPropertyValue("--composer-actions-width")).toBe("96px"),
  );
  expect(textOverlapsActions(composer.paragraph, composer.actions)).toBe(false);
});

it("keeps multiline prompt text clear of the buttons in the bottom corner", async () => {
  using composer = mountComposerBody("a long prompt that wraps ".repeat(10));
  await vi.waitFor(() => expect(composer.body.hasAttribute("data-composer-multiline")).toBe(true));
  await vi.waitFor(() =>
    expect(textOverlapsActions(composer.paragraph, composer.actions)).toBe(false),
  );
});
