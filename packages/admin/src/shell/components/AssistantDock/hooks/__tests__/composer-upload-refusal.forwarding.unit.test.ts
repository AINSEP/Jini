// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { withSizeRefusalCopy } from "../composer-files.hooks.js";

it("preserves options, omitted options and the first oversize refusal", async () => {
  const uploader = vi.fn(async () => []);
  const t = (key: string) => key;
  const describeRefusal = vi.fn(({ limitBytes, fileBytes }: { limitBytes: number; fileBytes: number }) => `${fileBytes}/${limitBytes}`);
  const wrapped = withSizeRefusalCopy({ uploader, t, limitForFile: () => 2, describeRefusal });
  const files = [new File(["a"], "a.txt")];
  const options = { batchId: "message", signal: new AbortController().signal };
  await wrapped(files, options);
  await wrapped(files);
  expect(uploader.mock.calls).toEqual([[files, options], [files]]);
  await expect(wrapped([new File(["123"], "first"), new File(["1234"], "second")], options)).rejects.toThrow("3/2");
  expect(describeRefusal).toHaveBeenCalledExactlyOnceWith({ t, limitBytes: 2, fileBytes: 3 });
  expect(uploader).toHaveBeenCalledTimes(2);
});
