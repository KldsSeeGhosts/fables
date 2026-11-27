import { expect, it } from "vite-plus/test";

import { derivePendingUserInputMaxHeight } from "./pendingUserInputLayout";

it("keeps the question below the header and orb when the keyboard leaves a short viewport", () => {
  expect(
    derivePendingUserInputMaxHeight({
      windowHeight: 466,
      keyboardHeight: 238,
      topInset: 146,
      composerOverlapHeight: 18,
    }),
  ).toBe(52);
});
