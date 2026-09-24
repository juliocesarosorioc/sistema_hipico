/** Declaraciones de tipos para pdfjs-dist (build legacy) usado en la SPA. */

declare module "pdfjs-dist/legacy/build/pdf" {
  const pdfjs: unknown;
  export default pdfjs;
}

declare module "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url" {
  const src: string;
  export default src;
}