// 1. CONFIGURATION & INITIALISATION FIREBASE 
const firebaseConfig = {
    apiKey: "AIzaSyAWQk-ggRbQbseTNJFQccVjAPpeWP5eD1I",
    authDomain: "chat-80cef.firebaseapp.com",
    projectId: "chat-80cef",
    storageBucket: "chat-80cef.firebasestorage.app",
    messagingSenderId: "275397956073",
    appId: "1:275397956073:web:52d15213320d05213bfb78"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;
let activeChatUserId = null;
let unsubscribeMessages = null;

// Éléments UI Modal Profil 
const profileTrigger = document.getElementById("userProfileTrigger");
const profileModal = document.getElementById("profileModal");
const closeModalBtn = document.getElementById("closeModalBtn");
const logoutBtn = document.getElementById("logoutBtn");
const switchAccountBtn = document.getElementById("switchAccountBtn");

// 2. GESTION DU PROFIL & DÉCONNEXION 
if (profileTrigger) {
    profileTrigger.addEventListener("click", () => {
        if (profileModal) profileModal.style.display = "flex";
    });
}

if (closeModalBtn) {
    closeModalBtn.addEventListener("click", () => {
        if (profileModal) profileModal.style.display = "none";
    });
}

if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
        try {
            await auth.signOut();
            window.location.href = "login.html";
        } catch (error) {
            console.error("Erreur de déconnexion :", error);
        }
    });
}

if (switchAccountBtn) {
    switchAccountBtn.addEventListener("click", async () => {
        await auth.signOut();
        window.location.href = "login.html";
    });
}

// 🔐 INITIALISATION ET RESTAURATION PERMANENTE DES CLÉS
async function initUserKeys(user) {
    try {
        const userDocRef = db.collection("users").doc(user.uid);
        const doc = await userDocRef.get();
        let myPrivateKey = localStorage.getItem(`e2ee_private_${user.uid}`);

        // 1. Si la clé est déjà en local, tout est bon
        if (myPrivateKey) return;

        // 2. Si la clé n'est pas en local mais présente sur Firestore, on la restaure
        if (doc.exists && doc.data().encryptedPrivateKey) {
            try {
                // Utilisation de l'UID comme clé de secours (ou le mot de passe utilisateur)
                myPrivateKey = await E2EE.importEncryptedPrivateKey(
                    doc.data().encryptedPrivateKey, 
                    user.uid
                );
                localStorage.setItem(`e2ee_private_${user.uid}`, myPrivateKey);
                return;
            } catch (err) {
                console.error("Échec de la restauration de la clé Firestore:", err);
            }
        }

        // 3. Si aucune clé n'existe nulle part, on génère une nouvelle paire
        if (typeof E2EE !== "undefined") {
            const keys = await E2EE.generateKeyPair();
            myPrivateKey = keys.privateKeyString;

            // Chiffrement de la clé privée avant sauvegarde distante
            const encryptedBackup = await E2EE.exportEncryptedPrivateKey(
                myPrivateKey, 
                user.uid
            );

            // Sauvegarde locale + distante
            localStorage.setItem(`e2ee_private_${user.uid}`, myPrivateKey);

            await userDocRef.set({
                publicKey: keys.publicKeyString,
                encryptedPrivateKey: encryptedBackup
            }, { merge: true });
        }
    } catch (err) {
        console.error("Erreur d'initialisation des clés cryptographiques :", err);
    }
}
// 🔄 GESTION PROPRE DE LA NAVIGATION (SANS TOUCHER AU DOM/CSS) 
function setupTabNavigation() {
    const menuItems = document.querySelectorAll(".sidebar-menu .menu-item");

    menuItems.forEach((item) => {
        item.addEventListener("click", function (e) {
            e.preventDefault();

            // 1. Récupération de l'onglet cible
            const targetTab = this.getAttribute("data-tab");
            if (!targetTab) return;

            // 2. Mise à jour de la classe active dans le menu
            menuItems.forEach((m) => m.classList.remove("active"));
            this.classList.add("active");

            // 3. Récupération des conteneurs principaux
            const convList = document.querySelector(".conversation-list");
            const chatArea = document.querySelector(".chat-area");
            const dashboard = document.querySelector(".dashboard");

            // 4. Récupération de toutes les vues secondaires (par ID ou classe)
            const allTabViews = document.querySelectorAll("#tab-contacts, #tab-devices, #tab-pinned, #tab-settings, .tab-content");

            if (targetTab === "conversations") {
                //  MODE CONVERSATIONS : On réaffiche le mode 3 colonnes d'origine
                if (dashboard) dashboard.classList.remove("tab-active");
                if (convList) convList.style.display = "flex";
                if (chatArea) chatArea.style.display = "flex";

                // On masque les autres onglets
                allTabViews.forEach((tab) => (tab.style.display = "none"));
            } else {
                //  AUTRES ONGLETS (Contacts, Appareils, etc.)
                if (dashboard) dashboard.classList.add("tab-active");
                if (convList) convList.style.display = "none";
                if (chatArea) chatArea.style.display = "none";

                // On masque tous les onglets puis on affiche uniquement celui qui correspond
                allTabViews.forEach((tab) => {
                    if (tab.id === `tab-${targetTab}` || tab.getAttribute("data-view") === targetTab) {
                        tab.style.display = "block";
                    } else {
                        tab.style.display = "none";
                    }
                });

                //  Charger la clé si l'utilisateur ouvre l'onglet Appareils
                if (targetTab === "devices" && typeof loadDevicePublicKey === "function") {
                    loadDevicePublicKey();
                }
            }
        });
    });
}
// 🔍 RECHERCHE EN TEMPS RÉEL SUR LA BARRE SUPÉRIEURE
function setupSearch() {
    const searchInputs = document.querySelectorAll(".search-bar input, #searchInput");

    searchInputs.forEach(input => {
        input.addEventListener("input", (e) => {
            const query = e.target.value.toLowerCase().trim();

            const conversations = document.querySelectorAll(".conversation");
            let foundConv = 0;

            conversations.forEach(item => {
                const name = item.querySelector("h3")?.textContent.toLowerCase() || "";
                if (name.includes(query)) {
                    item.style.display = "flex";
                    foundConv++;
                } else {
                    item.style.display = "none";
                }
            });

            let noConvMsg = document.getElementById("no-conv-found");
            const convContainer = document.querySelector(".conversations");
            if (foundConv === 0 && query !== "") {
                if (!noConvMsg && convContainer) {
                    noConvMsg = document.createElement("p");
                    noConvMsg.id = "no-conv-found";
                    noConvMsg.style.cssText = "padding: 15px; color: #94a3b8; font-size: 13px; text-align: center;";
                    noConvMsg.textContent = "Aucun contact ou conversation trouvé ";
                    convContainer.appendChild(noConvMsg);
                }
            } else if (noConvMsg) {
                noConvMsg.remove();
            }

            const contactCards = document.querySelectorAll("#contacts-list > div");
            contactCards.forEach(card => {
                const name = card.querySelector("h4")?.textContent.toLowerCase() || "";
                card.style.display = name.includes(query) ? "flex" : "none";
            });
        });
    });
}

