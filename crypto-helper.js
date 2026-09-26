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

// ==========================================
// CHIFFREMENT HYBRIDE GÉNÉRIQUE (AES-GCM 256 + RSA-OAEP) — pour les discussions à deux.
// Contrairement au chiffrement direct RSA-OAEP ci-dessus (limité à ~190 octets en clair !),
// ceci chiffre le texte une fois avec une clé AES aléatoire, puis ne chiffre QUE cette petite
// clé pour chaque destinataire (ici : vous et votre interlocuteur). Aucune limite de taille.
// ==========================================

// recipientsPublicKeys : { uid: "clépubliqueBase64", ... } — ici toujours { moi, l'autre }
E2EE.encryptHybrid = async function (text, recipientsPublicKeys) {
    const aesKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipherBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, new TextEncoder().encode(text));
    const rawAesKey = await crypto.subtle.exportKey("raw", aesKey);

    const keys = {};
    await Promise.all(Object.entries(recipientsPublicKeys || {}).map(async ([uid, pubKeyStr]) => {
        if (!pubKeyStr) return;
        try {
            const pubKey = await this.importPublicKey(pubKeyStr);
            const wrapped = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pubKey, rawAesKey);
            keys[uid] = toB64(wrapped);
        } catch (e) {
            console.warn(`Impossible de chiffrer la clé pour ${uid} :`, e);
        }
    }));

    return { iv: toB64(iv), cipherText: toB64(cipherBuffer), keys };
};

E2EE.decryptHybrid = async function (payload, myUid, myPrivateKeyString) {
    const wrappedKey = payload && payload.keys && payload.keys[myUid];
    if (!wrappedKey) throw new Error("Aucune clé disponible pour ce message.");

    const privateKey = await this.importPrivateKey(myPrivateKeyString);
    const rawAesKey = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, fromB64(wrappedKey).buffer);
    const aesKey = await crypto.subtle.importKey("raw", rawAesKey, { name: "AES-GCM" }, false, ["decrypt"]);
    const plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(payload.iv) }, aesKey, fromB64(payload.cipherText).buffer);
    return new TextDecoder().decode(plainBuffer);
};

// ==========================================
// CHIFFREMENT DE GROUPE : une clé AES-256 unique par groupe (comme WhatsApp/Signal),
// distribuée une seule fois par membre (chiffrée avec sa clé publique RSA), puis réutilisée
// pour tous les messages du groupe. Beaucoup plus léger que rechiffrer le texte pour chacun
// à chaque message, et compatible avec une fenêtre d'historique gérée côté règles Firestore.
// ==========================================

function toB64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function fromB64(str) { return Uint8Array.from(atob(str), c => c.charCodeAt(0)); }

// Génère la clé de groupe et l'exporte en base64 (à conserver seulement en mémoire côté client).
E2EE.generateGroupKey = async function () {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    const raw = await crypto.subtle.exportKey("raw", key);
    return toB64(raw);
};

// Chiffre la clé de groupe (base64) pour UN membre avec sa clé publique RSA.
E2EE.wrapGroupKeyForMember = async function (rawGroupKeyBase64, memberPublicKeyString) {
    const pubKey = await this.importPublicKey(memberPublicKeyString);
    const wrapped = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pubKey, fromB64(rawGroupKeyBase64).buffer);
    return toB64(wrapped);
};

// Récupère la clé de groupe en clair à partir de MA copie chiffrée + ma clé privée.
E2EE.unwrapGroupKey = async function (myWrappedKeyBase64, myPrivateKeyString) {
    const privateKey = await this.importPrivateKey(myPrivateKeyString);
    const raw = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, fromB64(myWrappedKeyBase64).buffer);
    return toB64(raw);
};

// Chiffre/déchiffre le texte d'un message avec la clé de groupe déjà en clair (rapide, symétrique).
E2EE.encryptGroupText = async function (text, rawGroupKeyBase64) {
    const key = await crypto.subtle.importKey("raw", fromB64(rawGroupKeyBase64), { name: "AES-GCM" }, false, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipherBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
    return { iv: toB64(iv), cipherText: toB64(cipherBuffer) };
};

E2EE.decryptGroupText = async function (payload, rawGroupKeyBase64) {
    const key = await crypto.subtle.importKey("raw", fromB64(rawGroupKeyBase64), { name: "AES-GCM" }, false, ["decrypt"]);
    const plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(payload.iv) }, key, fromB64(payload.cipherText).buffer);
    return new TextDecoder().decode(plainBuffer);
};

