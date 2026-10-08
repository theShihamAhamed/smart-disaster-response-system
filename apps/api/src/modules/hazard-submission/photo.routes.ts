import { UserRole } from "@disaster/domain";
import { Router } from "express";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { requireRoles } from "../../authorization.js";
import { HttpError } from "../../errors.js";

const uploadDirectory = join(dirname(fileURLToPath(import.meta.url)), "../../../uploads");
mkdirSync(uploadDirectory, { recursive: true });

const upload = multer({
  dest: uploadDirectory,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    callback(null, file.mimetype.startsWith("image/"));
  },
});

export function createPhotoRouter(): Router {
  const router = Router();

  router.use(requireRoles(UserRole.CITIZEN, UserRole.VOLUNTEER));
  router.post("/", upload.single("photo"), (request, response) => {
    const clientReportId = request.body.clientReportId?.trim();
    if (!clientReportId || !request.file) {
      throw new HttpError(422, "VALIDATION_ERROR", "A clientReportId and photo are required.");
    }

    response.status(201).json({
      photoRef: request.file.filename,
      clientReportId,
    });
  });

  return router;
}