//  ÉTAT DE L'AUTHENTIFICATION FIREBASE
auth.onAuthStateChanged(async (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }

    currentUser = user;
    await initUserKeys(user);

    try {
        const userDoc = await db.collection("users").doc(user.uid).get();
        let displayName = user.email;

        if (userDoc.exists && userDoc.data().username) {
            displayName = userDoc.data().username;
        }

        const sidebarName = document.querySelector(".sidebar-profile .profile-info h4");
        if (sidebarName) sidebarName.textContent = displayName;

        const sidebarAvatar = document.querySelector(".profile-avatar");
        if (sidebarAvatar) sidebarAvatar.textContent = displayName.substring(0, 2).toUpperCase();

        const modalUsername = document.getElementById("modalUsername");
        const modalEmail = document.getElementById("modalEmail");
        if (modalUsername) modalUsername.textContent = displayName;
        if (modalEmail) modalEmail.textContent = user.email;

        const settingsEmail = document.getElementById("settingsEmail");
        if (settingsEmail) settingsEmail.textContent = user.email;

    } catch (e) {
        console.error("Erreur profil:", e);
    }

    showEmptyChatState();
    loadContacts();
    listenTotalUnreadCount();
    setupTabNavigation();
    setupSearch();
    initPeerJS(user.uid);
});

