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
        submitBtn.innerHTML = 'Connexion en cours... <i class="fa-solid fa-spinner fa-spin"></i>';
    } else {
        submitBtn.disabled = false;
        submitBtn.style.opacity = "1";
        submitBtn.style.cursor = "pointer";
        submitBtn.innerHTML = originalBtnContent;
    }
}

if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault(); // Empêche l'actualisation de la page
        clearError();

        const email = emailInput.value.trim();
        const password = passwordInput.value;

        if (!email || !password) {
            showError("Veuillez remplir tous les champs.");
            return;
        }

        setLoadingState(true);

        try {
            await auth.signInWithEmailAndPassword(email, password);
            window.location.href = "index.html";
        } catch (error) {
            setLoadingState(false);
            console.error("Erreur Connexion :", error);

            switch (error.code) {
                case "auth/invalid-email":
                    showError("L'adresse e-mail n'est pas valide.");
                    break;
                case "auth/user-not-found":
                case "auth/wrong-password":
                case "auth/invalid-credential":
                    showError("Compte inexistant ou mot de passe incorrect.");
                    break;
                case "auth/too-many-requests":
                    showError("Trop de tentatives. Veuillez patienter.");
                    break;
                default:
                    showError("Erreur : " + error.message);
            }
        }
    });
}