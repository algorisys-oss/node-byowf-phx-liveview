/**
 * UploadDemoLive -- Demonstrates file uploads over WebSocket.
 *
 * Features:
 * - File selection with bv-upload binding
 * - Server-side validation (type, size, max entries)
 * - Chunked binary upload with progress tracking
 * - consumeUploadedEntries to process completed files
 */

import { copyFile, mkdir } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { LiveView, type LiveViewSocket } from "../blaze/live_view.js";
import { bv, type Rendered } from "../blaze/rendered.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = join(__dirname, "..", "..", "public", "uploads");

export class UploadDemoLive extends LiveView {
  mount(socket: LiveViewSocket): void {
    socket.allowUpload("photos", {
      accept: ["image/*"],
      maxEntries: 3,
      maxFileSize: 5_000_000,
      chunkSize: 64_000,
      autoUpload: true,
    });

    socket.assign({
      uploadedFiles: [] as { name: string; size: string; url: string }[],
    });
  }

  async handleEvent(
    event: string,
    _params: Record<string, unknown>,
    socket: LiveViewSocket,
  ): Promise<void> {
    if (event === "save") {
      await mkdir(UPLOADS_DIR, { recursive: true });
      const files = await socket.consumeUploadedEntries(
        "photos",
        async (entry) => {
          // Generate a unique filename to avoid collisions
          const ext = extname(entry.clientName);
          const baseName = entry.clientName.replace(ext, "");
          const savedName = `${baseName}-${Date.now()}${ext}`;
          const destPath = join(UPLOADS_DIR, savedName);

          // Copy from temp to public/uploads/
          await copyFile(entry.tmpPath, destPath);

          return {
            name: entry.clientName,
            size: formatSize(entry.clientSize),
            url: `/public/uploads/${savedName}`,
          };
        },
      );
      const existing = (socket.assigns.uploadedFiles as { name: string; size: string; url: string }[]) || [];
      socket.assign({ uploadedFiles: [...existing, ...files] });
    }
  }

  render(assigns: Record<string, unknown>): Rendered {
    const uploads = assigns.__uploads__ as Record<string, any> | undefined;
    const config = uploads?.photos;
    const entries = config?.entries || [];
    const errors = config?.errors || [];
    const uploadedFiles = (assigns.uploadedFiles as { name: string; size: string; url: string }[]) || [];

    let entriesHtml = "";
    for (const entry of entries) {
      const statusColor = entry.done ? "#2a2" : entry.valid ? "#36c" : "#c33";
      const statusText = entry.done
        ? "Done"
        : entry.valid
          ? `${entry.progress}%`
          : entry.errors.join(", ");
      entriesHtml += `<div style="padding:0.4rem 0.6rem; margin:0.2rem 0; background:#f8f8f8;
                          border-radius:4px; border-left:3px solid ${statusColor};
                          display:flex; justify-content:space-between;">
        <span>${entry.clientName} (${formatSize(entry.clientSize)})</span>
        <span style="color:${statusColor}; font-weight:bold;">${statusText}</span>
      </div>`;
    }

    let errorsHtml = "";
    for (const err of errors) {
      errorsHtml += `<p style="color:#c33;">${err}</p>`;
    }

    let uploadedHtml = "";
    for (const f of uploadedFiles) {
      uploadedHtml += `<li style="margin:0.8rem 0; list-style:none;">
        <div style="display:flex; align-items:center; gap:1rem;">
          <img src="${f.url}" style="width:80px; height:80px; object-fit:cover; border-radius:4px; border:1px solid #ddd;" />
          <div>
            <strong>${f.name}</strong> (${f.size})<br>
            <a href="${f.url}" target="_blank" style="display:inline-block; margin-top:0.3rem;
               padding:0.2rem 0.6rem; background:#36c; color:white; text-decoration:none;
               border-radius:3px; font-size:0.85rem;">View / Download</a>
          </div>
        </div>
      </li>`;
    }

    return bv`
      <h1>File Uploads</h1>

      <form bv-submit="save">
        <div style="border:2px dashed #ccc; border-radius:8px; padding:2rem; text-align:center; margin:1rem 0;">
          <p>Select images to upload (max 3 files, 5MB each)</p>
          <input type="file" bv-upload="photos" multiple accept="image/*"
                 style="font-size:1rem;" />
        </div>

        ${errorsHtml}
        ${entriesHtml}

        <button type="submit" style="padding:0.5rem 1.5rem; font-size:1rem; cursor:pointer;
                background:#2a2; color:white; border:none; border-radius:4px; margin-top:0.5rem;">
          Save Uploads
        </button>
      </form>

      ${uploadedFiles.length > 0
        ? `<h2>Saved Files</h2><ul>${uploadedHtml}</ul>`
        : ""}

      <p style="color:#888; font-size:0.85rem; margin-top:1rem;">
        Files are uploaded as binary WebSocket chunks. Auto-upload is enabled --
        upload starts as soon as files are selected. Click "Save" to consume entries.
      </p>
    `;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