// 🖼️ ÉCRAN D'ACCUEIL PAR DÉFAUT
// 🖼️ ÉCRAN D'ACCUEIL PROPRE ET ADAPTÉ AU DESIGN
function showEmptyChatState() {
    const chatArea = document.querySelector(".chat-area");
    if (!chatArea) return;

    chatArea.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; width: 100%; text-align: center; padding: 20px; background-color: #f8fafc;">
            <i class="fa-solid fa-comments" style="font-size: 64px; color: #3b82f6; margin-bottom: 20px;"></i>
            <h2 style="font-size: 20px; font-weight: 600; color: #1e293b; margin-bottom: 8px;">Bienvenue sur SecureChat </h2>
            <p style="font-size: 13px; color: #64748b; max-width: 360px; line-height: 1.5;">
                Sélectionnez un contact dans la liste à gauche pour démarrer une conversation chiffrée de bout en bout. 
            </p>
        </div>
    `;
}

// 👥 CHARGER LES CONTACTS ET CONVERSATIONS
function loadContacts() {
    const conversationsContainer = document.querySelector(".conversations");
    const contactsTabContainer = document.getElementById("contacts-list");

    db.collection("users").onSnapshot((snapshot) => {
        if (conversationsContainer) conversationsContainer.innerHTML = "";
        if (contactsTabContainer) contactsTabContainer.innerHTML = "";

        if (snapshot.empty) {
            const emptyMsg = "<p style='padding: 20px; color: #94a3b8; font-size: 13px; text-align: center;'>Aucun utilisateur disponible.</p>";
            if (conversationsContainer) conversationsContainer.innerHTML = emptyMsg;
            if (contactsTabContainer) contactsTabContainer.innerHTML = emptyMsg;
            return;
        }

        snapshot.forEach((doc) => {
            const userData = doc.data();
            if (userData.uid === currentUser.uid) return;

            const initials = userData.username ? userData.username.substring(0, 2).toUpperCase() : "U";

            if (conversationsContainer) {
                const convItem = document.createElement("article");
                convItem.className = "conversation";
                convItem.dataset.uid = userData.uid;
                convItem.innerHTML = `
                    <div class="avatar group">${initials}</div>
                    <div class="conversation-info">
                        <h3>${userData.username || "Utilisateur"}</h3>
                        <p class="last-msg-text">Chargement...</p>
                    </div>
                    <div class="conversation-meta">
                        <span class="last-msg-time"></span>
                        <span class="unread" style="display: none;">0</span>
                    </div>
                `;

                const chatId = [currentUser.uid, userData.uid].sort().join("_");

                db.collection("chats")
                    .doc(chatId)
                    .collection("messages")
                    .orderBy("timestamp", "desc")
                    .limit(1)
                    .onSnapshot(async (msgSnapshot) => {
                        const textEl = convItem.querySelector(".last-msg-text");
                        const timeEl = convItem.querySelector(".last-msg-time");

                        if (!msgSnapshot.empty) {
                            const lastMsg = msgSnapshot.docs[0].data();
                            const isMine = lastMsg.senderId === currentUser.uid;

                            let cleanText = lastMsg.text;
                            const myPrivateKey = localStorage.getItem(`e2ee_private_${currentUser.uid}`);

                            if (typeof E2EE !== "undefined" && myPrivateKey && lastMsg.text) {
                                try {
                                    const targetEncryptedText = isMine ? (lastMsg.textForSender || lastMsg.text) : lastMsg.text;
                                    cleanText = await E2EE.decryptText(targetEncryptedText, myPrivateKey);
                                } catch (e) {
                                    cleanText = " [Message chiffré]";
                                }
                            }

                            if (textEl) textEl.textContent = isMine ? `Vous : ${cleanText}` : cleanText;
                            if (timeEl && lastMsg.timestamp) {
                                const date = lastMsg.timestamp.toDate();
                                timeEl.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                            }
                        } else {
                            if (textEl) textEl.textContent = "Aucun message";
                            if (timeEl) timeEl.textContent = "";
                        }
                    });

                db.collection("chats").doc(chatId).onSnapshot((chatDoc) => {
                    const badgeEl = convItem.querySelector(".unread");
                    if (chatDoc.exists && badgeEl) {
                        const unreadKey = `unreadCount_${currentUser.uid}`;
                        const unreadCount = chatDoc.data()[unreadKey] || 0;

                        if (unreadCount > 0 && activeChatUserId !== userData.uid) {
                            badgeEl.textContent = unreadCount > 99 ? "99+" : unreadCount;
                            badgeEl.style.display = "flex";
                        } else {
                            badgeEl.style.display = "none";
                        }
                    } else if (badgeEl) {
                        badgeEl.style.display = "none";
                    }
                });

                convItem.addEventListener("click", () => {
                    document.querySelectorAll(".conversation").forEach(c => c.classList.remove("active-conversation"));
                    convItem.classList.add("active-conversation");

                    const convTabBtn = document.querySelector('[data-tab="conversations"]');
                    if (convTabBtn) convTabBtn.click();

                    renderChatLayout();
                    selectContact(userData);

                    if (window.innerWidth <= 768) {
                        const convList = document.querySelector(".conversation-list");
                        const chatArea = document.querySelector(".chat-area");
                        if (convList) convList.style.display = "none";
                        if (chatArea) chatArea.style.display = "flex";
                    }
                });

                conversationsContainer.appendChild(convItem);
            }

            if (contactsTabContainer) {
                const contactCard = document.createElement("div");
                contactCard.style.cssText = "display: flex; align-items: center; justify-content: space-between; padding: 12px; background: #fff; border-radius: 8px; margin-bottom: 8px; border: 1px solid #e2e8f0;";
                contactCard.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div class="avatar group">${initials}</div>
                        <div>
                            <h4 style="margin: 0; font-size: 14px; color: #0f172a;">${userData.username || "Utilisateur"}</h4>
                            <span style="font-size: 12px; color: #64748b;">${userData.email || ""}</span>
                        </div>
                    </div>
                    <button class="btn-chat-start" style="background: #2563eb; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;">
                        <i class="fa-solid fa-comment"></i> Discuter
                    </button>
                `;

                contactCard.querySelector(".btn-chat-start").addEventListener("click", () => {
                    const convTabBtn = document.querySelector('[data-tab="conversations"]');
                    if (convTabBtn) convTabBtn.click();

                    renderChatLayout();
                    selectContact(userData);

                    if (window.innerWidth <= 768) {
                        const convList = document.querySelector(".conversation-list");
                        const chatArea = document.querySelector(".chat-area");
                        if (convList) convList.style.display = "none";
                        if (chatArea) chatArea.style.display = "flex";
                    }
                });

                contactsTabContainer.appendChild(contactCard);
            }
        });
    });
}

