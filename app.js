/* =============================================================================
   app-2.js — Messagerie (Firebase Auth + Firestore + E2EE + PeerJS)
   =============================================================================
   Corrections & nouveautés
   - Liste des contacts / conversations : chargement corrigé (loadContacts manquant, variable « first » absente)
   - Groupes : icône dédiée (au lieu des initiales), contacts : initiales colorées
   - Interface : vraies icônes Font Awesome, style de messagerie moderne
   - Dernière connexion détaillée dans l'en-tête (en ligne / il y a X min / hier à HH:MM / date)
   - Nouveaux messages : conversation en gras + badge, séparateur « N nouveaux messages »
   - Statuts : envoi en cours, envoyé (✓), reçu (✓✓ gris), vu (✓✓ bleu)
   - Modifier un message, le supprimer pour moi ou pour tout le monde (sans trace)
   - Bloquer / débloquer un utilisateur
   - Notifications (navigateur + bulle dans l'app + son + compteur dans le titre)
   - Recherche par nom d'utilisateur
   - Code QR personnel + scanner (onglet Appareils) + lien direct ?add=<uid>

   Structure Firestore utilisée
   - users/{uid}                          profil, clés E2EE, status/lastSeen (transitions)
   - presence/{uid}                       status/lastSeen (battement de cœur, lu seulement par le correspondant)
   - blocks/{blockerUid}_{blockedUid}     blocages
   - chats/{uidA_uidB}                    compteurs unreadCount_<uid>
   - chats/{uidA_uidB}/messages/{id}      messages (status, edited, deletedFor, suppressed…)
   - calls/{id}                           appels
   ============================================================================= */

// ============================================================================
// 1. CONFIGURATION & INITIALISATION FIREBASE
// ============================================================================
const firebaseConfig = {
    apiKey: "AIzaSyAWQk-ggRbQbseTNJFQccVjAPpeWP5eD1I",
    authDomain: "chat-80cef.firebaseapp.com",
    projectId: "chat-80cef",
    storageBucket: "chat-80cef.firebasestorage.app",
    messagingSenderId: "275397956073",
    appId: "1:275397956073:web:52d15213320d05213bfb78"
};

document.addEventListener("DOMContentLoaded", () => {
    const brokenImg = document.querySelector(".chat-area img, #emptyState img");
    if (brokenImg) {
        const iconContainer = document.createElement("div");
        iconContainer.innerHTML = `<i class="fa-solid fa-comments" style="font-size: 68px; color: #3b82f6; margin-bottom: 20px; display: block;"></i>`;
        brokenImg.replaceWith(iconContainer.firstElementChild);
    }
});

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();
const FieldValue = firebase.firestore.FieldValue;

// ============================================================================
// 2. CONSTANTES & ÉTAT GLOBAL
// ============================================================================
const HEARTBEAT_MS = 60 * 1000;            // fréquence du battement de présence
const PRESENCE_STALE_MS = 150 * 1000;      // au-delà, on considère la personne hors ligne
const EDIT_WINDOW_MS = 48 * 60 * 60 * 1000; // délai pour modifier un message (48 h)
const BASE_TITLE = document.title;

const QR_GEN_URLS = [
    "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js",
    "https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"
];
const QR_SCAN_URLS = [
    "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js",
    "https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.min.js"
];

let currentUser = null;
let myUsername = "";
let activeChatUserId = null;
let activeChat = null;            // { uid, chatId, docs, lastSnapshot, newIds, msgIndex, ... }
let unsubscribeMessages = null;
let unsubscribeStatus = null;     // écouteur de présence du correspondant
let unsubscribeUsers = null;
let unsubscribeGroups = null;
let unsubscribeBlocks = [];
let heartbeatTimer = null;
let statusTicker = null;
let renderSeq = 0;
let editingMsg = null;            // { id, original }
let currentSearchQuery = "";
let sortTimer = null;
let presenceBound = false;

// PeerJS / appels
let peer = null;
let currentCall = null;
let localStream = null;
let incomingCall = null;

const usersById = new Map();      // uid -> données utilisateur
const convState = new Map();      // uid -> état de la conversation 1:1 dans la liste
const groupState = new Map();     // groupId -> état de la conversation de groupe dans la liste
const contactCards = new Map();   // uid -> { el, nameEl, avatarEl }
const decryptCache = new Map();   // msgId -> { cipher, clear, key }
const publicKeyCache = new Map(); // uid -> clé publique
let blockedByMe = new Map();      // uid bloqué -> timestamp (ms) du blocage
let blockedMe = new Set();        // uid de ceux qui m'ont bloqué

// Lien direct (?add=<uid>) : conservé jusqu'à la connexion
(function captureDeepLink() {
    try {
        const params = new URLSearchParams(location.search);
        const uid = params.get("add");
        if (uid) {
            sessionStorage.setItem("pendingChatUid", uid);
            params.delete("add");
            const qsStr = params.toString();
            history.replaceState(null, "", location.pathname + (qsStr ? `?${qsStr}` : "") + location.hash);
        }
    } catch (e) { /* stockage indisponible */ }
})();

// ============================================================================
// 3. STYLES INJECTÉS (les fichiers HTML/CSS existants restent inchangés)
// ============================================================================
const X_STYLES = `
:root { --x-accent: #2563eb; --x-read: #38bdf8; --x-danger: #dc2626; }

/* ---------- Mode sombre ---------- */
html[data-theme="dark"] { color-scheme: dark; }
html[data-theme="dark"] body,
html[data-theme="dark"] .app-layout,
html[data-theme="dark"] .conversation-list,
html[data-theme="dark"] .chat-area,
html[data-theme="dark"] .dashboard,
html[data-theme="dark"] .sidebar { background-color: #0f172a !important; color: #e2e8f0 !important; }
html[data-theme="dark"] .sidebar,
html[data-theme="dark"] .conversation-list,
html[data-theme="dark"] .chat-header,
html[data-theme="dark"] .message-form,
html[data-theme="dark"] .search-bar,
html[data-theme="dark"] .sidebar-profile { background-color: #111827 !important; border-color: #1e293b !important; }
html[data-theme="dark"] .conversation,
html[data-theme="dark"] #contacts-list > div,
html[data-theme="dark"] .x-dialog,
html[data-theme="dark"] .x-menu,
html[data-theme="dark"] .x-qr-card { background-color: #1e293b !important; border-color: #334155 !important; color: #e2e8f0 !important; }
html[data-theme="dark"] .conversation:hover,
html[data-theme="dark"] .conversation.active-conversation { background-color: #273449 !important; }
html[data-theme="dark"] .conversation-info h3,
html[data-theme="dark"] .chat-user h2,
html[data-theme="dark"] .x-dialog h3,
html[data-theme="dark"] .x-qr-card h3,
html[data-theme="dark"] .x-qr-name,
html[data-theme="dark"] .sidebar-profile .profile-info h4 { color: #f1f5f9 !important; }
html[data-theme="dark"] .conversation-info p,
html[data-theme="dark"] .last-msg-time,
html[data-theme="dark"] .user-status-text,
html[data-theme="dark"] .x-dialog p,
html[data-theme="dark"] .x-qr-sub { color: #94a3b8 !important; }
html[data-theme="dark"] .message-form input[type="text"] { background-color: #1e293b !important; color: #e2e8f0 !important; border-color: #334155 !important; }
html[data-theme="dark"] .message.received { background-color: #1e293b !important; color: #e2e8f0 !important; }
html[data-theme="dark"] .message.sent { background-color: var(--x-accent) !important; color: #fff !important; }
html[data-theme="dark"] .x-menu button { color: #e2e8f0 !important; }
html[data-theme="dark"] .x-menu button:hover { background-color: #273449 !important; }
html[data-theme="dark"] .x-btn-ghost { background: #1e293b !important; color: #e2e8f0 !important; border-color: #334155 !important; }
html[data-theme="dark"] .x-qr-box { background: #fff !important; } /* le QR doit rester lisible par un scanner */
html[data-theme="dark"] .x-banner { background: #1e293b !important; color: #e2e8f0 !important; border-color: #334155 !important; }
html[data-theme="dark"] .x-toast { background: #1e293b !important; }

.x-theme-toggle { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; color: #0f172a; cursor: pointer; font-size: 14px; flex-shrink: 0; }
.sidebar-brand .x-theme-toggle { margin-left: auto; }
@media (max-width: 850px) { .sidebar-brand .x-theme-toggle { display: none; } }
html[data-theme="dark"] .x-theme-toggle { background: #1e293b; color: #e2e8f0; border-color: #334155; }
.x-fab { position: absolute; right: 18px; bottom: 84px; width: 48px; height: 48px; border: none; border-radius: 50%; background: var(--x-accent); color: #fff; font-size: 18px; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 20px rgba(37,99,235,.4); cursor: pointer; z-index: 20; }
.x-fab:hover { filter: brightness(1.08); }

.x-member-row { display: flex; align-items: center; gap: 10px; padding: 8px 4px; border-bottom: 1px solid #f1f5f9; }
html[data-theme="dark"] .x-member-row { border-color: #1e293b; }
.x-member-row label { display: flex; align-items: center; gap: 10px; flex: 1; cursor: pointer; font-size: 14px; color: #0f172a; }
html[data-theme="dark"] .x-member-row label { color: #e2e8f0; }
.x-member-row .avatar { width: 32px; height: 32px; font-size: 12px; }
.x-group-form input[type="text"] { width: 100%; padding: 9px 12px; margin-bottom: 10px; border: 1px solid #e2e8f0; border-radius: 8px; font: inherit; box-sizing: border-box; }
html[data-theme="dark"] .x-group-form input[type="text"] { background: #1e293b; color: #e2e8f0; border-color: #334155; }
.x-group-members { max-height: 220px; overflow-y: auto; margin-bottom: 14px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 4px 10px; }
html[data-theme="dark"] .x-group-members { border-color: #334155; }
.x-sender-name { display: block; margin-bottom: 2px; font-size: 12px; font-weight: 700; color: var(--x-accent); }

.message { position: relative; }
.message p { white-space: pre-wrap; overflow-wrap: anywhere; }
.message.x-new p { font-weight: 700; }
.message .x-edited { font-size: 11px; font-style: italic; opacity: .75; margin-right: 4px; }
.x-tick { font-size: 11px; opacity: .7; }
.x-tick.x-read { color: var(--x-read); opacity: 1; }
.message .x-tick { margin-left: 4px; }
.conversation .last-msg-text .x-tick { margin-right: 4px; }

.x-date-sep { display: block; width: fit-content; margin: 12px auto 6px; padding: 3px 12px; font-size: 12px; color: #64748b; background: rgba(148,163,184,.18); border-radius: 999px; text-align: center; }
.x-unread-divider { display: flex; align-items: center; gap: 10px; margin: 10px 0; color: var(--x-accent); font-size: 12px; font-weight: 600; }
.x-unread-divider::before, .x-unread-divider::after { content: ""; flex: 1; height: 1px; background: currentColor; opacity: .35; }

.x-msg-menu-btn { position: absolute; top: 3px; right: 5px; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; border: none; border-radius: 50%; background: rgba(0,0,0,.14); color: inherit; font-size: 10px; cursor: pointer; opacity: 0; transition: opacity .15s; }
.message:hover .x-msg-menu-btn, .x-msg-menu-btn:focus-visible { opacity: 1; }
@media (hover: none) { .x-msg-menu-btn { opacity: .55; } }

.x-menu { position: fixed; z-index: 10000; min-width: 190px; padding: 6px; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; box-shadow: 0 10px 30px rgba(15,23,42,.18); font-size: 14px; }
.x-menu button { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 12px; border: none; border-radius: 8px; background: none; color: #0f172a; font: inherit; text-align: left; cursor: pointer; }
.x-menu button:hover, .x-menu button:focus-visible { background: #f1f5f9; outline: none; }
.x-menu button.x-danger { color: var(--x-danger); }
.x-menu i { width: 16px; text-align: center; }

.x-backdrop { position: fixed; inset: 0; z-index: 10001; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(15,23,42,.5); }
.x-dialog { width: 100%; max-width: 360px; padding: 20px; background: #fff; border-radius: 14px; box-shadow: 0 20px 50px rgba(15,23,42,.3); }
.x-dialog h3 { margin: 0 0 8px; font-size: 17px; color: #0f172a; }
.x-dialog p { margin: 0 0 16px; font-size: 14px; line-height: 1.45; color: #475569; }
.x-actions { display: flex; flex-direction: column; gap: 8px; }

.x-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 10px 14px; border: 1px solid transparent; border-radius: 8px; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
.x-btn:focus-visible { outline: 2px solid var(--x-accent); outline-offset: 2px; }
.x-btn-primary { background: var(--x-accent); color: #fff; }
.x-btn-danger { background: var(--x-danger); color: #fff; }
.x-btn-ghost { background: #fff; color: #0f172a; border-color: #e2e8f0; }

.x-toasts { position: fixed; top: 14px; right: 14px; z-index: 10002; display: flex; flex-direction: column; gap: 8px; max-width: min(340px, calc(100vw - 28px)); }
.x-toast { padding: 10px 14px; background: #0f172a; color: #fff; border-radius: 10px; box-shadow: 0 8px 24px rgba(15,23,42,.3); font-size: 13px; cursor: pointer; }
.x-toast strong { display: block; margin-bottom: 2px; }
.x-toast span { display: block; overflow: hidden; opacity: .85; text-overflow: ellipsis; white-space: nowrap; }

.x-banner { display: flex; align-items: center; gap: 10px; padding: 8px 14px; background: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 13px; color: #334155; }
.x-banner .x-banner-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.x-banner button { border: none; background: none; color: var(--x-accent); font: inherit; font-weight: 600; cursor: pointer; }
.x-banner.x-blocked { background: #fef2f2; color: #991b1b; }
.x-banner.x-blocked button { color: #991b1b; text-decoration: underline; }

.x-qr-card { max-width: 420px; margin: 16px 0; padding: 20px; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; text-align: center; }
.x-qr-card h3 { margin: 0 0 4px; font-size: 16px; color: #0f172a; }
.x-qr-card .x-qr-sub { margin: 0 0 14px; font-size: 13px; color: #64748b; }
.x-qr-box { display: inline-block; min-width: 200px; min-height: 200px; padding: 12px; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; }
.x-qr-box img, .x-qr-box canvas { display: block; }
.x-qr-name { margin-top: 10px; font-weight: 600; color: #0f172a; }
.x-qr-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 14px; }

.x-scanner { position: fixed; inset: 0; z-index: 10003; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #000; }
.x-scanner video { width: 100%; max-height: 78vh; object-fit: cover; }
.x-scan-frame { position: absolute; width: 240px; height: 240px; border: 3px solid var(--x-read); border-radius: 16px; box-shadow: 0 0 0 9999px rgba(0,0,0,.45); pointer-events: none; }
.x-scan-hint { margin-top: 16px; padding: 0 16px; font-size: 14px; color: #fff; text-align: center; }
.x-scan-close { margin-top: 16px; }

/* =====================================================================
   Refonte visuelle (style messageries modernes)
   ===================================================================== */
body { font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; -webkit-font-smoothing: antialiased; }

/* ---------- Avatars : initiales colorées (contact) / icône (groupe) ---------- */
body .avatar.x-av { display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; width: 48px; height: 48px; min-width: 48px; flex-shrink: 0; border-radius: 50%; overflow: hidden; background: #2563eb; color: #fff; font-size: 16px; font-weight: 600; letter-spacing: .3px; line-height: 1; user-select: none; }
body .avatar.x-av.x-av-group { background: linear-gradient(135deg, #6366f1 0%, #2563eb 100%) !important; }
body .avatar.x-av i { font-size: 1.1em; line-height: 1; }
body .conversation .avatar.x-av { width: 50px; height: 50px; min-width: 50px; }
body .chat-user .avatar.x-av { width: 42px; height: 42px; min-width: 42px; font-size: 15px; }
body .x-member-row .avatar.x-av { width: 34px; height: 34px; min-width: 34px; font-size: 12px; }
body .avatar.x-av.x-av-xl { width: 76px; height: 76px; min-width: 76px; font-size: 30px; }
.x-group-hero { display: flex; justify-content: center; margin: 4px 0 14px; }

/* ---------- Liste des conversations ---------- */
body .conversation { display: flex; align-items: center; gap: 12px; margin: 2px 8px; padding: 10px 12px; border: 0; border-radius: 12px; cursor: pointer; transition: background-color .15s ease; }
body .conversation:hover { background-color: #f1f5f9; }
body .conversation.active-conversation { background-color: #e8f0fe; }
body .conversation-info { flex: 1; min-width: 0; }
body .conversation-info h3 { margin: 0 0 2px; font-size: 15px; font-weight: 600; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
body .conversation-info p { margin: 0; font-size: 13.5px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
body .conversation-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; flex-shrink: 0; }
body .last-msg-time { font-size: 12px; color: #94a3b8; }
body .conversation.x-unread .last-msg-time { color: var(--x-accent); font-weight: 600; }
body .conversation .unread { box-sizing: border-box; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: var(--x-accent); color: #fff; font-size: 11px; font-weight: 700; line-height: 1; }
.x-empty-users { padding: 28px 16px; margin: 0; text-align: center; font-size: 13.5px; color: #94a3b8; }

/* ---------- Onglet Contacts ---------- */
.x-contact-card { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; padding: 12px 14px; background: #fff; border: 1px solid #e5e9f0; border-radius: 14px; transition: box-shadow .15s ease; }
.x-contact-card:hover { box-shadow: 0 4px 14px rgba(15,23,42,.07); }
.x-contact-main { display: flex; align-items: center; gap: 12px; min-width: 0; }
.x-contact-text { display: flex; flex-direction: column; min-width: 0; }
.x-contact-name { margin: 0; font-size: 15px; font-weight: 600; color: #0f172a; }
.x-contact-sub { font-size: 12.5px; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.x-contact-btn { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; padding: 8px 14px; border: 0; border-radius: 999px; background: var(--x-accent); color: #fff; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; transition: filter .15s ease; }
.x-contact-btn:hover { filter: brightness(1.1); }

/* ---------- En-tête de discussion ---------- */
body .chat-header { display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: #fff; border-bottom: 1px solid #e5e9f0; box-shadow: 0 1px 2px rgba(15,23,42,.04); }
body .chat-user { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; }
body .chat-user h2 { margin: 0; font-size: 16px; font-weight: 600; line-height: 1.25; color: #0f172a; }
body .user-status-text { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 12.5px; color: #64748b; }
body .chat-actions { display: flex; align-items: center; gap: 2px; }
body .chat-actions button, body .btn-back-mobile { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border: 0; border-radius: 50%; background: transparent; color: #475569; font-size: 16px; cursor: pointer; transition: background-color .15s ease; }
body .chat-actions button:hover, body .btn-back-mobile:hover { background: #f1f5f9; }

/* ---------- Messages ---------- */
body .chat-area .messages { padding: 16px 20px; background: #eef1f6; }
body .message { max-width: min(78%, 560px); padding: 8px 12px 6px; border-radius: 18px; font-size: 14.5px; line-height: 1.4; box-shadow: 0 1px 1px rgba(15,23,42,.08); }
body .message p { margin: 0; }
body .message.sent { background: var(--x-accent); color: #fff; border-bottom-right-radius: 6px; }
body .message.received { background: #fff; color: #0f172a; border-bottom-left-radius: 6px; }
body .message time { display: block; margin-top: 2px; text-align: right; font-size: 11px; opacity: .75; }
body .encryption-notice { display: flex; align-items: center; gap: 12px; max-width: 420px; margin: 12px auto; padding: 10px 14px; border-radius: 12px; background: #fff7d6; color: #6b5a1a; font-size: 12.5px; line-height: 1.4; }
body .encryption-notice strong { display: block; font-size: 13px; }
body .encryption-notice p { margin: 0; }
body .encryption-notice > i { font-size: 18px; }

/* ---------- Zone de saisie ---------- */
body .message-form { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: #fff; border-top: 1px solid #e5e9f0; }
body .message-form input[type="text"] { flex: 1; min-width: 0; height: 44px; padding: 0 18px; border: 1px solid #e2e8f0; border-radius: 22px; background: #f4f6fa; font-size: 15px; outline: none; transition: border-color .15s ease, box-shadow .15s ease, background-color .15s ease; }
body .message-form input[type="text"]:focus { background: #fff; border-color: var(--x-accent); box-shadow: 0 0 0 3px rgba(37,99,235,.14); }
body .message-form .attachment-button, body .message-form .emoji-button { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; flex-shrink: 0; border: 0; border-radius: 50%; background: transparent; color: #64748b; font-size: 18px; cursor: pointer; transition: background-color .15s ease; }
body .message-form .attachment-button:hover, body .message-form .emoji-button:hover { background: #f1f5f9; }
body .message-form .send-button { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; flex-shrink: 0; border: 0; border-radius: 50%; background: var(--x-accent); color: #fff; font-size: 16px; cursor: pointer; transition: filter .15s ease; }
body .message-form .send-button:hover { filter: brightness(1.1); }
body .sticker-item { cursor: pointer; }


/* ---------- Mode sombre : compléments ---------- */
html[data-theme="dark"] body .conversation:hover { background-color: #273449 !important; }
html[data-theme="dark"] body .conversation.active-conversation { background-color: #1e3a8a55 !important; }
html[data-theme="dark"] body .conversation-info h3, html[data-theme="dark"] body .x-contact-name { color: #f1f5f9; }
html[data-theme="dark"] body .conversation-info p, html[data-theme="dark"] body .x-contact-sub, html[data-theme="dark"] body .last-msg-time { color: #94a3b8; }
html[data-theme="dark"] .x-contact-card { background: #1e293b !important; border-color: #334155 !important; }
html[data-theme="dark"] body .chat-area .messages { background: #0b1220 !important; }
html[data-theme="dark"] body .chat-actions button, html[data-theme="dark"] body .btn-back-mobile, html[data-theme="dark"] body .message-form .attachment-button, html[data-theme="dark"] body .message-form .emoji-button { color: #cbd5e1; }
html[data-theme="dark"] body .chat-actions button:hover, html[data-theme="dark"] body .btn-back-mobile:hover, html[data-theme="dark"] body .message-form .attachment-button:hover, html[data-theme="dark"] body .message-form .emoji-button:hover { background: #273449; }
html[data-theme="dark"] body .encryption-notice { background: #3b3417; color: #fde68a; }
html[data-theme="dark"] body .message-form input[type="text"]:focus { background: #0f172a !important; }

/* ---------- Message impossible à déchiffrer (groupe) ---------- */
body .message.x-undecryptable p { font-style: italic; opacity: .75; }

/* ---------- Réactivité mobile : la barre de saisie doit toujours rester visible ---------- */
html, body { height: 100%; }
/* Le vrai conteneur racine du HTML est .dashboard (pas #appLayout, qui n'existe pas dans cette page) */
body .dashboard { height: var(--x-app-vh, 100vh); max-height: var(--x-app-vh, 100vh); }
body .chat-area, body .conversation-list { height: 100%; }
body .chat-area .messages { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; }
body .chat-header, body .message-form { flex: 0 0 auto; }
body .message-form { padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px)); }
body .chat-user h2 { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 42vw; }
@media (max-width: 768px) {
    /* style.css fixe .chat-area/.conversation-list à 100vh avec !important en mode plein écran
       mobile ; 100vh ne rétrécit pas quand le clavier s'ouvre (bug Android connu), donc on
       reprend la main avec la hauteur réellement visible (--x-app-vh, mise à jour en JS). */
    body .chat-area { height: var(--x-app-vh, 100vh) !important; }
    body .conversation-list { height: var(--x-app-vh, 100vh) !important; }
}
@media (max-width: 480px) {
    body .chat-header { padding: 8px 10px; gap: 8px; }
    body .chat-user h2 { max-width: 34vw; font-size: 15px; }
    body .chat-actions { gap: 0; }
    body .chat-actions button { width: 34px; height: 34px; font-size: 14px; }
    body .message-form { padding: 8px 10px; }
    body .message-form input[type="text"] { height: 40px; font-size: 14px; }
}

/* ---------- Réactivité mobile : onglets Contacts / Appareils / Paramètres ---------- */
@media (max-width: 480px) {
    #tab-contacts, #tab-devices, #tab-settings { padding: 14px !important; }
    .x-qr-card { padding: 14px !important; max-width: 100% !important; }
    .x-qr-box { min-width: 0 !important; width: fit-content; max-width: 100%; padding: 8px !important; }
    .x-qr-box img, .x-qr-box canvas, .x-qr-box table { max-width: 100% !important; height: auto !important; }
}
`;

