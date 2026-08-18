// image-compress.js — shrinks large photos client-side before uploading to
// Cloudinary. Phone camera photos are often 3-8MB; resizing them down to a
// sane viewing size before the upload starts is the single biggest lever we
// have over how long "Submit"/"Publish" takes to respond, since the upload
// itself is what most of that wait is spent on.

const MAX_DIMENSION = 1600; // px, on the longer side — plenty to read a payment screenshot or view a blog photo
const JPEG_QUALITY = 0.78;
const SKIP_BELOW_BYTES = 400 * 1024; // already small enough, not worth the extra work

export async function compressImage(file) {
  if (!file || !file.type || !file.type.startsWith("image/")) return file;
  if (file.size <= SKIP_BELOW_BYTES) return file;
  // Animated GIFs would lose their animation if redrawn to a canvas — leave those alone.
  if (file.type === "image/gif") return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob || blob.size >= file.size) return file; // didn't actually help — keep the original

    const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], newName, { type: "image/jpeg" });
  } catch (err) {
    // If anything about compression fails (unsupported browser, corrupt
    // image, etc.) just upload the original file instead of blocking.
    console.error("[image-compress] failed, uploading original:", err);
    return file;
  }
}