//  COMPTEUR BADGE TOTAL
function listenTotalUnreadCount() {
    const totalBadgeEl = document.getElementById("totalUnreadBadge");
    if (!totalBadgeEl) return;

    db.collection("chats").onSnapshot((snapshot) => {
        let totalUnread = 0;
        const unreadKey = `unreadCount_${currentUser.uid}`;

        snapshot.forEach((doc) => {
            const data = doc.data();
            if (data[unreadKey]) {
                totalUnread += data[unreadKey];
            }
        });

        if (totalUnread > 0) {
            totalBadgeEl.textContent = totalUnread > 99 ? "99+" : totalUnread;
            totalBadgeEl.style.display = "flex";
        } else {
            totalBadgeEl.style.display = "none";
        }
    });
}

//  INTERFACE DE CHAT ET PACKS DE STICKERS
function renderChatLayout() {
    const chatArea = document.querySelector(".chat-area");
    if (!chatArea) return;

    chatArea.innerHTML = `
        <header class="chat-header">
            <button class="btn-back-mobile" id="btnBackMobile" title="Retour aux discussions" type="button">
                <i class="fa-solid fa-arrow-left"></i>
            </button>
            <div class="chat-user">
                <div class="avatar group">--</div>
                <div>
                    <h2>Chargement...</h2>
                    <p><span class="online-dot"></span> En ligne</p>
                </div>
            </div>
            <div class="chat-actions">
                <button title="Rechercher" type="button"><i class="fa-solid fa-magnifying-glass"></i></button>
                <button title="Appel vocal" type="button"><i class="fa-solid fa-phone"></i></button>
                <button title="Appel vidéo" type="button"><i class="fa-solid fa-video"></i></button>
                <button title="Options" type="button"><i class="fa-solid fa-ellipsis-vertical"></i></button>
            </div>
        </header>

        <div class="messages"></div>

        <footer class="message-form" style="position: relative;">
            <button class="attachment-button" type="button"><i class="fa-solid fa-paperclip"></i></button>
            <input type="text" placeholder="Écrire un message..." />

            <div id="stickerPicker" class="sticker-picker-popup">
                <div class="sticker-header">
                    <span>Packs d'Emojis & Stickers 🚀</span>
                    <button type="button" id="closeStickerPicker">&times;</button>
                </div>
                <div class="sticker-grid">
                    <span class="sticker-item">👍</span>
                    <span class="sticker-item">❤️</span>
                    <span class="sticker-item">🔥</span>
                    <span class="sticker-item">😂</span>
                    <span class="sticker-item">🚀</span>
                    <span class="sticker-item">🎉</span>
                    <span class="sticker-item">😊</span>
                    <span class="sticker-item">🙌</span>
                    <span class="sticker-item">👏</span>
                    <span class="sticker-item">💡</span>
                    <span class="sticker-item">💯</span>
                    <span class="sticker-item">✨</span>
                </div>
            </div>

            <button class="emoji-button" type="button" id="stickerBtn"><i class="fa-regular fa-face-smile"></i></button>
            <button class="send-button" type="button">
                <i class="fa-solid fa-paper-plane"></i>
            </button>
        </footer>
    `;

    const btnBack = chatArea.querySelector("#btnBackMobile");
    if (btnBack) {
        btnBack.addEventListener("click", () => {
            const convList = document.querySelector(".conversation-list");
            if (convList) convList.style.display = "flex";
            chatArea.style.display = "none";
        });
    }

    const btnPhone = chatArea.querySelector(".chat-actions button:nth-child(2)");
    const btnVideo = chatArea.querySelector(".chat-actions button:nth-child(3)");

    if (btnPhone) {
        btnPhone.addEventListener("click", (e) => {
            e.preventDefault();
            if (activeChatUserId) startCall(activeChatUserId, false);
        });
    }

    if (btnVideo) {
        btnVideo.addEventListener("click", (e) => {
            e.preventDefault();
            if (activeChatUserId) startCall(activeChatUserId, true);
        });
    }

    const sendBtn = chatArea.querySelector(".send-button");
    const messageInput = chatArea.querySelector("input[type='text']");

    if (sendBtn) sendBtn.addEventListener("click", sendMessage);
    if (messageInput) {
        messageInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    const emojiBtn = chatArea.querySelector("#stickerBtn");
    const stickerPicker = chatArea.querySelector("#stickerPicker");
    const closeBtn = chatArea.querySelector("#closeStickerPicker");

    if (emojiBtn && stickerPicker) {
        emojiBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            stickerPicker.classList.toggle("active");
        });

        if (closeBtn) {
            closeBtn.addEventListener("click", () => {
                stickerPicker.classList.remove("active");
            });
        }

        chatArea.querySelectorAll(".sticker-item").forEach(item => {
            item.addEventListener("click", () => {
                if (messageInput) {
                    messageInput.value += item.textContent;
                    messageInput.focus();
                }
            });
        });
    }
}

