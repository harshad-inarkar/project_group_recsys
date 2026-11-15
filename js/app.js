import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, getDocs, updateDoc, arrayUnion, collection, query, where, documentId } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCmrY4OLmNdTFS_jBQdzAKMMtARAegB5kw",
    authDomain: "project-group-4ab7c.firebaseapp.com",
    projectId: "project-group-4ab7c",
    storageBucket: "project-group-4ab7c.firebasestorage.app",
    messagingSenderId: "714689701833",
    appId: "1:714689701833:web:dc3ee180c4f83e515f6a18"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
window.auth = auth;

const WEBHOOK_EMBED_PROFILE = "https://harshad-agentic-demo.app.n8n.cloud/webhook/embed-profile";
const WEBHOOK_GET_RECO = "https://harshad-agentic-demo.app.n8n.cloud/webhook/get-recommendations";

let currentUserProfile = null;

// Utility: Professional Toast Notifications
function showToast(message, type = "success") {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = `toast ${type} show`;
    toast.innerText = message;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 300); }, 3000);
}

// Handle UI State based on login
onAuthStateChanged(auth, async (user) => {
    if (user) {
        document.getElementById("auth-section").classList.add("hidden");
        document.getElementById("app-section").classList.remove("hidden");
        await loadUserProfile(user.uid);
    } else {
        document.getElementById("auth-section").classList.remove("hidden");
        document.getElementById("app-section").classList.add("hidden");
        currentUserProfile = null;
    }
});

// Registration
document.getElementById("btn-register").addEventListener("click", async () => {
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;
    const name = document.getElementById("name").value.trim();

    if (!email || !password || !name) {
        showToast("Email, Password, and Full Name are required.", "error");
        return;
    }

    const userData = {
        name: name,
        exp: document.getElementById("exp").value,
        city: document.getElementById("city").value,
        background: document.getElementById("background").value,
        current_domain: document.getElementById("domain").value,
        project_domain: document.getElementById("proj_domain").value,
        project_desc: document.getElementById("proj_desc").value,
        status: "open",
        partner_uid: null,
        interests_received: []
    };

    try {
        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        userData.uid = userCred.user.uid;

        await setDoc(doc(db, "users", userCred.user.uid), userData);

        const combinedText = `Experience: ${userData.exp}, City: ${userData.city}, Domain: ${userData.current_domain}, Project: ${userData.project_desc}`;
        fetch(WEBHOOK_EMBED_PROFILE, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uid: userData.uid, combinedText: combinedText, status: userData.status })
        });

        showToast("Profile created successfully!");
    } catch (error) {
        showToast(error.message, "error");
    }
});

// Login
document.getElementById("btn-login").addEventListener("click", async () => {
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;
    if (!email || !password) return showToast("Enter email and password", "error");

    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        showToast("Login failed: " + error.message, "error");
    }
});

// Load Profile Data
async function loadUserProfile(uid) {
    const docSnap = await getDoc(doc(db, "users", uid));
    if (docSnap.exists()) {
        currentUserProfile = docSnap.data();
        document.getElementById("welcome-msg").innerText = `Welcome, ${currentUserProfile.name}`;
        populateProfileForm(currentUserProfile);

        if (currentUserProfile.status === "teamed") {
            document.getElementById("partner-alert").classList.remove("hidden");
            document.querySelector(".tab-bar").classList.add("hidden");
            document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
            fetchAndRenderUsers([currentUserProfile.partner_uid], "partner-details", false, false);
        } else {
            loadAllMembers();
            loadInterests();
        }
    }
}

// Populate the "My Profile" tab form
function populateProfileForm(data) {
    document.getElementById("edit_name").value = data.name || "";
    document.getElementById("edit_exp").value = data.exp || "0-4";
    document.getElementById("edit_city").value = data.city || "";
    document.getElementById("edit_background").value = data.background || "Tech";
    document.getElementById("edit_domain").value = data.current_domain || "";
    document.getElementById("edit_proj_domain").value = data.project_domain || "";
    document.getElementById("edit_proj_desc").value = data.project_desc || "";
    document.getElementById("edit_status").value = data.status || "open";
}

// Update Profile
document.getElementById("btn-update-profile").addEventListener("click", async () => {
    const name = document.getElementById("edit_name").value.trim();
    if (!name) return showToast("Name is required", "error");

    const updatedData = {
        name: name,
        exp: document.getElementById("edit_exp").value,
        city: document.getElementById("edit_city").value,
        background: document.getElementById("edit_background").value,
        current_domain: document.getElementById("edit_domain").value,
        project_domain: document.getElementById("edit_proj_domain").value,
        project_desc: document.getElementById("edit_proj_desc").value,
        status: document.getElementById("edit_status").value
    };

    try {
        await updateDoc(doc(db, "users", auth.currentUser.uid), updatedData);

        // Push update to n8n to sync Vector Store
        const combinedText = `Experience: ${updatedData.exp}, City: ${updatedData.city}, Domain: ${updatedData.current_domain}, Project: ${updatedData.project_desc}`;
        fetch(WEBHOOK_EMBED_PROFILE, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uid: auth.currentUser.uid, combinedText: combinedText, status: updatedData.status })
        });

        showToast("Profile updated successfully!");
        loadUserProfile(auth.currentUser.uid); // Refresh state
    } catch (e) {
        showToast("Failed to update profile", "error");
    }
});

