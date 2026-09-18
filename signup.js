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
const db = firebase.firestore();

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

if (signupForm) {
    signupForm.addEventListener("submit", async (e) => {
        e.preventDefault(); // Empêche l'actualisation de la page
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

        try {
            // 1. Création compte utilisateur
            const userCredential = await auth.createUserWithEmailAndPassword(email, password);
            const user = userCredential.user;

            // 2. Sauvegarde Firestore
            await db.collection("users").doc(user.uid).set({
                uid: user.uid,
                username: username,
                email: email,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            // Redirection
            window.location.href = "index.html";

        } catch (error) {
            setLoadingState(false);
            console.error("Erreur Inscription :", error);

            switch (error.code) {
                case "auth/email-already-in-use":
                    showError("Cette adresse e-mail est déjà utilisée.");
                    break;
                case "auth/invalid-email":
                    showError("Format d'adresse e-mail invalide.");
                    break;
                case "auth/weak-password":
                    showError("Le mot de passe doit contenir au moins 6 caractères.");
                    break;
                default:
                    showError("Erreur : " + error.message);
            }
        }
    });
}