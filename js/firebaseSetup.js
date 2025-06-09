import { initializeApp } from "https://www.gstatic.com/firebasejs/11.8.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.8.1/firebase-analytics.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/11.8.1/firebase-auth.js";
import { getFirestore, collection, addDoc, serverTimestamp,doc, setDoc, getDoc} from "https://www.gstatic.com/firebasejs/11.8.1/firebase-firestore.js";
import { getStorage, ref as storageRef, uploadBytes, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.8.1/firebase-storage.js";

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyC0Q3gTe0QnKlbCmGn0fDsQeaiPoA9mTDE",
  authDomain: "mcree-ed-consulting.firebaseapp.com",
  projectId: "mcree-ed-consulting",
  storageBucket: "mcree-ed-consulting.firebasestorage.app",
  messagingSenderId: "48273856960",
  appId: "1:48273856960:web:261f03220536a53f47d025",
  measurementId: "G-TJBC1NLZP0"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const db = getFirestore(app);
export const storage = getStorage(app);


export {
  serverTimestamp,
  doc,
  setDoc,
  getDoc,
  collection,
  addDoc,
  storageRef,
  uploadBytes,
  uploadBytesResumable,
  getDownloadURL
};