//  SÉLECTIONNER ET LIRE UNE DISCUSSION
function selectContact(targetUser) {
    activeChatUserId = targetUser.uid;

    const chatId = [currentUser.uid, targetUser.uid].sort().join("_");

    db.collection("chats").doc(chatId).set({
        [`unreadCount_${currentUser.uid}`]: 0
    }, { merge: true }).catch(err => console.error("Erreur reset unread:", err));

    const chatHeaderName = document.querySelector(".chat-user h2");
    if (chatHeaderName) chatHeaderName.textContent = targetUser.username || "Discussion";

    const chatHeaderAvatar = document.querySelector(".chat-user .avatar");
    if (chatHeaderAvatar) {
        chatHeaderAvatar.textContent = targetUser.username ? targetUser.username.substring(0, 2).toUpperCase() : "U";
    }

    if (unsubscribeMessages) unsubscribeMessages();

    const messagesContainer = document.querySelector(".messages");

    unsubscribeMessages = db.collection("chats")
        .doc(chatId)
        .collection("messages")
        .orderBy("timestamp", "asc")
        .onSnapshot(async (snapshot) => {
            if (!messagesContainer) return;
            messagesContainer.innerHTML = "";

            if (snapshot.empty) {
                messagesContainer.innerHTML = `
                    <div class="encryption-notice">
                        <i class="fa-solid fa-shield-halved"></i>
                        <div>
                            <strong>Chiffrement E2EE activé</strong>
                            <p>Envoyez un premier message chiffré !</p>
                        </div>
                    </div>
                `;
                return;
            }

            const myPrivateKey = localStorage.getItem(`e2ee_private_${currentUser.uid}`);

            for (const doc of snapshot.docs) {
                const msg = doc.data();
                const isMine = msg.senderId === currentUser.uid;

                let timeStr = "";
                if (msg.timestamp) {
                    const date = msg.timestamp.toDate();
                    timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                }

                let clearText = msg.text;

                if (typeof E2EE !== "undefined" && myPrivateKey) {
                    try {
                        const targetEncryptedText = isMine ? (msg.textForSender || msg.text) : msg.text;
                        clearText = await E2EE.decryptText(targetEncryptedText, myPrivateKey);
                    } catch (err) {
                        console.error("Échec déchiffrement message:", err);
                        clearText = `<span style="font-style: italic; opacity: 0.75; color: #ef4444;"> Message chiffré (clé indisponible sur cet appareil)</span>`;
                    }
                }

                if (msg.isSystemCall) {
                    const callMsgDiv = document.createElement("div");
                    callMsgDiv.className = "system-call-notice";
                    callMsgDiv.style.cssText = "text-align: center; margin: 10px 0; color: #94a3b8; font-size: 12px;";
                    callMsgDiv.innerHTML = `<span style="background: rgba(255, 255, 255, 0.05); padding: 5px 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">${clearText} • ${timeStr}</span>`;
                    messagesContainer.appendChild(callMsgDiv);
                    continue;
                }

                const msgDiv = document.createElement("div");
                msgDiv.className = `message ${isMine ? "sent" : "received"}`;
                msgDiv.innerHTML = `
                    <p>${clearText}</p>
                    <time>${timeStr} ${isMine ? '<i class="fa-solid fa-check-double status-read"></i>' : ''}</time>
                `;
                messagesContainer.appendChild(msgDiv);
            }

            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        });
}

