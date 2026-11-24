import type { Plugin } from "vite";

/*
 * Content-Security-Policy for the built SPA (SEC-008).
 *
 * - Injected as a <meta> tag at BUILD time only: the dev server's
 *   React-refresh preamble is an inline script that a strict policy blocks.
 * - `vite preview` sends the same policy as a header, plus
 *   `frame-ancestors 'none'` (a meta tag cannot carry that directive).
 *   A production static host should send that header too.
 * - connect-src: the app itself, the API origin (resolved exactly like
 *   src/api/axios.ts resolves VITE_API_URL; a relative URL is same-origin),
 *   and blob: -- the PDF viewer loads documents as object URLs.
 * - script-src / worker-src are same-origin only: the pdf.js worker is
 *   bundled into /assets (ISS-050; it used to come from a CDN). blob: stays
 *   in worker-src for pdf.js. No 'unsafe-inline' or 'unsafe-eval' for scripts.
 * - style-src needs 'unsafe-inline': KaTeX and UI components set inline
 *   styles.
 */

/** Same default as src/api/axios.ts. */
const DEFAULT_API_URL = "http://localhost:5000/api";

/** The API origin to allow, or null when the API is same-origin. */
export const apiOriginFor = (apiUrl: string | undefined): string | null => {
  const value = (apiUrl || DEFAULT_API_URL).trim();
  if (!/^https?:\/\//i.test(value)) return null; // relative: same origin
  return new URL(value).origin;
};

export const buildClientCsp = (apiUrl: string | undefined): string => {
  const apiOrigin = apiOriginFor(apiUrl);
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'"]],
    ["worker-src", ["'self'", "blob:"]],
    ["connect-src", ["'self'", "blob:", ...(apiOrigin ? [apiOrigin] : [])]],
    ["img-src", ["'self'", "data:", "blob:", "https:"]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["font-src", ["'self'", "data:"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
};

/** Vite plugin: CSP meta tag in production builds only (never in dev). */
export const cspMetaPlugin = (apiUrl: string | undefined): Plugin => {
  const policy = buildClientCsp(apiUrl);
  return {
    name: "researchmind-csp",
    apply: "build",
    transformIndexHtml(html: string) {
      return html.replace(
        /<head>/i,
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`
      );
    },
  };
};

/**
 * Vite plugin: the CSP as a response header, plus `frame-ancestors 'none'`,
 * in `vite preview`. It must NOT be build-only: Vite drops `apply: "build"`
 * plugins for the preview command, so the hook would never run (Wave 4 review
 * L2). It only implements configurePreviewServer, so `vite build` output and
 * the dev server (`vite`) are unaffected.
 */
export const cspPreviewHeaderPlugin = (apiUrl: string | undefined): Plugin => {
  const header = `${buildClientCsp(apiUrl)}; frame-ancestors 'none'`;
  return {
    name: "researchmind-csp-preview",
    configurePreviewServer(server) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader("Content-Security-Policy", header);
        next();
      });
    },
  };
};

/** Both CSP plugins, for vite.config.ts. */
export const cspPlugins = (apiUrl: string | undefined): Plugin[] => [
  cspMetaPlugin(apiUrl),
  cspPreviewHeaderPlugin(apiUrl),
];
