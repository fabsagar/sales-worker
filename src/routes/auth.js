import { signJWT, hashPassword, verifyPassword } from '../utils/jwt.js';
import { jsonResponse, errorResponse, successResponse, validateRequired, validateEmail } from '../utils/helpers.js';

async function validateLicense(env) {
    try {
        const secret = "super-secret-key";
        const key = "ABC-123";

        console.log(`[License] Calling internal service binding`);
        console.log("Calling LICENSE binding...");
        console.log("env.LICENSE exists:", !!env.LICENSE);
        const response = await env.LICENSE.fetch(
            new Request("https://license/validate", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-secret": secret
                },
                body: JSON.stringify({
                    license_key: key
                })
            })
        );

        console.log(`[License] Status: ${response.status}`);

        const bodyText = await response.text();
        console.log(`[License] Raw Body: ${bodyText}`);

        if (!response.ok) {
            throw new Error(`License server returned status ${response.status}. Body: ${bodyText.slice(0, 100)}`);
        }

        const data = JSON.parse(bodyText);

        if (!data.valid) {
            throw new Error("License expired. Contact support.");
        }

        return data;

    } catch (err) {
        console.error('[License] Error:', err.message);
        throw err;
    }
}

// POST /api/auth/google
export async function handleGoogleLogin(request, env) {
    let body;
    try {
        body = await request.json();
    } catch {
        return errorResponse('Invalid JSON body');
    }

    const missing = validateRequired(body, ['credential']);
    if (missing) return errorResponse(missing);

    // Verify Google Token via standard REST API
    let googleUser;
    try {
        const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${body.credential}`);
        if (!verifyRes.ok) {
            throw new Error('Invalid Google Token');
        }
        googleUser = await verifyRes.json();
    } catch (err) {
        return errorResponse('Failed to verify Google identity', 401);
    }

    // Ensure token is for our app
    if (googleUser.aud !== env.GOOGLE_CLIENT_ID) {
        return errorResponse('Token was not issued for this application', 401);
    }

    const email = googleUser.email.toLowerCase().trim();

    const user = await env.DB.prepare(
        'SELECT id, name, email, role, is_active FROM users WHERE email = ?'
    ).bind(email).first();

    if (!user) return errorResponse('Unauthorized domain or email. Contact administrator.', 401);
    if (!user.is_active) return errorResponse('Account is inactive', 401);

    try {
        await validateLicense(env);
    } catch (err) {
        return errorResponse(err.message, 403);
    }

    const token = await signJWT(
        { userId: user.id, email: user.email, role: user.role, name: user.name },
        env.JWT_SECRET,
        86400 * 7 // 7 days
    );

    return successResponse({
        token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
    }, 'Login successful');
}

// GET /api/me
export async function handleGetMe(request, env, user) {
    return successResponse({ user });
}
