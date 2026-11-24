/**
 * Document files are private (SEC-005): the API never returns a storage URL.
 * The browser fetches the bytes from GET /api/documents/:id/file through the
 * authenticated axios client (so expired access tokens are refreshed as for
 * any other request; the token is never put in a URL) and shows or saves them
 * through a short-lived object URL that is always revoked.
 *
 * Framework-free so it can be unit-tested; the browser APIs are injectable.
 */

export interface ObjectUrlApi {
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
}

const browserUrlApi = (): ObjectUrlApi => ({
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
});

export type DocumentFileFetcher = (documentId: string) => Promise<Blob>;

/** Fetch a document's file and wrap it in an object URL; call `revoke` when done. */
export const loadDocumentObjectUrl = async (
  fetchFile: DocumentFileFetcher,
  documentId: string,
  urlApi: ObjectUrlApi = browserUrlApi()
): Promise<{ url: string; revoke: () => void }> => {
  const blob = await fetchFile(documentId);
  const url = urlApi.createObjectURL(blob);
  let revoked = false;
  return {
    url,
    revoke: () => {
      if (revoked) return;
      revoked = true;
      urlApi.revokeObjectURL(url);
    },
  };
};

export interface DownloadDom {
  createAnchor: () => { href: string; download: string; rel: string; click: () => void; remove: () => void };
  append: (anchor: unknown) => void;
  /** Revoke after the browser has started the download. */
  later: (fn: () => void) => void;
}

const browserDom = (): DownloadDom => ({
  createAnchor: () => document.createElement("a"),
  append: (anchor) => document.body.appendChild(anchor as Node),
  later: (fn) => window.setTimeout(fn, 60_000),
});

/** Fetch a document's file and save it under its original name. */
export const downloadDocumentFile = async (
  fetchFile: DocumentFileFetcher,
  documentId: string,
  fileName: string,
  urlApi: ObjectUrlApi = browserUrlApi(),
  dom: DownloadDom = browserDom()
): Promise<void> => {
  const { url, revoke } = await loadDocumentObjectUrl(fetchFile, documentId, urlApi);
  const anchor = dom.createAnchor();
  anchor.href = url;
  anchor.download = fileName || "document";
  anchor.rel = "noopener";
  dom.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    dom.later(revoke);
  }
};
