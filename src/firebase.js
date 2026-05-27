import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDjL2RBXUZLiVKXwstFGMyf3HLv_FT-iaE",
  authDomain: "thermal-advice-497619-i3.firebaseapp.com",
  projectId: "thermal-advice-497619-i3",
  storageBucket: "thermal-advice-497619-i3.firebasestorage.app",
  messagingSenderId: "640135908002",
  appId: "1:640135908002:web:49800e08572607f80665fb",
  measurementId: "G-51B3E2B6T7"
};

const app      = initializeApp(firebaseConfig);
const auth     = getAuth(app);
const analytics = getAnalytics(app);

const provider = new GoogleAuthProvider();
provider.addScope("profile");
provider.addScope("email");
provider.setCustomParameters({ prompt: "select_account" });

export async function signInWithGoogle() {
  const result  = await signInWithPopup(auth, provider);
  const user    = result.user;
  const idToken = await user.getIdToken();
  return {
    idToken,
    name:   user.displayName || "",
    email:  user.email       || "",
    avatar: user.photoURL    || "",
    uid:    user.uid,
  };
}

export async function signOutFirebase() {
  await firebaseSignOut(auth);
}

export { auth, analytics, onAuthStateChanged };
export default app;
