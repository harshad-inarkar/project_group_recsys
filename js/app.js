import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, getDocs, updateDoc, arrayUnion, collection, query, where, documentId } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// 1. Firebase Config (Paste from your Firebase Console)
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

// Your n8n Webhook URLs
const WEBHOOK_CREATE_PROFILE = "https://YOUR_N8N_URL/webhook/create-profile";
const WEBHOOK_GET_RECO = "https://YOUR_N8N_URL/webhook/get-recommendations";
const WEBHOOK_ACCEPT_INTEREST = "https://YOUR_N8N_URL/webhook/accept-interest";

let currentUserProfile = null;

// 2. Auth State Listener
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

// 3. Register & Login Handlers
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
        status: "open",
        partner_uid: null,
        interests_received: [],
        random_matches: []
    };

    try {
        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        userData.uid = userCred.user.uid;
        userData.email = email;

        // Save to Firebase
        await setDoc(doc(db, "users", userCred.user.uid), userData);

        // Send to n8n to generate Pinecone Vector Embedding
        await fetch(WEBHOOK_CREATE_PROFILE, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(userData)
        });

        alert("Profile created successfully!");
    } catch (error) {
        alert("Error: " + error.message);
    }
});

document.getElementById("btn-login").addEventListener("click", async () => {
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;
    try { await signInWithEmailAndPassword(auth, email, password); }
    catch (error) { alert("Login failed: " + error.message); }
});

// 4. Load Profile & Render Dashboard
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
            loadRandomMatches();
            loadInterests();
        }
    }
}

// 5. Send Interest (Direct Firebase Update)
window.sendInterest = async (targetUid) => {
    try {
        await updateDoc(doc(db, "users", targetUid), {
            interests_received: arrayUnion(auth.currentUser.uid)
        });
        alert("Interest sent successfully!");
    } catch (e) {
        console.error(e);
    }
};

// 6. Accept Interest (Triggers n8n Workflow)
window.acceptInterest = async (requesterUid) => {
    try {
        await fetch(WEBHOOK_ACCEPT_INTEREST, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                user1_uid: auth.currentUser.uid,
                user2_uid: requesterUid
            })
        });
        alert("Team formed! Refreshing...");
        window.location.reload();
    } catch (e) {
        console.error(e);
    }
};

// 7. Render UI Data functions
async function fetchAndRenderUsers(uidArray, containerId, allowActions = true, isIncomingInterest = false) {
    const container = document.getElementById(containerId);
    container.innerHTML = "Loading...";

    if (!uidArray || uidArray.length === 0) {
        container.innerHTML = "<p>No users found.</p>";
        return;
    }

    // Firebase 'in' queries have a limit of 10, which is fine for our batches of 5
    const q = query(collection(db, "users"), where(documentId(), "in", uidArray));
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

// Fetch AI Recos from n8n/Pinecone
document.getElementById("btn-get-reco").addEventListener("click", async () => {
    document.getElementById("reco-results").innerHTML = "Calling AI Engine...";
    const res = await fetch(WEBHOOK_GET_RECO, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            uid: auth.currentUser.uid,
            combinedText: `${currentUserProfile.exp} ${currentUserProfile.project_desc} ${currentUserProfile.city}`
        })
    });
    const topMatchesUids = await res.json(); // n8n should return an array like ["uid1", "uid2"]
    fetchAndRenderUsers(topMatchesUids, "reco-results");
});

// Load standard tabs
async function loadAllMembers() {
    const q = query(collection(db, "users"), where("status", "==", "open"));
    const querySnapshot = await getDocs(q);
    let uids = [];
    querySnapshot.forEach(d => { if (d.id !== auth.currentUser.uid) uids.push(d.id); });

    // Chunking to handle Firebase 'in' limit of 10 if you have more than 10 open users
    if (uids.length > 10) uids = uids.slice(0, 10);
    fetchAndRenderUsers(uids, "all-results");
}

function loadRandomMatches() {
    fetchAndRenderUsers(currentUserProfile.random_matches, "random-results");
}

function loadInterests() {
    fetchAndRenderUsers(currentUserProfile.interests_received, "interests-results", false, true);
}