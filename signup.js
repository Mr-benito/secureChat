// Configuration Firebase
const firebaseConfig = {
  apiKey: "AIzaSyAWQk-ggRbQbseTNJFQccVjAPpeWP5eD1I",
  authDomain: "chat-80cef.firebaseapp.com",
  databaseURL: "https://chat-80cef-default-rtdb.firebaseio.com",
  projectId: "chat-80cef",
  storageBucket: "chat-80cef.firebasestorage.app",
  messagingSenderId: "275397956073",
  appId: "1:275397956073:web:52d15213320d05213bfb78"
};

// Initialisation
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const rtdb = firebase.database();

const signupForm = document.querySelector("form");
const usernameInput = document.getElementById("username");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const confirmPasswordInput = document.getElementById("confirm-password");
const termsInput = document.getElementById("terms");
const submitBtn = document.querySelector(".primary-button");
const originalBtnContent = submitBtn ? submitBtn.innerHTML : "S'inscrire";

// Création de la boîte d'erreur
let errorBox = document.getElementById("errorMessage");
if (!errorBox && signupForm) {
    errorBox = document.createElement("div");
    errorBox.id = "errorMessage";
    errorBox.style.backgroundColor = "#fee2e2";
    errorBox.style.border = "1px solid #f87171";
    errorBox.style.color = "#991b1b";
    errorBox.style.padding = "10px 14px";
    errorBox.style.borderRadius = "7px";
    errorBox.style.fontSize = "13px";
    errorBox.style.marginBottom = "15px";
    errorBox.style.textAlign = "center";
    errorBox.style.display = "none";
    signupForm.parentNode.insertBefore(errorBox, signupForm);
}

function showError(message) {
    if (errorBox) {
        errorBox.textContent = message;
        errorBox.style.display = "block";
    }
}

function clearError() {
    if (errorBox) {
        errorBox.textContent = "";
        errorBox.style.display = "none";
    }
}

function setLoadingState(isLoading) {
    if (!submitBtn) return;
    if (isLoading) {
        submitBtn.disabled = true;
        submitBtn.style.opacity = "0.7";
        submitBtn.style.cursor = "not-allowed";
        submitBtn.innerHTML = 'Création en cours... <i class="fa-solid fa-spinner fa-spin"></i>';
    } else {
        submitBtn.disabled = false;
        submitBtn.style.opacity = "1";
        submitBtn.style.cursor = "pointer";
        submitBtn.innerHTML = originalBtnContent;
    }
}

// Bloc d'inscription
if (signupForm) {
    signupForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        clearError();

        const username = usernameInput.value.trim();
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        const confirmPassword = confirmPasswordInput.value;

        if (!username || !email || !password || !confirmPassword) {
            showError("Veuillez remplir tous les champs.");
            return;
        }

        if (password.length < 6) {
            showError("Le mot de passe doit contenir au moins 6 caractères.");
            return;
        }

        if (password !== confirmPassword) {
            showError("Les mots de passe ne correspondent pas.");
            return;
        }

        if (termsInput && !termsInput.checked) {
            showError("Veuillez accepter les conditions d'utilisation.");
            return;
        }

        setLoadingState(true);

        let createdUser = null;

        try {
            // 1. Génération des clés E2EE (avant de créer le compte, pour ne pas laisser
            //    de compte orphelin si le chiffrement est indisponible)
            if (typeof E2EE === "undefined" || !E2EE.generateKeyPair || !E2EE.exportEncryptedPrivateKey) {
                throw new Error("Module de chiffrement indisponible (crypto-helper.js non chargé).");
            }

            const keys = await E2EE.generateKeyPair();
            const rawPrivateKey = keys.privateKeyString;
            const publicKeyStr = keys.publicKeyString;

            // Chiffrement de la clé privée avec le mot de passe de l'utilisateur
            const encryptedPrivateKey = await E2EE.exportEncryptedPrivateKey(rawPrivateKey, password);

            // 2. Création compte utilisateur dans Firebase Auth
            const userCredential = await auth.createUserWithEmailAndPassword(email, password);
            const user = userCredential.user;
            createdUser = user;

            // Update du profil Firebase Auth avec le displayName
            await user.updateProfile({ displayName: username });

            // 3. Sauvegarde dans Realtime Database (écriture atomique multi-chemins) :
            //    - users/{uid}    : profil public (lisible par les autres utilisateurs)
            //    - userKeys/{uid} : clé privée chiffrée (lisible uniquement par son propriétaire)
            const updates = {};
            updates[`users/${user.uid}`] = {
                uid: user.uid,
                username: username,
                email: email,
                publicKey: publicKeyStr,
                status: "offline",
                lastSeen: firebase.database.ServerValue.TIMESTAMP,
                createdAt: firebase.database.ServerValue.TIMESTAMP
            };
            updates[`userKeys/${user.uid}`] = {
                encryptedPrivateKey: encryptedPrivateKey
            };
            await rtdb.ref().update(updates);

            // 4. Sauvegarde de la clé privée locale pour cet appareil
            localStorage.setItem(`e2ee_private_${user.uid}`, rawPrivateKey);

            // Redirection vers l'application
            window.location.href = "index.html";

        } catch (error) {
            // Si le compte Auth a été créé mais que l'écriture a échoué, on le supprime
            // pour permettre de réessayer avec le même e-mail.
            if (createdUser) {
                try { await createdUser.delete(); } catch (delErr) { console.warn("Nettoyage du compte impossible :", delErr); }
            }
            setLoadingState(false);
            console.error("Erreur Inscription :", error);
            showError("Erreur : " + error.message);
        }
    });
}