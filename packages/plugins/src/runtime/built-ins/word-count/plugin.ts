import type { PluginSdkBinding } from "../../../host/ports.js";
import { countWords } from "./count-words.js";

/** The executable half of the bundled artifact. Registration occurs only inside `setup()` so the
 * end-to-end enable test proves `loadPlugin()` reached BR-01 step (4), not merely that the module
 * happened to be statically imported by the server bundle. */
export function createWordCountPlugin({ definePlugin, beforeSaveHook }: Pick<PluginSdkBinding, "definePlugin" | "beforeSaveHook">, _optional = {}): ReturnType<PluginSdkBinding["definePlugin"]> {
  return definePlugin({
  setup(sdk) {
    sdk.addFilter(beforeSaveHook, async (entry) => ({ count: countWords({ bodyJson: "bodyJson" in entry ? entry.bodyJson : undefined }) }));
  },
});

}
