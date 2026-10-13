// Configuration Firebase
const firebaseConfig = {
  apiKey: "AIzaSyAWQk-ggRbQbseTNJFQccVjAPpeWP5eD1I",
  authDomain: "chat-80cef.firebaseapp.com",
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
// Firestore n'est pas forcément chargé sur la page de connexion : on protège l'accès
const db = typeof firebase.firestore === "function" ? firebase.firestore() : null;

// Messages d'erreur lisibles
function friendlyAuthError(error) {
    switch (error && error.code) {
        case "auth/invalid-email": return "Adresse e-mail invalide.";
        case "auth/user-not-found":
        case "auth/wrong-password":
        case "auth/invalid-credential":
        case "auth/invalid-login-credentials": return "E-mail ou mot de passe incorrect.";
        case "auth/user-disabled": return "Ce compte a été désactivé.";
        case "auth/too-many-requests": return "Trop de tentatives. Patientez quelques minutes ou réinitialisez votre mot de passe.";
        case "auth/network-request-failed": return "Problème de connexion réseau. Réessayez.";
        case "auth/unauthorized-domain": return "Ce domaine n'est pas autorisé dans Firebase (Authentication > Paramètres > Domaines autorisés).";
        default: return "Erreur : " + ((error && error.message) || "connexion impossible.");
    }
}

const loginForm = document.querySelector("form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const submitBtn = document.querySelector(".primary-button");
const originalBtnContent = submitBtn ? submitBtn.innerHTML : "Se connecter";

// Création de la boîte d'erreur
let errorBox = document.getElementById("errorMessage");
if (!errorBox && loginForm) {
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
    loginForm.parentNode.insertBefore(errorBox, loginForm);
}

function showError(message, opts = {}) {
    if (!errorBox) return;
    errorBox.textContent = message;
    if (opts.code) {
        const small = document.createElement("small");
        small.style.cssText = "display:block;margin-top:4px;opacity:.7;";
        small.textContent = opts.code;
        errorBox.appendChild(small);
    }
    errorBox.style.display = "block";
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
        submitBtn.innerHTML = 'Connexion en cours... <i class="fa-solid fa-spinner fa-spin"></i>';
    } else {
        submitBtn.disabled = false;
        submitBtn.style.opacity = "1";
        submitBtn.style.cursor = "pointer";
        submitBtn.innerHTML = originalBtnContent;
    }
}

// Remplace le bloc de connexion (loginForm.addEventListener) par :
if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        clearError();

        const email = emailInput.value.trim();
        const password = passwordInput.value;

        if (!email || !password) {
            showError("Veuillez remplir tous les champs.");
            return;
        }

        setLoadingState(true);

        try {
            // 1. Authentification Firebase
            const userCredential = await auth.signInWithEmailAndPassword(email, password);
            const user = userCredential.user;

            // 2. Restauration de la clé E2EE si absente de cet appareil (n'empêche jamais la connexion)
            try {
                const existingLocalKey = localStorage.getItem(`e2ee_private_${user.uid}`);

                if (!existingLocalKey && db && typeof E2EE !== "undefined" && E2EE.importEncryptedPrivateKey) {
                    const userDoc = await db.collection("users").doc(user.uid).get();
                    if (userDoc.exists && userDoc.data().encryptedPrivateKey) {
                        // Déchiffrement avec le mot de passe saisi
                        const restoredPrivateKey = await E2EE.importEncryptedPrivateKey(
                            userDoc.data().encryptedPrivateKey,
                            password
                        );
                        if (restoredPrivateKey) {
                            localStorage.setItem(`e2ee_private_${user.uid}`, restoredPrivateKey);
                            console.log("Clé E2EE déchiffrée et restaurée sur cet appareil.");
                        }
                    }
                }
            } catch (keyErr) {
                console.warn("Impossible de restaurer la clé E2EE (compte ancien, clé obsolète ou accès refusé).", keyErr);
            }

            // Redirection vers l'application
            window.location.href = "index.html";

        } catch (error) {
            setLoadingState(false);
            console.error("Erreur Connexion :", error);
            showError(friendlyAuthError(error), { code: error && error.code });
        }
    });
}