// Central Render Function for DOM manipulation
function renderUserCards(usersDataArray, containerId, allowActions = true, isIncomingInterest = false) {
    const container = document.getElementById(containerId);
    if (!usersDataArray || usersDataArray.length === 0) {
        container.innerHTML = "<p class='text-muted'>No members found in this category.</p>";
        return;
    }

    let html = "";
    usersDataArray.forEach((u) => {
        html += `
        <div class="card user-card">
            <h4>${u.name} <span class="badge">${u.city || 'No City'}</span></h4>
            <div class="user-card-meta">
                <div><strong>Exp:</strong> ${u.exp}</div>
                <div><strong>Domain:</strong> ${u.current_domain}</div>
                <div><strong>Background:</strong> ${u.background}</div>
                <div><strong>Target:</strong> ${u.project_domain}</div>
            </div>
            <p style="margin-top:10px;"><strong>Project Idea:</strong><br/> ${u.project_desc || '<span class="text-muted">None provided</span>'}</p>
            <div class="user-card-actions">
                ${allowActions ? `<button class="btn btn-outline" onclick="sendInterest('${u.id}')">Send Interest</button>` : ''}
                ${isIncomingInterest ? `<button class="btn btn-primary" onclick="acceptInterest('${u.id}')">Accept & Team Up</button>` : ''}
            </div>
        </div>`;
    });
    container.innerHTML = html;
}

// Fetch by UIDs (handles Firebase "in" query limits via chunking)
async function fetchAndRenderUsers(uidArray, containerId, allowActions = true, isIncomingInterest = false) {
    if (!uidArray || uidArray.length === 0) return renderUserCards([], containerId);

    document.getElementById(containerId).innerHTML = "<p class='text-muted'>Loading profiles...</p>";
    let allUsers = [];

    // Chunk array to bypass Firebase's 10-item limit for 'in' queries
    for (let i = 0; i < uidArray.length; i += 10) {
        const chunk = uidArray.slice(i, i + 10);
        const q = query(collection(db, "users"), where(documentId(), "in", chunk));
        const snap = await getDocs(q);
        snap.forEach(docSnap => allUsers.push({ id: docSnap.id, ...docSnap.data() }));
    }

    renderUserCards(allUsers, containerId, allowActions, isIncomingInterest);
}

// Direct Database Fetch for "All Members" (bypasses UID array matching entirely)
async function loadAllMembers() {
    document.getElementById("all-results").innerHTML = "<p class='text-muted'>Loading open members...</p>";
    const q = query(collection(db, "users"), where("status", "==", "open"));
    const querySnapshot = await getDocs(q);

    let allUsers = [];
    querySnapshot.forEach(d => {
        if (d.id !== auth.currentUser.uid) {
            allUsers.push({ id: d.id, ...d.data() });
        }
    });

    renderUserCards(allUsers, "all-results", true, false);
}

// Fetch AI Recos
document.getElementById("btn-get-reco").addEventListener("click", async () => {
    document.getElementById("reco-results").innerHTML = "<p class='text-muted'>Scanning vector database...</p>";
    const combinedText = `Experience: ${currentUserProfile.exp}, City: ${currentUserProfile.city}, Domain: ${currentUserProfile.current_domain}, Project: ${currentUserProfile.project_desc}`;

    try {
        const res = await fetch(WEBHOOK_GET_RECO, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uid: auth.currentUser.uid, combinedText: combinedText })
        });
        const matches = await res.json();
        fetchAndRenderUsers(matches, "reco-results");
    } catch (e) {
        showToast("Error connecting to AI", "error");
        document.getElementById("reco-results").innerHTML = "<p class='text-muted'>Failed to load matches.</p>";
    }
});

// Load Interests
function loadInterests() {
    fetchAndRenderUsers(currentUserProfile.interests_received, "interests-results", false, true);
}

// Global actions exposed to window for inline onclicks
window.sendInterest = async (targetUid) => {
    try {
        await updateDoc(doc(db, "users", targetUid), { interests_received: arrayUnion(auth.currentUser.uid) });
        showToast("Interest sent to user!");
    } catch (e) { showToast("Failed to send interest", "error"); }
};

window.acceptInterest = async (requesterUid) => {
    try {
        await updateDoc(doc(db, "users", auth.currentUser.uid), { status: "teamed", partner_uid: requesterUid });
        await updateDoc(doc(db, "users", requesterUid), { status: "teamed", partner_uid: auth.currentUser.uid });

        fetch(WEBHOOK_EMBED_PROFILE, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uid: auth.currentUser.uid, combinedText: "", status: "teamed" })
        });
        fetch(WEBHOOK_EMBED_PROFILE, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uid: requesterUid, combinedText: "", status: "teamed" })
        });

        showToast("Team successfully formed!");
        setTimeout(() => window.location.reload(), 1500);
    } catch (e) { showToast("Failed to form team", "error"); }
};