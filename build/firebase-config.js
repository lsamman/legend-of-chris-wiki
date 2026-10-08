// Firebase settings for the reading page and the writing room.
// Paste the values from Firebase console → Project settings → Your apps → Web app.
// These are meant to be public: the rules in firestore.rules decide who can write.
export const firebaseConfig = {
  apiKey: "AIzaSyAGduoa9uwFkXiclTJeI62jlR560AMvE7c",
  authDomain: "wikiloc-1c367.firebaseapp.com",
  projectId: "wikiloc-1c367",
  appId: "1:576514283395:web:3f1425c22800eaf0e388b6",
  messagingSenderId: "576514283395"
};

// Optional: your own Web Push key (Firebase console → Project settings → Cloud Messaging →
// Web Push certificates). Left empty, Firebase's built-in key is used, which works too.
export const vapidKey = "";