// Corrige un problème classique sur Android : quand le clavier s'ouvre, la fenêtre visible
// (visualViewport) rétrécit, mais la page garde souvent sa hauteur d'origine — la barre de
// saisie se retrouve alors poussée hors de l'écran, sous le clavier. On force la hauteur
// réelle de l'app à suivre celle de la zone effectivement visible.
function setupMobileViewportFix() {
    const root = document.documentElement;
    const vv = window.visualViewport;
    if (!vv) return;

    const apply = () => {
        root.style.setProperty("--x-app-vh", `${vv.height}px`);
        // Sur certains navigateurs, la page défile derrière le clavier : on recale en haut.
        if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
}

function injectStyles() {
    if (document.getElementById("xStyles")) return;
    const style = document.createElement("style");
    style.id = "xStyles";
    style.textContent = X_STYLES;
    document.head.appendChild(style);
}
injectStyles();

// ---------- Mode sombre (préférence par appareil, stockée en local) ----------
const THEME_KEY = "chatThemePref";
function getThemePref() {
    try { return localStorage.getItem(THEME_KEY) || "system"; } catch (e) { return "system"; }
}
function applyTheme(pref) {
    const dark = pref === "dark" || (pref === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    qsa(".x-theme-toggle").forEach((btn) => {
        btn.innerHTML = "";
        btn.appendChild(ico(dark ? "fa-solid fa-sun" : "fa-solid fa-moon"));
        btn.title = dark ? "Passer en mode clair" : "Passer en mode sombre";
    });
}
function toggleTheme() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* stockage indisponible */ }
    applyTheme(next);
}
function mountThemeToggle() {
    if (document.querySelector(".x-theme-toggle")) return;
    const btn = mk("button", { type: "button", class: "x-theme-toggle", title: "Changer de thème", onclick: toggleTheme });
    const host = qs(".sidebar-brand") || qs(".sidebar-profile") || qs(".sidebar-menu") || document.body;
    host.appendChild(btn);
}

// Bascule de thème toujours accessible depuis Paramètres (même quand la sidebar est réduite en icônes)
function renderAppearanceCard() {
    const tab = document.getElementById("tab-settings");
    if (!tab || document.getElementById("xAppearanceCard")) return;

    const btn = mk("button", { type: "button", class: "x-theme-toggle", title: "Changer de thème", onclick: toggleTheme });
    const card = mk("div", {
        id: "xAppearanceCard",
        style: "background:#ffffff;padding:20px;border-radius:12px;border:1px solid #e2e8f0;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.05);display:flex;align-items:center;justify-content:space-between;gap:12px;"
    },
        mk("div", {},
            mk("h3", { style: "font-size:15px;color:#1e293b;margin-bottom:4px;" }, ico("fa-solid fa-circle-half-stroke", null), " Apparence"),
            mk("p", { style: "font-size:13px;color:#64748b;margin:0;", text: "Basculez entre le mode clair et le mode sombre." })
        ),
        btn
    );
    tab.insertBefore(card, tab.firstElementChild.nextSibling);
    applyTheme(getThemePref());
}
// L'application initiale du thème se fait plus bas, une fois qs()/qsa() déclarés (voir section 4).

// ============================================================================
// 4. OUTILS (DOM, dates, texte)
// ============================================================================
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// Création d'éléments sûre : le texte utilisateur passe toujours par textContent (pas de XSS)
function mk(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k === "dataset") Object.assign(node.dataset, v);
        else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
        else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) {
        if (c === null || c === undefined || c === false) continue;
        node.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return node;
}
const ico = (cls, title) => mk("i", { class: cls, title });

// Applique le thème dès que possible (avant même la connexion, pour éviter un flash clair→sombre)
applyTheme(getThemePref());
if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
        if (getThemePref() === "system") applyTheme("system");
    });
}

