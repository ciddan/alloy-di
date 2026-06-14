import path from "node:path";
import { fileURLToPath } from "node:url";
import rspack from "@rspack/core";
import alloy from "alloy-di/rspack";
import { alloyOptions } from "./alloy-options.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const sharedAppRoot = path.resolve(root, "../app-vite");

export default {
  context: root,
  devtool: "source-map",
  entry: path.resolve(sharedAppRoot, "src/main.tsx"),
  mode: "development",
  output: {
    clean: true,
    filename: "assets/[name].js",
    path: path.resolve(root, "dist-rspack"),
    publicPath: "auto",
  },
  resolve: {
    extensions: [".tsx", ".ts", ".jsx", ".js"],
  },
  module: {
    rules: [
      {
        test: /\.m?js$/,
        resolve: {
          fullySpecified: false,
        },
      },
      {
        test: /\.[cm]?[jt]sx?$/,
        include: [path.resolve(sharedAppRoot, "src")],
        loader: "builtin:swc-loader",
        options: {
          jsc: {
            parser: {
              syntax: "typescript",
              tsx: true,
              decorators: true,
            },
            transform: {
              react: { runtime: "automatic" },
            },
          },
        },
        type: "javascript/auto",
      },
      {
        test: /\.module\.scss$/,
        use: [
          "style-loader",
          {
            loader: "css-loader",
            options: {
              esModule: true,
              modules: {
                namedExport: false,
                localIdentName: "[local]__[hash:base64:5]",
              },
            },
          },
          "sass-loader",
        ],
        type: "javascript/auto",
      },
      {
        test: /\.scss$/,
        exclude: /\.module\.scss$/,
        use: ["style-loader", "css-loader", "sass-loader"],
        type: "javascript/auto",
      },
      {
        test: /\.svg$/,
        type: "asset/resource",
      },
    ],
  },
  plugins: [
    alloy(alloyOptions),
    new rspack.DefinePlugin({
      __ALLOY_EXAMPLE_TARGET__: JSON.stringify("Rspack"),
    }),
    new rspack.HtmlRspackPlugin({
      template: path.resolve(root, "index.html"),
    }),
  ],
};
