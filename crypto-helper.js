// ==========================================
// MODULE DE CHIFFREMENT DE BOUT EN BOUT (E2EE)
// Algorithme : RSA-OAEP (2048 bits) + Web Crypto API
// ==========================================

const E2EE = {
    // 1. Générer une paire de clés RSA pour un nouvel utilisateur
    async generateKeyPair() {
        const keyPair = await window.crypto.subtle.generateKey(
            {
                name: "RSA-OAEP",
                modulusLength: 2048,
                publicExponent: new Uint8Array([1, 0, 1]),
                hash: "SHA-256"
            },
            true,
            ["encrypt", "decrypt"]
        );

        // Exporter la clé publique au format PEM/String pour Firestore
        const exportedPublic = await window.crypto.subtle.exportKey("spki", keyPair.publicKey);
        const publicKeyString = btoa(String.fromCharCode(...new Uint8Array(exportedPublic)));

        // Exporter la clé privée au format String pour stockage local
        const exportedPrivate = await window.crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
        const privateKeyString = btoa(String.fromCharCode(...new Uint8Array(exportedPrivate)));

        return {
            publicKeyString,
            privateKeyString,
            rawPrivateKey: keyPair.privateKey
        };
    },

    // 2. Importer une clé publique (depuis Firestore)
    async importPublicKey(pemString) {
        const binaryDer = Uint8Array.from(atob(pemString), c => c.charCodeAt(0));
        return await window.crypto.subtle.importKey(
            "spki",
            binaryDer.buffer,
            { name: "RSA-OAEP", hash: "SHA-256" },
            true,
            ["encrypt"]
        );
    },

    // 3. Importer une clé privée (depuis le localStorage local)
    async importPrivateKey(pemString) {
        const binaryDer = Uint8Array.from(atob(pemString), c => c.charCodeAt(0));
        return await window.crypto.subtle.importKey(
            "pkcs8",
            binaryDer.buffer,
            { name: "RSA-OAEP", hash: "SHA-256" },
            true,
            ["decrypt"]
        );
    },

    // 4. Chiffrer un message avec la clé publique du destinataire 
    async encryptText(text, receiverPublicKeyString) {
        try {
            const publicKey = await this.importPublicKey(receiverPublicKeyString);
            const enc = new TextEncoder();
            const encryptedBuffer = await window.crypto.subtle.encrypt(
                { name: "RSA-OAEP" },
                publicKey,
                enc.encode(text)
            );
            return btoa(String.fromCharCode(...new Uint8Array(encryptedBuffer)));
        } catch (e) {
            console.error("Erreur de chiffrement :", e);
            return text; // Fallback
        }
    },

    // 5. Déchiffrer un message avec la clé privée de l'utilisateur connecté 
    async decryptText(encryptedBase64, myPrivateKeyString) {
        try {
            const privateKey = await this.importPrivateKey(myPrivateKeyString);
            const encryptedArray = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
            const decryptedBuffer = await window.crypto.subtle.decrypt(
                { name: "RSA-OAEP" },
                privateKey,
                encryptedArray.buffer
            );
            const dec = new TextDecoder();
            return dec.decode(decryptedBuffer);
        } catch (e) {
            // Si le message a été envoyé par soi-même ou échec de déchiffrement
            return encryptedBase64;
        }
    }
};
// Chiffrer la clé privée avec une phrase/mot de passe avant envoi sur Firestore
E2EE.exportEncryptedPrivateKey = async function(privateKeyPem, secretPassword) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw", enc.encode(secretPassword), "PBKDF2", false, ["deriveKey"]
    );
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
        keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt"]
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv }, key, enc.encode(privateKeyPem)
    );

    return JSON.stringify({
        salt: Array.from(salt),
        iv: Array.from(iv),
        cipherText: Array.from(new Uint8Array(encrypted))
    });
};

// Déchiffrer la clé privée récupérée depuis Firestore
E2EE.importEncryptedPrivateKey = async function(encryptedDataJson, secretPassword) {
    const { salt, iv, cipherText } = JSON.parse(encryptedDataJson);
    const enc = new TextEncoder();
    const dec = new TextDecoder();

    const keyMaterial = await crypto.subtle.importKey(
        "raw", enc.encode(secretPassword), "PBKDF2", false, ["deriveKey"]
    );
    const key = await crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: new Uint8Array(salt),
            iterations: 100000,
            hash: "SHA-256"
        },
        keyMaterial, { name: "AES-GCM", length: 256 }, false, ["decrypt"]
    );

    const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(iv) },
        key,
        new Uint8Array(cipherText)
    );

    return dec.decode(decrypted);
};