const pad = (n) => String(n).padStart(2, "0");
const timeOf = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const toDate = (ts) => (ts && typeof ts.toDate === "function" ? ts.toDate() : ts instanceof Date ? ts : null);
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayDiff = (d, now = new Date()) => Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const initialsOf = (name) => {
    const parts = (name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "U";
    const first = (w) => Array.from(w);
    if (parts.length === 1) return first(parts[0]).slice(0, 2).join("").toUpperCase();
    return (first(parts[0])[0] + first(parts[parts.length - 1])[0]).toUpperCase();
};
const getChatId = (a, b) => [a, b].sort().join("_");
// ---------- Avatars : initiales colorées pour un contact, icône dédiée pour un groupe ----------
const AVATAR_COLORS = ["#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#ca8a04", "#059669", "#0891b2", "#4f46e5", "#0d9488"];
function avatarColor(seed) {
    let h = 0;
    const s = String(seed || "");
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function paintAvatar(el, name, isGroup = false) {
    if (!el) return;
    const key = (isGroup ? "g:" : "u:") + (name || "");
    if (el.dataset.paint === key) return;
    el.dataset.paint = key;
    el.className = "avatar x-av" + (isGroup ? " x-av-group" : "");
    el.textContent = "";
    if (isGroup) {
        el.style.background = "";
        el.appendChild(ico("fa-solid fa-users"));
        el.setAttribute("aria-label", "Groupe");
    } else {
        el.style.background = avatarColor(name);
        el.textContent = initialsOf(name);
    }
}

// ---------- Icônes du menu latéral : vraies icônes Font Awesome à la place d'éventuels emojis ----------
const MENU_ICONS = {
    conversations: "fa-solid fa-message",
    contacts: "fa-solid fa-address-book",
    pinned: "fa-solid fa-thumbtack",
    devices: "fa-solid fa-mobile-screen-button",
    settings: "fa-solid fa-gear"
};
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;
function upgradeMenuIcons() {
    qsa(".sidebar-menu .menu-item[data-tab]").forEach((item) => {
        if (item.dataset.iconDone) return;
        item.dataset.iconDone = "1";
        const cls = MENU_ICONS[item.dataset.tab];
        if (!cls || item.querySelector('i[class*="fa-"]')) return;

        const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
        const texts = [];
        while (walker.nextNode()) texts.push(walker.currentNode);
        texts.forEach((t) => { t.nodeValue = t.nodeValue.replace(EMOJI_RE, ""); });
        qsa("span, div", item).forEach((n) => { if (!n.children.length && !n.textContent.trim() && !n.querySelector("i")) n.remove(); });
        item.insertBefore(ico(cls), item.firstChild);
    });
}

const normalize = (s) => (s || "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

function fullDateTime(d) {
    return d.toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Dernière connexion : « à l'instant », « il y a 12 min », « aujourd'hui à 14:32 », « hier à… », « le 03/09 à… »
function formatLastSeen(timestamp) {
    const date = toDate(timestamp);
    if (!date) return "Vu récemment";

    const diffMin = Math.floor((Date.now() - date.getTime()) / 60000);
    if (diffMin < 1) return "Vu à l'instant";
    if (diffMin < 60) return `Vu il y a ${diffMin} min`;

    const days = dayDiff(date);
    if (days <= 0) return `Vu aujourd'hui à ${timeOf(date)}`;
    if (days === 1) return `Vu hier à ${timeOf(date)}`;

    const sameYear = date.getFullYear() === new Date().getFullYear();
    return `Vu le ${pad(date.getDate())}/${pad(date.getMonth() + 1)}${sameYear ? "" : "/" + date.getFullYear()} à ${timeOf(date)}`;
}

function formatDayLabel(d) {
    const days = dayDiff(d);
    if (days <= 0) return "Aujourd'hui";
    if (days === 1) return "Hier";
    if (days < 7) return capitalize(d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }));
    const opts = { day: "numeric", month: "long" };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
    return d.toLocaleDateString("fr-FR", opts);
}

function formatListTime(d) {
    const days = dayDiff(d);
    if (days <= 0) return timeOf(d);
    if (days === 1) return "Hier";
    if (days < 7) return d.toLocaleDateString("fr-FR", { weekday: "short" });
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`;
}

// ============================================================================
// 5. INTERFACE : toasts, boîtes de dialogue, menus, son, notifications
// ============================================================================
function showToast(title, message, onClick) {
    let wrap = document.getElementById("xToasts");
    if (!wrap) {
        wrap = mk("div", { id: "xToasts", class: "x-toasts" });
        document.body.appendChild(wrap);
    }
    const toast = mk("div", { class: "x-toast", role: "status" },
        title ? mk("strong", { text: title }) : null,
        message ? mk("span", { text: message }) : null
    );
    let timer;
    const close = () => { clearTimeout(timer); toast.remove(); };
    toast.addEventListener("click", () => { if (onClick) onClick(); close(); });
    wrap.appendChild(toast);
    timer = setTimeout(close, 5000);
}

function openDialog({ title, message, actions }) {
    return new Promise((resolve) => {
        const close = (value) => {
            document.removeEventListener("keydown", onKey);
            backdrop.remove();
            resolve(value);
        };
        const onKey = (e) => { if (e.key === "Escape") close(null); };
        const buttons = actions.map((a) =>
            mk("button", { type: "button", class: `x-btn x-btn-${a.variant || "ghost"}`, text: a.label, onclick: () => close(a.value) })
        );
        const backdrop = mk("div", { class: "x-backdrop", onclick: (e) => { if (e.target === backdrop) close(null); } },
            mk("div", { class: "x-dialog", role: "dialog", "aria-modal": "true" },
                mk("h3", { text: title }),
                message ? mk("p", { text: message }) : null,
                mk("div", { class: "x-actions" }, buttons)
            )
        );
        document.addEventListener("keydown", onKey);
        document.body.appendChild(backdrop);
        const first = backdrop.querySelector("button");
        if (first) first.focus();
    });
}

let openMenuEl = null;
function closeMenu() {
    if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; }
}
function openMenu(x, y, items) {
    closeMenu();
    const menu = mk("div", { class: "x-menu", role: "menu" });
    items.forEach((it) => {
        menu.appendChild(mk("button", {
            type: "button", role: "menuitem", class: it.danger ? "x-danger" : "",
            onclick: () => { closeMenu(); it.action(); }
        }, ico(it.icon), it.label));
    });
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + "px";
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + "px";
    openMenuEl = menu;
}
document.addEventListener("click", (e) => { if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu(); }, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
window.addEventListener("resize", closeMenu);

async function copyText(text, okMessage = "Copié") {
    try {
        await navigator.clipboard.writeText(text);
        showToast(okMessage);
    } catch (e) {
        const ta = mk("textarea", { style: "position:fixed;opacity:0" });
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); showToast(okMessage); } catch (err) { /* rien */ }
        ta.remove();
    }
}

let audioCtx = null;
function playPing() {
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === "suspended") audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const t = audioCtx.currentTime;
        osc.type = "sine";
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.4);
    } catch (e) { /* audio bloqué par le navigateur */ }
}

// Notifications : la permission est demandée au premier clic de l'utilisateur
function requestNotificationPermissionOnce() {
    if (!("Notification" in window) || Notification.permission !== "default") return;
    document.addEventListener("click", () => {
        Notification.requestPermission().catch(() => {});
    }, { once: true });
}

function notifyNewMessage(user, text, count = 1) {
    playPing();
    const title = user.username || "Nouveau message";
    const body = count > 1 ? `${count} nouveaux messages` : text;
    const open = () => (user.isGroup ? openGroupChat(user.uid) : openChatWith(user.uid));

    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
        try {
            const n = new Notification(title, { body, tag: `chat-${user.uid}` });
            n.onclick = () => { window.focus(); open(); n.close(); };
            return;
        } catch (e) { /* on retombe sur la bulle dans l'app */ }
    }
    showToast(title, body, open);
}

// ============================================================================
// 6. PRÉSENCE : en ligne / dernière connexion
// ============================================================================
function writePresence(userId, status) {
    return db.collection("presence").doc(userId)
        .set({ status, lastSeen: FieldValue.serverTimestamp() }, { merge: true })
        .catch(console.error);
}

// Transitions (connexion / déconnexion) : on écrit aussi dans users/{uid}
function updateUserPresence(userId, status) {
    if (!userId) return Promise.resolve();
    const userWrite = db.collection("users").doc(userId)
        .set({ status, lastSeen: FieldValue.serverTimestamp() }, { merge: true })
        .catch(console.error);
    return Promise.all([userWrite, writePresence(userId, status)]);
}

function startPresence(userId) {
    updateUserPresence(userId, "online");
    clearInterval(heartbeatTimer);
    // Le battement s'arrête quand l'onglet est masqué : « dernière connexion » = dernière activité
    heartbeatTimer = setInterval(() => {
        if (!document.hidden && currentUser) writePresence(userId, "online");
    }, HEARTBEAT_MS);

    if (presenceBound) return;
    presenceBound = true;
    const goOffline = () => { if (currentUser) updateUserPresence(currentUser.uid, "offline"); };
    window.addEventListener("beforeunload", goOffline);
    window.addEventListener("pagehide", goOffline);
    document.addEventListener("visibilitychange", () => {
        if (!currentUser) return;
        if (!document.hidden) {
            writePresence(currentUser.uid, "online");
            markActiveChatRead();
        }
        updateTotalUnread();
    });
    window.addEventListener("focus", () => { if (currentUser) markActiveChatRead(); });
}

function renderPeerStatus() {
    const chat = activeChat;
    const label = document.getElementById("statusLabel");
    const dot = document.getElementById("statusDot");
    if (!chat || !label) return;

    const peerUid = chat.uid;
    let text = "Hors ligne";
    let title = "";
    let online = false;

    if (blockedByMe.has(peerUid)) {
        text = "Contact bloqué";
    } else if (blockedMe.has(peerUid)) {
        text = "Hors ligne"; // un contact qui vous a bloqué ne voit plus votre statut, et vous ne voyez plus le sien
    } else {
        let data = chat.peerPresence;
        let legacy = false;
        if (!data) {
            const u = usersById.get(peerUid);
            if (u && (u.status || u.lastSeen)) { data = u; legacy = true; }
        }
        if (data) {
            const seen = toDate(data.lastSeen);
            const fresh = !seen || Date.now() - seen.getTime() < PRESENCE_STALE_MS;
            online = data.status === "online" && (legacy || fresh);
            if (online) {
                text = "En ligne";
            } else {
                text = formatLastSeen(data.lastSeen);
                if (seen) title = "Dernière connexion : " + fullDateTime(seen);
            }
        }
    }

    label.textContent = text;
    label.title = title;
    if (dot) dot.style.backgroundColor = online ? "#10b981" : "#94a3b8";
}

// ============================================================================
// 7. BLOCAGE D'UTILISATEURS
// ============================================================================
function listenBlocks(uid) {
    unsubscribeBlocks.forEach((fn) => fn());
    unsubscribeBlocks = [
        db.collection("blocks").where("blockerId", "==", uid).onSnapshot((snap) => {
            blockedByMe = new Map(snap.docs.map((d) => {
                const b = d.data();
                return [b.blockedId, b.createdAtMs || 0];
            }));
            onBlocksChanged();
        }, (err) => console.warn("Blocages (envoyés) :", err)),
        db.collection("blocks").where("blockedId", "==", uid).onSnapshot((snap) => {
            blockedMe = new Set(snap.docs.map((d) => d.data().blockerId));
            onBlocksChanged();
        }, (err) => console.warn("Blocages (reçus) :", err))
    ];
}

function onBlocksChanged() {
    convState.forEach((s) => { if (s.lastSnap) handleLastMessages(s, s.lastSnap, true); });
    refreshAllConversationsUI();
    updateTotalUnread();
    if (activeChat) {
        updateComposerState();
        renderPeerStatus();
        if (activeChat.lastSnapshot) renderMessages(activeChat.lastSnapshot);
    }
}

async function blockUser(uid) {
    try {
        await db.collection("blocks").doc(`${currentUser.uid}_${uid}`).set({
            blockerId: currentUser.uid,
            blockedId: uid,
            createdAt: FieldValue.serverTimestamp(),
            createdAtMs: Date.now()
        });
        showToast("Contact bloqué", "Vous ne recevrez plus ses messages ni ses appels.");
    } catch (err) {
        console.error("Erreur de blocage :", err);
        showToast("Blocage impossible", "Vérifiez votre connexion et réessayez.");
    }
}

async function unblockUser(uid) {
    try {
        await db.collection("blocks").doc(`${currentUser.uid}_${uid}`).delete();
        showToast("Contact débloqué");
    } catch (err) {
        console.error("Erreur de déblocage :", err);
        showToast("Déblocage impossible", "Vérifiez votre connexion et réessayez.");
    }
}

async function confirmBlock(uid) {
    const user = usersById.get(uid);
    const ok = await openDialog({
        title: `Bloquer ${user?.username || "ce contact"} ?`,
        message: "Vous ne recevrez plus ses messages ni ses appels, et il ne verra plus votre statut. Vous pouvez le débloquer à tout moment.",
        actions: [
            { label: "Bloquer", value: true, variant: "danger" },
            { label: "Annuler", value: false, variant: "ghost" }
        ]
    });
    if (ok) blockUser(uid);
}

// Un message est masqué s'il est supprimé « pour moi », envoyé par quelqu'un que j'ai bloqué, ou neutralisé
function isMsgHidden(msg) {
    const me = currentUser.uid;
    if (Array.isArray(msg.deletedFor) && msg.deletedFor.includes(me)) return true;
    if (msg.senderId !== me) {
        if (msg.suppressed) return true;
        const blockedAt = blockedByMe.get(msg.senderId);
        if (blockedAt !== undefined) {
            const t = toDate(msg.timestamp);
            if (!t || t.getTime() >= blockedAt) return true;
        }
    }
    return false;
}

// ============================================================================
// 8. CHIFFREMENT E2EE
// ============================================================================
function getMyPrivateKey() {
    return localStorage.getItem(`e2ee_private_${currentUser.uid}`);
}

async function getPublicKey(uid) {
    if (publicKeyCache.has(uid)) return publicKeyCache.get(uid);
    const doc = await db.collection("users").doc(uid).get();
    const pk = doc.data()?.publicKey;
    if (pk) publicKeyCache.set(uid, pk);
    return pk;
}

async function decryptMessage(docId, msg, isMine) {
    const key = getMyPrivateKey();

    // Nouveau format (chiffrement hybride, sans limite de taille)
    if (msg.cipherText !== undefined) {
        if (!msg.cipherText) return "";
        if (typeof E2EE === "undefined" || !key) return "Message chiffré";

        const cacheKey = `${docId}:${msg.cipherText}`;
        const cached = decryptCache.get(docId);
        if (cached && cached.cipher === cacheKey && cached.key === key) return cached.clear;

        let clear;
        try {
            clear = await E2EE.decryptHybrid(msg, currentUser.uid, key);
        } catch (err) {
            console.error("Erreur de déchiffrement :", err);
            clear = "Message chiffré";
        }
        decryptCache.set(docId, { cipher: cacheKey, clear, key });
        return clear;
    }

    // Rétrocompatibilité : anciens messages chiffrés directement en RSA-OAEP (avant ce correctif)
    const cipher = isMine ? (msg.textForSender || msg.text) : msg.text;
    if (!cipher) return "";

    if (typeof E2EE !== "undefined" && key) {
        const cached = decryptCache.get(docId);
        if (cached && cached.cipher === cipher && cached.key === key) return cached.clear;
        let clear;
        try {
            clear = await E2EE.decryptText(cipher, key);
        } catch (err) {
            console.error("Erreur de déchiffrement :", err);
            clear = "Message chiffré";
        }
        decryptCache.set(docId, { cipher, clear, key });
        return clear;
    }
    return cipher;
}

async function encryptForBoth(rawText, peerUid) {
    const [receiverKey, senderKey] = await Promise.all([getPublicKey(peerUid), getPublicKey(currentUser.uid)]);
    if (typeof E2EE === "undefined" || !E2EE.encryptHybrid) {
        throw new Error("Module de chiffrement indisponible : le message n'a pas été envoyé.");
    }
    const { iv, cipherText, keys } = await E2EE.encryptHybrid(rawText, { [currentUser.uid]: senderKey, [peerUid]: receiverKey });
    if (!keys[currentUser.uid]) throw new Error("Impossible de chiffrer le message pour vous-même.");
    return { iv, cipherText, keys };
}

// INITIALISATION ET RESTAURATION DES CLÉS E2EE
async function initUserKeys(user) {
    try {
        const localKey = getMyPrivateKey();
        
        // 1 Si la clé privée existe déjà sur l'appareil (localStorage), ON L'UTILISE DIRECTEMENT
        if (localKey) {
            console.log("Clé privée trouvée en cache local !");
            return localKey;
        }

        // 2 Si absente (ex: première ouverture sans repasser par login), on charge Firestore
        const userDocRef = db.collection("users").doc(user.uid);
        const doc = await userDocRef.get();

        if (doc.exists && doc.data()?.encryptedPrivateKey) {
            console.log("La clé privée locale est absente. Elle sera restaurée lors de la prochaine connexion avec mot de passe.");
        }
        
        return null;
    } catch (err) {
        console.error("Erreur d'initialisation des clés :", err);
    }
}
// ============================================================================
// 9. PROFIL, DÉCONNEXION, SESSION
// ============================================================================
const profileTrigger = document.getElementById("userProfileTrigger");
const profileModal = document.getElementById("profileModal");
const closeModalBtn = document.getElementById("closeModalBtn");
const logoutBtn = document.getElementById("logoutBtn");
const switchAccountBtn = document.getElementById("switchAccountBtn");

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

function cleanupSession() {
    if (unsubscribeUsers) { unsubscribeUsers(); unsubscribeUsers = null; }
    if (unsubscribeGroups) { unsubscribeGroups(); unsubscribeGroups = null; }
    if (unsubscribeMessages) { unsubscribeMessages(); unsubscribeMessages = null; }
    if (unsubscribeStatus) { unsubscribeStatus(); unsubscribeStatus = null; }
    unsubscribeBlocks.forEach((fn) => fn());
    unsubscribeBlocks = [];
    convState.forEach((s) => s.unsubs.forEach((fn) => fn()));
    convState.clear();
    groupState.forEach((s) => s.unsubs.forEach((fn) => fn()));
    groupState.clear();
    contactCards.clear();
    usersById.clear();
    decryptCache.clear();
    publicKeyCache.clear();
    blockedByMe = new Map();
    blockedMe = new Set();
    clearInterval(heartbeatTimer);
    clearInterval(statusTicker);
    clearTimeout(sortTimer);
    activeChatUserId = null;
    activeChat = null;
    editingMsg = null;
    if (peer) { try { peer.destroy(); } catch (e) { /* déjà fermé */ } peer = null; }
}

async function signOutAndRedirect() {
    try {
        if (currentUser) await updateUserPresence(currentUser.uid, "offline");
        cleanupSession();
        await auth.signOut();
        window.location.href = "login.html";
    } catch (error) {
        console.error("Erreur de déconnexion :", error);
    }
}
if (logoutBtn) logoutBtn.addEventListener("click", signOutAndRedirect);
if (switchAccountBtn) switchAccountBtn.addEventListener("click", signOutAndRedirect);

// CHARGER LE PROFIL
function loadUserProfile(user) {
    if (!user) return;

    db.collection("users").doc(user.uid).get().then((doc) => {
        let username = user.displayName || user.email?.split("@")[0] || "Utilisateur";
        const email = user.email || "";

        if (doc.exists && doc.data().username) {
            username = doc.data().username;
        }
        myUsername = username;

        const nameParts = username.trim().split(/\s+/);
        const initials = nameParts.length >= 2 
            ? (nameParts[0][0] + nameParts[1][0]).toUpperCase() 
            : username.substring(0, 2).toUpperCase();

        // Sidebar : Nom + Statut En Ligne
        const sidebarAvatar = qs(".sidebar-profile .profile-avatar");
        const sidebarName = qs(".sidebar-profile .profile-info h4");
        const sidebarSub = qs(".sidebar-profile .profile-info p, .sidebar-profile .profile-email, #sidebarUserEmail");

        if (sidebarAvatar) sidebarAvatar.textContent = initials;
        if (sidebarName) sidebarName.textContent = username;
        if (sidebarSub) sidebarSub.innerHTML = '<span class="status-dot online"></span> En ligne';

        // Modale : Nom + Email réel
        const modalName = document.getElementById("modalUsername");
        const modalEmail = document.getElementById("modalEmail");
        if (modalName) modalName.textContent = username;
        if (modalEmail) { 
            modalEmail.textContent = email; // L'email s'affiche uniquement ici
            modalEmail.title = email; 
        }

        const settingsEmail = document.getElementById("settingsEmail");
        if (settingsEmail) settingsEmail.textContent = email;

        const qrName = document.getElementById("xQrName");
        if (qrName) qrName.textContent = username;
    }).catch((err) => console.error("Erreur chargement profil :", err));
}

// ============================================================================
// 10. NAVIGATION PAR ONGLETS & RECHERCHE
// ============================================================================
function setupTabNavigation() {
    upgradeMenuIcons();
    const menuItems = qsa(".sidebar-menu .menu-item");

    menuItems.forEach((item) => {
        if (item.dataset.navBound) return;
        item.dataset.navBound = "1";

        item.addEventListener("click", function (e) {
            e.preventDefault();
            const targetTab = this.getAttribute("data-tab");
            if (!targetTab) return;

            menuItems.forEach((m) => m.classList.remove("active"));
            this.classList.add("active");

            const dashboard = qs(".dashboard");
            const allTabViews = qsa("#tab-contacts, #tab-devices, #tab-pinned, #tab-settings, .tab-content");

            if (targetTab === "conversations") {
                if (dashboard) dashboard.classList.remove("tab-active");
                allTabViews.forEach((tab) => (tab.style.display = "none"));
                setTimeout(() => { markActiveChatRead(); refreshAllConversationsUI(); updateTotalUnread(); }, 0);
            } else {
                if (dashboard) dashboard.classList.add("tab-active");
                qs(".chat-area")?.classList.remove("active");

                allTabViews.forEach((tab) => {
                    tab.style.display = (tab.id === `tab-${targetTab}` || tab.getAttribute("data-view") === targetTab) ? "block" : "none";
                });

                if (targetTab === "devices") loadDevicePublicKey();
                if (targetTab === "settings") renderAppearanceCard();
                updateTotalUnread();
            }
        });
    });
}

// RECHERCHE PAR NOM D'UTILISATEUR (insensible à la casse et aux accents, « @ » accepté)
function setupSearch() {
    qsa(".search-bar input, #searchInput").forEach((input) => {
        if (input.dataset.searchBound) return;
        input.dataset.searchBound = "1";

        input.addEventListener("input", (e) => {
            currentSearchQuery = normalize(e.target.value.replace(/^\s*@/, ""));
            applySearchFilter();
        });

        input.addEventListener("keydown", (e) => {
            if (e.key !== "Enter") return;
            const first = qsa(".conversation").find((c) => c.style.display !== "none");
            if (!first || !first.dataset.uid) return;
            if (first.dataset.group) openGroupChat(first.dataset.uid);
            else openChatWith(first.dataset.uid);
        });
    });
}

function applySearchFilter() {
    const q = currentSearchQuery;
    let found = 0;

    convState.forEach((s) => {
        const match = !q || s.el.dataset.search.includes(q);
        s.el.style.display = match ? "flex" : "none";
        if (match) found++;
    });
    groupState.forEach((s) => {
        const match = !q || s.el.dataset.search.includes(q);
        s.el.style.display = match ? "flex" : "none";
        if (match) found++;
    });
    contactCards.forEach((c) => {
        c.el.style.display = !q || c.el.dataset.search.includes(q) ? "flex" : "none";
    });

    const container = qs(".conversations");
    let noConvMsg = document.getElementById("no-conv-found");
    if (found === 0 && q !== "" && (convState.size > 0 || groupState.size > 0)) {
        if (!noConvMsg && container) {
            noConvMsg = mk("p", {
                id: "no-conv-found",
                style: "padding: 15px; color: #94a3b8; font-size: 13px; text-align: center;",
                text: "Aucun contact ou conversation trouvé"
            });
            container.appendChild(noConvMsg);
        }
    } else if (noConvMsg) {
        noConvMsg.remove();
    }
}

// ============================================================================
// 11. ÉTAT D'AUTHENTIFICATION
// ============================================================================
auth.onAuthStateChanged((user) => {
    if (user) {
        currentUser = user;

        const showApp = () => {
            const authContainer = document.getElementById("authContainer");
            const appLayout = document.getElementById("appLayout");

            if (authContainer) authContainer.style.display = "none";
            if (appLayout) appLayout.style.display = "flex";

            cleanupSession();
            resetListsDom();
            setupTabNavigation();
            setupSearch();
            loadUserProfile(user);
            mountThemeToggle();
            applyTheme(getThemePref());
            listenBlocks(user.uid);
            loadContacts();
            listenGroups(user.uid);
            mountGroupFab();
            initPeerJS(user.uid);
            initUserKeys(user);
            startPresence(user.uid);
            requestNotificationPermissionOnce();
            setupMobileViewportFix();
        };

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", showApp);
        } else {
            showApp();
        }
    } else {
        cleanupSession();
        currentUser = null;
        const authContainer = document.getElementById("authContainer");
        const appLayout = document.getElementById("appLayout");

        if (appLayout) appLayout.style.display = "none";
        if (authContainer) {
            authContainer.style.display = "block";
        } else if (!/\/(login|signup)\.html$/i.test(window.location.pathname)) {
            // Cette page (le tableau de bord) n'a pas d'écran de connexion intégré :
            // personne ne doit pouvoir la consulter sans être connecté.
            window.location.href = "login.html";
        }
    }
});

// ============================================================================
// 12. CONTACTS & LISTE DES CONVERSATIONS
// ============================================================================

// --- Conteneurs de listes (créés à la volée s'ils manquent dans le HTML) ---
function getConversationsContainer() {
    let c = qs(".conversations");
    if (!c) {
        const host = qs(".conversation-list");
        if (!host) return null;
        c = mk("div", { class: "conversations" });
        host.appendChild(c);
    }
    return c;
}

function getContactsContainer() {
    let c = document.getElementById("contacts-list");
    if (!c) {
        const host = document.getElementById("tab-contacts");
        if (!host) return null;
        c = mk("div", { id: "contacts-list" });
        host.appendChild(c);
    }
    return c;
}

// Vide les listes avant de (re)charger une session
function resetListsDom() {
    const conv = getConversationsContainer();
    const contacts = getContactsContainer();
    if (conv) conv.textContent = "";
    if (contacts) contacts.textContent = "";
}

// Écoute la collection « users » : alimente la liste des conversations ET l'onglet Contacts
function loadContacts() {
    if (unsubscribeUsers) { unsubscribeUsers(); unsubscribeUsers = null; }
    let first = true;

    unsubscribeUsers = db.collection("users").onSnapshot((snapshot) => {
        snapshot.docChanges().forEach((change) => {
            const uid = change.doc.id;
            const userData = change.doc.data() || {};

            // Mon propre compte : mise à jour de la barre latérale uniquement
            if (currentUser && uid === currentUser.uid) {
                const myRealName = userData.username || currentUser.displayName || "Utilisateur";
                usersById.set(uid, { ...userData, uid });

                const sidebarName = qs(".sidebar-profile .profile-info h4");
                if (sidebarName) sidebarName.textContent = myRealName;
                const sidebarSub = qs(".sidebar-profile .profile-info p, .sidebar-profile .profile-email, #sidebarUserEmail");
                if (sidebarSub) sidebarSub.innerHTML = '<span class="status-dot online"></span> En ligne';
                const sidebarAvatar = qs(".sidebar-profile .profile-avatar");
                if (sidebarAvatar) sidebarAvatar.textContent = initialsOf(myRealName);
                return;
            }

            if (change.type === "removed") {
                removeUser(uid);
                return;
            }

            const user = { ...userData, uid };
            usersById.set(uid, user);
            if (user.publicKey) publicKeyCache.set(uid, user.publicKey);

            if (change.type === "added") {
                addConversation(user);
                addContactCard(user);
            } else {
                updateUserEntry(user);
            }
        });

        checkAndShowEmptyState();
        applySearchFilter();
        scheduleSort();

        if (first) {
            first = false;
            consumePendingChat();
        }
    }, (err) => {
        console.error("Erreur chargement des contacts :", err);
        const message = err && err.code === "permission-denied"
            ? "Accès refusé : vérifiez les règles Firestore de la collection « users »."
            : "Impossible de charger les contacts. Vérifiez votre connexion.";
        const c = getContactsContainer();
        if (c && c.children.length === 0) c.appendChild(mk("p", { class: "x-empty-users", text: message }));
        showToast("Contacts indisponibles", message);
    });
}

function checkAndShowEmptyState() {
    qsa(".x-empty-users").forEach((n) => n.remove());

    const lists = [
        [getConversationsContainer(), "Aucune conversation pour le moment."],
        [getContactsContainer(), "Aucun contact disponible."]
    ];
    lists.forEach(([cnt, text]) => {
        if (cnt && cnt.querySelectorAll(":scope > article, :scope > div").length === 0) {
            cnt.appendChild(mk("p", { class: "x-empty-users", text }));
        }
    });
}
function updateEmptyState() { checkAndShowEmptyState(); }

function addConversation(user) {
    const container = getConversationsContainer();
    if (!container) return;

    // Vérification basée sur le DOM physique
    const existingEl = container.querySelector(`[data-uid="${user.uid}"]`);
    if (existingEl) return;

    const me = currentUser.uid;
    const chatId = typeof getChatId === "function" ? getChatId(me, user.uid) : [me, user.uid].sort().join("_");

    const safeName = user.username || user.userName || user.displayName || user.name || (user.email ? user.email.split("@")[0] : "Utilisateur");
    const safeSearch = normalize(safeName);

    const avatarEl = mk("div", { class: "avatar x-av" });
    paintAvatar(avatarEl, safeName);
    const nameEl = mk("h3", { text: safeName });
    const textEl = mk("p", { class: "last-msg-text", text: "Chargement..." });
    const timeEl = mk("span", { class: "last-msg-time" });
    const badgeEl = mk("span", { class: "unread", style: "display: none;", text: "0" });

    const el = mk("article", { class: "conversation", dataset: { uid: user.uid, search: safeSearch } },
        avatarEl,
        mk("div", { class: "conversation-info" }, nameEl, textEl),
        mk("div", { class: "conversation-meta" }, timeEl, badgeEl)
    );
    el.addEventListener("click", () => openChatWith(user.uid));

    let state = convState.get(user.uid);
    if (!state) {
        state = {
            user, el, avatarEl, nameEl, textEl, timeEl, badgeEl,
            unread: 0, lastTs: 0, timeText: "", preview: "Chargement...",
            previewStatus: null, previewReadAt: null,
            msgSeq: 0, initialized: false, lastSnap: null, unsubs: []
        };
        convState.set(user.uid, state);

        const chatRef = db.collection("chats").doc(chatId);

        state.unsubs.push(
            chatRef.collection("messages").orderBy("timestamp", "desc").limit(20).onSnapshot(
                (snap) => handleLastMessages(state, snap),
                (err) => console.error("Erreur écoute messages :", err)
            )
        );

        state.unsubs.push(
            chatRef.onSnapshot((doc) => {
                const key = `unreadCount_${currentUser.uid}`;
                state.unread = Math.max(0, (doc.exists && doc.data() && doc.data()[key]) || 0);
                if (state.unread > 0 && activeChatUserId === user.uid && isActiveChatVisible()) markActiveChatRead();
                refreshConvUI(state);
                updateTotalUnread();
            }, (err) => console.error("Erreur écoute conversation :", err))
        );
    } else {
        state.el = el;
        state.avatarEl = avatarEl;
        state.nameEl = nameEl;
        state.textEl = textEl;
        state.timeEl = timeEl;
        state.badgeEl = badgeEl;
    }

    container.appendChild(el);
    refreshConvUI(state);
}
async function handleLastMessages(state, snap, silent = false) {
    if (!currentUser || convState.get(state.user.uid) !== state) return;

    const me = currentUser.uid;
    const user = state.user;
    const seq = ++state.msgSeq;
    state.lastSnap = snap;

    const entries = snap.docs
        .map((d) => ({ doc: d, msg: d.data({ serverTimestamps: "estimate" }) }))
        .filter((e) => !isMsgHidden(e.msg));

    // ✓✓ « Reçu » : l'application du destinataire est ouverte et a récupéré les messages
    if (!silent && !(activeChatUserId === user.uid && isActiveChatVisible())) {
        const pairs = entries
            .filter((e) => e.msg.receiverId === me && e.msg.status === "sent" && !e.doc.metadata.hasPendingWrites)
            .map((e) => [e.doc.ref, { status: "delivered", deliveredAt: FieldValue.serverTimestamp() }]);
        if (pairs.length) batchUpdate(pairs);
    }

    const last = entries[0];
    if (!last) {
        state.preview = "Aucun message";
        state.previewStatus = null;
        state.timeText = "";
        state.lastTs = 0;
        state.initialized = true;
        refreshConvUI(state);
        scheduleSort();
        return;
    }

    const isMine = last.msg.senderId === me;
    const clear = await decryptMessage(last.doc.id, last.msg, isMine);
    if (seq !== state.msgSeq) return;

    // Notification pour les messages arrivés après le chargement initial
    if (!silent && state.initialized) {
        const fresh = snap.docChanges()
            .filter((ch) => ch.type === "added")
            .map((ch) => ch.doc)
            .filter((d) => {
                const m = d.data({ serverTimestamps: "estimate" });
                if (m.senderId === me || isMsgHidden(m) || d.metadata.hasPendingWrites) return false;
                if ((m.status || "read") === "read") return false;
                const t = toDate(m.timestamp);
                return !!t && Date.now() - t.getTime() < 60000;
            });

        if (fresh.length && !(activeChatUserId === user.uid && isActiveChatVisible())) {
            const target = fresh.find((d) => d.id === last.doc.id) || fresh[0];
            const text = target.id === last.doc.id ? clear : await decryptMessage(target.id, target.data(), false);
            if (seq !== state.msgSeq) return;
            notifyNewMessage(user, text, fresh.length);
        }
    }
    state.initialized = true;

    const date = toDate(last.msg.timestamp);
    state.lastTs = date ? date.getTime() : 0;
    state.timeText = date ? formatListTime(date) : "";
    state.preview = (isMine ? "Vous : " : "") + (clear || "").replace(/\s+/g, " ");
    state.previewStatus = isMine ? statusKind(last.doc, last.msg) : null;
    state.previewReadAt = toDate(last.msg.readAt);

    refreshConvUI(state);
    scheduleSort();
}

// Aspect d'une conversation : en gras + badge quand il y a des non lus
function refreshConvUI(s) {
    const uid = s.user.uid;
    const blocked = blockedByMe.has(uid);
    const isOpen = activeChatUserId === uid && isActiveChatVisible();
    const unread = blocked || isOpen ? 0 : s.unread;

    // NOM D'UTILISATEUR SÉCURISÉ :
    const rawName = s.user.username || s.user.userName || s.user.displayName || s.user.name || s.user.nom;
    const shownName = rawName || (s.user.email ? s.user.email.split("@")[0] : "Utilisateur");
    s.nameEl.textContent = shownName;
    paintAvatar(s.avatarEl, shownName);

    s.nameEl.style.fontWeight = unread > 0 ? "800" : "600";
    s.textEl.style.fontWeight = unread > 0 ? "700" : "normal";
    s.textEl.style.color = unread > 0 ? "#0f172a" : "#64748b";

    s.textEl.textContent = "";
    if (blocked) {
        s.textEl.append(ico("fa-solid fa-ban x-tick"), "Contact bloqué");
    } else {
        if (s.previewStatus) s.textEl.appendChild(tickIcon(s.previewStatus, s.previewReadAt));
        s.textEl.append(s.preview);
    }

    s.timeEl.textContent = s.timeText || "";
    s.badgeEl.textContent = unread > 99 ? "99+" : String(unread);
    s.badgeEl.style.display = unread > 0 ? "flex" : "none";
    s.el.classList.toggle("x-unread", unread > 0);
}
function refreshAllConversationsUI() {
    convState.forEach(refreshConvUI);
}

// Tri par activité récente (les plus récents en haut)
function scheduleSort() {
    if (sortTimer) return;
    sortTimer = setTimeout(() => { sortTimer = null; sortConversations(); }, 60);
}

function sortConversations() {
    const container = qs(".conversations") || document.querySelector(".conversations");
    if (!container) return;

    const nameOf = (s) => {
        if (!s) return "";
        if (s.user) {
            return s.user.username || s.user.userName || s.user.displayName || s.user.name || s.user.email || "";
        }
        return s.name || s.groupName || "";
    };

    // On filtre d'abord pour ne garder QUE les objets ayant un élément DOM valide
    const list = [...convState.values(), ...groupState.values()]
        .filter((s) => s && s.el)
        .sort((a, b) => {
            const tsA = a.lastTs || 0;
            const tsB = b.lastTs || 0;
            return (tsB - tsA) || nameOf(a).localeCompare(nameOf(b), "fr");
        });

    // Ré-insertion propre dans le DOM
    list.forEach((s) => {
        if (s.el && s.el instanceof Node) {
            container.appendChild(s.el);
        }
    });

    const noConv = document.getElementById("no-conv-found");
    if (noConv) container.appendChild(noConv);
}

// Compteur total (badge du menu + titre de l'onglet)
function updateTotalUnread() {
    let total = 0;
    convState.forEach((s) => {
        const isOpen = activeChatUserId === s.user.uid && isActiveChatVisible();
        if (!blockedByMe.has(s.user.uid) && !isOpen) total += s.unread;
    });
    groupState.forEach((s) => {
        const isOpen = activeChatUserId === s.id && isActiveChatVisible();
        if (!isOpen) total += s.unread;
    });

    const badge = document.getElementById("totalUnreadBadge");
    if (badge) {
        if (total > 0) {
            badge.textContent = total > 99 ? "99+" : String(total);
            badge.style.display = "flex";
        } else {
            badge.style.display = "none";
        }
    }
    document.title = total > 0 ? `(${total > 99 ? "99+" : total}) ${BASE_TITLE}` : BASE_TITLE;
}

function updateUserEntry(user) {
    // 1. Mise à jour Conversation
    if (typeof convState !== "undefined" && convState.has(user.uid)) {
        const state = convState.get(user.uid);
        state.user = { ...state.user, ...user };
        if (typeof refreshConvUI === "function") refreshConvUI(state);
    }

    // 2. Mise à jour Carte Contact
    if (typeof contactCards !== "undefined" && contactCards.has(user.uid)) {
        const card = contactCards.get(user.uid);
        const safeName = user.username || user.userName || user.displayName || user.name || (user.email ? user.email.split("@")[0] : "Utilisateur");
        
        if (card.nameEl) card.nameEl.textContent = safeName;
        paintAvatar(card.avatarEl, safeName);
        if (card.subEl) card.subEl.textContent = user.email || "";
        if (card.el && typeof normalize === "function") {
            card.el.dataset.search = normalize(safeName);
        }
    }
}

function removeUser(uid) {
    const s = convState.get(uid);
    if (s) { s.unsubs.forEach((fn) => fn()); s.el.remove(); convState.delete(uid); }
    const c = contactCards.get(uid);
    if (c) { c.el.remove(); contactCards.delete(uid); }
    usersById.delete(uid);
    if (activeChatUserId === uid) closeActiveChat();
    updateEmptyState();
}

function addContactCard(user) {
    const container = getContactsContainer();
    if (!container) return;
    if (container.querySelector(`[data-uid="${user.uid}"]`)) return;

    const safeName = user.username || user.userName || user.displayName || user.name || (user.email ? user.email.split("@")[0] : "Utilisateur");

    const avatarEl = mk("div", { class: "avatar x-av" });
    paintAvatar(avatarEl, safeName);
    const nameEl = mk("h4", { class: "x-contact-name", text: safeName });
    const subEl = mk("span", { class: "x-contact-sub", text: user.email || "" });

    const el = mk("div", { class: "x-contact-card", dataset: { uid: user.uid, search: normalize(safeName) } },
        mk("div", { class: "x-contact-main" }, avatarEl, mk("div", { class: "x-contact-text" }, nameEl, subEl)),
        mk("button", { class: "btn-chat-start x-contact-btn", type: "button", onclick: () => openChatWith(user.uid) },
            ico("fa-solid fa-comment"), " Discuter")
    );

    contactCards.set(user.uid, { el, nameEl, avatarEl, subEl });
    container.appendChild(el);
}
// Ouvre la discussion avec un utilisateur (liste, contacts, QR, notification…)
function openChatWith(uid) {
    const user = usersById.get(uid);
    if (!user) return false;

    const convTabBtn = qs('[data-tab="conversations"]');
    if (convTabBtn) convTabBtn.click();

    qsa(".conversation").forEach((c) => c.classList.toggle("active-conversation", c.dataset.uid === uid));

    renderChatLayout();
    selectContact(user);

    if (window.innerWidth <= 768) {
        qs(".chat-area")?.classList.add("active");
    }
    return true;
}

function consumePendingChat() {
    let uid = null;
    try {
        uid = sessionStorage.getItem("pendingChatUid");
        if (uid) sessionStorage.removeItem("pendingChatUid");
    } catch (e) { /* stockage indisponible */ }
    if (!uid || uid === currentUser.uid) return;
    if (!openChatWith(uid)) showToast("Utilisateur introuvable", "Ce lien ne correspond à aucun compte.");
}

// ============================================================================
// 12bis. GROUPES DE DISCUSSION
// ============================================================================
// Les messages de groupe ne sont PAS chiffrés de bout en bout (contrairement aux
// discussions 1:1) : le texte est stocké en clair dans groups/{id}/messages.
// Compteur de non lus des groupes : calculé localement à partir d'un marqueur de lecture,
// sans écrire dans le document du groupe (évite les erreurs de droits Firestore).
// Fenêtre d'historique donnée à un nouveau membre lors de son ajout à un groupe
// (comme Telegram : un nouveau membre voit les X derniers jours, pas l'intégralité).
// Changez cette valeur pour ajuster (7 = une semaine, 30 = un mois...).
const GROUP_HISTORY_WINDOW_DAYS = 30;

// Cache mémoire : clé de groupe déjà déchiffrée (évite de refaire l'opération RSA à chaque écran)
const groupKeyCache = new Map(); // groupId -> clé AES en clair (base64)
const groupTextCache = new Map(); // "docId:cipherText" -> { text, legacy, failed }

// Donne la clé de groupe en clair, en la déchiffrant une seule fois (RSA) puis en la mettant en cache.
async function getGroupKey(chat) {
    if (!chat || !chat.id) return null;
    if (groupKeyCache.has(chat.id)) return groupKeyCache.get(chat.id);

    const myWrappedKey = chat.groupKeys && chat.groupKeys[currentUser.uid];
    const myPrivateKey = getMyPrivateKey();
    if (!myWrappedKey || !myPrivateKey || typeof E2EE === "undefined" || !E2EE.unwrapGroupKey) return null;

    try {
        const raw = await E2EE.unwrapGroupKey(myWrappedKey, myPrivateKey);
        groupKeyCache.set(chat.id, raw);
        return raw;
    } catch (err) {
        console.error("Impossible de déchiffrer la clé du groupe :", err);
        return null;
    }
}

const groupReadKey = (id) => `groupReadAt_${currentUser ? currentUser.uid : ""}_${id}`;
function getGroupReadAt(id) {
    try {
        const v = localStorage.getItem(groupReadKey(id));
        return v === null ? null : Number(v) || 0;
    } catch (e) { return null; }
}
function setGroupReadAt(id, ms) {
    try { localStorage.setItem(groupReadKey(id), String(ms)); } catch (e) { /* stockage indisponible */ }
}
const tsMs = (msg) => { const d = toDate(msg && msg.timestamp); return d ? d.getTime() : 0; };

function groupAvatarIcon() {
    return ico("fa-solid fa-users");
}

function listenGroups(uid) {
    if (unsubscribeGroups) unsubscribeGroups();
    let first = true;

    unsubscribeGroups = db.collection("groups").where("members", "array-contains", uid).onSnapshot((snapshot) => {
        snapshot.docChanges().forEach((change) => {
            const id = change.doc.id;
            if (change.type === "removed") { removeGroup(id); return; }
            const group = { ...change.doc.data(), id };
            if (change.type === "added") addGroupConversation(group);
            else updateGroupEntry(group);
        });
        updateEmptyState();
        applySearchFilter();
        scheduleSort();
        if (first) first = false;
    }, (err) => console.error("Erreur chargement des groupes :", err));
}

function addGroupConversation(group) {
    if (groupState.has(group.id)) return;
    const container = getConversationsContainer();
    if (!container) return;

    const avatarEl = mk("div", { class: "avatar x-av x-av-group" });
    paintAvatar(avatarEl, group.name, true);
    const nameEl = mk("h3", { text: group.name || "Groupe" });
    const textEl = mk("p", { class: "last-msg-text", text: "Chargement..." });
    const timeEl = mk("span", { class: "last-msg-time" });
    const badgeEl = mk("span", { class: "unread", style: "display: none;", text: "0" });

    const el = mk("article", { class: "conversation", dataset: { uid: group.id, group: "1", search: normalize(group.name) } },
        avatarEl,
        mk("div", { class: "conversation-info" }, nameEl, textEl),
        mk("div", { class: "conversation-meta" }, timeEl, badgeEl)
    );
    el.addEventListener("click", () => openGroupChat(group.id));

    const state = {
        id: group.id, name: group.name, members: group.members || [], createdBy: group.createdBy,
        groupKeys: group.groupKeys || {}, historyFrom: group.historyFrom || {},
        el, avatarEl, nameEl, textEl, timeEl, badgeEl,
        unread: 0, lastTs: 0, timeText: "", preview: "Chargement...",
        msgSeq: 0, initialized: false, unsubs: []
    };
    groupState.set(group.id, state);

    const groupRef = db.collection("groups").doc(group.id);
    state.unsubs.push(
        groupRef.collection("messages").orderBy("timestamp", "desc").limit(20).onSnapshot(
            (snap) => handleGroupLastMessages(state, snap),
            (err) => console.error("Erreur écoute messages de groupe :", err)
        )
    );
    container.appendChild(el);
    refreshGroupUI(state);
}

async function handleGroupLastMessages(state, snap) {
    if (groupState.get(state.id) !== state) return;
    const me = currentUser.uid;
    const seq = ++state.msgSeq;

    const docs = snap.docs.filter((d) => !(Array.isArray(d.data().deletedFor) && d.data().deletedFor.includes(me)));
    const last = docs[0];

    // Non lus = messages des autres plus récents que mon marqueur de lecture
    const isOpenNow = activeChatUserId === state.id && isActiveChatVisible();
    const newestTs = last ? tsMs(last.data({ serverTimestamps: "estimate" })) : 0;
    let readAt = getGroupReadAt(state.id);
    if (readAt === null) {
        // Première fois sur cet appareil : l'historique existant est considéré comme lu
        readAt = docs.length ? newestTs : 0;
        setGroupReadAt(state.id, readAt);
    }
    if (isOpenNow && newestTs > readAt) {
        readAt = newestTs;
        setGroupReadAt(state.id, readAt);
    }
    state.unread = docs.filter((d) => {
        const m = d.data({ serverTimestamps: "estimate" });
        return m.senderId !== me && tsMs(m) > readAt;
    }).length;

    if (!last) {
        state.unread = 0;
        state.preview = "Aucun message";
        state.timeText = "";
        state.lastTs = 0;
        state.initialized = true;
        refreshGroupUI(state);
        updateTotalUnread();
        scheduleSort();
        return;
    }
    const msg = last.data({ serverTimestamps: "estimate" });

    if (state.initialized) {
        const fresh = snap.docChanges().filter((ch) => {
            if (ch.type !== "added" || ch.doc.metadata.hasPendingWrites) return false;
            const m = ch.doc.data({ serverTimestamps: "estimate" });
            if (m.senderId === me) return false;
            const t = toDate(m.timestamp);
            return !!t && Date.now() - t.getTime() < 60000;
        });
        if (fresh.length && !(activeChatUserId === state.id && isActiveChatVisible())) {
            const target = fresh[fresh.length - 1].doc.data();
            notifyNewMessage({ uid: state.id, username: state.name, isGroup: true }, `${target.senderName || "Quelqu'un"} : ${target.text || ""}`, fresh.length);
        }
    }
    if (seq !== state.msgSeq) return;
    state.initialized = true;

    const date = toDate(msg.timestamp);
    state.lastTs = date ? date.getTime() : 0;
    state.timeText = date ? formatListTime(date) : "";
    const who = msg.senderId === me ? "Vous" : (msg.senderName || "?");
    state.preview = `${who} : ${(msg.text || "").replace(/\s+/g, " ")}`;
    refreshGroupUI(state);
    updateTotalUnread();
    scheduleSort();
}

function refreshGroupUI(s) {
    const isOpen = activeChatUserId === s.id && isActiveChatVisible();
    const unread = isOpen ? 0 : s.unread;

    s.nameEl.textContent = s.name || "Groupe";
    s.nameEl.style.fontWeight = unread > 0 ? "800" : "600";
    s.textEl.style.fontWeight = unread > 0 ? "700" : "normal";
    s.textEl.style.color = unread > 0 ? "#0f172a" : "#64748b";
    s.textEl.textContent = s.preview;

    s.timeEl.textContent = s.timeText || "";
    s.badgeEl.textContent = unread > 99 ? "99+" : String(unread);
    s.badgeEl.style.display = unread > 0 ? "flex" : "none";
    s.el.classList.toggle("x-unread", unread > 0);
}

function updateGroupEntry(group) {
    const s = groupState.get(group.id);
    if (!s) return;
    s.name = group.name;
    s.members = group.members || [];
    s.createdBy = group.createdBy;
    s.groupKeys = group.groupKeys || {};
    s.historyFrom = group.historyFrom || {};
    paintAvatar(s.avatarEl, group.name, true);
    s.el.dataset.search = normalize(group.name);
    refreshGroupUI(s);
    if (activeChat && activeChat.isGroup && activeChat.id === group.id) {
        activeChat.name = group.name;
        activeChat.members = group.members || [];
        activeChat.groupKeys = group.groupKeys || {};
        activeChat.historyFrom = group.historyFrom || {};
        const h2 = qs(".chat-user h2");
        if (h2) h2.textContent = group.name || "Groupe";
        updateGroupHeaderInfo();
    }
}

function removeGroup(id) {
    const s = groupState.get(id);
    if (s) { s.unsubs.forEach((fn) => fn()); s.el.remove(); groupState.delete(id); }
    if (activeChatUserId === id) closeActiveChat();
    updateEmptyState();
}

function openGroupChat(id) {
    const group = groupState.get(id);
    if (!group) return false;

    const convTabBtn = qs('[data-tab="conversations"]');
    if (convTabBtn) convTabBtn.click();

    qsa(".conversation").forEach((c) => c.classList.toggle("active-conversation", c.dataset.uid === id));

    renderChatLayout();
    selectGroupChat(group);

    if (window.innerWidth <= 768) {
        qs(".chat-area")?.classList.add("active");
    }
    return true;
}

async function selectGroupChat(group) {
    if (unsubscribeMessages) { unsubscribeMessages(); unsubscribeMessages = null; }
    if (unsubscribeStatus) { unsubscribeStatus(); unsubscribeStatus = null; }
    clearInterval(statusTicker);
    cancelEdit(true);

    activeChatUserId = group.id;
    const chat = {
        uid: group.id, id: group.id, isGroup: true,
        name: group.name, members: group.members || [], createdBy: group.createdBy,
        groupKeys: group.groupKeys || {}, historyFrom: group.historyFrom || {},
        docs: [], lastSnapshot: null, newIds: new Set(), captured: false,
        msgIndex: new Map(), rendered: false, lastRenderedId: null
    };
    activeChat = chat;
    refreshAllConversationsUI();
    groupState.forEach(refreshGroupUI);
    updateTotalUnread();

    const chatHeaderName = qs(".chat-user h2");
    if (chatHeaderName) chatHeaderName.textContent = group.name || "Groupe";
    const chatHeaderAvatar = qs(".chat-user .avatar");
    paintAvatar(chatHeaderAvatar, group.name, true);
    updateGroupHeaderInfo();
    updateComposerState();

    // Fenêtre d'historique : si j'ai rejoint le groupe après coup, je ne peux (et ne dois) demander
    // que les messages à partir de ma date d'entrée. Les membres fondateurs n'ont pas cette limite.
    let messagesQuery = db.collection("groups").doc(group.id).collection("messages").orderBy("timestamp", "asc");
    const myHistoryFrom = chat.historyFrom && chat.historyFrom[currentUser.uid];
    if (myHistoryFrom) messagesQuery = messagesQuery.where("timestamp", ">=", toDate(myHistoryFrom) || new Date(0));

    unsubscribeMessages = messagesQuery
        .onSnapshot((snapshot) => {
            if (activeChat !== chat) return;
            chat.lastSnapshot = snapshot;
            renderGroupMessages(snapshot);
        }, (err) => console.error("Erreur lecture messages de groupe :", err));
}

// Cache le statut de présence et les boutons d'appel (non pertinents pour un groupe)
function updateGroupHeaderInfo() {
    const label = document.getElementById("statusLabel");
    const dot = document.getElementById("statusDot");
    if (label) label.textContent = `${(activeChat?.members || []).length} membre${(activeChat?.members || []).length > 1 ? "s" : ""}`;
    if (dot) dot.style.display = "none";
    const btnPhone = qs(".chat-actions button:nth-child(2)");
    const btnVideo = qs(".chat-actions button:nth-child(3)");
    if (btnPhone) btnPhone.style.display = "none";
    if (btnVideo) btnVideo.style.display = "none";
}

// Déchiffre un message de groupe (avec rétrocompatibilité pour les anciens messages envoyés en clair).
async function decryptGroupMsg(docId, msg, chat) {
    if (msg.cipherText === undefined) return { text: msg.text || "", legacy: true, failed: false };
    if (!msg.cipherText) return { text: "", legacy: false, failed: false };

    const groupKey = await getGroupKey(chat);
    if (typeof E2EE === "undefined" || !E2EE.decryptGroupText || !groupKey) {
        return { text: "Message chiffré", legacy: false, failed: true };
    }

    const cacheKey = `${docId}:${msg.cipherText}`;
    if (groupTextCache.has(cacheKey)) return groupTextCache.get(cacheKey);

    let result;
    try {
        const text = await E2EE.decryptGroupText(msg, groupKey);
        result = { text, legacy: false, failed: false };
    } catch (err) {
        console.error("Erreur de déchiffrement (groupe) :", err);
        result = { text: "Message indéchiffrable sur cet appareil", legacy: false, failed: true };
    }
    groupTextCache.set(cacheKey, result);
    return result;
}

function buildGroupMessageEl(entry, chat, decrypted) {
    const { doc, msg } = entry;
    const isMine = msg.senderId === currentUser.uid;
    const isNew = !isMine && !!chat && chat.newIds.has(doc.id);
    const date = toDate(msg.timestamp);
    const { text: shownText, failed } = decrypted || { text: msg.text || "", failed: false };

    const timeNode = mk("time", { title: date ? fullDateTime(date) : "" },
        msg.edited ? mk("span", { class: "x-edited", text: "modifié" }) : null,
        date ? timeOf(date) : "",
        isMine ? ico("fa-solid fa-check x-tick", "Envoyé") : null
    );

    return mk("div", { class: `message ${isMine ? "sent" : "received"}${isNew ? " x-new" : ""}${failed ? " x-undecryptable" : ""}`, dataset: { id: doc.id } },
        !isMine ? mk("span", { class: "x-sender-name", text: msg.senderName || "?" }) : null,
        mk("p", { text: shownText }),
        timeNode,
        mk("button", { type: "button", class: "x-msg-menu-btn", title: "Options du message", "aria-label": "Options du message" },
            ico("fa-solid fa-chevron-down"))
    );
}

async function renderGroupMessages(snapshot) {
    const chat = activeChat;
    const container = qs(".messages");
    if (!chat || !chat.isGroup || !container) return;

    const me = currentUser.uid;
    const entries = snapshot.docs
        .map((d) => ({ doc: d, msg: d.data({ serverTimestamps: "estimate" }) }))
        .filter((e) => !(Array.isArray(e.msg.deletedFor) && e.msg.deletedFor.includes(me)));
    chat.docs = snapshot.docs;

    const decodedList = await Promise.all(entries.map((e) => decryptGroupMsg(e.doc.id, e.msg, chat)));
    if (chat !== activeChat) return;

    chat.msgIndex = new Map(entries.map((e, i) => [e.doc.id, {
        isMine: e.msg.senderId === me, text: decodedList[i].text, ts: toDate(e.msg.timestamp)?.getTime()
    }]));

    // Messages « nouveaux » : plus récents que mon marqueur de lecture à l'ouverture (ou reçus onglet masqué)
    if (!chat.captured || !isActiveChatVisible()) {
        const readAt = getGroupReadAt(chat.id) || 0;
        entries.forEach((e) => {
            if (e.msg.senderId !== me && tsMs(e.msg) > readAt) chat.newIds.add(e.doc.id);
        });
        chat.captured = true;
    }

    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 140;
    const prevScrollTop = container.scrollTop;
    const frag = document.createDocumentFragment();

    if (entries.length === 0) {
        frag.appendChild(mk("div", { class: "encryption-notice" },
            ico("fa-solid fa-users"),
            mk("div", {}, mk("strong", { text: "Nouveau groupe" }), mk("p", { text: "Envoyez le premier message." }))
        ));
    } else {
        const firstNew = entries.find((e) => chat.newIds.has(e.doc.id));
        const newCount = entries.filter((e) => chat.newIds.has(e.doc.id)).length;
        let lastDay = "";
        entries.forEach((e, i) => {
            const d = toDate(e.msg.timestamp) || new Date();
            const dayKey = d.toDateString();
            if (dayKey !== lastDay) {
                frag.appendChild(mk("div", { class: "x-date-sep", text: formatDayLabel(d) }));
                lastDay = dayKey;
            }
            if (firstNew === e) {
                frag.appendChild(mk("div", { class: "x-unread-divider", text: `${newCount} nouveau${newCount > 1 ? "x" : ""} message${newCount > 1 ? "s" : ""}` }));
            }
            frag.appendChild(buildGroupMessageEl(e, chat, decodedList[i]));
        });
    }

    container.textContent = "";
    container.appendChild(frag);

    const lastEntry = entries[entries.length - 1];
    const lastIsMine = !!lastEntry && lastEntry.msg.senderId === me;
    const newTail = (lastEntry ? lastEntry.doc.id : null) !== chat.lastRenderedId;

    if (!chat.rendered) {
        const divider = container.querySelector(".x-unread-divider");
        container.scrollTop = divider
            ? divider.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 40
            : container.scrollHeight;
        chat.rendered = true;
    } else if (nearBottom || (newTail && lastIsMine)) {
        container.scrollTop = container.scrollHeight;
    } else {
        container.scrollTop = prevScrollTop;
    }
    chat.lastRenderedId = lastEntry ? lastEntry.doc.id : null;

    markActiveChatRead();
}

async function sendGroupMessage(rawText) {
    const chat = activeChat;
    if (!chat || !chat.isGroup) return;
    const me = currentUser.uid;

    try {
        const groupKey = await getGroupKey(chat);
        if (!groupKey) throw new Error("Clé de groupe indisponible sur cet appareil.");

        const { iv, cipherText } = await E2EE.encryptGroupText(rawText, groupKey);

        await db.collection("groups").doc(chat.id).collection("messages").add({
            senderId: me,
            senderName: myUsername,
            iv, cipherText,
            timestamp: FieldValue.serverTimestamp()
        });
    } catch (err) {
        console.error("Erreur envoi message de groupe :", err);
        const input = messageInputEl();
        if (input && !input.value) input.value = rawText;
        showToast("Message non envoyé", "Vérifiez votre connexion et réessayez.");
    }
}

// ---------- Création d'un groupe ----------
function mountGroupFab() {
    const host = qs(".conversation-list") || qs(".conversations")?.parentElement;
    if (!host || host.querySelector(".x-fab")) return;
    const cs = getComputedStyle(host);
    if (cs.position === "static") host.style.position = "relative";
    host.appendChild(mk("button", { type: "button", class: "x-fab", title: "Nouveau groupe", onclick: openCreateGroupDialog },
        ico("fa-solid fa-users")));
}

function openCreateGroupDialog() {
    const contacts = Array.from(usersById.values()).filter((u) => u.uid !== currentUser.uid).sort((a, b) => (a.username || "").localeCompare(b.username || "", "fr"));
    if (contacts.length === 0) {
        showToast("Aucun contact", "Il n'y a pas encore d'autre utilisateur à ajouter à un groupe.");
        return;
    }

    const nameInput = mk("input", { type: "text", placeholder: "Nom du groupe", maxlength: "60" });
    const checkboxes = [];
    const memberList = mk("div", { class: "x-group-members" },
        contacts.map((u) => {
            const cb = mk("input", { type: "checkbox", value: u.uid });
            checkboxes.push(cb);
            const memberName = u.username || u.userName || u.displayName || (u.email ? u.email.split("@")[0] : "Utilisateur");
            const av = mk("div", { class: "avatar x-av" });
            paintAvatar(av, memberName);
            return mk("div", { class: "x-member-row" },
                mk("label", {}, cb, av, mk("span", { text: memberName }))
            );
        })
    );

    const close = () => { document.removeEventListener("keydown", onKey); backdrop.remove(); };
    const onKey = (e) => { if (e.key === "Escape") close(); };

    const create = async () => {
        const name = nameInput.value.trim();
        const selected = checkboxes.filter((cb) => cb.checked).map((cb) => cb.value);
        if (!name) { showToast("Nom manquant", "Donnez un nom à votre groupe."); nameInput.focus(); return; }
        if (selected.length === 0) { showToast("Aucun membre", "Sélectionnez au moins un contact."); return; }

        const members = Array.from(new Set([currentUser.uid, ...selected]));
        try {
            if (typeof E2EE === "undefined" || !E2EE.generateGroupKey) {
                throw new Error("Module de chiffrement indisponible.");
            }
            const groupKey = await E2EE.generateGroupKey();
            const pubKeys = {};
            await Promise.all(members.map(async (uid) => { pubKeys[uid] = await getPublicKey(uid); }));

            const groupKeys = {};
            for (const uid of members) {
                if (!pubKeys[uid]) continue; // membre sans clé publique : sera ajouté plus tard si besoin
                groupKeys[uid] = await E2EE.wrapGroupKeyForMember(groupKey, pubKeys[uid]);
            }
            if (!groupKeys[currentUser.uid]) throw new Error("Impossible de chiffrer la clé du groupe pour vous-même.");

            const doc = await db.collection("groups").add({
                name, members, createdBy: currentUser.uid, createdAt: FieldValue.serverTimestamp(), groupKeys
            });
            close();
            setTimeout(() => openGroupChat(doc.id), 150); // laisse le temps à l'écouteur de créer l'entrée
        } catch (err) {
            console.error("Erreur création du groupe :", err);
            showToast("Création impossible", "Vérifiez votre connexion et réessayez.");
        }
    };

    const backdrop = mk("div", { class: "x-backdrop", onclick: (e) => { if (e.target === backdrop) close(); } },
        mk("div", { class: "x-dialog", role: "dialog", "aria-modal": "true" },
            mk("h3", { text: "Nouveau groupe" }),
            mk("div", { class: "x-group-form" },
                mk("div", { class: "x-group-hero" },
                    mk("div", { class: "avatar x-av x-av-group x-av-xl" }, ico("fa-solid fa-users"))),
                nameInput,
                memberList
            ),
            mk("div", { class: "x-actions" },
                mk("button", { type: "button", class: "x-btn x-btn-primary", text: "Créer le groupe", onclick: create }),
                mk("button", { type: "button", class: "x-btn x-btn-ghost", text: "Annuler", onclick: close })
            )
        )
    );
    document.addEventListener("keydown", onKey);
    document.body.appendChild(backdrop);
    nameInput.focus();
}

function showGroupMembers() {
    const chat = activeChat;
    if (!chat || !chat.isGroup) return;
    const names = (chat.members || []).map((uid) => {
        if (uid === currentUser.uid) return `${myUsername} (vous)`;
        return usersById.get(uid)?.username || "Utilisateur";
    });
    openDialog({
        title: `Membres (${names.length})`,
        message: names.join("\n"),
        actions: [{ label: "Fermer", value: true, variant: "ghost" }]
    });
}

// ---------- Ajout de membres (réservé à l'administrateur = créateur du groupe) ----------
function openAddMembersDialog() {
    const chat = activeChat;
    if (!chat || !chat.isGroup) return;
    if (chat.createdBy !== currentUser.uid) {
        showToast("Action réservée", "Seul l'administrateur du groupe peut ajouter des membres.");
        return;
    }

    const current = new Set(chat.members || []);
    const candidates = Array.from(usersById.values()).filter((u) => u.uid !== currentUser.uid && !current.has(u.uid))
        .sort((a, b) => (a.username || "").localeCompare(b.username || "", "fr"));

    if (candidates.length === 0) {
        showToast("Aucun contact disponible", "Tous vos contacts sont déjà membres de ce groupe.");
        return;
    }

    const checkboxes = [];
    const memberList = mk("div", { class: "x-group-members" },
        candidates.map((u) => {
            const cb = mk("input", { type: "checkbox", value: u.uid });
            checkboxes.push(cb);
            const memberName = u.username || u.userName || u.displayName || (u.email ? u.email.split("@")[0] : "Utilisateur");
            const av = mk("div", { class: "avatar x-av" });
            paintAvatar(av, memberName);
            return mk("div", { class: "x-member-row" }, mk("label", {}, cb, av, mk("span", { text: memberName })));
        })
    );

    const close = () => { document.removeEventListener("keydown", onKey); backdrop.remove(); };
    const onKey = (e) => { if (e.key === "Escape") close(); };

    const confirm = async () => {
        const selected = checkboxes.filter((cb) => cb.checked).map((cb) => cb.value);
        if (selected.length === 0) { showToast("Aucun membre sélectionné", "Cochez au moins un contact."); return; }
        close();
        await addMembersToGroup(chat.id, selected);
    };

    const backdrop = mk("div", { class: "x-backdrop", onclick: (e) => { if (e.target === backdrop) close(); } },
        mk("div", { class: "x-dialog" },
            mk("h3", { text: "Ajouter des membres" }),
            mk("p", { text: `Ils verront les messages des ${GROUP_HISTORY_WINDOW_DAYS} derniers jours.` }),
            memberList,
            mk("div", { class: "x-dialog-actions" },
                mk("button", { type: "button", class: "x-btn x-btn-primary", text: "Ajouter", onclick: confirm }),
                mk("button", { type: "button", class: "x-btn x-btn-ghost", text: "Annuler", onclick: close })
            )
        )
    );
    document.addEventListener("keydown", onKey);
    document.body.appendChild(backdrop);
}

async function addMembersToGroup(groupId, newUids) {
    showToast("Ajout en cours…", "Merci de patienter, ne fermez pas l'application.");
    try {
        if (typeof E2EE === "undefined" || !E2EE.wrapGroupKeyForMember) {
            throw new Error("Module de chiffrement indisponible.");
        }
        const groupKey = await getGroupKey(activeChat && activeChat.id === groupId ? activeChat : groupState.get(groupId));
        if (!groupKey) throw new Error("Clé de groupe indisponible sur cet appareil.");

        const newPubKeys = {};
        await Promise.all(newUids.map(async (uid) => { newPubKeys[uid] = await getPublicKey(uid); }));
        const readyUids = newUids.filter((uid) => !!newPubKeys[uid]);
        if (readyUids.length === 0) throw new Error("Clé publique introuvable pour ces contacts.");

        // Fenêtre d'historique : le nouveau membre voit à partir de « maintenant moins X jours »,
        // jamais avant la création du groupe. Cette date est ensuite imposée par les règles Firestore,
        // pas seulement par l'affichage : Firestore refusera de lui envoyer ce qui est plus ancien.
        const cutoff = new Date(Date.now() - GROUP_HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
        const groupKeysUpdate = {};
        const historyFromUpdate = {};
        for (const uid of readyUids) {
            groupKeysUpdate[`groupKeys.${uid}`] = await E2EE.wrapGroupKeyForMember(groupKey, newPubKeys[uid]);
            historyFromUpdate[`historyFrom.${uid}`] = cutoff;
        }

        await db.collection("groups").doc(groupId).update({
            ...groupKeysUpdate,
            ...historyFromUpdate,
            members: FieldValue.arrayUnion(...readyUids)
        });

        showToast("Membres ajoutés", `Ils voient désormais les ${GROUP_HISTORY_WINDOW_DAYS} derniers jours de discussion.`);
    } catch (err) {
        console.error("Erreur lors de l'ajout de membres :", err);
        showToast("Ajout impossible", "Vérifiez votre connexion et réessayez.");
    }
}

async function confirmLeaveGroup() {
    const chat = activeChat;
    if (!chat || !chat.isGroup) return;
    const ok = await openDialog({
        title: "Quitter le groupe ?",
        message: `Vous ne recevrez plus les messages de « ${chat.name} ».`,
        actions: [
            { label: "Quitter", value: true, variant: "danger" },
            { label: "Annuler", value: false, variant: "ghost" }
        ]
    });
    if (!ok) return;

    try {
        await db.collection("groups").doc(chat.id).update({
            members: FieldValue.arrayRemove(currentUser.uid)
        });
        closeActiveChat();
        showToast("Groupe quitté");
    } catch (err) {
        console.error("Erreur en quittant le groupe :", err);
        showToast("Action impossible", "Vérifiez votre connexion et réessayez.");
    }
}

// ============================================================================
// 13. INTERFACE DE CHAT
// ============================================================================
const EMOJI_PICKER = ["\u{1F44D}", "\u{2764}", "\u{1F525}", "\u{1F602}", "\u{1F389}", "\u{1F60A}", "\u{1F64C}", "\u{1F44F}", "\u{1F4AF}", "\u{2728}", "\u{1F60D}", "\u{1F62D}", "\u{1F914}", "\u{1F44B}", "\u{1F64F}", "\u{1F60E}", "\u{1F622}", "\u{1F621}", "\u{1F631}", "\u{1F970}", "\u{1F605}", "\u{1F4AA}", "\u{1F440}", "\u{1F91D}"];

function renderChatLayout() {
    const chatArea = qs(".chat-area");
    if (!chatArea) return;
    closeMenu();

    chatArea.innerHTML = `
        <header class="chat-header">
            <button class="btn-back-mobile" id="btnBackMobile" title="Retour aux discussions" type="button">
                <i class="fa-solid fa-arrow-left"></i>
            </button>
            <div class="chat-user">
                <div class="avatar x-av">--</div>
                <div>
                    <h2>Chargement...</h2>
                    <p class="user-status-text"><span class="online-dot" id="statusDot"></span> <span id="statusLabel">Hors ligne</span></p>
                </div>
            </div>
            <div class="chat-actions">
                <button title="Rechercher" type="button"><i class="fa-solid fa-magnifying-glass"></i></button>
                <button title="Appel vocal" type="button"><i class="fa-solid fa-phone"></i></button>
                <button title="Appel vidéo" type="button"><i class="fa-solid fa-video"></i></button>
                <button title="Options" type="button" id="btnChatOptions"><i class="fa-solid fa-ellipsis-vertical"></i></button>
            </div>
        </header>

        <div class="messages"></div>

        <div id="xEditBanner" class="x-banner" style="display: none;">
            <i class="fa-solid fa-pen"></i>
            <div class="x-banner-text"><strong>Modification du message</strong> <span id="xEditPreview"></span></div>
            <button type="button" id="xEditCancel" title="Annuler la modification"><i class="fa-solid fa-xmark"></i></button>
        </div>

        <div id="xBlockedBanner" class="x-banner x-blocked" style="display: none;">
            <i class="fa-solid fa-ban"></i>
            <span class="x-banner-text" id="xBlockedText">Vous avez bloqué ce contact.</span>
            <button type="button" id="xUnblockBtn">Débloquer</button>
        </div>

        <footer class="message-form" style="position: relative;">
            <button class="attachment-button" type="button"><i class="fa-solid fa-paperclip"></i></button>
            <input type="text" placeholder="Écrire un message..." autocomplete="off" />

            <div id="stickerPicker" class="sticker-picker-popup">
                <div class="sticker-header">
                    <span>Emojis</span>
                    <button type="button" id="closeStickerPicker">&times;</button>
                </div>
                <div class="sticker-grid">
                    ${EMOJI_PICKER.map((e) => `<span class="sticker-item" role="button">${e}</span>`).join("")}
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
        btnBack.addEventListener("click", () => closeActiveChat());
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

    // ⋮ Options : bloquer / débloquer (1:1) ou membres / quitter (groupe)
    const btnOptions = chatArea.querySelector("#btnChatOptions");
    if (btnOptions) {
        btnOptions.addEventListener("click", () => {
            if (!activeChatUserId) return;
            const r = btnOptions.getBoundingClientRect();

            if (activeChat && activeChat.isGroup) {
                const isAdmin = activeChat.createdBy === currentUser.uid;
                const items = [{ label: "Voir les membres", icon: "fa-solid fa-users", action: showGroupMembers }];
                if (isAdmin) items.push({ label: "Ajouter des membres", icon: "fa-solid fa-user-plus", action: openAddMembersDialog });
                items.push({ label: "Quitter le groupe", icon: "fa-solid fa-right-from-bracket", danger: true, action: confirmLeaveGroup });
                openMenu(r.right - 220, r.bottom + 6, items);
                return;
            }

            const uid = activeChatUserId;
            const item = blockedByMe.has(uid)
                ? { label: "Débloquer ce contact", icon: "fa-solid fa-unlock", action: () => unblockUser(uid) }
                : { label: "Bloquer ce contact", icon: "fa-solid fa-ban", danger: true, action: () => confirmBlock(uid) };
            openMenu(r.right - 200, r.bottom + 6, [item]);
        });
    }

    const unblockBtn = chatArea.querySelector("#xUnblockBtn");
    if (unblockBtn) unblockBtn.addEventListener("click", () => { if (activeChatUserId) unblockUser(activeChatUserId); });

    const editCancel = chatArea.querySelector("#xEditCancel");
    if (editCancel) editCancel.addEventListener("click", () => cancelEdit());

    const sendBtn = chatArea.querySelector(".send-button");
    const messageInput = chatArea.querySelector("input[type='text']");
    if (sendBtn) sendBtn.addEventListener("click", sendMessage);
    if (messageInput) {
        messageInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                sendMessage();
            } else if (e.key === "Escape" && editingMsg) {
                cancelEdit();
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
        if (closeBtn) closeBtn.addEventListener("click", () => stickerPicker.classList.remove("active"));
        chatArea.querySelectorAll(".sticker-item").forEach((item) => {
            item.addEventListener("click", () => {
                if (messageInput) {
                    messageInput.value += item.textContent;
                    messageInput.focus();
                }
            });
        });
    }

    setupMessageInteractions(chatArea.querySelector(".messages"));
}

function messageInputEl() {
    return qs(".message-form input[type='text']");
}

function isActiveChatVisible() {
    if (!activeChatUserId || document.hidden) return false;
    const area = qs(".chat-area");
    return !!area && area.getClientRects().length > 0 && !!qs(".messages", area);
}

function closeActiveChat() {
    if (unsubscribeMessages) { unsubscribeMessages(); unsubscribeMessages = null; }
    if (unsubscribeStatus) { unsubscribeStatus(); unsubscribeStatus = null; }
    clearInterval(statusTicker);
    cancelEdit(true);
    activeChatUserId = null;
    activeChat = null;
    qs(".chat-area")?.classList.remove("active");
    qsa(".conversation").forEach((c) => c.classList.remove("active-conversation"));
    refreshAllConversationsUI();
    groupState.forEach(refreshGroupUI);
    updateTotalUnread();
}

// SÉLECTIONNER ET LIRE UNE DISCUSSION
async function selectContact(targetUser) {
    const me = currentUser.uid;
    const peerUid = targetUser.uid;
    const chatId = getChatId(me, peerUid);

    if (unsubscribeMessages) { unsubscribeMessages(); unsubscribeMessages = null; }
    if (unsubscribeStatus) { unsubscribeStatus(); unsubscribeStatus = null; }
    clearInterval(statusTicker);
    cancelEdit(true);

    activeChatUserId = peerUid;
    const chat = {
        uid: peerUid, chatId,
        peerData: usersById.get(peerUid) || targetUser,
        peerPresence: null,
        docs: [], lastSnapshot: null,
        newIds: new Set(), captured: false,
        msgIndex: new Map(), rendered: false, lastRenderedId: null
    };
    activeChat = chat;
    refreshAllConversationsUI();
    updateTotalUnread();

    const chatHeaderName = qs(".chat-user h2");
    if (chatHeaderName) chatHeaderName.textContent = targetUser.username || "Discussion";
    const chatHeaderAvatar = qs(".chat-user .avatar");
    paintAvatar(chatHeaderAvatar, targetUser.username || "Discussion");

    updateComposerState();

    // Présence du correspondant (battement de cœur) + rafraîchissement du texte toutes les 30 s
    unsubscribeStatus = db.collection("presence").doc(peerUid).onSnapshot((doc) => {
        if (activeChat !== chat) return;
        chat.peerPresence = doc.exists ? doc.data({ serverTimestamps: "estimate" }) : null;
        renderPeerStatus();
    }, (err) => {
        console.warn("Présence indisponible :", err);
        if (activeChat === chat) { chat.peerPresence = null; renderPeerStatus(); }
    });
    statusTicker = setInterval(renderPeerStatus, 30000);
    renderPeerStatus();

    if (!getMyPrivateKey()) await initUserKeys(currentUser);
    if (activeChat !== chat) return;

    unsubscribeMessages = db.collection("chats").doc(chatId).collection("messages")
        .orderBy("timestamp", "asc")
        .onSnapshot((snapshot) => {
            if (activeChat !== chat) return;
            chat.lastSnapshot = snapshot;
            renderMessages(snapshot);
        }, (err) => console.error("Erreur lecture messages :", err));
}

function encryptionNotice() {
    return mk("div", { class: "encryption-notice" },
        ico("fa-solid fa-shield-halved"),
        mk("div", {}, mk("strong", { text: "Chiffrement E2EE activé" }), mk("p", { text: "Discussion sécurisée avec sauvegarde dans le cloud." }))
    );
}

// Icône de statut : envoi en cours / envoyé / reçu / vu
function statusKind(doc, msg) {
    if (doc.metadata.hasPendingWrites) return "pending";
    return msg.status || "read"; // anciens messages sans statut = déjà lus
}
function tickIcon(kind, readAt) {
    switch (kind) {
        case "pending": return ico("fa-regular fa-clock x-tick", "Envoi en cours…");
        case "read": return ico("fa-solid fa-check-double x-tick x-read", readAt ? `Vu à ${timeOf(readAt)}` : "Vu");
        case "delivered": return ico("fa-solid fa-check-double x-tick", "Reçu");
        default: return ico("fa-solid fa-check x-tick", "Envoyé");
    }
}

function buildMessageEl(entry, clearText, chat) {
    const { doc, msg } = entry;
    const isMine = msg.senderId === currentUser.uid;
    const isNew = !isMine && chat.newIds.has(doc.id);
    const date = toDate(msg.timestamp);

    const timeNode = mk("time", { title: date ? fullDateTime(date) : "" },
        msg.edited ? mk("span", { class: "x-edited", text: "modifié" }) : null,
        date ? timeOf(date) : "",
        isMine ? tickIcon(statusKind(doc, msg), toDate(msg.readAt)) : null
    );

    return mk("div", { class: `message ${isMine ? "sent" : "received"}${isNew ? " x-new" : ""}`, dataset: { id: doc.id } },
        mk("p", { text: clearText }),
        timeNode,
        mk("button", { type: "button", class: "x-msg-menu-btn", title: "Options du message", "aria-label": "Options du message" },
            ico("fa-solid fa-chevron-down"))
    );
}

async function renderMessages(snapshot) {
    const chat = activeChat;
    const container = qs(".messages");
    if (!chat || !container) return;

    const seq = ++renderSeq;
    const me = currentUser.uid;

    const entries = snapshot.docs
        .map((d) => ({ doc: d, msg: d.data({ serverTimestamps: "estimate" }) }))
        .filter((e) => !isMsgHidden(e.msg));
    chat.docs = snapshot.docs;

    // On déchiffre tout d'abord, puis on dessine d'un coup : pas de doublons si deux mises à jour se croisent
    const texts = await Promise.all(entries.map((e) => decryptMessage(e.doc.id, e.msg, e.msg.senderId === me)));
    if (seq !== renderSeq || chat !== activeChat) return;

    // Messages « nouveaux » : ceux qui n'étaient pas lus à l'ouverture (ou reçus onglet masqué)
    if (!chat.captured || !isActiveChatVisible()) {
        entries.forEach((e) => {
            if (e.msg.senderId !== me && (e.msg.status || "read") !== "read") chat.newIds.add(e.doc.id);
        });
        chat.captured = true;
    }

    chat.msgIndex = new Map(entries.map((e, i) => [e.doc.id, {
        isMine: e.msg.senderId === me,
        text: texts[i],
        ts: toDate(e.msg.timestamp)?.getTime(),
        status: e.msg.status || "read",
        suppressed: !!e.msg.suppressed
    }]));

    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 140;
    const prevScrollTop = container.scrollTop;
    const frag = document.createDocumentFragment();

    if (entries.length === 0) {
        frag.appendChild(encryptionNotice());
    } else {
        const firstNew = entries.find((e) => chat.newIds.has(e.doc.id));
        const newCount = entries.filter((e) => chat.newIds.has(e.doc.id)).length;
        let lastDay = "";

        entries.forEach((e, i) => {
            const d = toDate(e.msg.timestamp) || new Date();
            const dayKey = d.toDateString();
            if (dayKey !== lastDay) {
                frag.appendChild(mk("div", { class: "x-date-sep", text: formatDayLabel(d) }));
                lastDay = dayKey;
            }
            if (firstNew === e) {
                frag.appendChild(mk("div", { class: "x-unread-divider", text: `${newCount} nouveau${newCount > 1 ? "x" : ""} message${newCount > 1 ? "s" : ""}` }));
            }
            frag.appendChild(buildMessageEl(e, texts[i], chat));
        });
    }

    container.textContent = "";
    container.appendChild(frag);

    const lastEntry = entries[entries.length - 1];
    const lastId = lastEntry ? lastEntry.doc.id : null;
    const newTail = lastId !== chat.lastRenderedId;
    const lastIsMine = !!lastEntry && lastEntry.msg.senderId === me;

    if (!chat.rendered) {
        const divider = container.querySelector(".x-unread-divider");
        if (divider) {
            container.scrollTop = divider.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 40;
        } else {
            container.scrollTop = container.scrollHeight;
        }
        chat.rendered = true;
    } else if (nearBottom || (newTail && lastIsMine)) {
        container.scrollTop = container.scrollHeight;
    } else {
        container.scrollTop = prevScrollTop;
    }
    chat.lastRenderedId = lastId;

    markActiveChatRead();
}

// Marque comme « vus » les messages reçus quand la discussion est réellement affichée
function markActiveChatRead() {
    const chat = activeChat;
    if (!chat || !currentUser || !isActiveChatVisible()) return;
    const me = currentUser.uid;

    // Groupe : pas d'accusé de lecture par message, on avance simplement le marqueur de lecture local
    if (chat.isGroup) {
        const gState = groupState.get(chat.id);
        let newest = 0;
        (chat.docs || []).forEach((d) => { newest = Math.max(newest, tsMs(d.data({ serverTimestamps: "estimate" }))); });
        const current = getGroupReadAt(chat.id) || 0;
        if (newest > current) setGroupReadAt(chat.id, newest);
        if (gState && gState.unread > 0) {
            gState.unread = 0;
            refreshGroupUI(gState);
            updateTotalUnread();
        }
        return;
    }

    const pairs = [];
    (chat.docs || []).forEach((d) => {
        const m = d.data();
        if (m.receiverId !== me || isMsgHidden(m)) return;
        if ((m.status || "read") === "read" || d.metadata.hasPendingWrites) return;
        pairs.push([d.ref, { status: "read", readAt: FieldValue.serverTimestamp() }]);
    });
    if (pairs.length) batchUpdate(pairs);

    const state = convState.get(chat.uid);
    if (pairs.length || (state && state.unread > 0)) {
        db.collection("chats").doc(chat.chatId)
            .set({ [`unreadCount_${me}`]: 0 }, { merge: true })
            .catch(console.error);
    }
}

async function batchUpdate(pairs) {
    for (let i = 0; i < pairs.length; i += 400) {
        const batch = db.batch();
        pairs.slice(i, i + 400).forEach(([ref, data]) => batch.update(ref, data));
        try { await batch.commit(); } catch (err) { console.warn("Mise à jour groupée impossible :", err); }
    }
}

// ============================================================================
// 14. MENU DES MESSAGES : copier / modifier / supprimer
// ============================================================================
function setupMessageInteractions(container) {
    if (!container) return;

    container.addEventListener("click", (e) => {
        const btn = e.target.closest(".x-msg-menu-btn");
        if (!btn) return;
        e.preventDefault();
        const msgEl = btn.closest(".message");
        const r = btn.getBoundingClientRect();
        if (msgEl) openMessageMenu(msgEl.dataset.id, r.left - 120, r.bottom + 4);
    });

    container.addEventListener("contextmenu", (e) => {
        const msgEl = e.target.closest(".message");
        if (!msgEl) return;
        e.preventDefault();
        openMessageMenu(msgEl.dataset.id, e.clientX, e.clientY);
    });

    // Appui long sur mobile
    let pressTimer = null;
    container.addEventListener("touchstart", (e) => {
        const msgEl = e.target.closest(".message");
        if (!msgEl) return;
        const t = e.touches[0];
        pressTimer = setTimeout(() => openMessageMenu(msgEl.dataset.id, t.clientX, t.clientY), 500);
    }, { passive: true });
    ["touchend", "touchmove", "touchcancel"].forEach((ev) =>
        container.addEventListener(ev, () => clearTimeout(pressTimer), { passive: true })
    );
}

function openMessageMenu(id, x, y) {
    const info = activeChat?.msgIndex.get(id);
    if (!info) return;

    const items = [{ label: "Copier", icon: "fa-regular fa-copy", action: () => copyText(info.text) }];

    const canEdit = info.isMine && !blockedByMe.has(activeChatUserId) && Date.now() - (info.ts ?? Date.now()) < EDIT_WINDOW_MS;
    if (canEdit) items.push({ label: "Modifier", icon: "fa-solid fa-pen", action: () => startEdit(id, info.text) });

    items.push({ label: "Supprimer", icon: "fa-regular fa-trash-can", danger: true, action: () => confirmDelete(id, info) });
    openMenu(x, y, items);
}

async function confirmDelete(id, info) {
    const isGroup = activeChat && activeChat.isGroup;
    const actions = [];
    if (info.isMine) actions.push({ label: isGroup ? "Supprimer pour le groupe" : "Supprimer pour tout le monde", value: "everyone", variant: "danger" });
    actions.push({ label: "Supprimer pour moi", value: "me", variant: info.isMine ? "ghost" : "danger" });
    actions.push({ label: "Annuler", value: null, variant: "ghost" });

    const choice = await openDialog({
        title: "Supprimer le message ?",
        message: info.isMine
            ? (isGroup
                ? "« Pour le groupe » efface le message définitivement chez tous les membres, sans laisser de trace."
                : "« Pour tout le monde » efface le message définitivement chez vous et chez votre correspondant, sans laisser de trace.")
            : "Ce message sera supprimé de votre côté uniquement.",
        actions
    });
    if (choice) deleteMessage(id, choice, info);
}

async function deleteMessage(id, scope, info) {
    const me = currentUser.uid;
    const peer = activeChatUserId;
    if (!peer) return;

    if (activeChat && activeChat.isGroup) {
        const msgRef = db.collection("groups").doc(peer).collection("messages").doc(id);
        try {
            if (scope === "everyone") await msgRef.delete();
            else await msgRef.update({ deletedFor: FieldValue.arrayUnion(me) });
        } catch (err) {
            console.error("Erreur de suppression :", err);
            showToast("Suppression impossible", "Vérifiez votre connexion et réessayez.");
        }
        return;
    }

    const chatRef = db.collection("chats").doc(getChatId(me, peer));
    const msgRef = chatRef.collection("messages").doc(id);

    try {
        if (scope === "everyone") {
            await msgRef.delete();
            decryptCache.delete(id);

            // Rien ne doit rester : on corrige le compteur du destinataire et on efface l'ancien aperçu stocké
            const key = `unreadCount_${peer}`;
            await db.runTransaction(async (tx) => {
                const snap = await tx.get(chatRef);
                if (!snap.exists) return;
                const update = { lastMessage: FieldValue.delete() };
                const count = snap.data()[key] || 0;
                if (info.status !== "read" && !info.suppressed && count > 0) update[key] = count - 1;
                tx.update(chatRef, update);
            });
        } else {
            await msgRef.update({ deletedFor: FieldValue.arrayUnion(me) });
        }
    } catch (err) {
        console.error("Erreur de suppression :", err);
        showToast("Suppression impossible", "Vérifiez votre connexion et réessayez.");
    }
}

function startEdit(id, text) {
    const input = messageInputEl();
    if (!input || input.disabled) return;
    editingMsg = { id, original: text };

    const banner = document.getElementById("xEditBanner");
    const preview = document.getElementById("xEditPreview");
    if (preview) preview.textContent = text.length > 80 ? text.slice(0, 80) + "…" : text;
    if (banner) banner.style.display = "flex";

    input.value = text;
    input.focus();
    input.setSelectionRange(text.length, text.length);
}

function cancelEdit(silent = false) {
    if (!editingMsg) return;
    editingMsg = null;
    const banner = document.getElementById("xEditBanner");
    if (banner) banner.style.display = "none";
    const input = messageInputEl();
    if (input && !silent) input.value = "";
}

async function submitEdit() {
    const input = messageInputEl();
    if (!input || !editingMsg || !activeChatUserId) return;

    const newText = input.value.trim();
    if (!newText) return;
    const { id, original } = editingMsg;
    if (newText === original) { cancelEdit(); return; }

    const peer = activeChatUserId;
    const isGroup = activeChat && activeChat.isGroup;
    const msgRef = isGroup
        ? db.collection("groups").doc(peer).collection("messages").doc(id)
        : db.collection("chats").doc(getChatId(currentUser.uid, peer)).collection("messages").doc(id);

    try {
        if (isGroup) {
            const groupKey = await getGroupKey(activeChat);
            if (!groupKey) throw new Error("Clé de groupe indisponible.");
            const { iv, cipherText } = await E2EE.encryptGroupText(newText, groupKey);
            await msgRef.update({ iv, cipherText, edited: true, editedAt: FieldValue.serverTimestamp() });
        } else {
            const { iv, cipherText, keys } = await encryptForBoth(newText, peer);
            await msgRef.update({
                iv, cipherText, keys,
                edited: true,
                editedAt: FieldValue.serverTimestamp()
            });
        }
        cancelEdit();
    } catch (err) {
        console.error("Erreur de modification :", err);
        showToast("Modification impossible", "Le message n'a pas été modifié. Réessayez.");
    }
}

// État de la zone de saisie (contact bloqué…)
function updateComposerState() {
    const peer = activeChatUserId;
    if (!peer) return;

    if (activeChat && activeChat.isGroup) {
        const input = messageInputEl();
        if (input) { input.disabled = false; input.placeholder = "Écrire un message..."; }
        qsa(".message-form .send-button, .message-form .attachment-button, .message-form #stickerBtn").forEach((b) => { b.disabled = false; });
        const banner = document.getElementById("xBlockedBanner");
        if (banner) banner.style.display = "none";
        return;
    }

    const blocked = blockedByMe.has(peer);
    const input = messageInputEl();
    if (input) {
        input.disabled = blocked;
        input.placeholder = blocked ? "Contact bloqué" : "Écrire un message...";
    }
    qsa(".message-form .send-button, .message-form .attachment-button, .message-form #stickerBtn").forEach((b) => { b.disabled = blocked; });

    const banner = document.getElementById("xBlockedBanner");
    const text = document.getElementById("xBlockedText");
    if (banner) banner.style.display = blocked ? "flex" : "none";
    if (text) text.textContent = `Vous avez bloqué ${usersById.get(peer)?.username || "ce contact"}.`;
    if (blocked) cancelEdit(true);
}

// ENVOYER UN MESSAGE CHIFFRÉ (ou valider une modification)
async function sendMessage() {
    const messageInput = messageInputEl();
    if (!messageInput || !activeChatUserId) return;
    if (editingMsg) return submitEdit();

    if (activeChat && activeChat.isGroup) {
        const text = messageInput.value.trim();
        if (!text) return;
        messageInput.value = "";
        return sendGroupMessage(text);
    }

    if (blockedByMe.has(activeChatUserId)) return;

    const rawText = messageInput.value.trim();
    if (!rawText) return;
    messageInput.value = "";

    const me = currentUser.uid;
    const peer = activeChatUserId;
    const chatDocRef = db.collection("chats").doc(getChatId(me, peer));

    try {
        const { iv, cipherText, keys } = await encryptForBoth(rawText, peer);

        // S'il vous a bloqué, le message reste « envoyé » (✓) sans jamais être remis, sans le signaler
        const suppressed = blockedMe.has(peer);

        await chatDocRef.collection("messages").add({
            senderId: me,
            receiverId: peer,
            iv, cipherText, keys,
            status: "sent",
            ...(suppressed ? { suppressed: true } : {}),
            timestamp: FieldValue.serverTimestamp()
        });

        // On ne stocke plus d'aperçu du message dans le document de chat (rien ne subsiste après suppression)
        const chatUpdate = { lastSenderId: me, timestamp: FieldValue.serverTimestamp() };
        if (!suppressed) chatUpdate[`unreadCount_${peer}`] = FieldValue.increment(1);
        await chatDocRef.set(chatUpdate, { merge: true });
    } catch (error) {
        console.error("Erreur lors de l'envoi du message chiffré :", error);
        if (!messageInput.value) messageInput.value = rawText;
        showToast("Message non envoyé", "Vérifiez votre connexion et réessayez.");
    }
}

// ============================================================================
// 15. CODE QR : mon code, scanner, lien direct
// ============================================================================
const scriptPromises = {};
function loadScriptAny(key, urls) {
    if (scriptPromises[key]) return scriptPromises[key];
    scriptPromises[key] = (async () => {
        let lastErr;
        for (const url of urls) {
            try {
                await new Promise((resolve, reject) => {
                    const s = document.createElement("script");
                    s.src = url;
                    s.async = true;
                    s.onload = resolve;
                    s.onerror = () => reject(new Error("Chargement impossible : " + url));
                    document.head.appendChild(s);
                });
                return;
            } catch (e) { lastErr = e; }
        }
        delete scriptPromises[key];
        throw lastErr;
    })();
    return scriptPromises[key];
}

function getProfileLink() {
    return `${location.origin}${location.pathname}?add=${encodeURIComponent(currentUser.uid)}`;
}
function copyProfileLink() {
    if (currentUser) copyText(getProfileLink(), "Lien copié");
}

async function fingerprint(str) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    return hex.slice(0, 32).toUpperCase().match(/.{1,4}/g).join(" ");
}

async function renderDeviceQrCard() {
    const tab = document.getElementById("tab-devices");
    if (!tab || !currentUser) return;

    let card = document.getElementById("xQrCard");
    if (!card) {
        card = mk("section", { id: "xQrCard", class: "x-qr-card" },
            mk("h3", { text: "Mon code QR" }),
            mk("p", { class: "x-qr-sub", text: "Faites scanner ce code pour démarrer une discussion avec vous." }),
            mk("div", { id: "xQrBox", class: "x-qr-box" }),
            mk("div", { id: "xQrName", class: "x-qr-name", text: myUsername }),
            mk("div", { class: "x-qr-actions" },
                mk("button", { type: "button", class: "x-btn x-btn-primary", onclick: openQrScanner }, ico("fa-solid fa-qrcode"), " Scanner un code"),
                mk("button", { type: "button", class: "x-btn x-btn-ghost", onclick: copyProfileLink }, ico("fa-regular fa-copy"), " Copier mon lien")
            )
        );
        tab.appendChild(card);
    }

    const box = card.querySelector("#xQrBox");
    const link = getProfileLink();
    if (box.dataset.link === link) return;
    box.dataset.link = link;
    box.textContent = "";

    try {
        await loadScriptAny("qrgen", QR_GEN_URLS);
        const size = window.innerWidth < 380 ? 160 : 200;
        new QRCode(box, { text: link, width: size, height: size, colorDark: "#0f172a", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
    } catch (e) {
        console.error(e);
        box.dataset.link = "";
        box.textContent = "Code indisponible : connexion requise pour le générer.";
    }
}

// Onglet « Appareils » : empreinte de la clé publique + code QR
async function loadDevicePublicKey() {
    const keyElement = document.getElementById("publicKeyDisplay");
    if (currentUser && keyElement) {
        try {
            const publicKey = await getPublicKey(currentUser.uid);
            keyElement.textContent = publicKey
                ? `Empreinte de ma clé publique : ${await fingerprint(publicKey)}`
                : "Aucune clé générée pour ce compte.";
        } catch (error) {
            console.error("Erreur de chargement de la clé :", error);
            keyElement.textContent = "Erreur lors du chargement de la clé.";
        }
    }
    renderDeviceQrCard();
}

function extractUidFromQr(value) {
    try {
        const uid = new URL(value).searchParams.get("add");
        if (uid) return uid;
    } catch (e) { /* pas une URL */ }
    const raw = String(value).trim();
    return /^[A-Za-z0-9]{20,40}$/.test(raw) ? raw : null;
}

function handleScannedUid(uid) {
    if (uid === currentUser.uid) {
        showToast("C'est votre propre code", "Faites-le scanner par quelqu'un d'autre.");
        return;
    }
    if (!openChatWith(uid)) showToast("Utilisateur introuvable", "Ce code ne correspond à aucun compte.");
}

async function openQrScanner() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast("Caméra indisponible", "Le scan nécessite une caméra et une connexion HTTPS.");
        return;
    }

    let stream = null;
    let rafId = 0;
    let stopped = false;

    const video = mk("video", { playsinline: "", autoplay: "" });
    video.muted = true;
    const hint = mk("div", { class: "x-scan-hint", text: "Placez le code QR dans le cadre" });

    const close = () => {
        stopped = true;
        cancelAnimationFrame(rafId);
        if (stream) stream.getTracks().forEach((t) => t.stop());
        document.removeEventListener("keydown", onKey);
        overlay.remove();
    };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    const overlay = mk("div", { class: "x-scanner" },
        video,
        mk("div", { class: "x-scan-frame" }),
        hint,
        mk("button", { type: "button", class: "x-btn x-btn-ghost x-scan-close", text: "Fermer", onclick: close })
    );
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey);

    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    } catch (e) {
        close();
        showToast("Caméra refusée", "Autorisez l'accès à la caméra pour scanner un code.");
        return;
    }
    if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }

    video.srcObject = stream;
    try { await video.play(); } catch (e) { /* lecture automatique bloquée : on continue */ }

    let detector = null;
    if ("BarcodeDetector" in window) {
        try { detector = new BarcodeDetector({ formats: ["qr_code"] }); } catch (e) { detector = null; }
    }
    if (!detector) {
        try {
            await loadScriptAny("jsqr", QR_SCAN_URLS);
        } catch (e) {
            close();
            showToast("Scanner indisponible", "Impossible de charger le lecteur de code QR.");
            return;
        }
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const tick = async () => {
        if (stopped) return;
        if (video.readyState >= 2 && video.videoWidth) {
            let value = null;
            try {
                if (detector) {
                    const codes = await detector.detect(video);
                    value = codes[0]?.rawValue || null;
                } else {
                    const scale = Math.min(1, 640 / video.videoWidth);
                    canvas.width = Math.round(video.videoWidth * scale);
                    canvas.height = Math.round(video.videoHeight * scale);
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const res = window.jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
                    value = res ? res.data : null;
                }
            } catch (e) { /* image illisible : on réessaie à l'image suivante */ }

            if (value) {
                const uid = extractUidFromQr(value);
                if (uid) { close(); handleScannedUid(uid); return; }
                hint.textContent = "Code non reconnu, réessayez";
            }
        }
        if (!stopped) rafId = requestAnimationFrame(tick);
    };
    tick();
}

