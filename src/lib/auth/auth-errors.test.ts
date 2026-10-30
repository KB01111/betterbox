import { expect, test } from "bun:test";
import { authorizationErrorMessage } from "./auth-errors";
test("OAuth errors give safe actionable recovery", () => {
  expect(authorizationErrorMessage("access_denied")).toContain("cancelled");
  expect(authorizationErrorMessage("invalid_grant")).toContain("Reconnect");
  expect(authorizationErrorMessage("redirect_uri_mismatch")).toContain("callback");
  expect(authorizationErrorMessage("email_not_allowed")).toContain("access list");
  expect(authorizationErrorMessage("account_already_linked_to_different_user")).toContain("another BetterBox user");
  expect(authorizationErrorMessage("<script>private upstream error</script>")).not.toContain("script");
});
