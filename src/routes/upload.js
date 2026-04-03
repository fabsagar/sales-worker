import { errorResponse, successResponse } from '../utils/helpers.js';
import { requireAdmin } from '../middleware/auth.js';

// POST /api/upload
// Accepts multipart/form-data with a "file" field (image)
// Stores the image in Cloudflare R2 and returns the public URL
export async function handleUploadImage(request, env, user) {
    const denied = requireAdmin(user);
    if (denied) return denied;

    if (!env.IMAGES) {
        return errorResponse('Image storage not configured', 500);
    }

    let formData;
    try {
        formData = await request.formData();
    } catch {
        return errorResponse('Invalid form data');
    }

    const file = formData.get('file');
    if (!file || typeof file === 'string') {
        return errorResponse('No file provided');
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
    if (!allowedTypes.includes(file.type)) {
        return errorResponse('Invalid file type. Only JPEG, PNG, WEBP, GIF and AVIF allowed.');
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024;
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > maxSize) {
        return errorResponse('File too large. Maximum size is 5MB.');
    }

    // Generate a unique filename using timestamp + random suffix
    const ext = file.name?.split('.').pop() || 'jpg';
    const key = `products/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    await env.IMAGES.put(key, bytes, {
        httpMetadata: { contentType: file.type },
    });

    // Return the public URL — uses the R2 public domain if configured,
    // otherwise returns a signed URL via the worker itself
    const imageUrl = `${new URL(request.url).origin}/api/images/${key}`;

    return successResponse({ url: imageUrl }, 'Image uploaded');
}

// GET /api/images/:key*
// Serves an image from R2
export async function handleGetImage(request, env, key) {
    if (!env.IMAGES) return errorResponse('Image storage not configured', 500);

    const object = await env.IMAGES.get(key);
    if (!object) return errorResponse('Image not found', 404);

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('Access-Control-Allow-Origin', '*');

    return new Response(object.body, { headers });
}
