import { useEffect, useState } from "react";
import { documentApi } from "../api/document.api";
import { loadDocumentObjectUrl } from "../utils/document-file";

interface LoadedFile {
  documentId: string;
  url: string | null;
  error: Error | null;
}

/**
 * Load a document's file through the authenticated API as an object URL
 * (for the in-app PDF viewer). The URL is revoked when the component unmounts
 * or the document changes; a response that arrives after that is discarded.
 *
 * The result is stored together with the document id it belongs to, so a
 * change of document shows "loading" at once without resetting state inside
 * the effect (ISS-051, react-hooks/set-state-in-effect).
 */
export const useDocumentFileUrl = (documentId: string | null | undefined) => {
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);

  useEffect(() => {
    if (!documentId) return;
    let cancelled = false;
    let revoke: (() => void) | null = null;

    loadDocumentObjectUrl(documentApi.getDocumentFile, documentId)
      .then((file) => {
        if (cancelled) {
          file.revoke();
          return;
        }
        revoke = file.revoke;
        setLoaded({ documentId, url: file.url, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoaded({
            documentId,
            url: null,
            error: err instanceof Error ? err : new Error("Could not load the document"),
          });
        }
      });

    return () => {
      cancelled = true;
      revoke?.();
    };
  }, [documentId]);

  const current = documentId && loaded?.documentId === documentId ? loaded : null;
  return {
    url: current?.url ?? null,
    error: current?.error ?? null,
    isLoading: Boolean(documentId) && !current,
  };
};
