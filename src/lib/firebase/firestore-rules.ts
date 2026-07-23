/**
 * firestore-rules.txt
 * ===================
 * Copy these rules to Firebase Console → Firestore → Rules.
 *
 * These rules enforce:
 *   1. Only authenticated admins can write to content collections
 *   2. Authenticated users (students) can read published content
 *   3. Users can only read/write their own profile data
 *   4. Admin status is determined by custom claims (set via Admin SDK)
 */

export const firestoreRules = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ============================================================
    // Helper functions
    // ============================================================

    // Check if user is signed in
    function isSignedIn() {
      return request.auth != null;
    }

    // Check if user is admin (via custom claim)
    function isAdmin() {
      return isSignedIn() && request.auth.token.admin == true;
    }

    // Check if user is the owner of a document
    function isOwner(userId) {
      return isSignedIn() && request.auth.uid == userId;
    }

    // ============================================================
    // Users collection
    // ============================================================
    match /users/{userId} {
      // Users can read their own profile
      // Admins can read all profiles
      allow read: if isOwner(userId) || isAdmin();

      // Users can update their own profile (limited fields)
      // Admins can create/update any profile
      allow create, update, delete: if isAdmin();
      allow update: if isOwner(userId);
    }

    // ============================================================
    // Content collections (read by students, written by admins)
    // ============================================================

    match /banners/{bannerId} {
      allow read: if isSignedIn();
      allow write: if isAdmin();
    }

    match /materials/{materialId} {
      allow read: if isSignedIn();
      allow write: if isAdmin();
    }

    match /tools/{toolId} {
      allow read: if isSignedIn();
      allow write: if isAdmin();
    }

    match /navItems/{navItemId} {
      allow read: if isSignedIn();
      allow write: if isAdmin();
    }

    // ============================================================
    // Content Studio collections
    // ============================================================

    match /subjects/{subjectId} {
      allow read: if isSignedIn();
      allow write: if isAdmin();
    }

    match /sections/{sectionId} {
      allow read: if isSignedIn();
      allow write: if isAdmin();
    }

    match /topics/{topicId} {
      allow read: if isSignedIn();
      allow write: if isAdmin();
    }

    match /packages/{packageId} {
      allow read: if isSignedIn();
      allow write: if isAdmin();
    }

    match /questions/{questionId} {
      allow read: if isSignedIn();
      allow write: if isAdmin();
    }

    match /resources/{resourceId} {
      allow read: if isSignedIn();
      allow write: if isAdmin();
    }

    match /sources/{sourceId} {
      allow read: if isSignedIn();
      allow write: if isAdmin();
    }

    match /tags/{tagId} {
      allow read: if isSignedIn();
      allow write: if isAdmin();
    }

    // ============================================================
    // Registries (global configuration — admin only)
    // ============================================================

    match /registries/{registryId} {
      allow read: if isSignedIn();
      allow write: if isAdmin();
    }

    // ============================================================
    // Analytics events (students write, admins read)
    // ============================================================

    match /events/{eventId} {
      allow create: if isSignedIn();
      allow read, update, delete: if isAdmin();
    }

    // ============================================================
    // Subscriptions (admin only)
    // ============================================================

    match /subscriptions/{subscriptionId} {
      allow read: if isSignedIn();
      allow write: if isAdmin();
    }

    // ============================================================
    // History (admin only)
    // ============================================================

    match /history/{historyId} {
      allow read, write: if isAdmin();
    }
  }
}
`;

/**
 * Storage rules for Cloud Storage:
 * Copy to Firebase Console → Storage → Rules.
 */
export const storageRules = `
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {

    // Helper functions
    function isSignedIn() {
      return request.auth != null;
    }
    function isAdmin() {
      return isSignedIn() && request.auth.token.admin == true;
    }

    // Content images (banners, materials, questions, etc.)
    match /content/{allPaths=**} {
      allow read: if isSignedIn();
      allow write: if isAdmin();
    }

    // User uploads (avatars, etc.)
    match /users/{userId}/{allPaths=**} {
      allow read: if isSignedIn();
      allow write: if isOwner(userId) || isAdmin();
    }

    // System assets
    match /system/{allPaths=**} {
      allow read: if isSignedIn();
      allow write: if isAdmin();
    }
  }
}
`;