//  ENVOYER UN MESSAGE CHIFFRÉ
async function sendMessage() {
    const messageInput = document.querySelector(".message-form input[type='text']");
    if (!messageInput || !activeChatUserId) return;

    const rawText = messageInput.value.trim();
    if (!rawText) return;

    messageInput.value = "";

    const chatId = [currentUser.uid, activeChatUserId].sort().join("_");
    const chatDocRef = db.collection("chats").doc(chatId);

    try {
        let textForReceiver = rawText;
        let textForSender = rawText;

        if (typeof E2EE !== "undefined") {
            const receiverDoc = await db.collection("users").doc(activeChatUserId).get();
            const senderDoc = await db.collection("users").doc(currentUser.uid).get();

            const receiverPublicKey = receiverDoc.data()?.publicKey;
            const senderPublicKey = senderDoc.data()?.publicKey;

            if (receiverPublicKey) {
                textForReceiver = await E2EE.encryptText(rawText, receiverPublicKey);
            }

            if (senderPublicKey) {
                textForSender = await E2EE.encryptText(rawText, senderPublicKey);
            }
        }

        await chatDocRef.collection("messages").add({
            senderId: currentUser.uid,
            receiverId: activeChatUserId,
            text: textForReceiver,
            textForSender: textForSender,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        const unreadKey = `unreadCount_${activeChatUserId}`;
        
        await chatDocRef.set({
            lastMessage: textForReceiver,
            lastSenderId: currentUser.uid,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            [unreadKey]: firebase.firestore.FieldValue.increment(1)
        }, { merge: true });

    } catch (error) {
        console.error("Erreur lors de l'envoi du message chiffré :", error);
    }
}

//  LOGIQUE PEERJS ET APPELS WEBRTC
// 📞 LOGIQUE PEERJS ET APPELS WEBRTC (VERSION CORRIGÉE & COMPLÈTE)
let peer = null;
let currentCall = null;
let localStream = null;
let incomingCall = null;

function initPeerJS(userId) {
    peer = new Peer(userId, {
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        }
    });

    peer.on('open', (id) => {
        console.log("Connecté au serveur PeerJS avec l'ID :", id);
    });

    // Réception d'un appel : ouvre la modale sans bloquer les clics
    peer.on('call', (call) => {
        incomingCall = call;

        const callModal = document.getElementById("callModal");
        const callStatus = document.getElementById("callStatus");
        const acceptBtn = document.getElementById("acceptCallBtn");

        if (callModal) callModal.style.display = "flex";
        if (callStatus) callStatus.textContent = "Appel entrant... ";
        if (acceptBtn) acceptBtn.style.display = "inline-block";
    });
}

// 📲 Lancer un appel
async function startCall(targetUserId, isVideo = false) {
    if (!peer) return alert("Service d'appel non prêt.");

    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: isVideo,
            audio: true
        });

        const callModal = document.getElementById("callModal");
        const callStatus = document.getElementById("callStatus");
        const acceptBtn = document.getElementById("acceptCallBtn");
        const videoContainer = document.getElementById("videoContainer");

        if (callModal) callModal.style.display = "flex";
        if (callStatus) callStatus.textContent = "Appel en cours... ";
        if (acceptBtn) acceptBtn.style.display = "none";

        if (isVideo && videoContainer) {
            videoContainer.style.display = "block";
            const localVideo = document.getElementById("localVideo");
            if (localVideo) localVideo.srcObject = localStream;
        } else if (videoContainer) {
            videoContainer.style.display = "none";
        }

        const call = peer.call(targetUserId, localStream);
        currentCall = call;

        call.on('stream', (remoteStream) => {
            if (callStatus) callStatus.textContent = "En communication... ";
            if (isVideo) {
                const remoteVideo = document.getElementById("remoteVideo");
                if (remoteVideo) remoteVideo.srcObject = remoteStream;
            } else {
                const remoteAudio = document.getElementById("remoteAudio");
                if (remoteAudio) remoteAudio.srcObject = remoteStream;
            }
        });

        call.on('close', endCall);

    } catch (err) {
        console.error("Erreur lancement appel :", err);
        alert("Permission refusée pour la caméra/micro.");
    }
}

