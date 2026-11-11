import React, { useState, useRef } from "react";
import { X, Upload, FileText, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "../ui/button";
import { formatFileSize } from "../../utils/fileUtils";

interface UploadDocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpload: (file: File) => Promise<void>;
  isUploading: boolean;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB in bytes
const ALLOWED_EXTENSIONS = ["pdf", "docx"];

export const UploadDocumentModal: React.FC<UploadDocumentModalProps> = ({
  isOpen,
  onClose,
  onUpload,
  isUploading,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !isUploading) {
        setSelectedFile(null);
        setErrorMsg(null);
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isUploading, onClose]);

  if (!isOpen) return null;

  const validateFile = (file: File): boolean => {
    setErrorMsg(null);
    const ext = file.name.split(".").pop()?.toLowerCase();

    if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
      setErrorMsg("Only PDF and DOCX files are supported.");
      return false;
    }

    if (file.size > MAX_FILE_SIZE) {
      setErrorMsg("File size must be 10 MB or smaller.");
      return false;
    }

    return true;
  };

  const handleFileSelect = (file: File) => {
    if (validateFile(file)) {
      setSelectedFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelect(e.target.files[0]);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || isUploading) return;

    try {
      await onUpload(selectedFile);
      setSelectedFile(null);
      setErrorMsg(null);
      onClose();
    } catch (err: any) {
      const message =
        err.response?.data?.message || err.message || "Failed to upload document.";
      setErrorMsg(message);
    }
  };

  const handleModalClose = () => {
    if (!isUploading) {
      setSelectedFile(null);
      setErrorMsg(null);
      onClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-document-modal-title"
      className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={handleModalClose}
    >
      <div
        className="bg-bg-surface border border-border-default rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 relative text-text-primary"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between p-5 border-b border-border-default">
          <div>
            <h2 id="upload-document-modal-title" className="text-base font-bold text-text-primary">Upload document</h2>
            <p className="text-[12px] text-text-secondary mt-0.5">
              Upload a PDF or DOCX file to add it to your workspace knowledge base.
            </p>
          </div>
          <button
            onClick={handleModalClose}
            disabled={isUploading}
            className="p-1.5 rounded-lg hover:bg-bg-elevated border border-border-subtle text-text-secondary hover:text-text-primary transition-colors cursor-pointer disabled:opacity-50"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content Form */}
        <form onSubmit={handleFormSubmit} className="p-5 space-y-4">
          {/* Dropzone */}
          {!selectedFile ? (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-6 text-center flex flex-col items-center justify-center gap-3 cursor-pointer transition-all ${
                isDragOver
                  ? "border-accent-primary bg-accent-bg text-accent-primary"
                  : "border-border-default hover:border-border-default/80 bg-bg-elevated/40 text-text-secondary"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx"
                onChange={handleInputChange}
                className="hidden"
              />

              <div className="w-12 h-12 rounded-xl bg-bg-elevated border border-border-subtle flex items-center justify-center text-accent-primary">
                <Upload className="w-6 h-6" />
              </div>

              <div className="space-y-1">
                <p className="text-[13px] font-semibold text-text-primary">
                  Drop files here or <span className="text-accent-primary">browse files</span>
                </p>
                <p className="text-[11px] text-text-muted">
                  Supported formats: PDF, DOCX • Max size: 10 MB
                </p>
              </div>
            </div>
          ) : (
            /* Selected File Preview Box */
            <div className="bg-bg-elevated border border-border-subtle rounded-xl p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-accent-bg text-accent-primary border border-accent-primary/20 flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5" />
                </div>

                <div className="min-w-0">
                  <span className="block text-[13px] font-semibold text-text-primary truncate">
                    {selectedFile.name}
                  </span>
                  <span className="block text-[11px] text-text-secondary mt-0.5">
                    {formatFileSize(selectedFile.size)} • {selectedFile.name.split(".").pop()?.toUpperCase()}
                  </span>
                </div>
              </div>

              {!isUploading && (
                <button
                  type="button"
                  onClick={() => setSelectedFile(null)}
                  className="p-1.5 rounded-lg hover:bg-bg-surface text-text-secondary hover:text-destructive transition-colors cursor-pointer"
                  title="Remove file"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}

          {/* Validation or API Error Banner */}
          {errorMsg && (
            <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-[12px] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Footer Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border-subtle">
            <Button
              type="button"
              onClick={handleModalClose}
              disabled={isUploading}
              className="bg-bg-elevated border border-border-subtle hover:bg-bg-elevated/80 text-text-primary text-[12px] font-semibold h-9 px-4 rounded-lg cursor-pointer"
            >
              Cancel
            </Button>

            <Button
              type="submit"
              disabled={!selectedFile || isUploading}
              className="bg-accent-primary hover:bg-accent-hover text-white text-[12px] font-semibold h-9 px-4 rounded-lg flex items-center gap-2 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Uploading...</span>
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  <span>Upload document</span>
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
