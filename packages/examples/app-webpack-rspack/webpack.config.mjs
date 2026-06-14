import path from "node:path";
import { fileURLToPath } from "node:url";
import HtmlWebpackPlugin from "html-webpack-plugin";
import webpack from "webpack";
import alloy from "alloy-di/webpack";
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
    path: path.resolve(root, "dist-webpack"),
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
        use: {
          loader: "swc-loader",
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
        },
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
      },
      {
        test: /\.scss$/,
        exclude: /\.module\.scss$/,
        use: ["style-loader", "css-loader", "sass-loader"],
      },
      {
        test: /\.svg$/,
        type: "asset/resource",
      },
    ],
  },
  plugins: [
    alloy(alloyOptions),
    new webpack.DefinePlugin({
      __ALLOY_EXAMPLE_TARGET__: JSON.stringify("webpack"),
    }),
    new HtmlWebpackPlugin({
      template: path.resolve(root, "index.html"),
    }),
  ],
};
