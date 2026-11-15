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
window.auth = auth; // Expose for logout button

// n8n Webhook URLs (Replace with your Production URLs)
const WEBHOOK_EMBED_PROFILE = "https://harshad-agentic-demo.app.n8n.cloud/webhook/embed-profile";
const WEBHOOK_GET_RECO = "https://harshad-agentic-demo.app.n8n.cloud/webhook/get-recommendations";

let currentUserProfile = null;

// Handle UI State based on login
onAuthStateChanged(auth, async (user) => {
    if (user) {
        document.getElementById("auth-section").classList.add("hidden");
        document.getElementById("app-section").classList.remove("hidden");
        await loadUserProfile(user.uid);
    } else {
        document.getElementById("auth-section").classList.remove("hidden");
        document.getElementById("app-section").classList.add("hidden");
    }
});

// Registration
document.getElementById("btn-register").addEventListener("click", async () => {
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    const userData = {
        name: document.getElementById("name").value,
        exp: document.getElementById("exp").value,
        city: document.getElementById("city").value,
        background: document.getElementById("background").value,
        current_domain: document.getElementById("domain").value,
        project_domain: document.getElementById("proj_domain").value,
        project_desc: document.getElementById("proj_desc").value,
        status: "open", // Initial status explicitly set
        partner_uid: null,
        interests_received: []
    };

    try {
        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        userData.uid = userCred.user.uid;

        // 1. Save to Firebase
        await setDoc(doc(db, "users", userCred.user.uid), userData);

        // 2. Send to n8n Pinecone for AI Search compatibility
        const combinedText = `Experience: ${userData.exp}, City: ${userData.city}, Domain: ${userData.current_domain}, Project: ${userData.project_desc}`;
        await fetch(WEBHOOK_EMBED_PROFILE, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uid: userData.uid, combinedText: combinedText, status: userData.status })
        });

        alert("Profile created! You can now find matches.");
    } catch (error) {
        alert("Error: " + error.message);
    }
});

// Login
document.getElementById("btn-login").addEventListener("click", async () => {
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;
    try { await signInWithEmailAndPassword(auth, email, password); }
    catch (error) { alert("Login failed: " + error.message); }
});

// Load Profile
async function loadUserProfile(uid) {
    const docSnap = await getDoc(doc(db, "users", uid));
    if (docSnap.exists()) {
        currentUserProfile = docSnap.data();
        document.getElementById("welcome-msg").innerText = `Welcome, ${currentUserProfile.name}`;

        if (currentUserProfile.status === "teamed") {
            document.getElementById("partner-alert").classList.remove("hidden");
            document.querySelector(".tab-bar").classList.add("hidden");
            fetchAndRenderUsers([currentUserProfile.partner_uid], "partner-details", false);
        } else {
            loadAllMembers();
            loadInterests();
        }
    }
}

// Send Interest (Firebase direct)
window.sendInterest = async (targetUid) => {
    try {
        await updateDoc(doc(db, "users", targetUid), {
            interests_received: arrayUnion(auth.currentUser.uid)
        });
        alert("Interest sent!");
    } catch (e) { console.error(e); }
};

// Accept Interest (Updates Firebase & Pinecone metadata)
window.acceptInterest = async (requesterUid) => {
    try {
        // Update self
        await updateDoc(doc(db, "users", auth.currentUser.uid), { status: "teamed", partner_uid: requesterUid });
        // Update partner
        await updateDoc(doc(db, "users", requesterUid), { status: "teamed", partner_uid: auth.currentUser.uid });

        // Tell n8n to update Pinecone statuses to "teamed" so they stop showing in AI results
        await fetch(WEBHOOK_EMBED_PROFILE, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uid: auth.currentUser.uid, combinedText: "", status: "teamed" })
        });
        await fetch(WEBHOOK_EMBED_PROFILE, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uid: requesterUid, combinedText: "", status: "teamed" })
        });

        alert("Team formed!");
        window.location.reload();
    } catch (e) { console.error(e); }
};

// Render User Cards
async function fetchAndRenderUsers(uidArray, containerId, allowActions = true, isIncomingInterest = false) {
    const container = document.getElementById(containerId);
    if (!uidArray || uidArray.length === 0) {
        container.innerHTML = "<p>No users found.</p>";
        return;
    }

    const q = query(collection(db, "users"), where(documentId(), "in", uidArray.slice(0, 10)));
    const querySnapshot = await getDocs(q);

    let html = "";
    querySnapshot.forEach((docSnap) => {
        const u = docSnap.data();
        html += `
      <div class="card">
        <h4>${u.name} (${u.city})</h4>
        <p>Exp: ${u.exp} | Domain: ${u.current_domain} | BG: ${u.background}</p>
        <p>Project Idea: ${u.project_desc}</p>
        ${allowActions ? `<button onclick="sendInterest('${docSnap.id}')">Send Interest</button>` : ''}
        ${isIncomingInterest ? `<button onclick="acceptInterest('${docSnap.id}')">Accept & Team Up</button>` : ''}
      </div>
    `;
    });
    container.innerHTML = html;
}

// Fetch AI Recos
document.getElementById("btn-get-reco").addEventListener("click", async () => {
    document.getElementById("reco-results").innerHTML = "Searching Vector Database...";
    const combinedText = `Experience: ${currentUserProfile.exp}, City: ${currentUserProfile.city}, Domain: ${currentUserProfile.current_domain}, Project: ${currentUserProfile.project_desc}`;

    const res = await fetch(WEBHOOK_GET_RECO, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: auth.currentUser.uid, combinedText: combinedText })
    });

    const matches = await res.json();
    fetchAndRenderUsers(matches, "reco-results");
});

async function loadAllMembers() {
    const q = query(collection(db, "users"), where("status", "==", "open"));
    const querySnapshot = await getDocs(q);
    let uids = [];
    querySnapshot.forEach(d => { if (d.id !== auth.currentUser.uid) uids.push(d.id); });
    fetchAndRenderUsers(uids, "all-results");
}

function loadInterests() {
    fetchAndRenderUsers(currentUserProfile.interests_received, "interests-results", false, true);
}