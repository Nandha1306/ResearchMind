import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { cspPlugins } from "./csp";
import { reactPdfPdfjsDir } from "./pdf-worker";

export default defineConfig(({ mode }) => {
  // The CSP's connect-src must name the API origin the client will call (SEC-008).
  const env = loadEnv(mode, __dirname, "VITE_");
  return {
    // CSP: meta tag in builds, response header in `vite preview` (SEC-008).
    plugins: [react(), tailwindcss(), ...cspPlugins(env.VITE_API_URL)],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        // ISS-050: the self-hosted pdf.js worker must be react-pdf's exact
        // pdfjs-dist, whatever copy hoisting would otherwise resolve.
        "pdfjs-dist": reactPdfPdfjsDir(),
      },
    },
  };
});
