import type { AlloyPluginOptions } from "./plugins/consumer-plugin";
import { createWebpackLikeAlloyPlugin } from "./plugins/webpack-like-plugin";

export type { AlloyPluginOptions } from "./plugins/consumer-plugin";

export function alloy(options: AlloyPluginOptions = {}) {
  return createWebpackLikeAlloyPlugin(options, {
    name: "alloy-di-rspack",
    cacheFileName: "rspack-virtual-container.js",
  });
}

export default alloy;