// ============================================================================
// 16. PEERJS ET APPELS WEBRTC
// ============================================================================
function initPeerJS(userId) {
    if (peer && !peer.destroyed) return;
    if (typeof Peer === "undefined") {
        console.warn("PeerJS n'est pas chargé : les appels sont désactivés.");
        return;
    }

    peer = new Peer(userId, {
        config: {
            iceServers: [
                { urls: "stun:stun.l.google.com:19302" },
                { urls: "stun:stun1.l.google.com:19302" },
                { urls: "stun:stun2.l.google.com:19302" }
            ]
        }
    });

    peer.on("open", (id) => {
        console.log("Connecté au serveur PeerJS avec l'ID :", id);
    });

    peer.on("call", (call) => {
        if (blockedByMe.has(call.peer)) { call.close(); return; }
        incomingCall = call;
        showIncomingCallUI();
    });

    db.collection("calls")
        .where("receiverId", "==", userId)
        .where("status", "==", "calling")
        .onSnapshot((snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === "added") {
                    const callData = change.doc.data();
                    if (blockedByMe.has(callData.callerId)) return;
                    window.currentCallDocId = change.doc.id;
                    showIncomingCallUI(callData.callerName, callData.isVideo);
                }
                if (change.type === "modified" && change.doc.data().status === "ended") {
                    endCallUI();
                }
            });
        });
}

