import multer from "multer";
import path from "path";
import { AppError } from "../../../../packages/shared/errors/AppError";
import { ensureUploadTmpDir, newUploadTempName, resolveUploadTmpDir } from "../utils/upload-tmp";

/*
 * SEC-024 (a): uploads are written to UPLOAD_TMP_DIR (default: OS temp +
 * researchmind-uploads), not a cwd-relative folder inside the repository,
 * under a random name -- the client's file name never becomes part of a path.
 */
export const UPLOAD_TMP_DIR = resolveUploadTmpDir();
ensureUploadTmpDir(UPLOAD_TMP_DIR);

/** Store uploaded files temporarily until they are parsed and stored. */
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_TMP_DIR);
  },

  filename: (_req, file, cb) => {
    cb(null, newUploadTempName(path.extname(file.originalname)));
  },
});

/** Extensions the service can actually extract text from. */
export const ALLOWED_UPLOAD_EXTENSIONS = [".pdf", ".docx"];

/**
 * Allow only PDF and DOCX files, by extension.
 *
 * The browser-supplied MIME type is deliberately NOT accepted as an
 * alternative: it is client-controlled, and accepting "extension OR MIME" let
 * any file through with a zip/PDF MIME type (and admitted legacy `.doc`, which
 * cannot be parsed). The file's actual bytes are verified after upload
 * (utils/file-signature.ts) before any parsing.
 */
const fileFilter: multer.Options["fileFilter"] = (
  _req,
  file,
  cb
) => {
  const ext = path.extname(file.originalname).toLowerCase();

  if (ALLOWED_UPLOAD_EXTENSIONS.includes(ext)) {
    cb(null, true);
  } else {
    // 415 Unsupported Media Type, consistent with the service-level type check.
    cb(new AppError("Only PDF and DOCX files are allowed.", 415));
  }
};

/** Configure Multer upload middleware. */
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024,
    // One document per request plus a few small text fields (workspaceId).
    files: 1,
    fields: 10,
    fieldSize: 64 * 1024,
    fieldNameSize: 100,
    parts: 20,
  },
});