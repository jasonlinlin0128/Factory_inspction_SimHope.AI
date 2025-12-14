// Base64URL 編碼工具
function base64urlEncode(buffer) {
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    const binary = atob(str);
    return Uint8Array.from(binary, c => c.charCodeAt(0));
}

// 檢查 WebAuthn 支援
export function isWebAuthnSupported() {
    return window.PublicKeyCredential !== undefined;
}

// 檢查平台驗證器（Face ID / Touch ID）
export async function isPlatformAuthenticatorAvailable() {
    if (!isWebAuthnSupported()) return false;
    try {
        return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
        return false;
    }
}

// 註冊 WebAuthn 憑證
export async function registerWebAuthn(inspectorName, db) {
    if (!await isPlatformAuthenticatorAvailable()) {
        throw new Error('此裝置不支援 Face ID / Touch ID');
    }

    // 生成 challenge
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);

    const publicKeyOptions = {
        challenge: challenge,
        rp: {
            name: "工廠設備巡檢系統",
            id: window.location.hostname
        },
        user: {
            id: new TextEncoder().encode(inspectorName),
            name: inspectorName,
            displayName: inspectorName
        },
        pubKeyCredParams: [
            { type: "public-key", alg: -7 },  // ES256
            { type: "public-key", alg: -257 } // RS256
        ],
        authenticatorSelection: {
            authenticatorAttachment: "platform", // 強制使用平台驗證器
            userVerification: "required"
        },
        timeout: 60000,
        attestation: "none"
    };

    try {
        const credential = await navigator.credentials.create({
            publicKey: publicKeyOptions
        });

        const credentialId = base64urlEncode(credential.rawId);
        const publicKey = base64urlEncode(credential.response.getPublicKey());

        // 儲存到 Firestore
        const { addDoc, collection } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
        await addDoc(collection(db, 'webauthn_credentials'), {
            inspectorName: inspectorName,
            credentialId: credentialId,
            publicKey: publicKey,
            deviceInfo: getDeviceInfo(),
            createdAt: new Date()
        });

        // 儲存到 localStorage
        localStorage.setItem('webauthn_credentialId', credentialId);

        return { success: true, credentialId };

    } catch (error) {
        console.error('WebAuthn 註冊失敗:', error);
        throw error;
    }
}

// 驗證 WebAuthn
export async function verifyWebAuthn(credentialId) {
    if (!await isPlatformAuthenticatorAvailable()) {
        throw new Error('此裝置不支援 Face ID / Touch ID');
    }

    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);

    const publicKeyOptions = {
        challenge: challenge,
        allowCredentials: [{
            type: "public-key",
            id: base64urlDecode(credentialId),
            transports: ["internal"]
        }],
        userVerification: "required",
        timeout: 60000
    };

    try {
        const assertion = await navigator.credentials.get({
            publicKey: publicKeyOptions
        });

        return { success: true, assertion };

    } catch (error) {
        console.error('WebAuthn 驗證失敗:', error);
        throw error;
    }
}

// 取得裝置資訊
function getDeviceInfo() {
    const ua = navigator.userAgent;
    return {
        browser: /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Other',
        os: /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : 'Other',
        model: /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : 'Unknown'
    };
}