// 🛑 Raccrocher et couper les flux
function endCall() {
    if (currentCall) {
        currentCall.close();
        currentCall = null;
    }
    if (incomingCall) {
        incomingCall.close();
        incomingCall = null;
    }

    if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
        localStream = null;
    }

    const callModal = document.getElementById("callModal");
    if (callModal) callModal.style.display = "none";

    const localVideo = document.getElementById("localVideo");
    const remoteVideo = document.getElementById("remoteVideo");
    const remoteAudio = document.getElementById("remoteAudio");

    if (localVideo) localVideo.srcObject = null;
    if (remoteVideo) remoteVideo.srcObject = null;
    if (remoteAudio) remoteAudio.srcObject = null;
}

// 🔑 Attachement sécurisé des clics sur les boutons de la modale
document.addEventListener("DOMContentLoaded", () => {
    const acceptCallBtn = document.getElementById("acceptCallBtn");
    const endCallBtn = document.getElementById("endCallBtn");

    if (acceptCallBtn) {
        acceptCallBtn.addEventListener("click", async () => {
            if (!incomingCall) return;

            try {
                localStream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: true
                });

                const callStatus = document.getElementById("callStatus");
                const videoContainer = document.getElementById("videoContainer");

                if (callStatus) callStatus.textContent = "En communication... ";
                acceptCallBtn.style.display = "none";

                incomingCall.answer(localStream);
                currentCall = incomingCall;

                currentCall.on('stream', (remoteStream) => {
                    const hasVideo = remoteStream.getVideoTracks().length > 0;

                    if (hasVideo && videoContainer) {
                        videoContainer.style.display = "block";
                        const localVideo = document.getElementById("localVideo");
                        const remoteVideo = document.getElementById("remoteVideo");
                        if (localVideo) localVideo.srcObject = localStream;
                        if (remoteVideo) remoteVideo.srcObject = remoteStream;
                    } else if (videoContainer) {
                        videoContainer.style.display = "none";
                        const remoteAudio = document.getElementById("remoteAudio");
                        if (remoteAudio) remoteAudio.srcObject = remoteStream;
                    }
                });

                currentCall.on('close', endCall);

            } catch (err) {
                console.error("Erreur acceptation appel :", err);
                alert("Impossible d'accéder au micro ou à la caméra.");
            }
        });
    }

    if (endCallBtn) {
        endCallBtn.addEventListener("click", endCall);
    }
});

// 🔑 Chargeur de clé publique pour la vue Appareils
function loadDevicePublicKey() {
    const keyElement = document.getElementById("publicKeyDisplay");
    if (!keyElement || !currentUser) return;

    try {
        const myPrivateKey = localStorage.getItem(`e2ee_private_${currentUser.uid}`);
        keyElement.textContent = myPrivateKey || "Aucune clé privée générée sur cet appareil.";
    } catch (error) {
        console.error("Erreur de chargement de la clé :", error);
        keyElement.textContent = "Erreur lors du chargement de la clé.";
    }
}