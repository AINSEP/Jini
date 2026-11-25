import { expect, test, vi } from "vitest";
import { takePublishCriteriaFromQuery } from "../publish-criteria-deep-link.js";

test("absent queries do nothing and present invalid queries are consumed once", () => {
  const history = { replaceState: vi.fn() };
  const decode = vi.fn(() => null);
  const location = { search: "?other=1", pathname: "/admin", hash: "#fragment" };
  expect(takePublishCriteriaFromQuery({ location, history, parameter: "publish", decode })).toBeNull();
  expect(history.replaceState).not.toHaveBeenCalled();
  expect(decode).not.toHaveBeenCalled();
  expect(takePublishCriteriaFromQuery({ location: { ...location, search: "?other=1&publish=invalid&last=2" }, history, parameter: "publish", decode })).toBeNull();
  expect(history.replaceState).toHaveBeenCalledExactlyOnceWith(null, "", "/admin?other=1&last=2#fragment");
  expect(decode).toHaveBeenCalledExactlyOnceWith({ raw: "invalid" }, {});
});
