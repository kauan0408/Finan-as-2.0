declare module "*.jsx" {
  const Component: any;
  export default Component;
}

declare module "*.css";

declare module "*.svg" {
  const src: string;
  export default src;
}

declare module "*.png" {
  const src: string;
  export default src;
}
