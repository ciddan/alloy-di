declare const __ALLOY_EXAMPLE_TARGET__: string;

declare module "*.module.scss" {
  const classes: Record<string, string>;
  export default classes;
}

declare module "*.scss";

declare module "*.svg" {
  const url: string;
  export default url;
}
