import multer from "multer";
import path from "path";
import fs from "fs";
import { AppError } from "../../../../packages/shared/errors/AppError";

const uploadDir = "uploads/";

/** Ensure uploads directory exists. */
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

/** Store uploaded files temporarily in the uploads folder. */
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },

  filename: (_req, file, cb) => {
    const uniqueName =
      `${Date.now()}-${file.originalname}`;

    cb(null, uniqueName);
  },
});

/** Allow only PDF and DOCX files. */
const fileFilter: multer.Options["fileFilter"] = (
  _req,
  file,
  cb
) => {
  const allowedMimeTypes = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "application/x-zip-compressed",
    "application/zip",
  ];
  const allowedExtensions = [".pdf", ".docx", ".doc"];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedExtensions.includes(ext) || allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError("Only PDF and DOCX files are allowed.", 400));
  }
};

/** Configure Multer upload middleware. */
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});