function showIncomingCallUI(callerName = "Un contact", isVideo = false) {
    const callModal = document.getElementById("callModal");
    const callStatus = document.getElementById("callStatus");
    const acceptBtn = document.getElementById("acceptCallBtn");

    if (callModal) callModal.style.display = "flex";
    if (callStatus) callStatus.textContent = `${callerName} vous appelle (${isVideo ? "Vidéo" : "Vocal"})...`;
    if (acceptBtn) acceptBtn.style.display = "inline-block";
}

async function startCall(targetUserId, isVideo = false) {
    if (!peer) return alert("Service d'appel non prêt.");
    if (blockedByMe.has(targetUserId)) {
        showToast("Contact bloqué", "Débloquez ce contact pour l'appeler.");
        return;
    }

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
        if (callStatus) callStatus.textContent = "Appel en cours...";
        if (acceptBtn) acceptBtn.style.display = "none";

        if (isVideo && videoContainer) {
            videoContainer.style.display = "block";
            const localVideo = document.getElementById("localVideo");
            if (localVideo) localVideo.srcObject = localStream;
        }

        const call = peer.call(targetUserId, localStream);
        currentCall = call;

        const callDoc = await db.collection("calls").add({
            callerId: currentUser.uid,
            callerName: currentUser.displayName || currentUser.email?.split("@")[0] || "Un contact",
            receiverId: targetUserId,
            isVideo: isVideo,
            status: "calling",
            timestamp: FieldValue.serverTimestamp()
        });

        window.currentCallDocId = callDoc.id;

        call.on("stream", (remoteStream) => {
            if (callStatus) callStatus.textContent = "En communication...";
            if (isVideo) {
                const remoteVideo = document.getElementById("remoteVideo");
                if (remoteVideo) remoteVideo.srcObject = remoteStream;
            } else {
                const remoteAudio = document.getElementById("remoteAudio");
                if (remoteAudio) remoteAudio.srcObject = remoteStream;
            }
        });

        call.on("close", endCall);

    } catch (err) {
        console.error("Erreur lancement appel :", err);
        alert("Permission refusée pour la caméra/micro.");
    }
}

function endCallUI() {
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

async function endCall() {
    endCallUI();

    if (window.currentCallDocId) {
        try {
            await db.collection("calls").doc(window.currentCallDocId).update({
                status: "ended"
            });
            window.currentCallDocId = null;
        } catch (e) {
            console.warn("Erreur fermeture appel Firestore :", e);
        }
    }
}

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

                if (callStatus) callStatus.textContent = "En communication...";
                acceptCallBtn.style.display = "none";

                incomingCall.answer(localStream);
                currentCall = incomingCall;

                currentCall.on("stream", (remoteStream) => {
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

                currentCall.on("close", endCall);

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
